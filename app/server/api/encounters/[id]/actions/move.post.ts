import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'

interface MoveBody {
  participantId: string
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<MoveBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body.participantId) {
    throw createError({ statusCode: 400, message: 'participantId is required' })
  }

  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') { try { return JSON.parse(field) } catch { return [] } }
    return []
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: `Encounter ${encounterId} not found` })
  }

  const participants = parseJsonField(encounter.participants)
  const mover = participants.find((p: any) => p.id === body.participantId)
  if (!mover) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  const updatedParticipants = participants.map((p: any) => {
    if (p.id !== body.participantId) return p
    return {
      ...p,
      actionsRemaining: {
        ...p.actionsRemaining,
        simple: Math.max(0, (p.actionsRemaining?.simple ?? 0) - 1),
      },
    }
  })

  await db.update(encounters).set({
    participants: JSON.stringify(updatedParticipants),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  return { success: true }
})
