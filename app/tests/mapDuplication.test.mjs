import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globals = ['defineEventHandler', 'getRouterParam', 'createError', '$fetch']
const originals = new Map(globals.map(key => [key, globalThis[key]]))
afterEach(() => {
  for (const [key, value] of originals) value === undefined ? delete globalThis[key] : globalThis[key] = value
})
const collections = ['groundTiles', 'spaceTiles', 'voxels', 'walls', 'windows', 'doors', 'ceilings', 'stairs']
function sourceMap() {
  return {
    id: 'source', campaignId: 'campaign', ownerId: null, hidden: false,
    name: 'River', description: 'Keep the complete map', dimensions: { width: 0, depth: 0, height: 0 },
    groundTiles: [{ x: -3, y: 0, z: 2, element: 'wood', terrain: 'normal' }],
    spaceTiles: [{ x: 8, y: 0, z: 2, spaceType: 'pit' }],
    voxels: [{ x: -2, y: 3, z: 1, materialId: 'flickering-light', isSpawnPoint: true }],
    walls: [{ id: 'wall', x: 0, y: 0, z: 0, face: 'north' }],
    windows: [{ id: 'window', wallId: 'wall' }],
    doors: [{ id: 'door', wallId: 'wall', isOpen: true }],
    ceilings: [{ id: 'ceiling', x: 0, y: 4, z: 0 }],
    stairs: [{ id: 'stair', x: 1, y: 0, z: 0, face: 'east' }],
    contentBounds: null, createdAt: new Date(0), updatedAt: new Date(0),
  }
}
function fixture({ source = sourceMap(), denied = false, insertError = null } = {}) {
  Object.assign(globalThis, {
    defineEventHandler: handler => handler, getRouterParam: event => event.mapId,
    createError: data => Object.assign(new Error(data.message), data),
  })
  const writes = [], admissions = []
  const route = loadTypeScriptWithMocks('server/api/maps/[mapId]/duplicate.post.ts', {
    '../../../db': { maps: { id: 'id' }, db: {
      select: () => ({ from: () => ({ where: async () => source ? [structuredClone(source)] : [] }) }),
      insert: () => ({ values: async copy => { if (insertError) throw insertError; writes.push(structuredClone(copy)) } }),
    } },
    '../../../utils/entitySecurity': { requireEntityAccess: async (_event, kind, record, write) => {
      admissions.push({ kind, campaignId: record.campaignId, write })
      if (denied) throw Object.assign(new Error('GM required'), { statusCode: 403 })
    } },
    '../../../utils/session': { getSessionUser: async () => ({ id: 'owner' }) },
    '../../../utils/id': { generateId: () => 'copy' },
  }).default
  return { route, writes, admissions, source }
}

test('campaign Duplicate copies all saved content despite legacy zero dimensions', async () => {
  const f = fixture(), before = structuredClone(f.source)
  globalThis.$fetch = async (url, options) => {
    assert.equal(url, '/api/maps/source/duplicate')
    assert.equal(options.method, 'POST')
    return f.route({ mapId: 'source' })
  }
  const api = loadTypeScript('composables/useMap.ts').useMap()
  api.maps.value = [f.source]
  const deps = { duplicateSavedMap: api.duplicateMap, duplicatingMapIds: ref(new Set()), duplicateError: ref(''),
    requestErrorMessage: loadTypeScript('utils/requestError.ts').requestErrorMessage }
  const page = loadPageFunctions('pages/campaigns/[campaignId]/library/maps/index.vue', ['duplicateMap'], deps)
  await page.duplicateMap(f.source)
  assert.equal(deps.duplicateError.value, '')
  assert.equal(deps.duplicatingMapIds.value.size, 0)
  assert.equal(f.writes.length, 1)
  const copy = f.writes[0]
  assert.equal(copy.id, 'copy')
  assert.equal(copy.name, 'River (copy)')
  assert.equal(copy.campaignId, 'campaign')
  assert.equal(copy.ownerId, null)
  assert.equal(copy.description, f.source.description)
  assert.deepEqual(copy.dimensions, { width: 1, depth: 1, height: 1 })
  for (const key of collections) assert.deepEqual(copy[key], f.source[key], key)
  assert.ok(copy.contentBounds.x > 0)
  assert.ok(copy.createdAt > f.source.createdAt)
  assert.deepEqual(f.admissions, [{ kind: 'map', campaignId: 'campaign', write: true }])
  assert.deepEqual(f.source, before)
  assert.deepEqual(api.maps.value.map(m => m.id), ['source', 'copy'])
})

