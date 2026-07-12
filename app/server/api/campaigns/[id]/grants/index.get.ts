import { eq, inArray } from 'drizzle-orm'
import { db, campaigns, campaignAccessGrants, users, tamers } from '../../../../db'
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
    return { grants: [], ownerUsername: null }
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const [owner] = await db.select({ username: users.username }).from(users).where(eq(users.id, campaign.ownerId))

  const rows = await db
    .select({
      id: campaignAccessGrants.id,
      campaignId: campaignAccessGrants.campaignId,
      userId: campaignAccessGrants.userId,
      username: users.username,
      dmRole: campaignAccessGrants.dmRole,
      playerScope: campaignAccessGrants.playerScope,
      playerTamerId: campaignAccessGrants.playerTamerId,
    })
    .from(campaignAccessGrants)
    .innerJoin(users, eq(users.id, campaignAccessGrants.userId))
    .where(eq(campaignAccessGrants.campaignId, campaignId))

  const tamerIds = rows.map((r) => r.playerTamerId).filter((x): x is string => !!x)
  const tamerNameById = new Map<string, string>()
  if (tamerIds.length > 0) {
    const tamerRows = await db.select({ id: tamers.id, name: tamers.name }).from(tamers).where(inArray(tamers.id, tamerIds))
    for (const t of tamerRows) tamerNameById.set(t.id, t.name)
  }

  const grants = rows.map((r) => ({
    ...r,
    playerTamerName: r.playerTamerId ? tamerNameById.get(r.playerTamerId) ?? null : null,
  }))

  return { grants, ownerUsername: owner?.username ?? null }
})
