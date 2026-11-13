import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { updateMapContentBounds } = loadTypeScript('utils/mapContentBounds.ts')

const names = ['defineEventHandler', 'getRouterParam', 'readBody', 'getQuery', 'createError']
const originals = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value } })
function fixture() {
  Object.assign(globalThis, { defineEventHandler: fn => fn, getRouterParam: () => 'map', readBody: async event => event.body, getQuery: () => ({}), createError: data => Object.assign(new Error(data.message), data) })
  const schema = loadTypeScript('server/db/schema.ts')
  let campaign = { id: 'campaign', ownerId: null, passwordHash: 'player-hash', dmPasswordHash: 'gm-hash' }
  let map = { id: 'map', campaignId: 'campaign', name: 'Map', dimensions: { width: 4, depth: 4, height: 4 }, groundTiles: [], spaceTiles: [], voxels: [], walls: [{ id: 'wall', x: 0, y: 0, z: 0, face: 'north' }], windows: [], ceilings: [], stairs: [], doors: [{ id: 'door', wallId: 'wall', isOpen: true }] }
  map.contentBounds = updateMapContentBounds(null, map)
  let account = { userId: null, isOwner: false, isCoOwner: false, isCoDm: false, accessibleTamerIds: [] }
  const control = { writes: 0, locks: 0 }, cookies = {}
  const db = {
    select: () => ({ from: table => ({ where: () => {
      const result = table === schema.maps ? [structuredClone(map)] : table === schema.campaigns ? [campaign] : []
      return { then: (yes, no) => Promise.resolve(result).then(yes, no), for: async mode => { assert.equal(mode, 'update'); control.locks++; return result } }
    } }) }),
    update: () => ({ set: fields => ({ where: () => ({ returning: async projection => { control.writes++; map = { ...map, ...fields }; return [projection ? { id: map.id, updatedAt: map.updatedAt } : structuredClone(map)] } }) }) }),
    transaction: async fn => { const before = structuredClone(map); try { return await fn(db) } catch (error) { map = before; throw error } },
  }
  const exports = { ...schema, db }
  const security = loadTypeScriptWithMocks('server/utils/campaignSecurity.ts', {
    '../db': exports, './campaignAuth': { getMyCampaignAccess: async () => account }, './securityTransport': { enforcePrincipalWriteLimit: () => {} },
    h3: { getCookie: (_event, name) => cookies[name], setCookie: (_event, name, value) => { cookies[name] = value } },
  })
  const entities = loadTypeScriptWithMocks('server/utils/entitySecurity.ts', { '../db': exports, './campaignSecurity': security, './session': { getSessionUser: async () => null } })
  const handler = loadTypeScriptWithMocks('server/api/maps/[mapId].put.ts', {
    '../../db': exports, '../../utils/entitySecurity': entities,
    '../../utils/encounterRoom': { broadcast: () => {} }, '../../utils/guidingLight': { recomputeGuidingLightForEncounter: async () => {} },
  }).default
  return { save: body => handler({ body }), state: () => map, control, security, campaign, cookies, setAccount: value => { account = { ...account, ...value } } }
}

test('map writes reject unauthenticated/forged GM flags on ownerless protected campaigns', async () => {
  const f = fixture(); f.cookies['campaign-dm-campaign'] = 'true'
  await assert.rejects(f.save({ name: 'Hijack' }), error => error.statusCode === 401)
  assert.equal(f.control.writes, 0)
  assert.equal(f.state().name, 'Map')
})

test('a verified GM map save locks the row and preserves the live door state', async () => {
  const f = fixture(); f.security.issueCampaignDmCookie({}, f.campaign)
  await f.save({ name: 'Edited', doors: [{ id: 'door', wallId: 'wall', isOpen: false }] })
  assert.equal(f.state().name, 'Edited')
  assert.equal(f.state().doors[0].isOpen, true)
  assert.equal(f.control.locks, 1)
})

test('map writes reject scope rebinding, unknown properties and invalid coordinates before update', async () => {
  const f = fixture(); f.setAccount({ userId: 'gm', isCoDm: true })
  for (const body of [{ campaignId: 'other' }, { id: 'new-id' }, { ownerId: 'gm' }, { groundTiles: [{ x: 0, y: Infinity, z: 0 }] }, { groundTiles: [{}] }]) await assert.rejects(f.save(body), error => error.statusCode === 400)
  assert.equal(f.control.writes, 0)
})

test('unowned workshop maps are editable, with visibility changes reserved for owners', async () => {
  const f = fixture(); f.state().campaignId = null
  await f.save({ name: 'Changed' })
  assert.equal(f.state().name, 'Changed')
  await assert.rejects(f.save({ hidden: true }), { statusCode: 400 })
  assert.equal(f.control.writes, 1)
})

test('map saves persist bounds from partial geometry updates and reject forged display metadata', async () => {
  const f = fixture(); f.setAccount({ userId: 'gm', isCoDm: true })
  await f.save({ voxels: [{ x: -10, y: -5, z: -20, materialId: 'earth' }] })
  assert.deepEqual([f.state().contentBounds.x, f.state().contentBounds.y, f.state().contentBounds.z], [11, 6, 21])
  const stored = structuredClone(f.state().contentBounds)
  await f.save({ name: 'Rename' })
  assert.deepEqual(f.state().contentBounds, stored)
  await f.save({ voxels: [] })
  assert.deepEqual([f.state().contentBounds.x, f.state().contentBounds.y, f.state().contentBounds.z], [1, 1, 1])
  await f.save({ walls: [] })
  assert.deepEqual([f.state().contentBounds.x, f.state().contentBounds.y, f.state().contentBounds.z], [0, 0, 0])
  await assert.rejects(f.save({ contentBounds: { x: 999, y: 999, z: 999 } }), { statusCode: 400 })
})

test('legacy maps initialize all bounds on their first save without a bulk backfill', async () => {
  const f = fixture(); f.setAccount({ userId: 'gm', isCoDm: true })
  f.state().contentBounds = null
  f.state().voxels = [{ x: -50, y: 20, z: -30, materialId: 'earth' }]
  await f.save({ name: 'First save' })
  assert.deepEqual([f.state().contentBounds.x, f.state().contentBounds.y, f.state().contentBounds.z], [51, 21, 31])
  assert.equal(f.state().voxels.length, 1)
  assert.equal(f.state().walls.length, 1)
})
