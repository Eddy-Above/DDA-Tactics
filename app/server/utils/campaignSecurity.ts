import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { getCookie, setCookie, type H3Event } from 'h3'
import { eq } from 'drizzle-orm'
import { db, campaigns, encounters, tamers, digimon, maps, type Campaign } from '../db'
import { getMyCampaignAccess } from './campaignAuth'
import { enforcePrincipalWriteLimit } from './securityTransport'
import { createEntityScopeResolver } from './entityScopeGraph'

const TTL = 30 * 24 * 60 * 60 * 1000
type CredentialCampaign = Pick<Campaign, 'id' | 'passwordHash' | 'dmPasswordHash'>
type HeaderInput = Headers | Record<string, string | string[] | undefined>
const cookieName = (id: string, dm: boolean) => `campaign-${dm ? 'dm' : 'member'}-verified-${id}`
const signature = (id: string, expires: string, hash: string, dm: boolean) => createHmac('sha256', hash).update(`${dm ? 'dm' : 'member'}:${id}:${expires}`).digest('hex')

function credential(event: H3Event, campaign: CredentialCampaign, dm: boolean): { value: string; expiresAt: number } | null {
  const hash = dm ? campaign.dmPasswordHash : campaign.passwordHash
  if (!hash) return null
  const value = getCookie(event, cookieName(campaign.id, dm)) ?? ''
  const [expires, given, ...extra] = value.split('.')
  if (extra.length || !/^\d+$/.test(expires ?? '') || !/^[a-f0-9]{64}$/.test(given ?? '') || Number(expires) <= Date.now()) return null
  if (!timingSafeEqual(Buffer.from(given), Buffer.from(signature(campaign.id, expires, hash, dm)))) return null
  return { value, expiresAt: Number(expires) }
}

function issueCredential(event: H3Event, campaign: CredentialCampaign, dm: boolean) {
  const hash = dm ? campaign.dmPasswordHash : campaign.passwordHash
  if (!hash) return
  const expires = String(Date.now() + TTL)
  setCookie(event, cookieName(campaign.id, dm), `${expires}.${signature(campaign.id, expires, hash, dm)}`, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: TTL / 1000,
  })
}
export function issueCampaignMemberCookie(event: H3Event, campaign: CredentialCampaign) { issueCredential(event, campaign, false) }
export function issueCampaignDmCookie(event: H3Event, campaign: Pick<Campaign, 'id' | 'dmPasswordHash'>) { issueCredential(event, { ...campaign, passwordHash: null }, true) }
export function hasCampaignDmCookie(event: H3Event, campaign: Pick<Campaign, 'id' | 'dmPasswordHash'>) { return !!credential(event, { ...campaign, passwordHash: null }, true) }

