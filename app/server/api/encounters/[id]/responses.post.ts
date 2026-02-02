import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../db'

interface SubmitResponseBody {
  requestId: string
  tamerId: string
  response: {
    type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled'
    digimonId?: string
    initiative?: number
    initiativeRoll?: number
    dodgeDicePool?: number
    dodgeSuccesses?: number
    dodgeDiceResults?: number[]
  }
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<SubmitResponseBody>(event)

  if (!encounterId) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if (!body.requestId || !body.tamerId || !body.response) {
    throw createError({
      statusCode: 400,
      message: 'requestId, tamerId, and response are required',
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

  const pendingRequests = parseJsonField(encounter.pendingRequests)
  const currentResponses = parseJsonField(encounter.requestResponses)

  // Validate request exists and belongs to this tamer
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request) {
    throw createError({
      statusCode: 404,
      message: 'Request not found',
    })
  }

  if (request.targetTamerId !== body.tamerId) {
    throw createError({
      statusCode: 403,
      message: 'This request is not for you',
    })
  }

  // Validate response type matches request type
  if (body.response.type === 'digimon-selected') {
    if (request.type !== 'digimon-selection') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    // Allow null for tamer-only selection, or a string for digimon selection
    // No validation needed - both are valid
  } else if (body.response.type === 'initiative-rolled') {
    if (request.type !== 'initiative-roll') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    if (!Number.isInteger(body.response.initiative) || !Number.isInteger(body.response.initiativeRoll)) {
      throw createError({
        statusCode: 400,
        message: 'initiative and initiativeRoll are required for initiative-rolled response',
      })
    }
    // Validate realistic initiative roll (3d6 = 3-18)
    if (body.response.initiativeRoll < 3 || body.response.initiativeRoll > 18) {
      throw createError({
        statusCode: 400,
        message: 'Initiative roll must be between 3 and 18 (3d6)',
      })
    }
  } else if (body.response.type === 'dodge-rolled') {
    if (request.type !== 'dodge-roll') {
      throw createError({
        statusCode: 400,
        message: 'Response type does not match request type',
      })
    }
    if (body.response.dodgeDicePool === undefined || body.response.dodgeSuccesses === undefined || !body.response.dodgeDiceResults) {
      throw createError({
        statusCode: 400,
        message: 'dodgeDicePool, dodgeSuccesses, and dodgeDiceResults are required for dodge-rolled response',
      })
    }
  }

  // Create response
  const newResponse = {
    id: `resp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    requestId: body.requestId,
    tamerId: body.tamerId,
    participantId: body.response.type === 'dodge-rolled' ? request.targetParticipantId : undefined,
    response: {
      ...body.response,
      timestamp: new Date().toISOString(),
    },
  }

  currentResponses.push(newResponse)

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
