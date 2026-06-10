import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'

interface DigivolveFailBody {
  participantId: string
  targetSpecies: string
  rollTotal: number
  dc: number
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<DigivolveFailBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId) {
    throw createError({ statusCode: 400, message: 'participantId is required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  let participants = encounter.participants
  const battleLog = encounter.battleLog

  // Find participant
  const participant = participants.find((p: any) => p.id === body.participantId)
  if (!participant) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  if (participant.type !== 'digimon') {
    throw createError({ statusCode: 400, message: 'Only digimon can digivolve' })
  }

  // Find partner tamer
  const [digimonEntity] = await db.select().from(digimon).where(eq(digimon.id, participant.entityId))
  if (!digimonEntity?.partnerId) {
    throw createError({ statusCode: 400, message: 'Digimon has no partner tamer' })
  }

  const tamerParticipant = participants.find(
    (p: any) => p.type === 'tamer' && p.entityId === digimonEntity.partnerId
  )
  if (!tamerParticipant) {
    throw createError({ statusCode: 400, message: 'No partner tamer found in encounter' })
  }

  // Validate it's the tamer's turn
  const turnOrder = encounter.turnOrder
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]
  const canAct = tamerParticipant.id === currentTurnParticipantId || participant.id === currentTurnParticipantId

  if (!canAct) {
    throw createError({ statusCode: 400, message: 'Participant cannot act right now' })
  }

  // Check action cost
  if ((tamerParticipant.actionsRemaining?.simple || 0) < 1) {
    throw createError({ statusCode: 400, message: 'Tamer does not have enough actions' })
  }

  // Only one digivolve attempt per turn
  if (tamerParticipant.hasAttemptedDigivolve) {
    throw createError({ statusCode: 400, message: 'Already attempted digivolution this turn' })
  }

  // Deduct 1 simple action from tamer
  participants = participants.map((p: any) => {
    if (p.id === tamerParticipant.id) {
      return {
        ...p,
        actionsRemaining: { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) },
        hasAttemptedDigivolve: true,
      }
    }
    return p
  })

  // Add battle log entry
  const logEntry = {
    id: `log-${Date.now()}-digivolve-fail`,
    timestamp: new Date().toISOString(),
    round: encounter.round || 0,
    actorId: body.participantId,
    actorName: digimonEntity.name,
    action: `failed to digivolve to ${body.targetSpecies}`,
    target: null,
    result: `Willpower check failed (rolled ${body.rollTotal} vs DC ${body.dc})`,
    damage: null,
    effects: [],
  }

  // Update encounter
  await db.update(encounters).set({
    participants,
    battleLog: [...battleLog, logEntry],
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  return updated
})
