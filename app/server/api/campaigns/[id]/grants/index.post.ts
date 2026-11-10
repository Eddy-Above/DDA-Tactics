import { allowFields, boundedString } from '../../../../utils/securityValidation'
import { invalidateCampaignPeers } from '../../../../utils/websocketSecurity'
import { and, eq } from 'drizzle-orm'
import { db, campaigns, users, campaignAccessGrants, type NewCampaignAccessGrantRow } from '../../../../db'
import { generateId } from '../../../../utils/id'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

interface GrantBody {
  userId: string
  dmRole?: 'co-dm' | 'co-owner' | null
}

// Create-or-update (upsert on the campaignId+userId unique index) so the
// Settings UI can use the same call for "add account" and "edit grant".
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
  allowFields(body, ['userId', 'dmRole'])
  boundedString(body.userId, 'userId', 200, false)
  if (body.dmRole !== undefined && body.dmRole !== null && !['co-dm', 'co-owner'].includes(body.dmRole)) throw createError({ statusCode: 400, message: 'Invalid campaign role' })
  if (!body.userId) {
    throw createError({ statusCode: 400, message: 'userId is required' })
  }
  if (body.userId === campaign.ownerId) {
    throw createError({ statusCode: 400, message: 'The campaign owner already has full access' })
  }

  const [grantee] = await db.select().from(users).where(eq(users.id, body.userId))
  if (!grantee) {
    throw createError({ statusCode: 404, message: 'Account not found' })
  }

  const dmRole = body.dmRole ?? null
  const now = new Date()

  const values: NewCampaignAccessGrantRow = {
    id: generateId(),
    campaignId,
    userId: body.userId,
    dmRole,
    createdAt: now,
    updatedAt: now,
  }

  await db
    .insert(campaignAccessGrants)
    .values(values)
    .onConflictDoUpdate({
      target: [campaignAccessGrants.campaignId, campaignAccessGrants.userId],
      set: { dmRole, updatedAt: now },
    })

  const [saved] = await db
    .select()
    .from(campaignAccessGrants)
    .where(and(eq(campaignAccessGrants.campaignId, campaignId), eq(campaignAccessGrants.userId, body.userId)))

  invalidateCampaignPeers(campaignId)

  return { ...saved, username: grantee.username }
})
