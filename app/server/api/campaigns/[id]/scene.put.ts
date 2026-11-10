import { requireCampaignDm } from '../../../utils/campaignSecurity'
import { eq } from 'drizzle-orm'
import { db, campaigns } from '../../../db'
import { broadcast } from '../../../utils/encounterRoom'
import { campaignRoomKey } from '../../../utils/rollLog'
import { safeUrl, boundedString, allowFields } from '../../../utils/securityValidation'

interface UpdateSceneBody {
  imageUrl: string | null
  caption?: string | null
}

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  const body = await readBody<UpdateSceneBody>(event)
  allowFields(body, ['imageUrl', 'caption'])
  const imageUrl = body?.imageUrl ? String(body.imageUrl).trim() || null : null
  const caption = imageUrl && body?.caption ? String(body.caption).trim() || null : null
  if (caption !== null) boundedString(caption, 'caption', 300)

  const campaignAccess = await requireCampaignDm(event, campaignId)

  const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Campaign not found' })
  }
  if (imageUrl !== existing.sceneImageUrl) safeUrl(imageUrl)

  await db.update(campaigns)
    .set({ sceneImageUrl: imageUrl, sceneImageCaption: caption, updatedAt: new Date() })
    .where(eq(campaigns.id, campaignId))

  broadcast(campaignRoomKey(campaignId), {
    type: 'scene-updated',
    campaignId,
    sceneImageUrl: imageUrl,
    sceneImageCaption: caption,
  })

  return { sceneImageUrl: imageUrl, sceneImageCaption: caption }
})
