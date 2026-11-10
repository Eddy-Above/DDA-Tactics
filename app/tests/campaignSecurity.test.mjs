import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const original = globalThis.createError
afterEach(() => { if (original === undefined) delete globalThis.createError; else globalThis.createError = original })
function fixture(overrides = {}) {
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const campaign = { id: 'campaign', ownerId: 'owner', passwordHash: 'player-hash', dmPasswordHash: 'gm-hash', ...overrides }
  let account = { userId: null, isOwner: false, isCoOwner: false, isCoDm: false, accessibleTamerIds: [] }
  const cookies = {}, written = [], tables = { campaigns: { name: 'campaigns', id: 'id' }, encounters: { name: 'encounters', id: 'id' }, tamers: { name: 'tamers', id: 'id' }, digimon: { name: 'digimon', id: 'id' } }
  const rows = { campaigns: [campaign], encounters: [{ id: 'enc', campaignId: campaign.id, visibleToPlayers: true, participants: [{ id: 'player', type: 'tamer', entityId: 'tamer' }, { id: 'npc', type: 'digimon', entityId: 'npc' }] }], tamers: [{ id: 'tamer', campaignId: campaign.id, publicAccess: false }], digimon: [{ id: 'npc', campaignId: campaign.id, isEnemy: true }] }
  const helpers = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', {
    '../db': { ...tables, db: { select: () => ({ from: table => ({ where: async id => rows[table.name].filter(row => row.id === id) }) }) } },
    'drizzle-orm': { eq: (_field, value) => value },
    './campaignAuth': { getMyCampaignAccess: async () => account },
    './securityTransport': { enforcePrincipalWriteLimit: () => {} },
    h3: { getCookie: (_event, name) => cookies[name], setCookie: (_event, name, value, options) => { cookies[name] = value; written.push({ name, value, options }) } },
  })
  return { ...helpers, campaign, cookies, written, rows, setAccount: value => { account = { ...account, ...value } } }
}

test('forged UI flags never grant campaign membership, GM or manager access', async () => {
  const f = fixture()
  f.cookies['campaign-access-campaign'] = 'true'
  f.cookies['campaign-dm-campaign'] = 'true'
  for (const guard of [f.requireCampaignMember, f.requireCampaignDm, f.requireCampaignManager]) await assert.rejects(guard({}, 'campaign'), error => error.statusCode === 401)
})

test('player credentials are httpOnly, campaign/role scoped, expiring, and revoked by password changes', async () => {
  const f = fixture()
  f.issueCampaignMemberCookie({}, f.campaign)
  assert.equal(f.written[0].options.httpOnly, true)
  assert.equal(f.written[0].options.sameSite, 'lax')
  assert.equal((await f.requireCampaignMember({}, 'campaign')).isGuest, true)
  await assert.rejects(f.requireCampaignDm({}, 'campaign'), error => error.statusCode === 403)
  f.cookies['campaign-dm-verified-campaign'] = f.written[0].value
  assert.equal(f.hasCampaignDmCookie({}, f.campaign), false)
  f.campaign.passwordHash = 'changed'
  await assert.rejects(f.requireCampaignMember({}, 'campaign'))
})

test('anonymous GM requires no owner and neither player nor GM password', async () => {
  for (const [overrides, allowed] of [
    [{ ownerId: null, passwordHash: null, dmPasswordHash: null }, true],
    [{ ownerId: null, passwordHash: 'player', dmPasswordHash: null }, false],
    [{ ownerId: null, passwordHash: null, dmPasswordHash: 'gm' }, false],
    [{ ownerId: 'owner', passwordHash: null, dmPasswordHash: null }, false],
  ]) {
    const f = fixture(overrides)
    assert.equal((await f.resolveCampaignAccess({}, 'campaign')).isDm, allowed)
  }
})

