import { eq } from 'drizzle-orm'
import { db, encounters, type Encounter } from '../../../db'

interface CreateRequestBody {
  type: 'digimon-selection' | 'initiative-roll' | 'dodge-roll' | 'intercede-offer' | 'health-roll' | 'recovery-check' | 'divine-protection-offer'
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

  // Create new request
  const newRequest = {
    id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    type: body.type,
    targetTamerId: body.targetTamerId,
    targetParticipantId: body.targetParticipantId,
    timestamp: new Date().toISOString(),
    data: body.data,
  }

  const currentRequests = [...encounter.pendingRequests, newRequest]

  // Update encounter
  await db.update(encounters).set({
    pendingRequests: currentRequests,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
})