export interface CampaignAccess {
  campaign: Campaign
  userId: string | null
  isMember: boolean
  isDm: boolean
  isManager: boolean
  isGuest: boolean
  accessibleTamerIds: string[]
  principalId: string
  expiresAt?: number
}
export async function resolveCampaignAccess(event: H3Event, campaignId: string): Promise<CampaignAccess> {
  const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!campaign) throw createError({ statusCode: 404, message: 'Campaign not found' })
  const account = await getMyCampaignAccess(event, campaignId)
  const dm = credential(event, campaign, true), member = credential(event, campaign, false)
  const fullyPublic = !campaign.ownerId && !campaign.passwordHash && !campaign.dmPasswordHash
  const isDm = account.isOwner || account.isCoOwner || account.isCoDm || !!dm || fullyPublic
  const signed = dm ?? member
  const accountMember = account.isOwner || account.isCoOwner || account.isCoDm || (account.accessibleTamerIds?.length ?? 0) > 0
  // Independent credentials coexist: expire private reading when the final valid
  // member credential expires, rather than an unrelated signed-in account.
  const memberExpiries = [dm?.expiresAt, member?.expiresAt, accountMember ? account.sessionExpiresAt : undefined]
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
  const expiresAt = campaign.passwordHash && memberExpiries.length ? Math.max(...memberExpiries) : undefined
  return {
    campaign, userId: account.userId,
    isMember: isDm || !campaign.passwordHash || !!member || (account.accessibleTamerIds?.length ?? 0) > 0,
    isDm, isManager: campaign.ownerId ? account.isOwner || account.isCoOwner : isDm,
    isGuest: !!signed || !account.userId && !campaign.passwordHash,
    accessibleTamerIds: account.accessibleTamerIds ?? [],
    principalId: account.userId ? `user:${account.userId}` : signed ? `guest:${createHash('sha256').update(signed.value).digest('hex')}` : `public:${campaign.id}`,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }
}
export function securityEventFromHeaders(headers: HeaderInput): H3Event {
  const values = headers instanceof Headers ? Object.fromEntries(headers.entries()) : headers
  return { node: { req: { headers: values } }, context: {} } as unknown as H3Event
}
export function resolveCampaignAccessFromHeaders(headers: HeaderInput, id: string) { return resolveCampaignAccess(securityEventFromHeaders(headers), id) }
function denied(access: CampaignAccess, message: string): never { throw createError({ statusCode: access.userId || access.isMember ? 403 : 401, message }) }
export async function requireCampaignMember(event: H3Event, id: string): Promise<CampaignAccess> {
  const access = await resolveCampaignAccess(event, id)
  if (!access.isMember) denied(access, 'Campaign access is required')
  if (event.node?.req?.method) enforcePrincipalWriteLimit(event, access.principalId)
  return access
}
export async function requireCampaignDm(event: H3Event, id: string): Promise<CampaignAccess> {
  const access = await resolveCampaignAccess(event, id)
  if (!access.isDm) denied(access, 'GM access is required')
  if (event.node?.req?.method) enforcePrincipalWriteLimit(event, access.principalId)
  return access
}
export async function requireCampaignManager(event: H3Event, id: string): Promise<CampaignAccess> {
  const access = await resolveCampaignAccess(event, id)
  if (!access.isManager) denied(access, 'Campaign owner or co-owner access is required')
  if (event.node?.req?.method) enforcePrincipalWriteLimit(event, access.principalId)
  return access
}
export async function requireEncounterAccess(event: H3Event, id: string, level: 'member' | 'dm' | 'manager' = 'member') {
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id))
  if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })
  if (!encounter.campaignId) {
    if (level !== 'member') throw createError({ statusCode: 403, message: 'Legacy standalone encounters are read-only' })
    return { encounter, access: null }
  }
  const access = await (level === 'dm' ? requireCampaignDm : level === 'manager' ? requireCampaignManager : requireCampaignMember)(event, encounter.campaignId)
  if (level === 'member' && !access.isDm && !encounter.visibleToPlayers) throw createError({ statusCode: 404, message: 'Encounter not found' })
  if (encounter.mapId) {
    const [map] = await db.select().from(maps).where(eq(maps.id, encounter.mapId))
    if (map && map.campaignId !== encounter.campaignId) throw createError({ statusCode: 403, message: 'Encounter map belongs to a different campaign' })
  }
  return { encounter, access }
}
export async function assertCanControlTamer(_event: H3Event, id: string, access: CampaignAccess): Promise<any> {
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, id))
  if (!tamer || tamer.campaignId !== access.campaign.id) throw createError({ statusCode: 400, message: 'Tamer does not belong to this campaign' })
  if (!access.isMember) denied(access, 'Campaign access is required')
  return tamer
}
export async function requireEncounterActor(event: H3Event, encounter: any, id: string, suppliedAccess?: CampaignAccess | null): Promise<any> {
  if (!encounter.campaignId) throw createError({ statusCode: 403, message: 'Legacy standalone encounters are read-only' })
  const access = suppliedAccess ?? await requireCampaignMember(event, encounter.campaignId)
  const participant = (encounter.participants ?? []).find((p: any) => p.id === id)
  if (!participant) throw createError({ statusCode: 404, message: 'Participant not found' })
  if (participant.isEnemy && !access.isDm) denied(access, 'GM access is required for this participant')
  if (participant.type === 'tamer') { await assertCanControlTamer(event, participant.entityId, access); return participant }
  if (participant.type === 'digimon') {
    const [record] = await db.select().from(digimon).where(eq(digimon.id, participant.entityId))
    let scope = record?.campaignId
    if (record && !scope && record.partnerId) {
      const [partner] = await db.select().from(tamers).where(eq(tamers.id, record.partnerId))
      scope = partner?.campaignId
    }
    if (record && !scope && !record.partnerId) scope = await createEntityScopeResolver([record], 'digimon')('digimon', record)
    if (!record || scope !== encounter.campaignId) throw createError({ statusCode: 400, message: 'Digimon does not belong to this campaign' })
    if (access.isDm) return participant
    if (!participant.isEnemy && !record.isEnemy && record.partnerId) { await assertCanControlTamer(event, record.partnerId, access); return participant }
  }
  if (!access.isDm) denied(access, 'GM access is required for this participant')
  return participant
}