test('GM-password and co-DM access cannot manage an owned campaign; owner/co-owner can', async () => {
  const f = fixture()
  f.issueCampaignDmCookie({}, f.campaign)
  assert.equal((await f.requireCampaignDm({}, 'campaign')).isMember, true)
  await assert.rejects(f.requireCampaignManager({}, 'campaign'), error => error.statusCode === 403)
  f.setAccount({ userId: 'co-dm', isCoDm: true })
  await assert.rejects(f.requireCampaignManager({}, 'campaign'))
  for (const role of ['isOwner', 'isCoOwner']) {
    const g = fixture(); g.setAccount({ userId: 'manager', [role]: true })
    assert.equal((await g.requireCampaignManager({}, 'campaign')).isManager, true)
  }
})

test('admitted players retain trusted control of player characters, while NPC and cross-campaign IDs remain blocked', async () => {
  const f = fixture(); f.setAccount({ userId: 'guest', accessibleTamerIds: ['another-tamer'] })
  const { encounter, access } = await f.requireEncounterAccess({}, 'enc')
  assert.equal((await f.requireEncounterActor({}, encounter, 'player', access)).id, 'player')
  await assert.rejects(f.requireEncounterActor({}, encounter, 'npc', access), error => error.statusCode === 403)
  f.rows.tamers[0].campaignId = 'foreign'
  await assert.rejects(f.requireEncounterActor({}, encounter, 'player', access), error => error.statusCode === 400)
})

test('enemy-marked Tamer actors require GM while normal Tamers remain broadly controllable', async () => {
  const f = fixture()
  f.issueCampaignMemberCookie({}, f.campaign)
  const { encounter, access } = await f.requireEncounterAccess({}, 'enc')
  assert.equal((await f.requireEncounterActor({}, encounter, 'player', access)).id, 'player')
  encounter.participants[0].isEnemy = true
  await assert.rejects(f.requireEncounterActor({}, encounter, 'player', access), { statusCode: 403 })
  f.issueCampaignDmCookie({}, f.campaign)
  assert.equal((await f.requireEncounterActor({}, encounter, 'player')).id, 'player')
})

test('staged encounters are hidden from players, and legacy standalone encounters are read-only', async () => {
  const f = fixture(); f.issueCampaignMemberCookie({}, f.campaign)
  f.rows.encounters[0].visibleToPlayers = false
  await assert.rejects(f.requireEncounterAccess({}, 'enc'), error => error.statusCode === 404)
  f.rows.encounters[0].campaignId = null
  assert.equal((await f.requireEncounterAccess({}, 'enc')).access, null)
  await assert.rejects(f.requireEncounterAccess({}, 'enc', 'dm'), error => error.statusCode === 403)
  await assert.rejects(f.requireEncounterActor({}, f.rows.encounters[0], 'player'), error => error.statusCode === 403)
})

test('runtime field projection rejects ownership/campaign rebinding and unsafe image protocols', () => {
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const { tableWriteBody, safeUrl, finiteNumber } = loadTypeScript('server/utils/securityValidation.ts')
  const { tamers } = loadTypeScript('server/db/schema.ts')
  const existing = { id: 't', ownerId: 'owner', campaignId: 'campaign', publicAccess: false }
  assert.deepEqual(tableWriteBody({ name: 'New', ownerId: 'owner' }, tamers, existing, [], ['publicAccess']), { name: 'New' })
  assert.equal(tableWriteBody({ spriteUrl: 'http://legacy.example.com/a.png', name: 'Rename' }, tamers, { ...existing, spriteUrl: 'http://legacy.example.com/a.png' }).name, 'Rename')
  for (const hostile of [{ id: 'chosen' }, { ownerId: 'chosen' }, { publicAccess: true }]) assert.throws(() => tableWriteBody(hostile, tamers, undefined, [], ['publicAccess']))
  for (const hostile of [{ ownerId: null }, { campaignId: null }, { publicAccess: true }, { imaginary: 1 }]) assert.throws(() => tableWriteBody(hostile, tamers, existing, [], ['publicAccess']))
  for (const url of ['javascript:alert(1)', 'data:image/svg+xml,x', 'http://example.com/a.png', 'https://user:pass@example.com/a.png']) assert.throws(() => safeUrl(url))
  assert.equal(safeUrl('https://example.com/a.png'), 'https://example.com/a.png')
  assert.throws(() => finiteNumber(Infinity))
  assert.throws(() => finiteNumber(1.5, 'coordinate', { integer: true }))
})
