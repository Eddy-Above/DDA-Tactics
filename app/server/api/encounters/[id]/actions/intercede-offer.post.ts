import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns } from '../../../../db'
import { resolveNpcAttack } from '~/server/utils/resolveNpcAttack'
import { resolveParticipantName } from '~/server/utils/participantName'
import { getEffectResolutionType, EFFECT_ALIGNMENT } from '~/data/attackConstants'
import { resolvePositiveAuto, resolvePositiveHealth, resolveNegativeSupportNpc } from '~/server/utils/resolveSupportAttack'
import { triggerCounterattack } from '~/server/utils/triggerCounterattack'
import { getUnlockedSpecialOrders } from '~/utils/specialOrders'
import { STAGE_CONFIG } from '~/types'

interface IntercedeOfferBody {
  attackerId: string
  targetId?: string       // Single-target attack
  targetIds?: string[]    // Area attack: multiple targets
  accuracySuccesses: number
  accuracyDice: number[]
  attackId: string
  attackName?: string
  attackData: any // Full attack data for later resolution
  bolstered?: boolean
  bolsterType?: 'damage-accuracy' | 'bit-cpu'
  lifestealed?: boolean
  hugePowerUsed?: boolean
  hugePowerAttackRange?: 'melee' | 'ranged'
  skipActionDeduction?: boolean // When called from attack.post.ts which already deducted actions
  isSignatureMove?: boolean
  batteryCount?: number
  clashAttack?: boolean         // If true, target's dodge pool is halved (clash controller attack)
  outsideClashCpuPenalty?: number  // Damage penalty when attacker is outside target's active clash
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeOfferBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.attackerId || !body.attackId) {
    throw createError({ statusCode: 400, message: 'attackerId and attackId are required' })
  }
  if (!body.targetId && (!body.targetIds || body.targetIds.length === 0)) {
    throw createError({ statusCode: 400, message: 'targetId or targetIds is required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Fetch campaign house rules
  let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  let eddySoulRules: import('~/types').EddySoulRules | undefined
  let campaignLevel: string = 'standard'
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = typeof campaign.rulesSettings === 'string'
        ? JSON.parse(campaign.rulesSettings) : (campaign.rulesSettings || {})
      houseRules = rulesSettings.houseRules
      eddySoulRules = rulesSettings.eddySoulRules
      if (campaign.level) campaignLevel = campaign.level
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
  let turnOrder = parseJsonField(encounter.turnOrder)
  const pendingRequests = parseJsonField(encounter.pendingRequests)
  let battleLog = parseJsonField(encounter.battleLog)

  // Helper: check if a participant has eligible intercede actions
  const hasEligibleInterceptor = (participant: any): boolean => {
    if (participant.type === 'digimon') {
      // Partner digimon are not in turnOrder; use hasActed flag instead
      if (!participant.hasActed) {
        return (participant.actionsRemaining?.simple || 0) >= 1
      } else {
        const cap = participant.maxPostTurnIntercedes ?? 2
        return (participant.interceptPenalty || 0) < cap
      }
    }
    const turnIdx = (turnOrder as string[]).indexOf(participant.id)
    const turnHasGone = turnIdx >= 0 && turnIdx < (encounter.currentTurnIndex || 0)
    if (!turnHasGone) {
      return (participant.actionsRemaining?.simple || 0) >= 1
    } else {
      return (participant.interceptPenalty || 0) < 2
    }
  }

  const attacker = participants.find((p: any) => p.id === body.attackerId)
  if (!attacker) {
    throw createError({ statusCode: 404, message: 'Attacker not found' })
  }

  // ========================
  // AREA ATTACK PATH
  // ========================
  if (body.targetIds && body.targetIds.length > 0) {
    // Deduct attacker actions once for the whole area attack
    if (!body.skipActionDeduction) {
      const attackActionCost = body.bolstered ? 2 : 1
      participants = participants.map((p: any) => {
        if (p.id === body.attackerId) {
          const updated: any = {
            ...p,
            actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - attackActionCost) },
            usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
            activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
          }
          if (body.bolstered && p.type === 'digimon') {
            updated.digimonBolsterCount = (p.digimonBolsterCount ?? 0) + 1
            if (body.bolsterType === 'bit-cpu') {
              updated.lastBitCpuBolsterRound = encounter.round
            }
          }
          if (body.hugePowerUsed) {
            if (body.hugePowerAttackRange === 'ranged' || (body as any).hugePowerTrackAll) {
              updated.lastHugePowerRound = encounter.round
            }
            if ((body as any).hugePowerRank === 2) {
              updated.lastHugePowerRank2Round = encounter.round
            }
          }
          if (body.isSignatureMove) {
            updated.battery = 0
            updated.usedSignatureMoveThisTurn = true
          }
          return updated
        }
        return p
      })
    }

    // Get attacker name
    let attackerName = 'Unknown'
    if (attacker.type === 'digimon') {
      const [d] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
      attackerName = resolveParticipantName(attacker, participants, d?.name || 'Digimon', d?.isEnemy || false)
    }

    // Determine isSupportAttack for this attack
    let isSupportAttack = false
    let areaAttackDef: any = null
    if (attacker.type === 'digimon') {
      const [attackerDig] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
      if (attackerDig?.attacks) {
        const attacks = typeof attackerDig.attacks === 'string' ? JSON.parse(attackerDig.attacks) : attackerDig.attacks
        areaAttackDef = attacks?.find((a: any) => a.id === body.attackId)
        isSupportAttack = areaAttackDef?.type === 'support'
      }
    }

    // Process each target: collect player targets and NPC targets separately
    const playerTargetIds: string[] = []
    const playerTargetInfo: Record<string, { name: string; entityId: string; type: string; partnerId?: string }> = {}
    const npcTargetIds: string[] = []

    for (const targetId of body.targetIds) {
      const target = participants.find((p: any) => p.id === targetId)
      if (!target) continue

      let targetName = 'Unknown'
      let isPlayerTarget = false
      let partnerId: string | undefined

      if (target.type === 'tamer') {
        const [t] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
        targetName = t?.name || 'Tamer'
        isPlayerTarget = true
      } else if (target.type === 'digimon') {
        const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
        if (dig) {
          targetName = resolveParticipantName(target, participants, dig.name || 'Digimon', dig.isEnemy || false)
          if (dig.partnerId) {
            isPlayerTarget = true
            partnerId = dig.partnerId
          }
        }
      }

      if (isPlayerTarget) {
        playerTargetIds.push(targetId)
        playerTargetInfo[targetId] = { name: targetName, entityId: target.entityId, type: target.type, partnerId }
      } else {
        // NPC target — defer resolution until after intercede window
        npcTargetIds.push(targetId)
      }
    }

    // All targets (player + NPC) are eligible for intercede offers
    const allTargetIds = [...playerTargetIds, ...npcTargetIds]

    // Build one intercede-offer per eligible tamer and one for GM
    const intercedeGroupId = `intercede-${Date.now()}-area`
    const newRequests: any[] = []
    const allTargetIdSet = new Set(allTargetIds)

    for (const p of participants) {
      if (p.type !== 'tamer') continue

      // Must have a partner digimon in encounter
      let hasPartnerInEncounter = false
      let partnerParticipantId: string | null = null
      for (const pp of participants) {
        if (pp.type !== 'digimon') continue
        const [dig] = await db.select().from(digimon).where(eq(digimon.id, pp.entityId))
        if (dig?.partnerId === p.entityId) { hasPartnerInEncounter = true; partnerParticipantId = pp.id; break }
      }
      if (!hasPartnerInEncounter) continue

      // Check if tamer or their partner digimon has eligible intercede actions
      // (also covers the case where both are targeted — neither would be eligible)
      const digimonParticipant = partnerParticipantId ? participants.find((pp: any) => pp.id === partnerParticipantId) : null
      const tamerEligible = !allTargetIdSet.has(p.id) && hasEligibleInterceptor(p)
      const digimonEligible = !!(digimonParticipant && !allTargetIdSet.has(partnerParticipantId!) && hasEligibleInterceptor(digimonParticipant))
      if (!tamerEligible && !digimonEligible) continue

      // Filter areaTargetIds by this tamer's opt-outs
      const tamerOptOuts: string[] = p.intercedeOptOuts || []
      const tamerAreaTargetIds = allTargetIds.filter(tid => !tamerOptOuts.includes(tid))
      if (tamerAreaTargetIds.length === 0) continue

      // QR eligibility: can use if their partner is one of the area targets
      let canUseQR = false
      let qrDiceCount = 0
      for (const tid of tamerAreaTargetIds) {
        const info = playerTargetInfo[tid]
        if (info?.partnerId === p.entityId) {
          const [tamerRecord] = await db.select().from(tamers).where(eq(tamers.id, p.entityId))
          if (tamerRecord) {
            const tamerAttrs = typeof tamerRecord.attributes === 'string' ? JSON.parse(tamerRecord.attributes) : (tamerRecord.attributes || {})
            const tamerXp = typeof tamerRecord.xpBonuses === 'string' ? JSON.parse(tamerRecord.xpBonuses) : (tamerRecord.xpBonuses || {})
            const unlockedOrders = getUnlockedSpecialOrders(tamerAttrs, tamerXp, campaignLevel as any)
            if (unlockedOrders.some((o: any) => o.name === 'Quick Reaction')) {
              const usedPerDay = typeof tamerRecord.usedPerDayOrders === 'string' ? JSON.parse(tamerRecord.usedPerDayOrders) : (tamerRecord.usedPerDayOrders || [])
              if (!usedPerDay.includes('Quick Reaction')) {
                canUseQR = true
                const targetPart = participants.find((pp: any) => pp.id === tid)
                if (targetPart) {
                  const [tDig] = await db.select().from(digimon).where(eq(digimon.id, targetPart.entityId))
                  if (tDig) qrDiceCount = ((STAGE_CONFIG as any)[tDig.stage]?.stageBonus ?? 0) + 2
                }
              }
            }
          }
          break
        }
      }

      newRequests.push({
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'intercede-offer',
        targetTamerId: p.entityId,
        targetParticipantId: null,
        timestamp: new Date().toISOString(),
        data: {
          intercedeGroupId,
          isAreaAttack: true,
          areaTargetIds: tamerAreaTargetIds,
          attackerId: body.attackerId,
          attackerName,
          targetId: null,
          targetName: null,
          attackName: body.attackName || 'Attack',
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          attackId: body.attackId,
          attackData: body.attackData,
          npcTargetIds,
          eligibleTamerIds: [], // filled after loop
          bolstered: body.bolstered || false,
          bolsterType: body.bolsterType || null,
          bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
          bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
          isSupportAttack,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
          clashAttack: body.clashAttack || false,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
          canUseQuickReaction: canUseQR,
          quickReactionDiceCount: qrDiceCount,
        },
      })
    }

    // GM intercede offer
    const gmParticipant = participants.find((p: any) => p.id === 'gm')
    const gmOptOuts: string[] = gmParticipant?.intercedeOptOuts || []
    const gmAreaTargetIds = allTargetIds.filter(tid => !gmOptOuts.includes(tid))
    if (gmAreaTargetIds.length > 0) {
      newRequests.push({
        id: `req-${Date.now()}-gm`,
        type: 'intercede-offer',
        targetTamerId: 'GM',
        targetParticipantId: null,
        timestamp: new Date().toISOString(),
        data: {
          intercedeGroupId,
          isAreaAttack: true,
          areaTargetIds: gmAreaTargetIds,
          npcTargetIds,
          attackerId: body.attackerId,
          attackerName,
          targetId: null,
          targetName: null,
          attackName: body.attackName || 'Attack',
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          attackId: body.attackId,
          attackData: body.attackData,
          eligibleTamerIds: [],
          bolstered: body.bolstered || false,
          bolsterType: body.bolsterType || null,
          bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
          bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
          isSupportAttack,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
          clashAttack: body.clashAttack || false,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        },
      })
    }

    // Fill eligibleTamerIds in all requests
    const allEligibleTamerIds = newRequests.filter(r => r.targetTamerId !== 'GM').map(r => r.targetTamerId)
    for (const r of newRequests) r.data.eligibleTamerIds = allEligibleTamerIds

    // If no intercede offers possible, create dodge-rolls for player targets and auto-resolve NPC targets
    // (intercede-group-state is pushed below only when intercede offers exist)
    if (newRequests.length === 0) {
      // Auto-resolve NPC targets immediately (no intercede window)
      for (const tid of npcTargetIds) {
        const target = participants.find((p: any) => p.id === tid)
        const npcTargetName = target?.name || tid
        if (isSupportAttack && areaAttackDef) {
          const resolutionType = getEffectResolutionType(areaAttackDef.effect, areaAttackDef.tags || [], 'support')
          const supportParams = {
            participants, battleLog, pendingRequests,
            attackerParticipantId: body.attackerId,
            targetParticipantId: tid,
            attackDef: areaAttackDef,
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            round: encounter.round || 0,
            attackerName,
            targetName: npcTargetName,
            encounterId: encounterId!,
            turnOrder, houseRules,
            isSignatureMove: body.isSignatureMove || false,
            batteryCount: body.batteryCount ?? 0,
          }
          let supportResult: any = null
          if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
          else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
          else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)
          if (supportResult) {
            participants = supportResult.participants
            battleLog = supportResult.battleLog
            pendingRequests = supportResult.pendingRequests
            if (supportResult.turnOrder) turnOrder = supportResult.turnOrder
          }
        } else {
          const result = await resolveNpcAttack({
            participants, battleLog,
            attackerParticipantId: body.attackerId,
            targetParticipantId: tid,
            attackId: body.attackId,
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            round: encounter.round || 0,
            attackerName,
            targetName: npcTargetName,
            turnOrder,
            currentTurnIndex: encounter.currentTurnIndex || 0,
            houseRules,
            clashAttack: body.clashAttack,
            outsideClashCpuPenalty: body.outsideClashCpuPenalty,
          })
          participants = result.participants
          battleLog = result.battleLog
          if (result.turnOrder) turnOrder = result.turnOrder
        }
      }

      const dodgeRequests = playerTargetIds.map(tid => {
        const info = playerTargetInfo[tid]
        const target = participants.find((p: any) => p.id === tid)
        let targetTamerId = 'GM'
        if (info.type === 'tamer') targetTamerId = info.entityId
        else if (info.partnerId) targetTamerId = info.partnerId
        return {
          id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'dodge-roll',
          targetTamerId,
          targetParticipantId: tid,
          timestamp: new Date().toISOString(),
          data: {
            attackerName,
            targetName: info.name,
            attackName: body.attackName || 'Attack',
            accuracySuccesses: body.accuracySuccesses,
            accuracyDice: body.accuracyDice,
            attackId: body.attackId,
            attackData: body.attackData,
            attackerEntityId: attacker.entityId,
            attackerParticipantId: body.attackerId,
            targetEntityId: info.entityId,
            dodgePenalty: target?.dodgePenalty ?? 0,
            bolstered: body.bolstered || false,
            bolsterType: body.bolsterType || null,
            bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
            bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
            lifestealed: body.lifestealed || false,
            isSupportAttack,
            isSignatureMove: body.isSignatureMove || false,
            batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
            clashAttack: body.clashAttack || false,
            outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
          },
        }
      })
      await db.update(encounters).set({
        participants: JSON.stringify(participants),
        battleLog: JSON.stringify(battleLog),
        pendingRequests: JSON.stringify([...pendingRequests, ...dodgeRequests]),
        turnOrder: JSON.stringify(turnOrder),
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

    // Push intercede-group-state tracker so claims are accumulated before resolution
    newRequests.push({
      id: `igs-${intercedeGroupId}`,
      type: 'intercede-group-state',
      targetTamerId: '__internal__',
      targetParticipantId: null,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        originalTargetIds: allTargetIds,
        npcTargetIds,
        playerTargetInfo,
        attackerId: body.attackerId,
        attackerName,
        attackName: body.attackName || 'Attack',
        attackId: body.attackId,
        attackData: body.attackData,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
        lifestealed: body.lifestealed || false,
        isSupportAttack,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        claims: [],
      },
    })

    // Save intercede offers
    await db.update(encounters).set({
      participants: JSON.stringify(participants),
      battleLog: JSON.stringify(battleLog),
      pendingRequests: JSON.stringify([...pendingRequests, ...newRequests]),
      turnOrder: JSON.stringify(turnOrder),
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updatedArea] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    if (!updatedArea) throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
    return {
      ...updatedArea,
      participants: parseJsonField(updatedArea.participants),
      turnOrder: parseJsonField(updatedArea.turnOrder),
      battleLog: parseJsonField(updatedArea.battleLog),
      pendingRequests: parseJsonField(updatedArea.pendingRequests),
      requestResponses: parseJsonField(updatedArea.requestResponses),
      hazards: parseJsonField(updatedArea.hazards),
    }
  }

  // ========================
  // SINGLE-TARGET PATH (unchanged from before)
  // ========================
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) {
    throw createError({ statusCode: 404, message: 'Target not found' })
  }

  // Deduct attacker actions and track used attack (skip if already done by attack.post.ts)
  if (!body.skipActionDeduction) {
    const attackActionCost = body.bolstered ? 2 : 1
    participants = participants.map((p: any) => {
      if (p.id === body.attackerId) {
        const updated: any = {
          ...p,
          actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - attackActionCost) },
          usedAttackIds: [...(p.usedAttackIds || []), body.attackId],
          // Consume Directed effect on attacker (bonus was applied client-side to accuracy pool)
          activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
        }
        // Track bolster usage for digimon
        if (body.bolstered && p.type === 'digimon') {
          updated.digimonBolsterCount = (p.digimonBolsterCount ?? 0) + 1
          if (body.bolsterType === 'bit-cpu') {
            updated.lastBitCpuBolsterRound = encounter.round
          }
        }
        // Track Huge Power usage
        if (body.hugePowerUsed) {
          // Track ranged usage OR EddySoul once-per-turn (any attack)
          if (body.hugePowerAttackRange === 'ranged' || (body as any).hugePowerTrackAll) {
            updated.lastHugePowerRound = encounter.round
          }
          // Track Rank 2 usage (once per round, any attack type)
          if ((body as any).hugePowerRank === 2) {
            updated.lastHugePowerRank2Round = encounter.round
          }
        }
        // Signature Move Battery: expend all battery on use
        if (body.isSignatureMove) {
          updated.battery = 0
          updated.usedSignatureMoveThisTurn = true
        }
        return updated
      }
      return p
    })
  }

  // Get attacker and target names
  let attackerName = 'Unknown'
  let targetName = 'Unknown'
  if (attacker.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
    const baseDigimonName = d?.name || 'Digimon'
    attackerName = resolveParticipantName(attacker, participants, baseDigimonName, d?.isEnemy || false)
  }
  if (target.type === 'digimon') {
    const [d] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    const baseDigimonName = d?.name || 'Digimon'
    targetName = resolveParticipantName(target, participants, baseDigimonName, d?.isEnemy || false)
  } else if (target.type === 'tamer') {
    const [t] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    targetName = t?.name || 'Tamer'
  }

  // Auto-miss: 0 accuracy successes = immediate miss, no intercede/dodge requests
  if (body.accuracySuccesses === 0) {
    // Still increment dodge penalty on target (successive attacks reduce dodge pool)
    participants = participants.map((p: any) => {
      if (p.id === body.targetId) {
        return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
      }
      return p
    })

    const missLog = {
      id: `log-${Date.now()}-miss`,
      timestamp: new Date().toISOString(),
      round: encounter.round || 0,
      actorId: body.attackerId,
      actorName: attackerName,
      action: 'Attack Result',
      target: targetName,
      result: 'AUTO MISS - 0 accuracy successes',
      damage: 0,
      effects: ['Miss'],
      hit: false,
    }

    await db.update(encounters).set({
      participants: JSON.stringify(participants),
      battleLog: JSON.stringify([...battleLog, missLog]),
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
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

  // === SUPPORT ATTACK ROUTING ===
  // Look up attack definition to determine if this is a support attack
  let attackDef: any = null
  if (attacker.type === 'digimon') {
    const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
    if (attackerDigimon?.attacks) {
      const attacks = typeof attackerDigimon.attacks === 'string'
        ? JSON.parse(attackerDigimon.attacks) : attackerDigimon.attacks
      attackDef = attacks?.find((a: any) => a.id === body.attackId)
    }
  }

  if (attackDef?.type === 'support') {
    const isAreaAttackTags = (attackDef.tags || []).some((t: string) => t.startsWith('Area Attack'))
    const isMeleeSelfBuff = attackDef.range === 'melee' && !isAreaAttackTags && body.targetId === body.attackerId

    if (isMeleeSelfBuff) {
      const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')

      const supportParams = {
        participants,
        battleLog,
        pendingRequests,
        attackerParticipantId: body.attackerId,
        targetParticipantId: body.targetId!,
        attackDef,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        round: encounter.round || 0,
        attackerName,
        targetName,
        encounterId: encounterId!,
        turnOrder,
        bolstered: body.bolstered,
        bolsterType: body.bolsterType,
        houseRules,
        eddySoulRules,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.batteryCount ?? 0,
      }

      let supportResult: any = null

      if (resolutionType === 'positive-auto') {
        supportResult = await resolvePositiveAuto(supportParams)
      } else if (resolutionType === 'positive-health') {
        supportResult = await resolvePositiveHealth(supportParams)
      } else if (resolutionType === 'negative') {
        supportResult = await resolveNegativeSupportNpc(supportParams)
      }

      if (supportResult?.resolved) {
        await db.update(encounters).set({
          participants: JSON.stringify(supportResult.participants),
          battleLog: JSON.stringify(supportResult.battleLog),
          pendingRequests: JSON.stringify(supportResult.pendingRequests),
          ...(supportResult.turnOrder ? { turnOrder: JSON.stringify(supportResult.turnOrder) } : {}),
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
    }
    // All other support attacks fall through to intercede
  }

  // Flag for downstream: is this a support attack?
  const isSupportAttack = attackDef?.type === 'support'

  // Find eligible tamers (those with partner digimon in encounter, not opted out)
  const eligibleTamerIds: string[] = []
  for (const p of participants) {
    if (p.type !== 'tamer') continue

    // Check opt-out: skip tamers who opted out of interceding for this target
    if (p.intercedeOptOuts?.includes(body.targetId)) continue

    // Verify they actually have a partner digimon in encounter
    let partnerParticipant: any = null
    for (const pp of participants) {
      if (pp.type !== 'digimon') continue
      const [dig] = await db.select().from(digimon).where(eq(digimon.id, pp.entityId))
      if (dig?.partnerId === p.entityId) {
        partnerParticipant = pp
        break
      }
    }

    if (!partnerParticipant) continue

    // Check action eligibility: at least one of tamer or partner digimon must have eligible actions
    const tamerIsTarget = p.id === body.targetId
    const digimonIsTarget = partnerParticipant.id === body.targetId
    const tamerEligible = !tamerIsTarget && hasEligibleInterceptor(p)
    const digimonEligible = !digimonIsTarget && hasEligibleInterceptor(partnerParticipant)
    if (!tamerEligible && !digimonEligible) continue

    eligibleTamerIds.push(p.entityId)
  }

  // Per-tamer Quick Reaction eligibility: only if target is their partner and order not used today
  const tamerQuickReactionMap: Record<string, { canUse: boolean; diceCount: number }> = {}
  if (target.type === 'digimon') {
    const [targetDig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    if (targetDig) {
      const stageBonus = (STAGE_CONFIG as any)[targetDig.stage]?.stageBonus ?? 0
      const diceCount = stageBonus + 2
      for (const tamerId of eligibleTamerIds) {
        if (targetDig.partnerId !== tamerId) {
          tamerQuickReactionMap[tamerId] = { canUse: false, diceCount: 0 }
          continue
        }
        const [tamerRecord] = await db.select().from(tamers).where(eq(tamers.id, tamerId))
        if (!tamerRecord) { tamerQuickReactionMap[tamerId] = { canUse: false, diceCount: 0 }; continue }
        const tamerAttrs = typeof tamerRecord.attributes === 'string' ? JSON.parse(tamerRecord.attributes) : (tamerRecord.attributes || {})
        const tamerXp = typeof tamerRecord.xpBonuses === 'string' ? JSON.parse(tamerRecord.xpBonuses) : (tamerRecord.xpBonuses || {})
        const unlockedOrders = getUnlockedSpecialOrders(tamerAttrs, tamerXp, campaignLevel as any)
        const hasQR = unlockedOrders.some((o: any) => o.name === 'Quick Reaction')
        if (!hasQR) { tamerQuickReactionMap[tamerId] = { canUse: false, diceCount: 0 }; continue }
        const usedPerDay = typeof tamerRecord.usedPerDayOrders === 'string' ? JSON.parse(tamerRecord.usedPerDayOrders) : (tamerRecord.usedPerDayOrders || [])
        tamerQuickReactionMap[tamerId] = { canUse: !usedPerDay.includes('Quick Reaction'), diceCount }
      }
    }
  }

  // GM always gets intercede modal unless explicitly opted out via "Never Intercede"
  const gmParticipant = participants.find((p: any) => p.id === 'gm')
  const gmOptOuts: string[] = gmParticipant?.intercedeOptOuts || []
  let gmEligible = !gmOptOuts.includes(body.targetId)

  // Check per-character opt-outs: if GM has opted out all possible interceptors for this target, skip
  if (gmEligible) {
    const gmCharacterOptOuts: Record<string, string[]> = gmParticipant?.gmCharacterOptOuts || {}
    const optedOutForTarget = gmCharacterOptOuts[body.targetId!] || []
    const possibleInterceptors = participants.filter((p: any) =>
      (p.type === 'tamer' || p.type === 'digimon') &&
      p.id !== body.attackerId &&
      p.id !== body.targetId
    )
    if (possibleInterceptors.length > 0 && possibleInterceptors.every((p: any) => optedOutForTarget.includes(p.id))) {
      gmEligible = false
    }
  }

  if (eligibleTamerIds.length === 0 && !gmEligible) {
    // No eligible tamers and GM not eligible — check if target is player-controlled or NPC
    let isPlayerTarget = false
    if (target.type === 'tamer') {
      isPlayerTarget = true
    } else if (target.type === 'digimon') {
      const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      isPlayerTarget = !!dig?.partnerId
    }

    if (isPlayerTarget) {
      // Player target — create dodge request
      let dodgeTargetTamerId = 'GM'
      if (target.type === 'tamer') {
        dodgeTargetTamerId = target.entityId
      } else if (target.type === 'digimon') {
        const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
        if (dig?.partnerId) dodgeTargetTamerId = dig.partnerId
      }

      const dodgeRequest = {
        id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        type: 'dodge-roll',
        targetTamerId: dodgeTargetTamerId,
        targetParticipantId: body.targetId,
        timestamp: new Date().toISOString(),
        data: {
          attackerName, targetName,
          attackName: body.attackName || 'Attack',
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          attackId: body.attackId, attackData: body.attackData,
          attackerEntityId: attacker.entityId,
          attackerParticipantId: body.attackerId,
          targetEntityId: target.entityId,
          dodgePenalty: target.dodgePenalty ?? 0,
          // Bolster bonuses for damage calculation
          bolstered: body.bolstered || false,
          bolsterType: body.bolsterType || null,
          bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
          bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
          lifestealed: body.lifestealed || false,
          // Support attack flag — downstream handlers skip damage
          isSupportAttack: isSupportAttack || false,
          // Signature Move Battery bonus
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
          // Clash modifiers
          clashAttack: body.clashAttack || false,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        },
      }

      await db.update(encounters).set({
        pendingRequests: JSON.stringify([...pendingRequests, dodgeRequest]),
        participants: JSON.stringify(participants),
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
    } else {
      // NPC target — resolve based on attack type
      if (isSupportAttack && attackDef) {
        const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')
        const supportParams = {
          participants, battleLog, pendingRequests,
          attackerParticipantId: body.attackerId,
          targetParticipantId: body.targetId!,
          attackDef,
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          round: encounter.round || 0,
          attackerName, targetName,
          encounterId: encounterId!,
          turnOrder, houseRules,
          isSignatureMove: body.isSignatureMove || false,
          batteryCount: body.batteryCount ?? 0,
        }
        let supportResult: any = null
        if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
        else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
        else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)

        if (supportResult) {
          await db.update(encounters).set({
            participants: JSON.stringify(supportResult.participants),
            battleLog: JSON.stringify(supportResult.battleLog),
            pendingRequests: JSON.stringify(supportResult.pendingRequests),
            ...(supportResult.turnOrder ? { turnOrder: JSON.stringify(supportResult.turnOrder) } : {}),
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
      } else {
        // Damage attack — auto-resolve NPC (roll dodge, calculate damage)
        const result = await resolveNpcAttack({
          participants, battleLog,
          attackerParticipantId: body.attackerId,
          targetParticipantId: body.targetId!,
          attackId: body.attackId,
          accuracySuccesses: body.accuracySuccesses,
          accuracyDice: body.accuracyDice,
          round: encounter.round || 0,
          attackerName, targetName,
          turnOrder,
          currentTurnIndex: encounter.currentTurnIndex || 0,
          houseRules,
          clashAttack: body.clashAttack,
          outsideClashCpuPenalty: body.outsideClashCpuPenalty,
        })

        await db.update(encounters).set({
          participants: JSON.stringify(result.participants),
          battleLog: JSON.stringify(result.battleLog),
          ...(result.turnOrder ? { turnOrder: JSON.stringify(result.turnOrder) } : {}),
          updatedAt: new Date(),
        }).where(eq(encounters.id, encounterId))

        // Check for Counterattack quality on the target (the one who was missed)
        if (!result.hit && target?.type === 'digimon' && !target?.usedCounterattackThisCombat) {
          const [tgtDig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
          const tgtQualities = typeof tgtDig?.qualities === 'string' ? JSON.parse(tgtDig.qualities) : (tgtDig?.qualities || [])
          if ((tgtQualities as any[]).some((q: any) => q.id === 'counterattack')) {
            const freshEnc = await db.select().from(encounters).where(eq(encounters.id, encounterId)).then(r => r[0])
            const caResult = await triggerCounterattack({
              participants: parseJsonField(freshEnc.participants),
              battleLog: parseJsonField(freshEnc.battleLog),
              pendingRequests: parseJsonField(freshEnc.pendingRequests),
              round: encounter.round || 0,
              counterattackerParticipantId: body.targetId!,
              originalAttackerParticipantId: body.attackerId,
              houseRules,
            })
            await db.update(encounters).set({
              participants: JSON.stringify(caResult.participants),
              battleLog: JSON.stringify(caResult.battleLog),
              pendingRequests: JSON.stringify(caResult.pendingRequests),
              updatedAt: new Date(),
            }).where(eq(encounters.id, encounterId))
          }
        }

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
      }
    }
  }

  // If no player tamers eligible but GM is, create GM-only intercede offer
  if (eligibleTamerIds.length === 0 && gmEligible) {
    const intercedeGroupId = `intercede-${Date.now()}-${body.targetId}`
    const gmRequest = {
      id: `req-${Date.now()}-gm`,
      type: 'intercede-offer',
      targetTamerId: 'GM',
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        attackerId: body.attackerId,
        targetId: body.targetId,
        attackerName,
        targetName,
        attackName: body.attackName || 'Attack',
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds: [],
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
        isSupportAttack: isSupportAttack || false,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
      },
    }

    await db.update(encounters).set({
      pendingRequests: JSON.stringify([...pendingRequests, gmRequest]),
      participants: JSON.stringify(participants),
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
  }

  // Create a unique intercede group ID to link all offers for this attack
  const intercedeGroupId = `intercede-${Date.now()}-${body.targetId}`

  // Create intercede-offer requests for each eligible tamer
  const newRequests: any[] = []
  for (const tamerId of eligibleTamerIds) {
    const qr = tamerQuickReactionMap[tamerId] || { canUse: false, diceCount: 0 }
    newRequests.push({
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'intercede-offer',
      targetTamerId: tamerId,
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        attackerId: body.attackerId,
        targetId: body.targetId,
        attackerName,
        targetName,
        attackName: body.attackName || 'Attack',
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds,
        // Pass through bolster bonuses
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
        isSupportAttack: isSupportAttack || false,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
        canUseQuickReaction: qr.canUse,
        quickReactionDiceCount: qr.diceCount,
      },
    })
  }

  // Add GM intercede offer if eligible (reusing check computed earlier)
  if (gmEligible) {
    newRequests.push({
      id: `req-${Date.now()}-gm`,
      type: 'intercede-offer',
      targetTamerId: 'GM',
      targetParticipantId: body.targetId,
      timestamp: new Date().toISOString(),
      data: {
        intercedeGroupId,
        attackerId: body.attackerId,
        targetId: body.targetId,
        attackerName,
        targetName,
        attackName: body.attackName || 'Attack',
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds,
        isSupportAttack: isSupportAttack || false,
        isSignatureMove: body.isSignatureMove || false,
        batteryCount: body.isSignatureMove ? (body.batteryCount ?? 0) : 0,
        clashAttack: body.clashAttack || false,
        outsideClashCpuPenalty: body.outsideClashCpuPenalty ?? 0,
      },
    })
  }

  // Update encounter with new requests and updated participants (attacker actions deducted)
  await db.update(encounters).set({
    pendingRequests: JSON.stringify([...pendingRequests, ...newRequests]),
    participants: JSON.stringify(participants),
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
