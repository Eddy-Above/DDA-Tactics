import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'
const keys = ['useTamers', 'useDigimon', 'useMap', 'FileReader', 'document']
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
