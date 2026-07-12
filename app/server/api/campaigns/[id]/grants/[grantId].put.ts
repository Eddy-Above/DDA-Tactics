import { and, eq } from 'drizzle-orm'
import { db, campaigns, campaignAccessGrants, tamers, users } from '../../../../db'
import { requireOwnerOrCoOwner } from '../../../../utils/campaignAuth'

interface UpdateGrantBody {
  dmRole?: 'co-dm' | 'co-owner' | null
  playerScope?: 'all' | 'specific' | null
  playerTamerId?: string | null
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

  const playerScope = body.playerScope !== undefined ? body.playerScope : existing.playerScope
  let playerTamerId = body.playerTamerId !== undefined ? body.playerTamerId : existing.playerTamerId
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

  const dmRole = body.dmRole !== undefined ? body.dmRole : existing.dmRole
  const now = new Date()

  await db
    .update(campaignAccessGrants)
    .set({ dmRole, playerScope, playerTamerId, updatedAt: now })
    .where(eq(campaignAccessGrants.id, grantId))

  const [updated] = await db.select().from(campaignAccessGrants).where(eq(campaignAccessGrants.id, grantId))
  const [grantee] = await db.select({ username: users.username }).from(users).where(eq(users.id, updated.userId))

  return { ...updated, username: grantee?.username ?? null }
})
