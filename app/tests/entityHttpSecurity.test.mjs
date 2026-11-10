import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const names = ['defineEventHandler', 'getRouterParam', 'readBody', 'getQuery', 'createError']
const originals = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value } })
function fixture() {
  Object.assign(globalThis, { defineEventHandler: fn => fn, getRouterParam: () => 'map', readBody: async event => event.body, getQuery: () => ({}), createError: data => Object.assign(new Error(data.message), data) })
  const schema = loadTypeScript('server/db/schema.ts')
  let campaign = { id: 'campaign', ownerId: null, passwordHash: 'player-hash', dmPasswordHash: 'gm-hash' }
  let map = { id: 'map', campaignId: 'campaign', name: 'Map', dimensions: { width: 4, depth: 4, height: 4 }, groundTiles: [], spaceTiles: [], voxels: [], walls: [{ id: 'wall', x: 0, y: 0, z: 0, face: 'north' }], windows: [], ceilings: [], stairs: [], doors: [{ id: 'door', wallId: 'wall', isOpen: true }] }
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

test('standalone maps remain readable legacy data and cannot become anonymous writable', async () => {
  const f = fixture(); f.state().campaignId = null
  await assert.rejects(f.save({ name: 'Changed' }), error => error.statusCode === 403)
  assert.equal(f.control.writes, 0)
})
