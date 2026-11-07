import { eq } from 'drizzle-orm'
import { db, encounters } from '../db'
import { getPassingOwnerIds, offerHasQuickReaction } from '~/utils/intercedeOptOuts'
import {
  loadIntercedeDecisionContext,
  initialDecisionState,
  persistDecisionState,
  resolvePassedOffers,
} from './intercedeDecision'

/** Players who are passing and have an intercede prompt waiting that a pass answers. */
export function passableOfferOwners(encounter: any): string[] {
  const passing = getPassingOwnerIds(encounter)
  if (passing.length === 0) return []
  const waiting = new Set<string>()
  for (const r of ((encounter?.pendingRequests as any[]) || [])) {
    if (r.type === 'intercede-offer' && passing.includes(r.targetTamerId) && !offerHasQuickReaction(r)) waiting.add(r.targetTamerId)
  }
  return [...waiting]
}

/**
 * Answers the intercede prompts of every player whose "Pass until my next turn" is in force, the
 * way a Skip does (see `resolvePassedOffers`). Called after a pass is set and after new offers are
 * created, so passed prompts never reach the player. Run it inside `serializeIntercedeClaim`: it
 * reads the encounter fresh and writes back through the same path as Skip. Returns whether any
 * offer was answered.
 */
export async function applyActivePasses(encounterId: string): Promise<boolean> {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) return false

  const passing = passableOfferOwners(encounter)
  if (passing.length === 0) return false

  const ctx = await loadIntercedeDecisionContext(encounter)
  const initial = initialDecisionState(encounter)
  const state = await resolvePassedOffers(ctx, initial, passing)
  if (state === initial) return false
  await persistDecisionState(encounter, state)
  return true
}
