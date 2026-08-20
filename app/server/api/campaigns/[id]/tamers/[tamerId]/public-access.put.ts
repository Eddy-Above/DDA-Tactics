import { and, eq } from 'drizzle-orm'
import { db, campaigns, tamers } from '../../../../../db'
import { requireOwnerOrCoOwner } from '../../../../../utils/campaignAuth'

interface UpdateBody {
  publicAccess: boolean
}

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  const tamerId = getRouterParam(event, 'tamerId')
  if (!campaignId || !tamerId) {
    throw createError({ statusCode: 400, message: 'Campaign ID and tamer ID are required' })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) {
    throw createError({ statusCode: 404, message: `Campaign with ID ${campaignId} not found` })
  }
  if (!campaign.ownerId) {
    throw createError({ statusCode: 400, message: 'This campaign has no owner account; access control is unavailable' })
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const [tamer] = await db.select().from(tamers).where(and(eq(tamers.id, tamerId), eq(tamers.campaignId, campaignId)))
  if (!tamer) {
    throw createError({ statusCode: 404, message: 'Tamer not found in this campaign' })
  }

  const body = await readBody<UpdateBody>(event)
  if (typeof body.publicAccess !== 'boolean') {
    throw createError({ statusCode: 400, message: 'publicAccess (boolean) is required' })
  }

  await db
    .update(tamers)
    .set({ publicAccess: body.publicAccess, updatedAt: new Date() })
    .where(eq(tamers.id, tamerId))

  const [updated] = await db.select().from(tamers).where(eq(tamers.id, tamerId))
  return updated
})
