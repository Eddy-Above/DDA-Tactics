import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers } from '../../../../db'

interface DirectActionBody {
  participantId: string
  targetDigimonId: string
  bolstered: boolean
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<DirectActionBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.participantId || !body.targetDigimonId || body.bolstered === undefined) {
    throw createError({
      statusCode: 400,
      message: 'participantId, targetDigimonId, and bolstered are required',
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

  const participants = encounter.participants || []
  const turnOrder = encounter.turnOrder || []
  const battleLog = encounter.battleLog || []

  // Find tamer participant
  const actor = participants.find((p: any) => p.id === body.participantId)
  if (!actor) {
    throw createError({
      statusCode: 404,
      message: 'Participant not found',
    })
  }

  if (actor.type !== 'tamer') {
    throw createError({
      statusCode: 403,
      message: 'Only tamers can use Direct',
    })
  }

  // Check if participant can act (their turn)
  const currentIndex = encounter.currentTurnIndex || 0
  const currentTurnParticipantId = turnOrder[currentIndex]

  if (actor.id !== currentTurnParticipantId) {
    throw createError({
      statusCode: 403,
      message: 'It is not this participant\'s turn',
    })
  }

  // Check if already directed this turn
  if (actor.hasDirectedThisTurn) {
    throw createError({
      statusCode: 403,
      message: 'Cannot Direct twice in the same turn',
    })
  }

  // Validate action cost
  const actionCost = body.bolstered ? 2 : 1
  if ((actor.actionsRemaining?.simple || 0) < actionCost) {
    throw createError({
      statusCode: 403,
      message: 'Not enough actions remaining',
    })
  }

  // Find target digimon participant
  const targetParticipant = participants.find((p: any) => p.id === body.targetDigimonId)
  if (!targetParticipant || targetParticipant.type !== 'digimon') {
    throw createError({
      statusCode: 404,
      message: 'Target digimon not found',
    })
  }

  // Fetch tamer entity for Charisma
  const [tamerEntity] = await db.select().from(tamers).where(eq(tamers.id, actor.entityId))
  if (!tamerEntity) {
    throw createError({
      statusCode: 404,
      message: 'Tamer entity not found',
    })
  }

  const tamerAttrs = tamerEntity.attributes
  const charisma = tamerAttrs?.charisma ?? 0

  // Determine partner status
  const [targetDigimonEntity] = await db.select().from(digimon).where(eq(digimon.id, targetParticipant.entityId))
  const isPartner = targetDigimonEntity?.partnerId === actor.entityId

  // Calculate bonus
  let bonus = isPartner ? charisma : Math.max(0, charisma - 2)
  if (body.bolstered) {
    bonus += 2
  }

  // Get names for battle log
  const tamerName = tamerEntity.name || `Tamer ${actor.entityId}`
  const targetName = targetDigimonEntity?.name || `Digimon ${targetParticipant.entityId}`

  // Update participants
  const updatedParticipants = participants.map((p: any) => {
    if (p.id === body.participantId) {
      return {
        ...p,
        actionsRemaining: {
          simple: Math.max(0, (p.actionsRemaining?.simple || 0) - actionCost),
        },
        hasDirectedThisTurn: true,
      }
    }
    if (p.id === body.targetDigimonId) {
      return {
        ...p,
        activeEffects: [
          ...(p.activeEffects || []),
          {
            id: `effect-directed-${Date.now()}`,
            name: 'Directed',
            type: 'buff',
            duration: 99,
            source: tamerName,
            description: `+${bonus} to next Accuracy or Dodge`,
            value: bonus,
          },
        ],
      }
    }
    return p
  })

  // Battle log
  const actionLabel = body.bolstered ? 'Bolster Direct' : 'Direct'
  const logEntry = {
    id: `log-${Date.now()}`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: actor.id,
    actorName: tamerName,
    action: actionLabel,
    target: targetName,
    result: `${tamerName} directed ${targetName} (+${bonus} to next Accuracy or Dodge)${!isPartner ? ' (non-partner: -2 penalty)' : ''}${body.bolstered ? ' (bolstered)' : ''}`,
    damage: null,
    effects: [actionLabel],
  }

  const updatedBattleLog = [...battleLog, logEntry]

  // Update encounter
  await db.update(encounters).set({
    participants: updatedParticipants,
    battleLog: updatedBattleLog,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
})
