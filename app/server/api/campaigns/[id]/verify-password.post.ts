import { and, eq } from 'drizzle-orm'
import { db, campaigns } from '../../../db'
import { verifyPassword, hashPassword, needsPasswordRehash } from '../../../utils/password'
import { issueCampaignMemberCookie } from '../../../utils/campaignSecurity'
import { enforcePasswordAttemptLimit, recordPasswordFailure } from '../../../utils/securityTransport'
import { invalidateCampaignPeers } from '../../../utils/websocketSecurity'

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ password: string }>(event)
  if (!id) throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  if (!body?.password || typeof body.password !== 'string' || body.password.length > 500) throw createError({ statusCode: 400, message: 'Password is required' })
  enforcePasswordAttemptLimit(event, id)
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, id))
  if (!campaign) throw createError({ statusCode: 404, message: 'Campaign not found' })
  if (!campaign.passwordHash) return { valid: true }
  const valid = await verifyPassword(body.password, campaign.passwordHash)
  if (!valid) { recordPasswordFailure(event, id); return { valid: false } }
  if (needsPasswordRehash(campaign.passwordHash)) {
    const upgraded = await hashPassword(body.password)
    const [updated] = await db.update(campaigns).set({ passwordHash: upgraded }).where(and(eq(campaigns.id, id), eq(campaigns.passwordHash, campaign.passwordHash))).returning()
    if (updated) { Object.assign(campaign, updated); invalidateCampaignPeers(id) }
    else {
      const [current] = await db.select().from(campaigns).where(eq(campaigns.id, id))
      if (!current?.passwordHash || !await verifyPassword(body.password, current.passwordHash)) return { valid: false }
      Object.assign(campaign, current)
    }
  }
  issueCampaignMemberCookie(event, campaign)
  return { valid: true }
})
