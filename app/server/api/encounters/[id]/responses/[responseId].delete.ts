import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const responseId = getRouterParam(event, 'responseId')

  if (!encounterId || !responseId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID and Response ID are required',
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

  let currentResponses = encounter.requestResponses

  // Check if response exists
  const responseExists = currentResponses.some((r: any) => r.id === responseId)
  if (!responseExists) {
    throw createError({
      statusCode: 404,
      message: 'Response not found',
    })
  }

  // Remove response
  currentResponses = currentResponses.filter((r: any) => r.id !== responseId)

  // Update encounter
  await db.update(encounters).set({
    requestResponses: currentResponses,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
})
