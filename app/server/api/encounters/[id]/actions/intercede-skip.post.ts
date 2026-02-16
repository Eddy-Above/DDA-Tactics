import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'
import { resolveNpcAttack } from '~/server/utils/resolveNpcAttack'

interface IntercedeSkipBody {
  requestId: string
  optOut?: boolean // If true, permanently opt out of interceding for this target
  characterOptOuts?: string[] // GM-only: participant IDs to never intercede with for this target
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeSkipBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId) {
    throw createError({ statusCode: 400, message: 'requestId is required' })
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
  let turnOrder = parseJsonField(encounter.turnOrder)

  // Find the request
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  // Handle per-character opt-outs (GM-only): save which interceptors should never intercede for this target
  if (body.characterOptOuts && request.targetTamerId === 'GM') {
    const gmP = participants.find((p: any) => p.id === 'gm')
    if (gmP) {
      gmP.gmCharacterOptOuts = {
        ...(gmP.gmCharacterOptOuts || {}),
        [request.data.targetId]: body.characterOptOuts,
      }
    } else {
      participants.push({
        id: 'gm',
        type: 'gm',
        intercedeOptOuts: [],
        gmCharacterOptOuts: { [request.data.targetId]: body.characterOptOuts },
      })
    }

    // Save participants but do NOT remove the pending request
    await db.update(encounters).set({
      participants: JSON.stringify(participants),
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return {
      ...updated,
      participants: parseJsonField(updated!.participants),
      turnOrder: parseJsonField(updated!.turnOrder),
      battleLog: parseJsonField(updated!.battleLog),
      pendingRequests: parseJsonField(updated!.pendingRequests),
      requestResponses: parseJsonField(updated!.requestResponses),
      hazards: parseJsonField(updated!.hazards),
    }
  }

  // Handle opt-out: save target to tamer's or GM's intercedeOptOuts
  if (body.optOut) {
    if (request.targetTamerId === 'GM') {
      const gmP = participants.find((p: any) => p.id === 'gm')
      if (gmP) {
        gmP.intercedeOptOuts = [...(gmP.intercedeOptOuts || []), request.data.targetId]
      } else {
        participants.push({ id: 'gm', type: 'gm', intercedeOptOuts: [request.data.targetId] })
      }
    } else {
      const tamerParticipant = participants.find(
        (p: any) => p.type === 'tamer' && p.entityId === request.targetTamerId
      )
      if (tamerParticipant) {
        tamerParticipant.intercedeOptOuts = [
          ...(tamerParticipant.intercedeOptOuts || []),
          request.data.targetId,
        ]
      }
    }
  }

  const intercedeGroupId = request.data.intercedeGroupId

  // Remove this specific request
  pendingRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

  // Check if all eligible tamers have now skipped (no more requests in this group)
  const remainingGroupRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)

  const updateData: any = {
    pendingRequests: JSON.stringify(pendingRequests),
    updatedAt: new Date(),
  }

  // If all skipped, resolve the attack
  if (remainingGroupRequests.length === 0) {
    const target = participants.find((p: any) => p.id === request.data.targetId)
    if (target) {
      // Check if target is player-controlled or NPC
      let isPlayerTarget = false
      if (target.type === 'tamer') {
        isPlayerTarget = true
      } else if (target.type === 'digimon') {
        const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
        isPlayerTarget = !!dig?.partnerId
      }

      if (isPlayerTarget) {
        // Player target — create dodge request
        let targetTamerId = 'GM'
        if (target.type === 'tamer') {
          targetTamerId = target.entityId
        } else if (target.type === 'digimon') {
          const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
          if (dig?.partnerId) targetTamerId = dig.partnerId
        }

        const dodgeRequest = {
          id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          type: 'dodge-roll',
          targetTamerId,
          targetParticipantId: request.data.targetId,
          timestamp: new Date().toISOString(),
          data: {
            attackerName: request.data.attackerName,
            targetName: request.data.targetName,
            accuracySuccesses: request.data.accuracySuccesses,
            accuracyDice: request.data.accuracyDice,
            attackId: request.data.attackId,
            attackData: request.data.attackData,
            attackerEntityId: participants.find((p: any) => p.id === request.data.attackerId)?.entityId,
            attackerParticipantId: request.data.attackerId,
            targetEntityId: target.entityId,
            dodgePenalty: target.dodgePenalty ?? 0,
            // Pass through bolster bonuses from intercede-offer
            bolstered: request.data.bolstered || false,
            bolsterType: request.data.bolsterType || null,
            bolsterDamageBonus: request.data.bolsterDamageBonus || 0,
            bolsterBitCpuBonus: request.data.bolsterBitCpuBonus || 0,
          },
        }

        const updatedRequests = [...pendingRequests, dodgeRequest]
        updateData.pendingRequests = JSON.stringify(updatedRequests)

        updateData.participants = JSON.stringify(participants)
      } else {
        // NPC target — auto-resolve (roll dodge, calculate damage)
        const result = await resolveNpcAttack({
          participants, battleLog,
          attackerParticipantId: request.data.attackerId,
          targetParticipantId: request.data.targetId,
          attackId: request.data.attackId,
          accuracySuccesses: request.data.accuracySuccesses,
          accuracyDice: request.data.accuracyDice,
          round: encounter.round || 0,
          attackerName: request.data.attackerName,
          targetName: request.data.targetName,
          turnOrder,
        })

        updateData.participants = JSON.stringify(result.participants)
        updateData.battleLog = JSON.stringify(result.battleLog)
        if (result.turnOrder) {
          updateData.turnOrder = JSON.stringify(result.turnOrder)
        }
      }
    }
  } else {
    // Not all skipped yet, but still save participant changes (opt-out)
    updateData.participants = JSON.stringify(participants)
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

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
