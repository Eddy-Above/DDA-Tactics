import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'

interface IntercedeOptOutsBody {
  participantId: string // tamer participant id, or the literal 'gm'
  intercedeOptOuts: string[] // full replacement array of target participant IDs
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeOptOutsBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId) {
    throw createError({ statusCode: 400, message: 'participantId is required' })
  }

  if (!Array.isArray(body.intercedeOptOuts)) {
    throw createError({ statusCode: 400, message: 'intercedeOptOuts must be an array' })
  }

  // Fetch encounter fresh
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  let participants = encounter.participants
  const idx = participants.findIndex((p: any) => p.id === body.participantId)

  if (idx !== -1) {
    participants[idx] = { ...participants[idx], intercedeOptOuts: body.intercedeOptOuts }
  } else if (body.participantId === 'gm') {
    participants = [...participants, { id: 'gm', type: 'gm', intercedeOptOuts: body.intercedeOptOuts } as any]
  } else {
    throw createError({ statusCode: 404, message: `Participant with id '${body.participantId}' not found` })
  }

  await db.update(encounters).set({
    participants,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
})
