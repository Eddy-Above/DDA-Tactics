import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import {
  loadIntercedeDecisionContext,
  initialDecisionState,
  persistDecisionState,
  resolveIntercedeGroupIfDecided,
  pruneOptedOutOffers,
} from '~/server/utils/intercedeDecision'
import { updateTargetOptOuts, updateGmCharacterOptOuts } from '~/server/utils/intercedeOptOuts'
import { getOfferTargetIds, GM_OPT_OUT_OWNER } from '~/utils/intercedeOptOuts'
import { serializeIntercedeClaim } from '~/server/utils/intercedeClaims'

interface IntercedeSkipBody {
  requestId: string
  optOut?: boolean // If true, never be asked to intercede for these target(s) again this encounter
  optOutTargetIds?: string[] // Which of the offer's targets to opt out of (default: all of them)
  characterOptOuts?: string[] // GM-only: participant IDs to never intercede with for this target
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeSkipBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId) {
    throw createError({ statusCode: 400, message: 'requestId is required' })
  }

  return serializeIntercedeClaim(encounterId, () => skipIntercede(encounterId, body))
})

async function skipIntercede(encounterId: string, body: IntercedeSkipBody) {
  // Fetch encounter
  let [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Find the request
  const request = (encounter.pendingRequests as any[]).find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  // Per-character opt-outs (GM-only): save which interceptors should never intercede for this
  // target. A preference edit only — the offer stays open.
  if (body.characterOptOuts && request.targetTamerId === GM_OPT_OUT_OWNER) {
    await updateGmCharacterOptOuts(encounterId, request.data.targetId, body.characterOptOuts)
    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  if (body.optOut) {
    // Opt out of just the chosen target(s) — for an area attack, the one the recipient picked,
    // not everyone in the blast. Only the offer's own targets are accepted here.
    const offerTargetIds = getOfferTargetIds(request)
    const chosen = (body.optOutTargetIds || []).filter((id) => offerTargetIds.includes(id))
    const optOutTargetIds = chosen.length > 0 ? chosen : offerTargetIds
    const ownerId = request.targetTamerId as string

    const ownerOptOuts = await updateTargetOptOuts(encounterId, ownerId, (current) => [...current, ...optOutTargetIds])

    // Clear every prompt already queued for this owner about an opted-out target — including
    // the one clicked. An area offer with targets left stays open so they can pick another.
    ;[encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    const ctx = await loadIntercedeDecisionContext(encounter)
    const initial = initialDecisionState(encounter)
    const state = await pruneOptedOutOffers(ctx, initial, ownerId, ownerOptOuts)
    if (state !== initial) await persistDecisionState(encounter, state)
  } else {
    // Plain skip: drop this offer, then resolve the attack if that was the last open decision
    const ctx = await loadIntercedeDecisionContext(encounter)
    let state = initialDecisionState(encounter)
    state = { ...state, pendingRequests: state.pendingRequests.filter((r: any) => r.id !== body.requestId) }
    state = await resolveIntercedeGroupIfDecided(ctx, state, request)
    await persistDecisionState(encounter, state)
  }

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  return updated
}
