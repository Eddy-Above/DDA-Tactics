import { allowFields, boundedString } from '../../../../utils/securityValidation'
import { invalidateCampaignPeers } from '../../../../utils/websocketSecurity'
import { and, eq } from 'drizzle-orm'
import { db, campaigns, campaignAccessGrants, users } from '../../../../db'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

interface UpdateGrantBody {
  dmRole?: 'co-dm' | 'co-owner' | null
}

export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  const grantId = getRouterParam(event, 'grantId')
  if (!campaignId || !grantId) {
    throw createError({ statusCode: 400, message: 'Campaign ID and grant ID are required' })
  }

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) {
    throw createError({ statusCode: 404, message: `Campaign with ID ${campaignId} not found` })
  }

  await requireOwnerOrCoOwner(event, campaignId)

  const [existing] = await db
    .select()
    .from(campaignAccessGrants)
    .where(and(eq(campaignAccessGrants.id, grantId), eq(campaignAccessGrants.campaignId, campaignId)))
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Grant not found' })
  }

  const body = await readBody<UpdateGrantBody>(event)
  allowFields(body, ['dmRole'])
  if (body.dmRole !== undefined && body.dmRole !== null && !['co-dm', 'co-owner'].includes(body.dmRole)) throw createError({ statusCode: 400, message: 'Invalid campaign role' })

  const dmRole = body.dmRole !== undefined ? body.dmRole : existing.dmRole
  const now = new Date()

  await db
    .update(campaignAccessGrants)
    .set({ dmRole, updatedAt: now })
    .where(eq(campaignAccessGrants.id, grantId))

  const [updated] = await db.select().from(campaignAccessGrants).where(eq(campaignAccessGrants.id, grantId))
  const [grantee] = await db.select({ username: users.username }).from(users).where(eq(users.id, updated.userId))

  invalidateCampaignPeers(campaignId)

  return { ...updated, username: grantee?.username ?? null }
})
