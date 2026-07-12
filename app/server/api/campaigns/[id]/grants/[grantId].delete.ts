import { and, eq } from 'drizzle-orm'
import { db, campaignAccessGrants } from '../../../../db'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  const grantId = getRouterParam(event, 'grantId')
  if (!campaignId || !grantId) {
    throw createError({ statusCode: 400, message: 'Campaign ID and grant ID are required' })
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const [existing] = await db
    .select()
    .from(campaignAccessGrants)
    .where(and(eq(campaignAccessGrants.id, grantId), eq(campaignAccessGrants.campaignId, campaignId)))
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Grant not found' })
  }

  await db.delete(campaignAccessGrants).where(eq(campaignAccessGrants.id, grantId))

  return { success: true, id: grantId }
})
