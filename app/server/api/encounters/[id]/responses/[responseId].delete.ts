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

  // Parse existing responses
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

  let currentResponses = parseJsonField(encounter.requestResponses)

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
  const updateData: any = {
    requestResponses: JSON.stringify(currentResponses),
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
