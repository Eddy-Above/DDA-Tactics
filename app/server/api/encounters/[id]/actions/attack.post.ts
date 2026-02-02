import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'

interface AttackActionBody {
  participantId: string
  attackId: string
  targetId: string
  accuracyDicePool: number
  accuracySuccesses: number
  accuracyDiceResults: number[]
  tamerId: string
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<AttackActionBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.participantId || !body.attackId || !body.targetId || !body.tamerId ||
      body.accuracyDicePool === undefined || body.accuracySuccesses === undefined ||
      !body.accuracyDiceResults) {
    throw createError({
      statusCode: 400,
      message: 'participantId, attackId, targetId, accuracyDicePool, accuracySuccesses, accuracyDiceResults, and tamerId are required',
    })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${encounterId} not found`,
    })
  }

  // Parse JSON fields
  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try {
        return JSON.parse(field)
      } catch {
        return []
      }
    }
    return []
  }

  const participants = parseJsonField(encounter.participants) || []
  const turnOrder = parseJsonField(encounter.turnOrder) || []
  const battleLog = parseJsonField(encounter.battleLog) || []
  const pendingRequests = parseJsonField(encounter.pendingRequests) || []

  // Validate participant exists and is active
  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) {
    throw createError({
      statusCode: 404,
      message: 'Participant not found',
    })
  }

  // Check if participant can act (direct turn or partner digimon on tamer's turn)
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]

  let canAct = actor.id === currentTurnParticipantId

  // If actor is a digimon and it's not directly their turn,
  // check if it's their partner tamer's turn
  if (!canAct && actor.type === 'digimon') {
    // Find current turn participant
    const currentTurnParticipant = participants.find((p: any) => p.id === currentTurnParticipantId)

    // Check if current participant is a tamer
    if (currentTurnParticipant?.type === 'tamer') {
      // Look up digimon to get partnerId
      const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, actor.entityId))

      if (digimonEntity?.partnerId === currentTurnParticipant.entityId) {
        canAct = true
      }
    }
  }

  if (!canAct) {
    throw createError({
      statusCode: 403,
      message: 'It is not this participant\'s turn',
    })
  }

  // Validate target exists
  const target = participants.find((p: any) => p.id === body.targetId)
  if (!target) {
    throw createError({
      statusCode: 404,
      message: 'Target not found',
    })
  }

  // Attacks cost 1 simple action
  const actionCostSimple = 1

  // Validate participant has enough actions
  if ((actor.actionsRemaining?.simple || 0) < actionCostSimple) {
    throw createError({
      statusCode: 403,
      message: 'Not enough actions remaining',
    })
  }

  // Create new participant with decremented actions
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        actionsRemaining: {
          simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCostSimple),
        },
      }
    }
    return p
  })

  // Add battle log entry for the attack
  const attackLogEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: actor.type === 'tamer' ? `Tamer ${actor.entityId}` : `Digimon ${actor.entityId}`,
    action: 'Attack',
    target: target.type === 'tamer' ? `Tamer ${target.entityId}` : `Digimon ${target.entityId}`,
    result: `${body.accuracyDicePool}d6 => [${body.accuracyDiceResults.join(',')}] = ${body.accuracySuccesses} successes`,
    damage: null,
    effects: ['Attack', 'Accuracy Roll'],
  }

  const updatedBattleLog = [...battleLog, attackLogEntry]

  // Create dodge request for target
  const targetTamerId = target.type === 'tamer' ? target.entityId : `partner-of-${target.entityId}`
  // For simplicity, we'll extract the tamer ID from the context
  // In a production system, you'd need to fetch the tamer ID separately

  const dodgeRequest = {
    id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: 'dodge-roll',
    targetTamerId: target.entityId,
    targetParticipantId: target.id,
    timestamp: new Date().toISOString(),
    data: {
      attackName: body.attackId,
      attackerName: actor.type === 'tamer' ? `Tamer ${actor.entityId}` : `Digimon ${actor.entityId}`,
      attackerParticipantId: body.participantId,
      attackerEntityId: actor.entityId,
      // Store accuracy dice data for later comparison when dodge response comes in
      accuracyDicePool: body.accuracyDicePool,
      accuracySuccesses: body.accuracySuccesses,
      accuracyDiceResults: body.accuracyDiceResults,
    },
  }

  const updatedRequests = [...pendingRequests, dodgeRequest]

  // Update encounter
  const updateData: any = {
    participants: JSON.stringify(updatedParticipants),
    battleLog: JSON.stringify(updatedBattleLog),
    pendingRequests: JSON.stringify(updatedRequests),
    updatedAt: new Date(),
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    hazards: parseJsonField(updated.hazards),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
  }
})
