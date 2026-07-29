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

  // Setup prompts (pick a digimon / roll initiative) are a single-slot conversation per
  // tamer: re-sending one REPLACES whatever is outstanding rather than stacking a second
  // modal on top. Without this, answering the digimon picker leaves behind the
  // auto-created initiative-roll request forever, so a re-sent picker was covered by the
  // stale initiative modal (and the GM's per-tamer button stuck on "Init pending…").
  // Also makes a double-click / second GM tab idempotent.
  // Scoped strictly to these two types — dodge, intercede, clash etc. are per-attack and
  // must never be cancelled by an unrelated request.
  let pendingRequestsAfterReplace = encounter.pendingRequests
  let requestResponsesAfterReplace = encounter.requestResponses
  if (body.type === 'digimon-selection' || body.type === 'initiative-roll') {
    const supersededIds = new Set(
      encounter.pendingRequests
        .filter((r: any) =>
          r.targetTamerId === body.targetTamerId &&
          (r.type === 'digimon-selection' || r.type === 'initiative-roll')
        )
        .map((r: any) => r.id)
    )
    if (supersededIds.size > 0) {
      pendingRequestsAfterReplace = encounter.pendingRequests.filter((r: any) => !supersededIds.has(r.id))
      // Drop any answer the GM hadn't processed yet — it belongs to a prompt that no
      // longer exists, and an orphaned response blocks Start Combat permanently.
      requestResponsesAfterReplace = encounter.requestResponses.filter((r: any) => !supersededIds.has(r.requestId))
    }
  }

  const currentRequests = [...pendingRequestsAfterReplace, newRequest]

  // Update encounter
  await db.update(encounters).set({
    pendingRequests: currentRequests,
    requestResponses: requestResponsesAfterReplace,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  return updated
})
