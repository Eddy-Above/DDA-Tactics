import { db, encounters } from '../../db'

export default defineEventHandler(async () => {
  const allEncounters = await db.select().from(encounters)

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

  return allEncounters.map((encounter) => ({
    ...encounter,
    participants: parseJsonField(encounter.participants),
    turnOrder: parseJsonField(encounter.turnOrder),
    battleLog: parseJsonField(encounter.battleLog),
    hazards: parseJsonField(encounter.hazards),
    pendingRequests: parseJsonField(encounter.pendingRequests),
    requestResponses: parseJsonField(encounter.requestResponses),
  }))
})
