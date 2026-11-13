import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'
const keys = ['useTamers', 'useDigimon', 'useMap', 'FileReader', 'document', 'defineEventHandler', 'readBody', 'createError']
const originals = new Map(keys.map(key => [key, globalThis[key]]))
afterEach(() => { for (const [key, value] of originals) value === undefined ? delete globalThis[key] : globalThis[key] = value })

test('exported workshop terrain imports as an independent workshop or campaign map', async () => {
  const creates = [], updates = []
  Object.assign(globalThis, {
    useTamers: () => ({}), useDigimon: () => ({}),
    useMap: () => ({ createMap: async body => { creates.push(body); return { id: 'copy-' + creates.length } }, updateMap: async (id, body) => updates.push({ id, body }) }),
    FileReader: class { readAsText(file) { this.onload({ target: { result: file.content } }) } },
  })
  const { useLibraryImportExport } = loadTypeScript('composables/useLibraryImportExport.ts')
  const api = useLibraryImportExport()
  const map = { id: 'source', ownerId: 'someone', campaignId: null, hidden: true, name: 'Shared', description: 'Terrain', dimensions: { width: 8, depth: 6, height: 10 }, groundTiles: [{ x: 1, y: 0, z: 2, element: 'wood', terrain: 'normal' }], spaceTiles: [], voxels: [{ x: 2, y: 1, z: 3, materialId: 'stone' }], walls: [{ id: 'wall', x: 0, y: 0, z: 0 }], windows: [], doors: [{ id: 'door', wallId: 'wall', isOpen: false }], ceilings: [], stairs: [] }
  const createUrl = URL.createObjectURL, revokeUrl = URL.revokeObjectURL
  let blob
  try {
    URL.createObjectURL = value => { blob = value; return 'blob:test' }
    URL.revokeObjectURL = () => {}
    globalThis.document = { createElement: () => ({ click() {} }) }
    api.exportMap(map)
  } finally { URL.createObjectURL = createUrl; URL.revokeObjectURL = revokeUrl }
  const content = await blob.text()
  const exported = JSON.parse(content)
  for (const field of ['id', 'ownerId', 'campaignId', 'hidden']) assert.equal(Object.hasOwn(exported, field), false)
  for (const campaignId of [undefined, 'campaign']) {
    const result = await api.importMaps({ content }, campaignId)
    assert.equal(result.successful, 1)
    assert.equal(result.failed, 0)
    assert.equal(creates.at(-1).campaignId, campaignId)
    assert.equal(creates.at(-1).generateGround, false)
    assert.deepEqual(creates.at(-1).dimensions, map.dimensions)
    for (const field of ['groundTiles', 'spaceTiles', 'voxels', 'walls', 'windows', 'doors', 'ceilings', 'stairs']) assert.deepEqual(updates.at(-1).body[field], map[field])
  }
})

test('legacy campaign exports with empty dimension metadata reach the real Workshop create endpoint without losing terrain', async () => {
  const source = { name: 'Kamo River', campaignId: 'source-campaign', ownerId: 'original-owner', hidden: true,
    groundTiles: [{ x: -3, y: 2, z: 8, element: 'wood', materialId: 'wood' }],
    voxels: [{ x: -2, y: -1, z: 7, materialId: 'stone' }],
    walls: [{ id: 'wall', x: -2, y: 1, z: 7 }], doors: [{ id: 'door', wallId: 'wall', isOpen: true }] }
  let body, stored
  Object.assign(globalThis, {
    defineEventHandler: handler => handler, readBody: async () => body,
    createError: data => Object.assign(new Error(data.message), data),
    useTamers: () => ({}), useDigimon: () => ({}),
    FileReader: class { readAsText(file) { this.onload({ target: { result: file.content } }) } },
  })
  const handler = loadTypeScriptWithMocks('server/api/maps/index.post.ts', {
    '../../db': { db: { insert: () => ({ values: async row => { stored = row } }) }, maps: {} },
    '../../utils/session': { getSessionUser: async () => ({ id: 'workshop-owner' }) },
    '../../utils/id': { generateId: () => 'new-map' },
    '../../utils/campaignSecurity': { requireCampaignDm: () => { throw Error('Import must not carry campaign access') } },
  }).default
  globalThis.useMap = () => ({
    createMap: async input => { body = JSON.parse(JSON.stringify(input)); return handler({}) },
    updateMap: async (id, patch) => { assert.equal(id, 'new-map'); stored = { ...stored, ...patch }; return stored },
  })
  const api = loadTypeScript('composables/useLibraryImportExport.ts').useLibraryImportExport()
  for (const dimensions of [undefined, null, { width: 0, depth: 0, height: 0 }, { width: 8, depth: 6, height: 0, legacy: true }]) {
    const result = await api.importMaps({ content: JSON.stringify({ ...source, dimensions }) })
    assert.equal(result.successful, 1, JSON.stringify(result.errors))
    assert.equal(stored.id, 'new-map')
    assert.equal(stored.ownerId, 'workshop-owner')
    assert.equal(stored.campaignId, null)
    assert.equal(stored.hidden, false)
    assert.deepEqual(stored.dimensions, dimensions?.width > 0 ? { width: 8, depth: 6, height: 1 } : { width: 1, depth: 1, height: 1 })
    for (const field of ['groundTiles', 'voxels', 'walls', 'doors']) assert.deepEqual(stored[field], source[field])
  }
})

test('map import shows the server rejection reason instead of only the POST status', async () => {
  Object.assign(globalThis, {
    useTamers: () => ({}), useDigimon: () => ({}),
    useMap: () => ({ createMap: async () => { throw { message: '[POST] /api/maps: 400', data: { message: 'Map name is too long' } } } }),
    FileReader: class { readAsText(file) { this.onload({ target: { result: file.content } }) } },
  })
  const api = loadTypeScript('composables/useLibraryImportExport.ts').useLibraryImportExport()
  const result = await api.importMaps({ content: JSON.stringify({ name: 'River' }) })
  assert.equal(result.failed, 1)
  assert.equal(result.errors[0].error, 'Map name is too long')
})
