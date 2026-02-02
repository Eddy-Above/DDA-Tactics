import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const requestId = getRouterParam(event, 'requestId')

  if (!encounterId || !requestId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID and Request ID are required',
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

  // Parse existing requests and responses
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

  let pendingRequests = parseJsonField(encounter.pendingRequests)
  let currentResponses = parseJsonField(encounter.requestResponses)

  // Check if request exists
  const requestExists = pendingRequests.some((r: any) => r.id === requestId)
  if (!requestExists) {
    throw createError({
      statusCode: 404,
      message: 'Request not found',
    })
  }

  // Remove request and any associated responses
  pendingRequests = pendingRequests.filter((r: any) => r.id !== requestId)
  currentResponses = currentResponses.filter((r: any) => r.requestId !== requestId)

  // Update encounter
  const updateData: any = {
    pendingRequests: JSON.stringify(pendingRequests),
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
