import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const originals = new Map(['createError', 'getRouterParam', 'readBody', 'defineEventHandler'].map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })

function fixture() {
  const campaign = { id: 'campaign', ownerId: 'owner', dmPasswordHash: 'private-password-hash' }
  let access = { userId: 'player', isOwner: false, isCoOwner: false, isCoDm: false }
  const cookies = {}, written = []
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const helpers = loadTypeScriptWithMocks('server/utils/campaignDm.ts', {
    '../db': { db: { select: () => ({ from: () => ({ where: async () => [campaign] }) }) }, campaigns: { id: 'id' } },
    './campaignAuth': { getMyCampaignAccess: async () => access },
    h3: { getCookie: (_event, name) => cookies[name], setCookie: (_event, name, value, options) => { cookies[name] = value; written.push({ name, value, options }) } },
  })
  return { ...helpers, campaign, cookies, written, setAccess: value => { access = { ...access, ...value } } }
}

test('GM reward access accepts owner, co-owner and co-DM accounts, while a player or boolean UI flag is rejected', async () => {
  const f = fixture()
  f.cookies['campaign-dm-campaign'] = 'true'
  await assert.rejects(f.requireCampaignDm({}, 'campaign'), error => error.statusCode === 403)
  for (const role of ['isOwner', 'isCoOwner', 'isCoDm']) {
    const roleFixture = fixture(); roleFixture.setAccess({ [role]: true })
    assert.equal((await roleFixture.requireCampaignDm({}, 'campaign')).userId, 'player')
  }
})

test('a verified GM-password credential is httpOnly, scoped, expiring and invalidated by password changes', async () => {
  const f = fixture()
  f.issueCampaignDmCookie({}, f.campaign)
  assert.equal(f.written[0].options.httpOnly, true)
  assert.equal(f.written[0].options.sameSite, 'lax')
  assert.equal(f.hasCampaignDmCookie({}, f.campaign), true)
  assert.equal((await f.requireCampaignDm({}, 'campaign')).campaign.id, 'campaign')
  assert.equal(f.hasCampaignDmCookie({}, { ...f.campaign, id: 'another' }), false)
  assert.equal(f.hasCampaignDmCookie({}, { ...f.campaign, dmPasswordHash: 'new-password-hash' }), false)
  for (const invalid of ['true', '1.' + '0'.repeat(64), `${Date.now() + 10000}.` + 'é'.repeat(64), f.written[0].value + '.extra']) {
    f.cookies['campaign-dm-verified-campaign'] = invalid
    assert.equal(f.hasCampaignDmCookie({}, f.campaign), false)
  }
})

test('ownerless campaigns without a GM password retain their existing open GM tools policy', async () => {
  const f = fixture()
  f.campaign.ownerId = null
  f.campaign.dmPasswordHash = null
  assert.equal((await f.requireCampaignDm({}, 'campaign')).campaign, f.campaign)
})

test('the existing GM password endpoint issues the server credential only after a correct password', async () => {
  let password = 'wrong'
  const issued = [], campaign = { id: 'campaign', dmPasswordHash: 'stored-hash' }
  Object.assign(globalThis, { defineEventHandler: handler => handler, getRouterParam: () => 'campaign', readBody: async () => ({ password }) })
  const handler = loadTypeScriptWithMocks('server/api/campaigns/[id]/verify-dm-password.post.ts', {
    '../../../db': { db: { select: () => ({ from: () => ({ where: async () => [campaign] }) }) }, campaigns: { id: 'id' } },
    '../../../utils/password': { verifyPassword: value => value === 'correct' },
    '../../../utils/campaignDm': { issueCampaignDmCookie: (_event, value) => issued.push(value) },
  }).default
  assert.deepEqual(await handler({}), { valid: false })
  assert.deepEqual(issued, [])
  password = 'correct'
  assert.deepEqual(await handler({}), { valid: true })
  assert.deepEqual(issued, [campaign])
})
