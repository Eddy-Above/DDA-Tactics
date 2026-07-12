import type { H3Event } from 'h3'
import { getSessionUser } from './session'

// Ownership enforcement applies only to Workshop/sandbox records
// (campaignId === null) — campaign-scoped tamers/digimon keep their
// existing campaign-access/dm-access-governed permissions, unchanged.
export async function assertCanModifySandboxCharacter(
  event: H3Event,
  record: { campaignId: string | null; ownerId: string | null },
): Promise<void> {
  if (record.campaignId !== null) return // out of scope: campaign-scoped permissions unchanged
  if (!record.ownerId) return // unowned/legacy sandbox character: open to anyone, as today

  const user = await getSessionUser(event)
  if (user?.id !== record.ownerId) {
    throw createError({ statusCode: 403, message: 'You do not own this character' })
  }
}
