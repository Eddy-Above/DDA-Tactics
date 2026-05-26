import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns, evolutionLines } from '../../../../db'
import { applyEffectToParticipant } from '../../../../utils/applyEffect'
import { type AreaAttackClaim, allAreaTargetsDecided, resolveAreaIntercedeGroup } from '~/server/utils/resolveAreaIntercedeGroup'
import { computeAttackDamage } from '~/server/utils/computeAttackDamage'

interface IntercedeClaimBody {
  requestId: string
  interceptorParticipantId: string
  chosenTargetId?: string // Required for area attacks
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeClaimBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId || !body.interceptorParticipantId) {
    throw createError({ statusCode: 400, message: 'requestId and interceptorParticipantId are required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Fetch campaign house rules
  let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = typeof campaign.rulesSettings === 'string'
        ? JSON.parse(campaign.rulesSettings) : (campaign.rulesSettings || {})
      houseRules = rulesSettings.houseRules
    }
  }

  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try { return JSON.parse(field) } catch { return [] }
    }
    return []
  }

  let participants = parseJsonField(encounter.participants)
  let pendingRequests = parseJsonField(encounter.pendingRequests)
  let battleLog = parseJsonField(encounter.battleLog)

  let participantPositions: Record<string, { x: number; y: number; z: number }> = (() => {
    const raw = (encounter as any).participantPositions
    if (!raw) return {}
    try { return typeof raw === 'string' ? JSON.parse(raw) : raw } catch { return {} }
  })()

  // Find the request
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  const intercedeGroupId = request.data.intercedeGroupId
  const isAreaAttack = !!request.data.isAreaAttack

  // Determine effective target — area attacks use chosenTargetId
  let effectiveTargetId: string
  let effectiveTargetName: string

  if (isAreaAttack) {
    if (!body.chosenTargetId) {
      throw createError({ statusCode: 400, message: 'chosenTargetId is required for area attacks' })
    }
    if (!request.data.areaTargetIds?.includes(body.chosenTargetId)) {
      throw createError({ statusCode: 400, message: 'chosenTargetId is not a valid target for this request' })
    }
    // 409 check: is chosen target still available (not already claimed by another interceptor)?
    const stillAvailable = pendingRequests.some(
      (r: any) => r.data?.intercedeGroupId === intercedeGroupId && r.data?.areaTargetIds?.includes(body.chosenTargetId)
    )
    if (!stillAvailable) {
      throw createError({ statusCode: 409, message: 'Target already claimed by another interceptor' })
    }
    effectiveTargetId = body.chosenTargetId
    const chosenParticipant = participants.find((p: any) => p.id === body.chosenTargetId)
    if (chosenParticipant?.type === 'digimon') {
      const [dig] = await db.select().from(digimon).where(eq(digimon.id, chosenParticipant.entityId))
      effectiveTargetName = dig?.name || body.chosenTargetId
    } else if (chosenParticipant?.type === 'tamer') {
      const [tam] = await db.select().from(tamers).where(eq(tamers.id, chosenParticipant.entityId))
      effectiveTargetName = tam?.name || body.chosenTargetId
    } else {
      effectiveTargetName = body.chosenTargetId
    }
  } else {
    // Single-target 409 check: if no group requests left, someone already claimed
    const groupRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)
    if (groupRequests.length === 0) {
      throw createError({ statusCode: 409, message: 'Another player already interceded' })
    }
    effectiveTargetId = request.data.targetId
    effectiveTargetName = request.data.targetName || 'Unknown'
  }

  // Find interceptor
  const interceptor = participants.find((p: any) => p.id === body.interceptorParticipantId)
  if (!interceptor) {
    throw createError({ statusCode: 404, message: 'Interceptor not found' })
  }

  // Interceptor cannot be the same as the target
  if (body.interceptorParticipantId === effectiveTargetId) {
    throw createError({ statusCode: 400, message: 'Interceptor cannot be the same as the target' })
  }

  // Interceptor cannot be the same as the attacker
  if (body.interceptorParticipantId === request.data.attackerId) {
    throw createError({ statusCode: 400, message: 'Attacker cannot intercede their own attack' })
  }

  // Determine if interceptor's turn has already happened this round
  let turnOrder = parseJsonField(encounter.turnOrder)
  const currentTurnIndex = encounter.currentTurnIndex || 0
  let turnHasGone = false

  if (interceptor.type === 'tamer') {
    const idx = turnOrder.indexOf(interceptor.id)
    turnHasGone = idx >= 0 && idx < currentTurnIndex
  } else if (interceptor.type === 'digimon') {
    // Partner digimon use the hasActed flag set at tamer turn-end
    const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, interceptor.entityId))
    if (digimonEntity?.partnerId) {
      // Player digimon: use hasActed flag (set when partner tamer's turn ends)
      turnHasGone = !!interceptor.hasActed
    } else {
      // NPC digimon — check own turn position directly
      const idx = turnOrder.indexOf(interceptor.id)
      turnHasGone = idx >= 0 && idx < currentTurnIndex
    }
  }

  // Validate against the INTERCEPTOR directly
  if (!turnHasGone) {
    // Must have an action to spend THIS round
    if ((interceptor.actionsRemaining?.simple || 0) < 1) {
      throw createError({ statusCode: 400, message: 'Not enough actions to intercede' })
    }
  } else {
    // Already acted — check deferred intercede cap (maxPostTurnIntercedes, default 2)
    const postTurnCap = interceptor.type === 'digimon'
      ? (interceptor.maxPostTurnIntercedes ?? 2)
      : 2
    if ((interceptor.interceptPenalty || 0) >= postTurnCap) {
      throw createError({ statusCode: 400, message: 'No more intercede actions available for next round' })
    }
  }

  // Get interceptor name
  let interceptorName = 'Unknown'
  if (interceptor.type === 'digimon') {
    const [dig] = await db.select().from(digimon).where(eq(digimon.id, interceptor.entityId))
    interceptorName = dig?.name || 'Digimon'
  }

  const { accuracySuccesses, attackerId, attackData } = request.data
  const attacker = participants.find((p: any) => p.id === attackerId)
  const isSupportAttack = request.data.isSupportAttack || false

  // Single-target position swap: interceptor steps into intercedee's tile;
  // intercedee moves one step further from the attacker.
  let updatedParticipantPositions: Record<string, { x: number; y: number; z: number }> | null = null
  if (!isAreaAttack && (encounter as any).mapId) {
    const interceptorPos = participantPositions[body.interceptorParticipantId]
    const targetPos = participantPositions[effectiveTargetId]
    const attackerPos = participantPositions[attackerId]
    if (interceptorPos && targetPos && attackerPos) {
      const dir = {
        x: Math.sign(targetPos.x - attackerPos.x),
        y: Math.sign(targetPos.y - attackerPos.y),
        z: Math.sign(targetPos.z - attackerPos.z),
      }
      updatedParticipantPositions = { ...participantPositions }
      updatedParticipantPositions[body.interceptorParticipantId] = { ...targetPos }
      const hasDirection = dir.x !== 0 || dir.y !== 0 || dir.z !== 0
      if (hasDirection) {
        updatedParticipantPositions[effectiveTargetId] = {
          x: targetPos.x + dir.x,
          y: targetPos.y + dir.y,
          z: targetPos.z + dir.z,
        }
      }
    }
  }

  // Compute damage using shared canonical function (dodge successes = 0 for intercede)
  const damageCalc = await computeAttackDamage({
    attackerParticipant: attacker,
    targetParticipant: interceptor,
    attackId: request.data.attackId,
    attackerName: request.data.attackerName,
    accuracySuccesses,
    dodgeSuccesses: 0,
    isSignatureMove: request.data.isSignatureMove,
    batteryCount: request.data.batteryCount,
    houseRules,
  })

  const npcAttackDef = damageCalc.attackDef
  const attackBaseDamage = damageCalc.attackBaseDamage
  const armorPiercing = damageCalc.armorPiercing
  const interceptorArmor = damageCalc.targetArmor
  const effectiveArmor = damageCalc.effectiveArmor
  const damageDealt = damageCalc.damageDealt
  const netSuccesses = damageCalc.netSuccesses
  // hit is always true for intercede (dodgeSuccesses = 0, so netSuccesses >= 0)

  // --- Support attack: no damage, apply N effect only ---
  if (isSupportAttack) {
    let appliedEffectName: string | null = null

    const supportPotency = damageCalc.effectData?.potency ?? 0
    const supportPotencyStat = damageCalc.effectData?.potencyStat ?? 'bit'

    let stunActionReducedThisRound = false

    participants = participants.map((p: any) => {
      if (p.id === body.interceptorParticipantId) {
        const updated = {
          ...p,
          // Deduct/defer action at claim time (prevents double-spending before resolution)
          ...(!turnHasGone
            ? { actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) } }
            : { interceptPenalty: (p.interceptPenalty || 0) + 1 }
          ),
        }

        // Stun extra action deduction: apply at claim time for all attacks
        if (npcAttackDef?.effect === 'Stun' && !turnHasGone) {
          updated.actionsRemaining = { simple: Math.max(0, (updated.actionsRemaining?.simple || p.actionsRemaining?.simple || 0) - 1) }
          updated.stunActionReducedThisRound = true
          stunActionReducedThisRound = true
        } else if (npcAttackDef?.effect === 'Stun' && turnHasGone) {
          updated.interceptPenalty = (p.interceptPenalty || 0) + 1
          updated.stunActionReducedThisRound = true
          stunActionReducedThisRound = true
        }

        // Effects on activeEffects: only apply immediately for single-target intercede
        if (!isAreaAttack && damageCalc.effectData) {
          updated.activeEffects = applyEffectToParticipant(p.activeEffects || [], damageCalc.effectData, houseRules)
          appliedEffectName = damageCalc.attackDef?.effect ?? null
        }

        return updated
      }
      // Dodge penalty on target: deferred for area attacks (resolveAreaIntercedeGroup handles it)
      if (!isAreaAttack && p.id === effectiveTargetId) {
        return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
      }
      return p
    })

    let claimNextTurnIndex: number | undefined
    let claimNextRound: number | undefined

    if (isAreaAttack) {
      const newClaim: AreaAttackClaim = {
        interceptorParticipantId: body.interceptorParticipantId,
        targetId: effectiveTargetId,
        interceptorName,
        targetName: effectiveTargetName,
        damageDealt: 0,
        appliedEffectName: damageCalc.appliedEffectName,
        effectData: damageCalc.effectData ?? null,
        stunActionReducedThisRound,
        interceptorArmor: 0,
        armorPiercing: 0,
        effectiveArmor: 0,
        attackBaseDamage: 0,
        netSuccesses,
        isSupportAttack: true,
      }

      // Strip claimed target from ALL group offers (this offer included); remove empty ones
      pendingRequests = pendingRequests.map((r: any) => {
        if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return r
        const remaining = (r.data.areaTargetIds || []).filter((tid: string) => tid !== effectiveTargetId)
        return { ...r, data: { ...r.data, areaTargetIds: remaining } }
      })
      pendingRequests = pendingRequests.filter((r: any) => {
        if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return true
        return (r.data.areaTargetIds || []).length > 0
      })

      // Record claim in intercede-group-state
      const groupState = pendingRequests.find(
        (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
      )
      if (groupState) {
        groupState.data.claims = [...(groupState.data.claims || []), newClaim]
      }

      // Resolve when all targets have a decision
      if (groupState && allAreaTargetsDecided(groupState, pendingRequests, intercedeGroupId)) {
        const resolved = await resolveAreaIntercedeGroup({
          groupState,
          participants,
          battleLog,
          pendingRequests,
          turnOrder,
          round: encounter.round || 0,
          currentTurnIndex: encounter.currentTurnIndex || 0,
          houseRules,
          encounterId: encounterId!,
        })
        participants = resolved.participants
        battleLog = resolved.battleLog
        pendingRequests = resolved.pendingRequests
        turnOrder = resolved.turnOrder
        if (resolved.nextTurnIndex !== undefined) claimNextTurnIndex = resolved.nextTurnIndex
        if (resolved.nextRound !== undefined) claimNextRound = resolved.nextRound
      }
    } else {
      pendingRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId !== intercedeGroupId)

      const intercedeLog = {
        id: `log-${Date.now()}-intercede`,
        timestamp: new Date().toISOString(),
        round: encounter.round || 0,
        actorId: body.interceptorParticipantId,
        actorName: interceptorName,
        action: `Interceded for ${effectiveTargetName}! (Support)`,
        target: null,
        result: appliedEffectName
          ? `Takes debuff with 0 dodge - ${appliedEffectName} applied for ${Math.max(1, netSuccesses)} rounds`
          : 'Interceded (no effect)',
        damage: 0,
        effects: appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede'],
        hit: true,
        dodgeDicePool: 0,
        dodgeDiceResults: [],
        dodgeSuccesses: 0,
      }
      battleLog = [...battleLog, intercedeLog]
    }

    await db.update(encounters).set({
      participants: JSON.stringify(participants),
      pendingRequests: JSON.stringify(pendingRequests),
      battleLog: JSON.stringify(battleLog),
      turnOrder: JSON.stringify(turnOrder),
      ...(claimNextTurnIndex !== undefined ? { currentTurnIndex: claimNextTurnIndex } : {}),
      ...(claimNextRound !== undefined ? { round: claimNextRound } : {}),
      ...(updatedParticipantPositions ? { participantPositions: JSON.stringify(updatedParticipantPositions) } : {}),
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    if (!updated) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })

    return {
      ...updated,
      participants: parseJsonField(updated.participants),
      turnOrder: parseJsonField(updated.turnOrder),
      battleLog: parseJsonField(updated.battleLog),
      pendingRequests: parseJsonField(updated.pendingRequests),
      requestResponses: parseJsonField(updated.requestResponses),
      hazards: parseJsonField(updated.hazards),
    }
  }

  // --- Damage attack: existing flow ---
  // All damage values (interceptorArmor, effectiveArmor, damageDealt, etc.) already
  // computed by computeAttackDamage above.

  // Apply damage/effects to interceptor, deduct/defer actions
  let appliedEffectName: string | null = null
  let stunActionReducedThisRound = false

  participants = participants.map((p: any) => {
    if (p.id === body.interceptorParticipantId) {
      const updated: any = {
        ...p,
        // Action deduction at claim time (prevents double-spending before resolution)
        ...(!turnHasGone
          ? { actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) } }
          : { interceptPenalty: (p.interceptPenalty || 0) + 1 }
        ),
      }

      // Wounds: only apply immediately for single-target intercede
      if (!isAreaAttack) {
        updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt)
        if (damageCalc.targetHasCombatMonster && damageDealt > 0) {
          updated.combatMonsterBonus = Math.min(
            p.totalHealth ?? damageCalc.targetHealthStat ?? p.maxWounds,
            (p.combatMonsterBonus ?? 0) + damageDealt
          )
        }
      }

      // Stun extra action deduction: apply at claim time for all attacks
      if (npcAttackDef?.effect === 'Stun' && !turnHasGone) {
        updated.actionsRemaining = { simple: Math.max(0, (updated.actionsRemaining?.simple || p.actionsRemaining?.simple || 0) - 1) }
        updated.stunActionReducedThisRound = true
        stunActionReducedThisRound = true
      } else if (npcAttackDef?.effect === 'Stun' && turnHasGone) {
        updated.interceptPenalty = (p.interceptPenalty || 0) + 1
        updated.stunActionReducedThisRound = true
        stunActionReducedThisRound = true
      }

      // Effects on activeEffects: only apply immediately for single-target intercede
      if (!isAreaAttack && damageCalc.effectData) {
        updated.activeEffects = applyEffectToParticipant(p.activeEffects || [], damageCalc.effectData, houseRules)
        appliedEffectName = damageCalc.attackDef?.effect ?? null
      }

      return updated
    }
    // Dodge penalty on target: deferred for area attacks (resolveAreaIntercedeGroup handles it)
    if (!isAreaAttack && p.id === effectiveTargetId) {
      return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
    }
    return p
  })

  let claimNextTurnIndex: number | undefined
  let claimNextRound: number | undefined

  if (isAreaAttack) {
    const newClaim: AreaAttackClaim = {
      interceptorParticipantId: body.interceptorParticipantId,
      targetId: effectiveTargetId,
      interceptorName,
      targetName: effectiveTargetName,
      damageDealt,
      appliedEffectName: damageCalc.appliedEffectName,
      effectData: damageCalc.effectData ?? null,
      stunActionReducedThisRound,
      interceptorArmor,
      armorPiercing,
      effectiveArmor,
      attackBaseDamage,
      netSuccesses,
      isSupportAttack: false,
      interceptorHasCombatMonster: damageCalc.targetHasCombatMonster,
      interceptorHealthStat: damageCalc.targetHealthStat,
    }

    // Strip claimed target from ALL group offers (this offer included); remove empty ones
    pendingRequests = pendingRequests.map((r: any) => {
      if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return r
      const remaining = (r.data.areaTargetIds || []).filter((tid: string) => tid !== effectiveTargetId)
      return { ...r, data: { ...r.data, areaTargetIds: remaining } }
    })
    pendingRequests = pendingRequests.filter((r: any) => {
      if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return true
      return (r.data.areaTargetIds || []).length > 0
    })

    // Record claim in intercede-group-state
    const groupState = pendingRequests.find(
      (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
    )
    if (groupState) {
      groupState.data.claims = [...(groupState.data.claims || []), newClaim]
    }

    // Resolve when all targets have a decision
    if (groupState && allAreaTargetsDecided(groupState, pendingRequests, intercedeGroupId)) {
      const resolved = await resolveAreaIntercedeGroup({
        groupState,
        participants,
        battleLog,
        pendingRequests,
        turnOrder,
        round: encounter.round || 0,
        currentTurnIndex: encounter.currentTurnIndex || 0,
        houseRules,
        encounterId: encounterId!,
      })
      participants = resolved.participants
      battleLog = resolved.battleLog
      pendingRequests = resolved.pendingRequests
      turnOrder = resolved.turnOrder
      if (resolved.nextTurnIndex !== undefined) claimNextTurnIndex = resolved.nextTurnIndex
      if (resolved.nextRound !== undefined) claimNextRound = resolved.nextRound
    }
  } else {
    // Remove all intercede-offer requests for this group
    pendingRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId !== intercedeGroupId)

    // Auto-devolve check: if interceptor is KO'd and has evolution history, devolve instead
    let autoDevolveLog: any = null
    const damagedInterceptor = participants.find((p: any) => p.id === body.interceptorParticipantId)
    if (damagedInterceptor &&
        damagedInterceptor.currentWounds >= damagedInterceptor.maxWounds &&
        damagedInterceptor.evolutionLineId &&
        damagedInterceptor.woundsHistory?.length > 0) {
      const rawState = damagedInterceptor.woundsHistory.pop()
      const previousState = typeof rawState === 'string' ? JSON.parse(rawState) : rawState
      if (previousState) {
        const oldEntityId = damagedInterceptor.entityId
        damagedInterceptor.entityId = previousState.entityId
        damagedInterceptor.maxWounds = previousState.maxWounds
        damagedInterceptor.currentWounds = previousState.wounds !== undefined ? previousState.wounds : 0

        await db.update(evolutionLines).set({
          currentStageIndex: previousState.stageIndex,
          updatedAt: new Date(),
        }).where(eq(evolutionLines.id, damagedInterceptor.evolutionLineId))

        const [oldDigimon] = await db.select().from(digimon).where(eq(digimon.id, oldEntityId))
        const [newDigimon] = await db.select().from(digimon).where(eq(digimon.id, previousState.entityId))

        const devolvedQualities = typeof newDigimon?.qualities === 'string'
          ? JSON.parse(newDigimon.qualities) : (newDigimon?.qualities || [])
        const devolvedHasCombatMonster = (devolvedQualities as any[]).some((q: any) => q.id === 'combat-monster')
        damagedInterceptor.combatMonsterBonus = devolvedHasCombatMonster
          ? Math.min(damagedInterceptor.combatMonsterBonus ?? 0, previousState.totalHealth ?? previousState.maxWounds)
          : 0

        autoDevolveLog = {
          id: `log-${Date.now()}-autodevolve`,
          timestamp: new Date().toISOString(),
          round: encounter.round || 0,
          actorId: damagedInterceptor.id,
          actorName: oldDigimon?.name || 'Digimon',
          action: `was knocked out and devolved to ${newDigimon?.name || 'previous form'}!`,
          target: null,
          result: `Wounds restored to ${previousState.wounds !== undefined ? previousState.wounds : 0}`,
          damage: null,
          effects: ['Auto-Devolve'],
        }
      }
    }

    const intercedeLog = {
      id: `log-${Date.now()}-intercede`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.interceptorParticipantId,
      actorName: interceptorName,
      action: `Interceded for ${effectiveTargetName}!`,
      target: null,
      result: 'Takes hit with 0 dodge',
      damage: damageDealt,
      effects: appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede'],
      attackerParticipantId: request.data.attackerId,
      baseDamage: attackBaseDamage,
      netSuccesses,
      targetArmor: interceptorArmor,
      armorPiercing,
      effectiveArmor,
      finalDamage: damageDealt,
      hit: true,
      dodgeDicePool: 0,
      dodgeDiceResults: [],
      dodgeSuccesses: 0,
    }
    battleLog = [...battleLog, intercedeLog, ...(autoDevolveLog ? [autoDevolveLog] : [])]
  }

  await db.update(encounters).set({
    participants: JSON.stringify(participants),
    pendingRequests: JSON.stringify(pendingRequests),
    battleLog: JSON.stringify(battleLog),
    turnOrder: JSON.stringify(turnOrder),
    ...(claimNextTurnIndex !== undefined ? { currentTurnIndex: claimNextTurnIndex } : {}),
    ...(claimNextRound !== undefined ? { round: claimNextRound } : {}),
    ...(updatedParticipantPositions ? { participantPositions: JSON.stringify(updatedParticipantPositions) } : {}),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
    hazards: parseJsonField(updated.hazards),
  }
})
