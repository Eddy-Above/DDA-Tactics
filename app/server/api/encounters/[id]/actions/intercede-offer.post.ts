import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'
import { resolveNpcAttack } from '~/server/utils/resolveNpcAttack'
import { resolveParticipantName } from '~/server/utils/participantName'

interface IntercedeOfferBody {
  attackerId: string
  targetId: string
  accuracySuccesses: number
  accuracyDice: number[]
  attackId: string
  attackData: any // Full attack data for later resolution
  bolstered?: boolean
  bolsterType?: 'damage-accuracy' | 'bit-cpu'
  skipActionDeduction?: boolean // When called from attack.post.ts which already deducted actions
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeOfferBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.attackerId || !body.targetId || !body.attackId) {
    throw createError({ statusCode: 400, message: 'attackerId, targetId, and attackId are required' })
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
  const pendingRequests = parseJsonField(encounter.pendingRequests)
  const battleLog = parseJsonField(encounter.battleLog)

  const attacker = participants.find((p: any) => p.id === body.attackerId)
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!attacker || !target) {
    throw createError({ statusCode: 404, message: 'Attacker or target not found' })
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

  // Find eligible tamers (those with partner digimon in encounter, not opted out)
  const eligibleTamerIds: string[] = []
  for (const p of participants) {
    if (p.type !== 'tamer') continue

    // Check opt-out: skip tamers who opted out of interceding for this target
    if (p.intercedeOptOuts?.includes(body.targetId)) continue

    // Verify they actually have a partner digimon in encounter
    let hasPartnerInEncounter = false
    for (const pp of participants) {
      if (pp.type !== 'digimon') continue
      const [dig] = await db.select().from(digimon).where(eq(digimon.id, pp.entityId))
      if (dig?.partnerId === p.entityId) {
        hasPartnerInEncounter = true
        break
      }
    }

    if (hasPartnerInEncounter) {
      eligibleTamerIds.push(p.entityId)
    }
  }

  // GM always gets intercede modal unless explicitly opted out via "Never Intercede"
  const gmParticipant = participants.find((p: any) => p.id === 'gm')
  const gmOptOuts: string[] = gmParticipant?.intercedeOptOuts || []
  const gmEligible = !gmOptOuts.includes(body.targetId)

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
      // NPC target — auto-resolve (roll dodge, calculate damage)
      const result = await resolveNpcAttack({
        participants, battleLog,
        attackerParticipantId: body.attackerId,
        targetParticipantId: body.targetId,
        attackId: body.attackId,
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        round: encounter.round || 0,
        attackerName, targetName,
      })

      await db.update(encounters).set({
        participants: JSON.stringify(result.participants),
        battleLog: JSON.stringify(result.battleLog),
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
  }

  // If no player tamers eligible but GM is, create GM-only intercede offer
  if (eligibleTamerIds.length === 0 && gmEligible) {
    const intercedeGroupId = `intercede-${Date.now()}`
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
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds: [],
        bolstered: body.bolstered || false,
        bolsterType: body.bolsterType || null,
        bolsterDamageBonus: body.bolstered && body.bolsterType === 'damage-accuracy' ? 2 : 0,
        bolsterBitCpuBonus: body.bolstered && body.bolsterType === 'bit-cpu' ? 1 : 0,
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
  const intercedeGroupId = `intercede-${Date.now()}`

  // Create intercede-offer requests for each eligible tamer
  const newRequests = eligibleTamerIds.map(tamerId => ({
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
    },
  }))

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
        accuracySuccesses: body.accuracySuccesses,
        accuracyDice: body.accuracyDice,
        attackId: body.attackId,
        attackData: body.attackData,
        eligibleTamerIds,
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
