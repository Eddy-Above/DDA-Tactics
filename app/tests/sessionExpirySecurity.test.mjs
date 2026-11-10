import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const original = new Map(['getCookie', 'createError'].map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of original) value === undefined ? delete globalThis[name] : globalThis[name] = value })

test('account session expiry travels through campaign access to the private WebSocket deadline', async () => {
  globalThis.getCookie = () => 'session'
  globalThis.createError = options => Object.assign(new Error(options.message), options)
  const expiresAt = Date.now() + 1000
  const session = loadTypeScriptWithMocks('server/utils/session.ts', {
    '../db': { db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: async () => [{ userId: 'owner', username: 'Owner', expiresAt: new Date(expiresAt) }] }) }) }) }, sessions: {}, users: {} },
    'drizzle-orm': { eq: () => null },
  })
  assert.equal((await session.getSessionUser({})).expiresAt, expiresAt)
  const campaign = { id: 'campaign', ownerId: 'owner', passwordHash: 'protected', dmPasswordHash: null }
  const tables = { campaigns: { name: 'campaigns' }, campaignAccessGrants: { name: 'grants' }, tamerAccessGrants: {}, tamers: {} }
  const campaignAuth = loadTypeScriptWithMocks('server/utils/campaignAuth.ts', {
    './session': session,
    '../db': { ...tables, db: { select: () => ({ from: table => ({ where: async () => table.name === 'campaigns' ? [campaign] : [] }) }) } },
    'drizzle-orm': { eq: () => null, and: () => null },
  })
  const account = await campaignAuth.getMyCampaignAccess({}, campaign.id)
  assert.equal(account.sessionExpiresAt, expiresAt)
  assert.equal(account.isOwner, true)
  const cookies = {}
  const security = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', {
    './campaignAuth': campaignAuth,
    '../db': { campaigns: {}, encounters: {}, tamers: {}, digimon: {}, db: { select: () => ({ from: () => ({ where: async () => [campaign] }) }) } },
    'drizzle-orm': { eq: () => null },
    h3: { getCookie: (_event, name) => cookies[name], setCookie: (_event, name, value) => { cookies[name] = value } },
  })
  assert.equal((await security.resolveCampaignAccess({}, campaign.id)).expiresAt, expiresAt)
  security.issueCampaignMemberCookie({}, campaign)
  assert.ok((await security.resolveCampaignAccess({}, campaign.id)).expiresAt > expiresAt,
    'an independently valid member credential can continue guest reading after an unrelated account expires')
})
