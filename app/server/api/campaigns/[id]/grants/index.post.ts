import { and, eq } from 'drizzle-orm'
import { db, campaigns, tamers, users, campaignAccessGrants, type NewCampaignAccessGrantRow } from '../../../../db'
import { generateId } from '../../../../utils/id'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

interface GrantBody {
  userId: string
  dmRole?: 'co-dm' | 'co-owner' | null
  playerScope?: 'all' | 'specific' | null
  playerTamerId?: string | null
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

  const playerScope = body.playerScope ?? null
  let playerTamerId = body.playerTamerId ?? null
  if (playerScope === 'specific') {
    if (!playerTamerId) {
      throw createError({ statusCode: 400, message: 'playerTamerId is required when playerScope is "specific"' })
    }
    const [tamer] = await db.select().from(tamers).where(and(eq(tamers.id, playerTamerId), eq(tamers.campaignId, campaignId)))
    if (!tamer) {
      throw createError({ statusCode: 400, message: 'That tamer does not belong to this campaign' })
    }
  } else {
    playerTamerId = null
  }

  const dmRole = body.dmRole ?? null
  const now = new Date()

  const values: NewCampaignAccessGrantRow = {
    id: generateId(),
    campaignId,
    userId: body.userId,
    dmRole,
    playerScope,
    playerTamerId,
    createdAt: now,
    updatedAt: now,
  }

  await db
    .insert(campaignAccessGrants)
    .values(values)
    .onConflictDoUpdate({
      target: [campaignAccessGrants.campaignId, campaignAccessGrants.userId],
      set: { dmRole, playerScope, playerTamerId, updatedAt: now },
    })

  const [saved] = await db
    .select()
    .from(campaignAccessGrants)
    .where(and(eq(campaignAccessGrants.campaignId, campaignId), eq(campaignAccessGrants.userId, body.userId)))

  return { ...saved, username: grantee.username }
})
