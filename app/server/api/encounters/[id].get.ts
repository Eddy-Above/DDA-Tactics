import { eq } from 'drizzle-orm'
import { db, encounters } from '../../db'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id))

  if (!encounter) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  // Explicitly parse JSON fields in case they're stored as strings
  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try {
        return JSON.parse(field)
      }
      catch {
        return []
      }
    }
    return []
  }

  return {
    ...encounter,
    participants: parseJsonField(encounter.participants),
    turnOrder: parseJsonField(encounter.turnOrder),
    battleLog: parseJsonField(encounter.battleLog),
    hazards: parseJsonField(encounter.hazards),
    pendingRequests: parseJsonField(encounter.pendingRequests),
    requestResponses: parseJsonField(encounter.requestResponses),
  }
})
