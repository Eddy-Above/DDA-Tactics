import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'

interface CheerUpBody {
  participantId: string       // Tamer's participant ID
  targetParticipantId: string // Digimon participant ID to cheer up
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<CheerUpBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId || !body.targetParticipantId) {
    throw createError({ statusCode: 400, message: 'participantId and targetParticipantId are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!encounter) {
    throw createError({ statusCode: 404, message: `Encounter with ID ${encounterId} not found` })
  }

  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try { return JSON.parse(field) } catch { return [] }
    }
    return []
  }

  const participants = parseJsonField(encounter.participants) || []
  const turnOrder = parseJsonField(encounter.turnOrder) || []
  const battleLog = parseJsonField(encounter.battleLog) || []

  // Find tamer participant
  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) throw createError({ statusCode: 404, message: 'Participant not found' })
  if (actor.type !== 'tamer') throw createError({ statusCode: 403, message: 'Only tamers can use Cheer Up' })

  // Must be the active participant's turn
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]
  if (actor.id !== currentTurnParticipantId) {
    throw createError({ statusCode: 403, message: 'It is not this participant\'s turn' })
  }

  // Costs 2 simple actions (Complex Action)
  if ((actor.actionsRemaining?.simple || 0) < 2) {
    throw createError({ statusCode: 403, message: 'Not enough actions remaining (Cheer Up costs 2 Simple Actions)' })
  }

  // Find target digimon participant
  const targetParticipant = participants.find((p: any) => p.id === body.targetParticipantId)
  if (!targetParticipant || targetParticipant.type !== 'digimon') {
    throw createError({ statusCode: 404, message: 'Target digimon not found' })
  }

  // Validate target has Positive Reinforcement and Mood is at 1
  const [targetDigimonEntity] = await db.select().from(digimon).where(eq(digimon.id, targetParticipant.entityId))
  if (!targetDigimonEntity) throw createError({ statusCode: 404, message: 'Target digimon entity not found' })

  const targetQualities = typeof targetDigimonEntity.qualities === 'string'
    ? JSON.parse(targetDigimonEntity.qualities)
    : targetDigimonEntity.qualities
  const hasPositiveReinforcement = (targetQualities || []).some((q: any) => q.id === 'positive-reinforcement')
  if (!hasPositiveReinforcement) {
    throw createError({ statusCode: 400, message: 'Target digimon does not have Positive Reinforcement' })
  }

  const currentMood = targetParticipant.moodValue ?? 3
  if (currentMood !== 1) {
    throw createError({ statusCode: 400, message: 'Cheer Up can only be used when the Digimon\'s Mood is at 1' })
  }

  // Get names for battle log
  const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
  const tamerName = tamerEntity?.name || `Tamer ${actor.entityId}`
  const digimonName = targetDigimonEntity.name || `Digimon ${targetParticipant.entityId}`

  // Update participants
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 2) },
      }
    }
    if (p.id === body.targetParticipantId) {
      return { ...p, moodValue: 4 }
    }
    return p
  })

  // Battle log entry
  const logEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: tamerName,
    action: 'Cheer Up',
    target: digimonName,
    result: `${tamerName} cheered up ${digimonName}! Mood restored to 4.`,
    damage: null,
    effects: ['Cheer Up'],
  }

  const updatedBattleLog = [...battleLog, logEntry]

  await db.update(encounters).set({
    participants: JSON.stringify(updatedParticipants),
    battleLog: JSON.stringify(updatedBattleLog),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

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
