import { eq } from 'drizzle-orm'
import { db, encounters, type Encounter } from '../../../db'

interface CreateRequestBody {
  type: 'digimon-selection' | 'initiative-roll' | 'dodge-roll'
  targetTamerId: string
  targetParticipantId?: string
  data?: any
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<CreateRequestBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.type || !body.targetTamerId) {
    throw createError({
      statusCode: 400,
      message: 'type and targetTamerId are required',
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

  // Parse existing requests
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

  // Create new request
  const newRequest = {
    id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: body.type,
    targetTamerId: body.targetTamerId,
    targetParticipantId: body.targetParticipantId,
    timestamp: new Date().toISOString(),
    data: body.data,
  }

  const currentRequests = parseJsonField(encounter.pendingRequests)
  currentRequests.push(newRequest)

  // Update encounter
  const updateData: any = {
    pendingRequests: JSON.stringify(currentRequests),
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
