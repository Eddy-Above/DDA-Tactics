import { createHmac, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie, type H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, campaigns, type Campaign } from '../db'
import { getMyCampaignAccess } from './campaignAuth'

const cookieName = (id: string) => `campaign-dm-verified-${id}`
const signature = (id: string, expires: string, hash: string) => createHmac('sha256', hash).update(`${id}:${expires}`).digest('hex')

/** A server-issued credential for the existing GM-password workflow. Boolean UI cookies are not credentials. */
export function issueCampaignDmCookie(event: H3Event, campaign: Pick<Campaign, 'id' | 'dmPasswordHash'>) {
  if (!campaign.dmPasswordHash) return
  const expires = String(Date.now() + 30 * 24 * 60 * 60 * 1000)
  setCookie(event, cookieName(campaign.id), `${expires}.${signature(campaign.id, expires, campaign.dmPasswordHash)}`, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: 30 * 24 * 60 * 60,
  })
}

export function hasCampaignDmCookie(event: H3Event, campaign: Pick<Campaign, 'id' | 'dmPasswordHash'>): boolean {
  if (!campaign.dmPasswordHash) return false
  const [expires, given, ...extra] = (getCookie(event, cookieName(campaign.id)) ?? '').split('.')
  if (extra.length || !expires || !/^[a-f0-9]{64}$/.test(given ?? '') || !/^\d+$/.test(expires) || Number(expires) <= Date.now()) return false
  const expected = signature(campaign.id, expires, campaign.dmPasswordHash)
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

export async function requireCampaignDm(event: H3Event, campaignId: string) {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) throw createError({ statusCode: 404, message: 'Campaign not found' })
  const access = await getMyCampaignAccess(event, campaignId)
  if (access.isOwner || access.isCoOwner || access.isCoDm || hasCampaignDmCookie(event, campaign)
    || (!campaign.ownerId && !campaign.dmPasswordHash)) return { campaign, userId: access.userId }
  throw createError({ statusCode: 403, message: 'GM access is required. Sign in with a GM account or verify the campaign GM password.' })
}
