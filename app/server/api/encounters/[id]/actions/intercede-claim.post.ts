import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns, evolutionLines, maps } from '../../../../db'
import { applyEffectToParticipant } from '../../../../utils/applyEffect'
import { type AreaAttackClaim, allAreaTargetsDecided, resolveAreaIntercedeGroup } from '~/server/utils/resolveAreaIntercedeGroup'
import { computeAttackDamage } from '~/server/utils/computeAttackDamage'
import {
  detectCapabilitiesFromQualities,
  getSizeFootprintDimension,
  isValidLandingPosition,
  getFootprintCells,
  isFootprintValid,
  findClosestValidDisplacementPosition,
  findRangedIntercedPosition,
} from '~/server/utils/mapMovement'
import { calculateDigimonDerivedStats } from '~/types'

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

  // Load map for spatial position validation (single-target only)
  let claimMapRecord: any = null
  if (!isAreaAttack && (encounter as any).mapId) {
    const [m] = await db.select().from(maps).where(eq(maps.id, (encounter as any).mapId))
    if (m) {
      claimMapRecord = {
        ...m,
        groundTiles: typeof m.groundTiles === 'string' ? JSON.parse(m.groundTiles) : (m.groundTiles ?? []),
        spaceTiles: typeof m.spaceTiles === 'string' ? JSON.parse(m.spaceTiles) : (m.spaceTiles ?? []),
        voxels: typeof (m as any).voxels === 'string' ? JSON.parse((m as any).voxels) : ((m as any).voxels ?? []),
        walls: typeof m.walls === 'string' ? JSON.parse(m.walls) : (m.walls ?? []),
        ceilings: typeof m.ceilings === 'string' ? JSON.parse(m.ceilings) : (m.ceilings ?? []),
        stairs: typeof m.stairs === 'string' ? JSON.parse(m.stairs) : (m.stairs ?? []),
        windows: typeof m.windows === 'string' ? JSON.parse(m.windows) : (m.windows ?? []),
        doors: typeof m.doors === 'string' ? JSON.parse(m.doors) : (m.doors ?? []),
      }
    }
  }

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

  // Get interceptor name + full DB record (needed for size/caps in position logic)
  let interceptorName = 'Unknown'
  let interceptorDigRec: any = null
  if (interceptor.type === 'digimon') {
    const [dig] = await db.select().from(digimon).where(eq(digimon.id, interceptor.entityId))
    interceptorDigRec = dig ?? null
    interceptorName = dig?.name || 'Digimon'
  }

  // Load target's digimon record for size/caps (used in displacement logic)
  let targetDigRecForPos: any = null
  const targetParticipantForPos = participants.find((p: any) => p.id === effectiveTargetId)
  if (targetParticipantForPos?.type === 'digimon') {
    const [tDig] = await db.select().from(digimon).where(eq(digimon.id, targetParticipantForPos.entityId))
    targetDigRecForPos = tDig ?? null
  }

  const { accuracySuccesses, attackerId, attackData } = request.data
  const attacker = participants.find((p: any) => p.id === attackerId)
  const isSupportAttack = request.data.isSupportAttack || false

  // Fetch the attacking digimon's attack definition for reliable range detection.
  // The stored isRangedIntercede flag can be wrong (e.g. NPC attacks where the DB record
  // did not have range populated at offer time). This is the authoritative source.
  let claimAttackRange: string | null = null
  if (!isAreaAttack && attacker?.type === 'digimon') {
    const [attackerDigForRange] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
    if (attackerDigForRange?.attacks) {
      const attacks = typeof attackerDigForRange.attacks === 'string'
        ? JSON.parse(attackerDigForRange.attacks) : attackerDigForRange.attacks
      const foundAttack = (attacks as any[])?.find((a: any) => a.id === request.data.attackId)
      claimAttackRange = foundAttack?.range ?? null
    }
  }

  // Single-target position swap with spatial validation.
  // For melee: interceptor moves to target's tile; target is displaced to nearest valid spot.
  // For ranged: interceptor moves to a line-of-fire cell stored in the offer; target stays put.
  let updatedParticipantPositions: Record<string, { x: number; y: number; z: number }> | null = null
  let fallDamageToApply = 0  // wounds applied to interceptor if they jumped to intercede

  if (!isAreaAttack && claimMapRecord) {
    const interceptorPos = participantPositions[body.interceptorParticipantId]
    const isRangedIntercede: boolean =
      claimAttackRange === 'ranged' ||
      !!(request.data.isRangedIntercede) ||
      request.data.attackData?.range === 'ranged'
    const targetPos = participantPositions[effectiveTargetId]
    const attackerPos = participantPositions[attackerId]
    // For ranged intercede the destination is the pre-computed line-of-fire cell stored in the
    // offer; targetPos is only the fallback for melee (where it is always the intercede tile).
    let intercDePos: { x: number; y: number; z: number } | undefined =
      request.data.interceptePos ?? targetPos

    // GM ranged intercede: no specific interceptor was chosen at offer time, so no position was
    // pre-computed. Compute the best reachable line-of-fire cell now using the chosen interceptor.
    if (isRangedIntercede && !request.data.interceptePos && interceptorPos && targetPos && attackerPos && interceptorDigRec && interceptor.type === 'digimon') {
      const quals = typeof interceptorDigRec.qualities === 'string' ? JSON.parse(interceptorDigRec.qualities) : (interceptorDigRec.qualities ?? [])
      const derived = calculateDigimonDerivedStats(
        typeof interceptorDigRec.baseStats === 'string' ? JSON.parse(interceptorDigRec.baseStats) : interceptorDigRec.baseStats,
        interceptorDigRec.stage as any,
        interceptorDigRec.size as any,
      )
      const caps = detectCapabilitiesFromQualities(quals, derived.movement, derived.ram, derived.cpu)
      const interceptorDim = getSizeFootprintDimension(interceptorDigRec.size as any, (interceptorDigRec as any).giganticDimensions)
      const occupied = new Set(
        Object.entries(participantPositions)
          .filter(([pid]) => pid !== body.interceptorParticipantId)
          .map(([, pos]: [string, any]) => `${pos.x},${pos.y},${pos.z}`)
      )
      const computed = findRangedIntercedPosition(attackerPos, targetPos, interceptorPos, derived.movement, caps, interceptorDim, claimMapRecord, occupied)
      intercDePos = computed ?? undefined
    }

    if (interceptorPos && intercDePos) {
      updatedParticipantPositions = { ...participantPositions }

      // Move interceptor to their intercede position
      updatedParticipantPositions[body.interceptorParticipantId] = { ...intercDePos }

      // Jump fall damage: interceptor jumped to reach the intercede tile and now falls
      if ((request.data.requiresJump ?? false) && !(request.data.requiresFly ?? false)) {
        const fallHeight: number = request.data.fallHeight || 0
        fallDamageToApply = Math.max(0, fallHeight - 1)
        if (fallHeight > 0) {
          const groundY = intercDePos.y - fallHeight
          updatedParticipantPositions[body.interceptorParticipantId] = { x: intercDePos.x, y: groundY, z: intercDePos.z }
        }
      }

      if (!isRangedIntercede && targetPos) {
        // Melee: displace the target away from the interceptor's new position
        const interceptorDim = interceptorDigRec
          ? getSizeFootprintDimension(interceptorDigRec.size as any, (interceptorDigRec as any).giganticDimensions)
          : 1
        const targetDim = targetDigRecForPos
          ? getSizeFootprintDimension(targetDigRecForPos.size as any, (targetDigRecForPos as any).giganticDimensions)
          : 1

        const defaultCaps = { canFly: false, canJump: false, jumpRange: 0, jumpHeight: 0, canClimb: false, canSwim: false, canDig: false }
        const targetCaps = targetDigRecForPos ? (() => {
          const tq = typeof targetDigRecForPos.qualities === 'string'
            ? JSON.parse(targetDigRecForPos.qualities)
            : (targetDigRecForPos.qualities ?? [])
          const td = calculateDigimonDerivedStats(
            typeof targetDigRecForPos.baseStats === 'string'
              ? JSON.parse(targetDigRecForPos.baseStats)
              : targetDigRecForPos.baseStats,
            targetDigRecForPos.stage as any,
            targetDigRecForPos.size as any,
          )
          return detectCapabilitiesFromQualities(tq, td.movement, td.ram, td.cpu)
        })() : defaultCaps

        // Occupied set: exclude interceptor (at target's tile) and target (leaving),
        // then add the interceptor's full footprint so target can't land in their space
        const claimOccupied = new Set(
          Object.entries(updatedParticipantPositions)
            .filter(([pid]) => pid !== body.interceptorParticipantId && pid !== effectiveTargetId)
            .map(([, pos]: [string, any]) => `${pos.x},${pos.y},${pos.z}`)
        )
        getFootprintCells(intercDePos, interceptorDim).forEach((cell: { x: number; y: number; z: number }) => {
          claimOccupied.add(`${cell.x},${cell.y},${cell.z}`)
        })

        // Preferred displacement: interceptorDim tiles in the direction away from attacker
        let displacedPos: { x: number; y: number; z: number } | null = null
        if (attackerPos) {
          const dir = {
            x: Math.sign(targetPos.x - attackerPos.x),
            y: Math.sign(targetPos.y - attackerPos.y),
            z: Math.sign(targetPos.z - attackerPos.z),
          }
          if (dir.x !== 0 || dir.y !== 0 || dir.z !== 0) {
            const preferred = {
              x: targetPos.x + dir.x * interceptorDim,
              y: targetPos.y + dir.y * interceptorDim,
              z: targetPos.z + dir.z * interceptorDim,
            }
            if (isFootprintValid(preferred, targetDim, claimMapRecord, claimOccupied)) {
              displacedPos = preferred
            }
          }
        }

        // BFS fallback if preferred direction is blocked
        if (!displacedPos) {
          displacedPos = findClosestValidDisplacementPosition(
            targetPos, claimMapRecord, targetCaps, claimOccupied, targetDim,
          )
        }

        if (displacedPos) {
          updatedParticipantPositions[effectiveTargetId] = displacedPos
        }
        // else: target cannot be displaced (edge case — offer.post should have blocked this)
      }
      // Ranged intercede: target stays in place, only interceptor moves
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

        // Fall damage from jumping to intercede position
        if (!isAreaAttack && fallDamageToApply > 0) {
          (updated as any).currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + fallDamageToApply)
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

      const fallEffects = !isAreaAttack && fallDamageToApply > 0 ? [`Fell ${request.data.fallHeight} tiles (${fallDamageToApply} wound${fallDamageToApply !== 1 ? 's' : ''})`] : []
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
        damage: fallDamageToApply || 0,
        effects: [...(appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede']), ...fallEffects],
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
        // Fall damage from jumping to intercede position (applied on top of attack damage)
        if (fallDamageToApply > 0) {
          updated.currentWounds = Math.min(p.maxWounds, (updated.currentWounds || 0) + fallDamageToApply)
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

    const fallEffectsDmg = fallDamageToApply > 0
      ? [`Fell ${request.data.fallHeight} tiles (${fallDamageToApply} wound${fallDamageToApply !== 1 ? 's' : ''})`]
      : []
    const intercedeLog = {
      id: `log-${Date.now()}-intercede`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.interceptorParticipantId,
      actorName: interceptorName,
      action: `Interceded for ${effectiveTargetName}!`,
      target: null,
      result: 'Takes hit with 0 dodge',
      damage: damageDealt + fallDamageToApply,
      effects: [...(appliedEffectName ? ['Intercede', `Applied: ${appliedEffectName}`] : ['Intercede']), ...fallEffectsDmg],
      attackerParticipantId: request.data.attackerId,
      baseDamage: attackBaseDamage,
      netSuccesses,
      targetArmor: interceptorArmor,
      armorPiercing,
      effectiveArmor,
      finalDamage: damageDealt + fallDamageToApply,
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
