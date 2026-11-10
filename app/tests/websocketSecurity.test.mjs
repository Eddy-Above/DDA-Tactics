import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const security = loadTypeScript('server/utils/websocketSecurity.ts')
const peers = []
const originalOrigin = process.env.APP_ALLOWED_ORIGINS
const originalHandler = globalThis.defineWebSocketHandler
process.env.APP_ALLOWED_ORIGINS = 'https://game.example'
afterEach(() => { for (const peer of peers.splice(0)) security.releaseAuthorizedPeer(peer); globalThis.defineWebSocketHandler = originalHandler; process.env.APP_ALLOWED_ORIGINS = 'https://game.example' })
process.on('exit', () => { if (originalOrigin === undefined) delete process.env.APP_ALLOWED_ORIGINS; else process.env.APP_ALLOWED_ORIGINS = originalOrigin })
const access = extra => ({ campaignId: 'campaign', isMember: true, isDm: false, userId: null, principalId: 'guest:credential', ...extra })
function peer(path = '/api/encounters/enc/ws', ip = '127.0.0.1', headers = {}) {
  const subject = { remoteAddress: ip, request: { url: `https://game.example${path}`, headers: new Headers({ origin: 'https://game.example', ...headers }) }, closed: [], sent: [], close: (code, reason) => subject.closed.push({ code, reason }), send: value => subject.sent.push(JSON.parse(value)) }
  peers.push(subject)
  return subject
}
const raw = value => ({ text: () => JSON.stringify(value) })

test('Origin and membership are checked before a peer is authorised', async () => {
  const evil = peer(undefined, '127.0.0.2', { origin: 'https://evil.example' })
  let reads = 0
  assert.equal(await security.authorizeWebSocketPeer(evil, async () => { reads++; return access() }, () => {}), null)
  assert.equal(reads, 0)
  assert.equal(evil.closed[0].code, 1008)
  const outsider = peer()
  assert.equal(await security.authorizeWebSocketPeer(outsider, async () => access({ isMember: false }), () => {}), null)
  assert.equal(outsider.closed[0].code, 1008)
})

test('idle peers expire, grant revocation closes peers, and campaign invalidation closes only that campaign', async t => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1000 })
  const expired = peer()
  await security.authorizeWebSocketPeer(expired, async () => access({ expiresAt: 1100 }), () => {})
  t.mock.timers.tick(101)
  await Promise.resolve()
  assert.equal(expired.closed[0].code, 1008)
  assert.equal(expired._securityCanReceive(), false)
  let member = true
  const revoked = peer()
  await security.authorizeWebSocketPeer(revoked, async () => access({ isMember: member }), () => {})
  member = false
  t.mock.timers.tick(60_001)
  await Promise.resolve(); await Promise.resolve()
  assert.equal(revoked.closed[0].code, 1008)
  const same = peer(), other = peer()
  await security.authorizeWebSocketPeer(same, async () => access(), () => {})
  await security.authorizeWebSocketPeer(other, async () => access({ campaignId: 'other' }), () => {})
  security.invalidateCampaignPeers('campaign')
  assert.equal(same.closed[0].code, 1008)
  assert.equal(other.closed.length, 0)
})

test('logout invalidates only the matching session and incoming payloads have byte and rate bounds', async () => {
  const signedIn = peer(undefined, '127.0.0.3', { cookie: 'session=one; other=value' })
  await security.authorizeWebSocketPeer(signedIn, async () => access({ userId: 'account' }), () => {})
  security.invalidateSessionPeers('one')
  assert.equal(signedIn.closed[0].code, 1008)
  const huge = peer()
  await security.authorizeWebSocketPeer(huge, async () => access(), () => {})
  let decoded = false
  assert.equal(security.readWebSocketMessage(huge, { rawData: Buffer.alloc(65537), text: () => { decoded = true; return '{}' } }), null)
  assert.equal(decoded, false)
  assert.equal(huge.closed[0].code, 1009)
  const noisy = peer()
  await security.authorizeWebSocketPeer(noisy, async () => access(), () => {})
  for (let i = 0; i < 60; i++) assert.deepEqual(security.readWebSocketMessage(noisy, raw({})), {})
  assert.equal(security.readWebSocketMessage(noisy, raw({})), null)
  assert.equal(noisy.closed[0].code, 1008)
})

test('connection caps release when a peer leaves', async () => {
  const connected = []
  for (let i = 0; i < 100; i++) {
    const subject = peer(undefined, '127.0.0.4'); connected.push(subject)
    assert.ok(await security.authorizeWebSocketPeer(subject, async () => access(), () => {}))
  }
  const capped = peer(undefined, '127.0.0.4')
  assert.equal(await security.authorizeWebSocketPeer(capped, async () => access(), () => {}), null)
  assert.equal(capped.closed[0].code, 1013)
  security.releaseAuthorizedPeer(connected[0])
  assert.ok(await security.authorizeWebSocketPeer(peer(undefined, '127.0.0.4'), async () => access(), () => {}))
})

