import { and, eq } from 'drizzle-orm'
import { db, campaigns, tamers, users, tamerAccessGrants, type NewTamerAccessGrantRow } from '../../../../db'
import { generateId } from '../../../../utils/id'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

interface GrantBody {
  tamerId: string
  userId: string
}

// Grants one account access to one tamer. Idempotent — re-adding an
// already-granted account is a harmless no-op (unique on tamerId+userId).
export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) {
    throw createError({ statusCode: 404, message: `Campaign with ID ${campaignId} not found` })
  }
  if (!campaign.ownerId) {
    throw createError({ statusCode: 400, message: 'This campaign has no owner account; account-based access grants are unavailable' })
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const body = await readBody<GrantBody>(event)
  if (!body.tamerId || !body.userId) {
    throw createError({ statusCode: 400, message: 'tamerId and userId are required' })
  }

  const [tamer] = await db.select().from(tamers).where(and(eq(tamers.id, body.tamerId), eq(tamers.campaignId, campaignId)))
  if (!tamer) {
    throw createError({ statusCode: 400, message: 'That tamer does not belong to this campaign' })
  }

  const [grantee] = await db.select().from(users).where(eq(users.id, body.userId))
  if (!grantee) {
    throw createError({ statusCode: 404, message: 'Account not found' })
  }

  const now = new Date()
  const values: NewTamerAccessGrantRow = {
    id: generateId(),
    tamerId: body.tamerId,
    userId: body.userId,
    createdAt: now,
    updatedAt: now,
  }

  await db
    .insert(tamerAccessGrants)
    .values(values)
    .onConflictDoNothing({ target: [tamerAccessGrants.tamerId, tamerAccessGrants.userId] })

  const [saved] = await db
    .select()
    .from(tamerAccessGrants)
    .where(and(eq(tamerAccessGrants.tamerId, body.tamerId), eq(tamerAccessGrants.userId, body.userId)))

  return { ...saved, username: grantee.username, tamerName: tamer.name }
})
