import { eq } from 'drizzle-orm'
import { db, encounters, type Encounter } from '../../db'

type UpdateEncounterBody = Partial<Omit<Encounter, 'id' | 'createdAt' | 'updatedAt'>>

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateEncounterBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  // Check if encounter exists
  const [existing] = await db.select().from(encounters).where(eq(encounters.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  // Update encounter - explicitly serialize JSON fields
  const updateData: any = {
    ...body,
    updatedAt: new Date(),
  }

  // Drizzle's text mode:json isn't working properly, so manually serialize
  if (body.participants) {
    updateData.participants = JSON.stringify(body.participants)
  }
  if (body.turnOrder) {
    updateData.turnOrder = JSON.stringify(body.turnOrder)
  }
  if (body.battleLog) {
    updateData.battleLog = JSON.stringify(body.battleLog)
  }
  if (body.hazards) {
    updateData.hazards = JSON.stringify(body.hazards)
  }
  if (body.pendingRequests) {
    updateData.pendingRequests = JSON.stringify(body.pendingRequests)
  }
  if (body.requestResponses) {
    updateData.requestResponses = JSON.stringify(body.requestResponses)
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, id))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, id))

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
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    hazards: parseJsonField(updated.hazards),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
  }
})