test('duplication preserves valid dimension metadata and private workshop ownership', async () => {
  const source = { ...sourceMap(), campaignId: null, ownerId: 'owner', hidden: true,
    name: 'a'.repeat(1000), dimensions: { width: 10000, depth: 5000, height: 50 } }
  const f = fixture({ source }), copy = await f.route({ mapId: source.id })
  assert.deepEqual(copy.dimensions, source.dimensions)
  assert.equal(copy.hidden, true)
  assert.equal(copy.ownerId, 'owner')
  assert.equal(copy.campaignId, null)
  assert.equal(copy.name.length, 1000)
  assert.ok(copy.name.endsWith(' (copy)'))
})

test('missing or unauthorized maps cannot be duplicated', async () => {
  for (const [options, statusCode] of [[{ source: null }, 404], [{ denied: true }, 403]]) {
    const f = fixture(options)
    await assert.rejects(f.route({ mapId: 'source' }), { statusCode })
    assert.equal(f.writes.length, 0)
  }
})

test('the duplicate endpoint shares the map creation rate limit', () => {
  globalThis.defineEventHandler = handler => handler
  const limits = []
  const middleware = loadTypeScriptWithMocks('server/middleware/01-rate-limit.ts', {
    '../utils/securityTransport': {
      getClientIp: () => 'viewer', enforcePasswordAttemptLimit: () => {},
      consumeHttpLimit: (_event, key, budget) => limits.push([key, budget]),
    },
  }).default
  middleware({ node: { req: { method: 'POST' } }, path: '/api/maps/source/duplicate' })
  assert.deepEqual(limits, [['create-delete:viewer', 10], ['api-ip:viewer', 3000]])
})

test('a failed insert leaves the list unchanged, reports an error, and allows retry', async () => {
  const f = fixture({ insertError: new Error('Database unavailable') })
  globalThis.$fetch = () => f.route({ mapId: 'source' })
  const api = loadTypeScript('composables/useMap.ts').useMap()
  api.maps.value = [f.source]
  const deps = { duplicateSavedMap: api.duplicateMap, duplicatingMapIds: ref(new Set()), duplicateError: ref(''),
    requestErrorMessage: loadTypeScript('utils/requestError.ts').requestErrorMessage }
  const page = loadPageFunctions('pages/campaigns/[campaignId]/library/maps/index.vue', ['duplicateMap'], deps)
  await page.duplicateMap(f.source)
  assert.ok(deps.duplicateError.value)
  assert.equal(deps.duplicatingMapIds.value.size, 0)
  assert.deepEqual(api.maps.value.map(m => m.id), ['source'])
  assert.equal(f.writes.length, 0)
})

test('repeated clicks share the pending duplication and enable the button afterwards', async () => {
  let finish, calls = 0
  const deps = { duplicatingMapIds: ref(new Set()), duplicateError: ref('previous failure'),
    duplicateSavedMap: () => { calls++; return new Promise(resolve => { finish = resolve }) },
    requestErrorMessage: () => 'Failed' }
  const page = loadPageFunctions('pages/campaigns/[campaignId]/library/maps/index.vue', ['duplicateMap'], deps)
  const pending = page.duplicateMap(sourceMap())
  assert.equal(deps.duplicatingMapIds.value.has('source'), true)
  await page.duplicateMap(sourceMap())
  assert.equal(calls, 1)
  assert.equal(deps.duplicateError.value, '')
  finish()
  await pending
  assert.equal(deps.duplicatingMapIds.value.size, 0)
})
