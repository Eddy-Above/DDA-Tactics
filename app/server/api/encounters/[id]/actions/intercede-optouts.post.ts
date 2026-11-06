import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import {
  loadIntercedeDecisionContext,
  initialDecisionState,
  persistDecisionState,
  pruneOptedOutOffers,
} from '~/server/utils/intercedeDecision'
import { updateTargetOptOuts } from '~/server/utils/intercedeOptOuts'
import { GM_OPT_OUT_OWNER } from '~/utils/intercedeOptOuts'
import { serializeIntercedeClaim } from '~/server/utils/intercedeClaims'

interface IntercedeOptOutsBody {
  ownerId?: string // tamer entity id, or 'GM'
  participantId?: string // legacy (pages loaded before ownerId existed): tamer participant id or 'gm'
  intercedeOptOuts: string[] // full replacement array of target participant IDs
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeOptOutsBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.ownerId && !body.participantId) {
    throw createError({ statusCode: 400, message: 'ownerId is required' })
  }

  if (!Array.isArray(body.intercedeOptOuts)) {
    throw createError({ statusCode: 400, message: 'intercedeOptOuts must be an array' })
  }

  return serializeIntercedeClaim(encounterId, () => saveIntercedeOptOuts(encounterId, body))
})

async function saveIntercedeOptOuts(encounterId: string, body: IntercedeOptOutsBody) {
  const [existing] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Owners are keyed like pendingRequests[].targetTamerId: the tamer's entity id, or 'GM'
  let ownerId = body.ownerId
  if (!ownerId) {
    ownerId = body.participantId === 'gm'
      ? GM_OPT_OUT_OWNER
      : (existing.participants as any[]).find((p: any) => p.id === body.participantId && p.type === 'tamer')?.entityId
  }
  if (!ownerId || (ownerId !== GM_OPT_OUT_OWNER &&
      !(existing.participants as any[]).some((p: any) => p.type === 'tamer' && p.entityId === ownerId))) {
    throw createError({ statusCode: 404, message: `Tamer '${body.ownerId ?? body.participantId}' is not in this encounter` })
  }

  const ownerOptOuts = await updateTargetOptOuts(encounterId, ownerId, () => body.intercedeOptOuts)

  // Clear prompts already queued for targets that were just opted out of, in this one request
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  const ctx = await loadIntercedeDecisionContext(encounter)
  const initial = initialDecisionState(encounter)
  const state = await pruneOptedOutOffers(ctx, initial, ownerId, ownerOptOuts)
  if (state !== initial) await persistDecisionState(encounter, state)

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return updated
}