function handlerFixture() {
  globalThis.defineWebSocketHandler = handler => handler
  const control = { member: true, dm: false, joined: 0, left: 0, applied: [], broadcasts: [] }
  const room = { joinRoom: async () => { control.joined++ }, leaveRoom: () => { control.left++ },
    getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [], version: 0 }), prepareRoomCommit: async () => {},
    applyStructureDamaged: async (...args) => { control.applied.push(args); return 1 }, broadcast: (...args) => control.broadcasts.push(args) }
  const auth = { securityEventFromHeaders: headers => ({ headers }), requireEncounterAccess: async () => {
    if (!control.member) throw new Error('Denied')
    return { encounter: { id: 'enc', campaignId: 'campaign', mapId: 'map' }, access: access({ isDm: control.dm }) }
  } }
  const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/ws.ts', {
    '../../../db': { encounters: { id: 'id' }, db: { transaction: work => work({}), select: () => ({ from: () => ({ where: () => ({ for: async () => [] }) }) }) } },
    'drizzle-orm': { eq: () => null },
    '../../../utils/encounterRoom': room, '../../../utils/campaignSecurity': auth,
    '../../../utils/combatSpatial': { loadEncounterMap: async () => ({ walls: [{ id: 'wall', woundBoxes: 5 }], windows: [], ceilings: [] }) },
    '../../../utils/intercedeClaims': { serializeIntercedeClaim: (_id, work) => work() },
    '../../../utils/websocketSecurity': security,
  }).default
  return { control, handler }
}

test('the actual encounter handler sends no protected state to outsiders and denies client position/map writes', async () => {
  const f = handlerFixture()
  f.control.member = false
  const outsider = peer(); await f.handler.open(outsider)
  assert.equal(f.control.joined, 0); assert.equal(outsider.sent.length, 0)
  f.control.member = true
  for (const type of ['unit-moved', 'position-patch', 'map-edited', 'door-toggled', 'element-painted', 'full-state']) {
    const guest = peer(); await f.handler.open(guest)
    await f.handler.message(guest, raw({ type, encounterId: 'enc', participantId: 'unit', position: { x: 0, y: 0, z: 0 } }))
    assert.equal(guest.closed[0].code, 1008)
  }
  assert.equal(f.control.applied.length, 0)
})

test('only a current GM may damage an existing destructible with finite bounded wounds', async () => {
  const f = handlerFixture()
  const guest = peer(); await f.handler.open(guest)
  await f.handler.message(guest, raw({ type: 'structure-damaged', encounterId: 'enc', structureId: 'wall', woundsRemaining: 0 }))
  assert.equal(f.control.applied.length, 0)
  f.control.dm = true
  for (const payload of [{ structureId: 'foreign', woundsRemaining: 0 }, { structureId: 'wall', woundsRemaining: 6 }, { structureId: 'wall', woundsRemaining: -1 }, { structureId: 'wall', woundsRemaining: null }]) {
    const gm = peer(); await f.handler.open(gm)
    await f.handler.message(gm, raw({ type: 'structure-damaged', encounterId: 'enc', ...payload }))
    assert.equal(gm.closed[0].code, 1008)
  }
  assert.equal(f.control.applied.length, 0)
  const gm = peer(); await f.handler.open(gm)
  await f.handler.message(gm, raw({ type: 'structure-damaged', encounterId: 'enc', structureId: 'wall', woundsRemaining: 2, version: 99 }))
  assert.deepEqual(f.control.applied, [['enc', 'wall', 2]])
  assert.equal(f.control.broadcasts[0][1].version, 1)
})

test('campaign channels authenticate before joining and cannot receive client-authored broadcasts', async () => {
  globalThis.defineWebSocketHandler = handler => handler
  let member = false, joined = 0
  const handler = loadTypeScriptWithMocks('server/api/campaigns/[id]/ws.ts', {
    '../../../utils/encounterRoom': { joinRoom: async () => { joined++ }, leaveRoom: () => {} },
    '../../../utils/rollLog': { campaignRoomKey: id => `campaign:${id}` },
    '../../../utils/campaignSecurity': { resolveCampaignAccessFromHeaders: async () => access({ isMember: member }) },
    '../../../utils/websocketSecurity': security,
  }).default
  const outsider = peer('/api/campaigns/campaign/ws')
  await handler.open(outsider)
  assert.equal(joined, 0)
  member = true
  const guest = peer('/api/campaigns/campaign/ws')
  await handler.open(guest)
  assert.equal(joined, 1)
  await handler.message(guest, raw({ type: 'roll-logged', campaignId: 'campaign' }))
  assert.equal(guest.closed[0].code, 1008)
})

test('logout captures the session token before destroying it and revokes its live peers afterward', async () => {
  const original = globalThis.defineEventHandler
  globalThis.defineEventHandler = handler => handler
  let destroyed = false
  const revoked = []
  try {
    const handler = loadTypeScriptWithMocks('server/api/auth/logout.post.ts', {
      h3: { getCookie: () => { assert.equal(destroyed, false); return 'session-token' } },
      '../../utils/session': { destroySession: async () => { destroyed = true } },
      '../../utils/websocketSecurity': { invalidateSessionPeers: token => { assert.equal(destroyed, true); revoked.push(token) } },
    }).default
    await handler({})
    assert.deepEqual(revoked, ['session-token'])
  } finally { globalThis.defineEventHandler = original }
})
