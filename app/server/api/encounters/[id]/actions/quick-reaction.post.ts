import { eq } from 'drizzle-orm'
import { db, encounters, tamers, digimon, campaigns } from '../../../../db'
import { getUnlockedSpecialOrders } from '~/utils/specialOrders'
import { STAGE_CONFIG } from '~/types'

interface QuickReactionBody {
  requestId: string
  tamerParticipantId: string
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<QuickReactionBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId || !body.tamerParticipantId) {
    throw createError({ statusCode: 400, message: 'requestId and tamerParticipantId are required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
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

  // Find the intercede-offer request
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  const intercedeGroupId = request.data.intercedeGroupId
  const isAreaAttack = !!request.data.isAreaAttack

  // Atomic check: if group already resolved (no remaining group requests), 409
  const groupRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)
  if (groupRequests.length === 0) {
    throw createError({ statusCode: 409, message: 'Intercede group already resolved' })
  }

  // Find tamer participant and target participant
  const tamerParticipant = participants.find((p: any) => p.id === body.tamerParticipantId && p.type === 'tamer')
  if (!tamerParticipant) {
    throw createError({ statusCode: 404, message: 'Tamer participant not found' })
  }

  // For area attacks, find the tamer's partner among areaTargetIds
  let effectiveTargetId: string
  if (isAreaAttack) {
    const areaTargetIds: string[] = request.data.areaTargetIds || []
    // Find which area target is this tamer's partner digimon
    let partnerTargetId: string | null = null
    for (const tid of areaTargetIds) {
      const p = participants.find((pp: any) => pp.id === tid)
      if (p?.type === 'digimon') {
        const [dig] = await db.select().from(digimon).where(eq(digimon.id, p.entityId))
        if (dig?.partnerId === tamerParticipant.entityId) {
          partnerTargetId = tid
          break
        }
      }
    }
    if (!partnerTargetId) {
      throw createError({ statusCode: 400, message: 'Quick Reaction requires your partner digimon to be among the area attack targets' })
    }
    // Also check if this target is still available (not claimed yet)
    const stillAvailable = pendingRequests.some(
      (r: any) => r.data?.intercedeGroupId === intercedeGroupId && r.data?.areaTargetIds?.includes(partnerTargetId)
    )
    if (!stillAvailable) {
      throw createError({ statusCode: 409, message: 'Your partner digimon target was already claimed by another interceptor' })
    }
    effectiveTargetId = partnerTargetId
  } else {
    effectiveTargetId = request.data.targetId
  }

  const target = participants.find((p: any) => p.id === effectiveTargetId)
  if (!target || target.type !== 'digimon') {
    throw createError({ statusCode: 400, message: 'Quick Reaction requires a digimon target' })
  }

  // Load tamer DB record
  const [tamerRecord] = await db.select().from(tamers).where(eq(tamers.id, tamerParticipant.entityId))
  if (!tamerRecord) {
    throw createError({ statusCode: 404, message: 'Tamer record not found' })
  }

  // Verify Quick Reaction is unlocked
  const tamerAttrs = typeof tamerRecord.attributes === 'string' ? JSON.parse(tamerRecord.attributes) : (tamerRecord.attributes || {})
  const tamerXp = typeof tamerRecord.xpBonuses === 'string' ? JSON.parse(tamerRecord.xpBonuses) : (tamerRecord.xpBonuses || {})

  // Get campaign level
  let campaignLevel: string = 'standard'
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign?.level) campaignLevel = campaign.level
  }

  const unlockedOrders = getUnlockedSpecialOrders(tamerAttrs, tamerXp, campaignLevel as any)
  const hasQR = unlockedOrders.some((o: any) => o.name === 'Quick Reaction')
  if (!hasQR) {
    throw createError({ statusCode: 403, message: 'Tamer does not have Quick Reaction unlocked' })
  }

  // Verify not already used today
  const usedPerDayOrders: string[] = typeof tamerRecord.usedPerDayOrders === 'string'
    ? JSON.parse(tamerRecord.usedPerDayOrders) : (tamerRecord.usedPerDayOrders || [])
  if (usedPerDayOrders.includes('Quick Reaction')) {
    throw createError({ statusCode: 409, message: 'Quick Reaction already used today' })
  }

  // Load target digimon DB record
  const [targetDig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
  if (!targetDig) {
    throw createError({ statusCode: 404, message: 'Target digimon not found' })
  }

  // Verify this tamer is the target's partner
  if (targetDig.partnerId !== tamerParticipant.entityId) {
    throw createError({ statusCode: 403, message: 'Quick Reaction can only be used for your own partner digimon' })
  }

  // Compute dice bonus
  const stageBonus = (STAGE_CONFIG as any)[targetDig.stage]?.stageBonus ?? 0
  const diceCount = stageBonus + 2

  // Apply action cost to tamer — always deferred (rule: "next round")
  participants = participants.map((p: any) => {
    if (p.id === body.tamerParticipantId) {
      return { ...p, interceptPenalty: (p.interceptPenalty || 0) + 1 }
    }
    if (p.id === effectiveTargetId) {
      return { ...p, quickReactionDiceBonus: diceCount }
    }
    return p
  })

  if (isAreaAttack) {
    // Remove this request
    pendingRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

    // Strip QR target from areaTargetIds of all remaining group requests
    pendingRequests = pendingRequests.map((r: any) => {
      if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return r
      const remaining = (r.data.areaTargetIds || []).filter((tid: string) => tid !== effectiveTargetId)
      return { ...r, data: { ...r.data, areaTargetIds: remaining } }
    })

    // Remove requests whose areaTargetIds is now empty
    pendingRequests = pendingRequests.filter((r: any) => {
      if (r.data?.intercedeGroupId !== intercedeGroupId || !r.data?.isAreaAttack) return true
      return (r.data.areaTargetIds || []).length > 0
    })

    // Create a dodge-roll (with QR bonus) for the QR target
    let qrTargetTamerId = 'GM'
    if (targetDig.partnerId) qrTargetTamerId = targetDig.partnerId

    const qrDodgeRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'dodge-roll',
      targetTamerId: qrTargetTamerId,
      targetParticipantId: effectiveTargetId,
      timestamp: new Date().toISOString(),
      data: {
        attackerName: request.data.attackerName,
        targetName: target.name || effectiveTargetId,
        attackName: request.data.attackName || 'Attack',
        accuracySuccesses: request.data.accuracySuccesses,
        accuracyDice: request.data.accuracyDice,
        attackId: request.data.attackId,
        attackData: request.data.attackData,
        attackerEntityId: participants.find((p: any) => p.id === request.data.attackerId)?.entityId,
        attackerParticipantId: request.data.attackerId,
        targetEntityId: target.entityId,
        dodgePenalty: target.dodgePenalty ?? 0,
        bolstered: request.data.bolstered || false,
        bolsterType: request.data.bolsterType || null,
        bolsterDamageBonus: request.data.bolsterDamageBonus || 0,
        bolsterBitCpuBonus: request.data.bolsterBitCpuBonus || 0,
        isSupportAttack: request.data.isSupportAttack || false,
        isSignatureMove: request.data.isSignatureMove || false,
        batteryCount: request.data.batteryCount ?? 0,
        clashAttack: request.data.clashAttack || false,
        outsideClashCpuPenalty: request.data.outsideClashCpuPenalty ?? 0,
      },
    }
    pendingRequests.push(qrDodgeRequest)

    // For remaining area targets (not the QR target), check coverage
    const originalAreaTargets: string[] = request.data.areaTargetIds || []
    for (const uncoveredId of originalAreaTargets) {
      if (uncoveredId === effectiveTargetId) continue
      const isCovered = pendingRequests.some(
        (r: any) => r.data?.intercedeGroupId === intercedeGroupId && r.data?.areaTargetIds?.includes(uncoveredId)
      )
      if (!isCovered) {
        const uncoveredParticipant = participants.find((p: any) => p.id === uncoveredId)
        if (uncoveredParticipant) {
          let targetTamerId = 'GM'
          if (uncoveredParticipant.type === 'tamer') {
            targetTamerId = uncoveredParticipant.entityId
          } else if (uncoveredParticipant.type === 'digimon') {
            const [dig] = await db.select().from(digimon).where(eq(digimon.id, uncoveredParticipant.entityId))
            if (dig?.partnerId) targetTamerId = dig.partnerId
          }
          const dodgeRequest = {
            id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'dodge-roll',
            targetTamerId,
            targetParticipantId: uncoveredId,
            timestamp: new Date().toISOString(),
            data: {
              attackerName: request.data.attackerName,
              targetName: uncoveredParticipant.name || uncoveredId,
              attackName: request.data.attackName || 'Attack',
              accuracySuccesses: request.data.accuracySuccesses,
              accuracyDice: request.data.accuracyDice,
              attackId: request.data.attackId,
              attackData: request.data.attackData,
              attackerEntityId: participants.find((p: any) => p.id === request.data.attackerId)?.entityId,
              attackerParticipantId: request.data.attackerId,
              targetEntityId: uncoveredParticipant.entityId,
              dodgePenalty: uncoveredParticipant.dodgePenalty ?? 0,
              bolstered: request.data.bolstered || false,
              bolsterType: request.data.bolsterType || null,
              bolsterDamageBonus: request.data.bolsterDamageBonus || 0,
              bolsterBitCpuBonus: request.data.bolsterBitCpuBonus || 0,
              isSupportAttack: request.data.isSupportAttack || false,
              isSignatureMove: request.data.isSignatureMove || false,
              batteryCount: request.data.batteryCount ?? 0,
              clashAttack: request.data.clashAttack || false,
              outsideClashCpuPenalty: request.data.outsideClashCpuPenalty ?? 0,
            },
          }
          pendingRequests.push(dodgeRequest)
        }
      }
    }
  } else {
    // Single-target: remove all intercede-offer requests for this group, create one dodge-roll
    pendingRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId !== intercedeGroupId)

    // Resolve targetTamerId for dodge-roll request
    let targetTamerId = 'GM'
    if (targetDig.partnerId) targetTamerId = targetDig.partnerId

    // Build dodge-roll pending request
    const dodgeRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'dodge-roll',
      targetTamerId,
      targetParticipantId: effectiveTargetId,
      timestamp: new Date().toISOString(),
      data: {
        attackerName: request.data.attackerName,
        targetName: request.data.targetName,
        attackName: request.data.attackName || 'Attack',
        accuracySuccesses: request.data.accuracySuccesses,
        accuracyDice: request.data.accuracyDice,
        attackId: request.data.attackId,
        attackData: request.data.attackData,
        attackerEntityId: participants.find((p: any) => p.id === request.data.attackerId)?.entityId,
        attackerParticipantId: request.data.attackerId,
        targetEntityId: target.entityId,
        dodgePenalty: target.dodgePenalty ?? 0,
        bolstered: request.data.bolstered || false,
        bolsterType: request.data.bolsterType || null,
        bolsterDamageBonus: request.data.bolsterDamageBonus || 0,
        bolsterBitCpuBonus: request.data.bolsterBitCpuBonus || 0,
        isSupportAttack: request.data.isSupportAttack || false,
        isSignatureMove: request.data.isSignatureMove || false,
        batteryCount: request.data.batteryCount ?? 0,
        clashAttack: request.data.clashAttack || false,
        outsideClashCpuPenalty: request.data.outsideClashCpuPenalty ?? 0,
      },
    }

    pendingRequests = [...pendingRequests, dodgeRequest]
  }

  // Persist Quick Reaction to tamer's usedPerDayOrders
  await db.update(tamers).set({
    usedPerDayOrders: JSON.stringify([...usedPerDayOrders, 'Quick Reaction']),
  }).where(eq(tamers.id, tamerParticipant.entityId))

  // Add battle log entry
  const logEntry = {
    id: `log-${Date.now()}-qr`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.tamerParticipantId,
    actorName: tamerRecord.name || 'Tamer',
    action: 'Quick Reaction',
    target: target.name || effectiveTargetId,
    result: `${tamerRecord.name || 'Tamer'} calls out a warning — ${target.name || effectiveTargetId} gains +${diceCount} Dodge Dice for the round`,
    damage: 0,
    effects: ['Quick Reaction'],
    hit: false,
  }
  battleLog = [...battleLog, logEntry]

  await db.update(encounters).set({
    participants: JSON.stringify(participants),
    pendingRequests: JSON.stringify(pendingRequests),
    battleLog: JSON.stringify(battleLog),
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
