import { eq } from 'drizzle-orm'
import { db, campaigns } from '../../../db'

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) {
    throw createError({ statusCode: 404, message: 'Campaign not found' })
  }

  return {
    sceneImageUrl: campaign.sceneImageUrl ?? null,
    sceneImageCaption: campaign.sceneImageCaption ?? null,
  }
})
