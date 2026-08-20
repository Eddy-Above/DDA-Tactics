import { eq } from 'drizzle-orm'
import { db, campaigns, tamerAccessGrants, users, tamers } from '../../../../db'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

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
    return { grants: [] }
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const grants = await db
    .select({
      id: tamerAccessGrants.id,
      tamerId: tamerAccessGrants.tamerId,
      tamerName: tamers.name,
      userId: tamerAccessGrants.userId,
      username: users.username,
    })
    .from(tamerAccessGrants)
    .innerJoin(users, eq(users.id, tamerAccessGrants.userId))
    .innerJoin(tamers, eq(tamers.id, tamerAccessGrants.tamerId))
    .where(eq(tamers.campaignId, campaignId))

  return { grants }
})
