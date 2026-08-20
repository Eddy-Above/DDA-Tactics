import { and, eq } from 'drizzle-orm'
import { db, tamerAccessGrants, tamers } from '../../../../db'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  const grantId = getRouterParam(event, 'grantId')
  if (!campaignId || !grantId) {
    throw createError({ statusCode: 400, message: 'Campaign ID and grant ID are required' })
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const [existing] = await db.select().from(tamerAccessGrants).where(eq(tamerAccessGrants.id, grantId))
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Grant not found' })
  }

  const [tamer] = await db.select().from(tamers).where(and(eq(tamers.id, existing.tamerId), eq(tamers.campaignId, campaignId)))
  if (!tamer) {
    throw createError({ statusCode: 404, message: 'Grant not found' })
  }

  await db.delete(tamerAccessGrants).where(eq(tamerAccessGrants.id, grantId))

  return { success: true, id: grantId }
})
