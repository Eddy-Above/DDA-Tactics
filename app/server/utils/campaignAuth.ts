import { and, eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { db, campaigns, campaignAccessGrants, tamerAccessGrants, tamers } from '../db'
import { getSessionUser } from './session'

export interface MyCampaignAccessResult {
  userId: string | null
  isOwner: boolean
  isCoOwner: boolean
  isCoDm: boolean
  accessibleTamerIds: string[]
}

const EMPTY_ACCESS: MyCampaignAccessResult = {
  userId: null,
  isOwner: false,
  isCoOwner: false,
  isCoDm: false,
  accessibleTamerIds: [],
}

// Single source of truth for "what can the current session do on this
// campaign" — consumed by all three middleware files (client-side, via the
// /my-access endpoint) and by the server-side write-path checks below.
export async function getMyCampaignAccess(event: H3Event, campaignId: string): Promise<MyCampaignAccessResult> {
  const user = await getSessionUser(event)
  if (!user) return EMPTY_ACCESS

  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) return { ...EMPTY_ACCESS, userId: user.id }

  const isOwner = campaign.ownerId === user.id

  const [grant] = await db
    .select()
    .from(campaignAccessGrants)
    .where(and(eq(campaignAccessGrants.campaignId, campaignId), eq(campaignAccessGrants.userId, user.id)))

  const isCoOwner = isOwner || grant?.dmRole === 'co-owner'
  const isCoDm = isCoOwner || grant?.dmRole === 'co-dm'

  // DM-tier accounts bypass per-tamer checks everywhere this list is
  // consulted, so there's no need to compute it for them.
  let accessibleTamerIds: string[] = []
  if (!isCoDm) {
    const rows = await db
      .select({ tamerId: tamerAccessGrants.tamerId })
      .from(tamerAccessGrants)
      .innerJoin(tamers, eq(tamers.id, tamerAccessGrants.tamerId))
      .where(and(eq(tamers.campaignId, campaignId), eq(tamerAccessGrants.userId, user.id)))
    accessibleTamerIds = rows.map((r) => r.tamerId)
  }

  return {
    userId: user.id,
    isOwner,
    isCoOwner,
    isCoDm,
    accessibleTamerIds,
  }
}

// Throws 403 unless the requester is the owner or a co-owner. Used by
// settings save/delete and grant-management endpoints — call sites should
// only invoke this when campaign.ownerId is set (ownerless campaigns keep
// their legacy DM-password-only enforcement and never call this).
export async function requireOwnerOrCoOwner(event: H3Event, campaignId: string): Promise<string> {
  const access = await getMyCampaignAccess(event, campaignId)
  if (!access.isOwner && !access.isCoOwner) {
    throw createError({ statusCode: 403, message: 'Only the campaign owner or a co-owner can do this' })
  }
  return access.userId as string
}
