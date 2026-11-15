import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const originalFetch = globalThis.$fetch
afterEach(() => { originalFetch === undefined ? delete globalThis.$fetch : globalThis.$fetch = originalFetch })
const source = {
  id: 'river', name: 'River', campaignId: 'campaign', description: 'A crossing',
  dimensions: { width: 0, depth: 0, height: 0 },
  groundTiles: [{ x: -3, y: 0, z: 1, element: 'wood' }],
  voxels: [{ x: 0, y: 1, z: 0, materialId: 'glass' }],
  walls: [{ id: 'wall', x: 0, y: 0, z: 0 }],
  doors: [{ id: 'door', wallId: 'wall', isOpen: true }],
}
function fixture(fetch) {
  globalThis.$fetch = fetch
  const api = loadTypeScript('composables/useMap.ts').useMap()
  api.maps.value = [structuredClone(source)]
  const state = { renameTarget: ref(null), renameName: ref(''), renameSaving: ref(false), renameError: ref(''),
    updateMap: api.updateMap, requestErrorMessage: loadTypeScript('utils/requestError.ts').requestErrorMessage }
  const page = loadPageFunctions('pages/campaigns/[campaignId]/library/maps/index.vue',
    ['startRename', 'cancelRename', 'saveRename'], state)
  return { api, ...state, ...page }
}

test('campaign map rename saves a trimmed name-only patch and preserves existing map content', async () => {
  const calls = []
  const h = fixture(async (url, options) => {
    calls.push({ url, options })
    return { ...structuredClone(source), ...options.body }
  })
  h.startRename(source)
  assert.equal(h.renameName.value, 'River')
  h.renameName.value = '  Moonlit Crossing  '
  await h.saveRename()
  assert.deepEqual(calls, [{ url: '/api/maps/river', options: { method: 'PUT', body: { name: 'Moonlit Crossing' } } }])
  assert.deepEqual(JSON.parse(JSON.stringify(h.api.maps.value[0])), { ...source, name: 'Moonlit Crossing' })
  assert.equal(h.renameTarget.value, null)
  assert.equal(h.renameSaving.value, false)
})

test('cancel, unchanged names, and invalid names do not send map updates', async () => {
  const h = fixture(() => { throw Error('Unexpected update') })
  h.startRename(source); h.renameName.value = 'Discard this'; h.cancelRename()
  assert.equal(h.renameTarget.value, null)
  assert.equal(h.api.maps.value[0].name, 'River')
  h.startRename(source); await h.saveRename()
  assert.equal(h.renameTarget.value, null)
  for (const name of ['   ', 'a'.repeat(1001)]) {
    h.startRename(source); h.renameName.value = name; await h.saveRename()
    assert.ok(h.renameError.value)
    assert.equal(h.renameTarget.value.id, source.id)
  }
})

test('a failed rename shows the server explanation and retains the draft for retry', async () => {
  let fail = true
  const h = fixture(async (_url, options) => {
    if (fail) throw { data: { message: 'Campaign access has changed' } }
    return { ...source, ...options.body }
  })
  h.startRename(source); h.renameName.value = 'Crossing'
  await h.saveRename()
  assert.equal(h.renameError.value, 'Campaign access has changed')
  assert.equal(h.renameName.value, 'Crossing')
  assert.equal(h.api.maps.value[0].name, 'River')
  assert.equal(h.renameSaving.value, false)
  fail = false
  await h.saveRename()
  assert.equal(h.api.maps.value[0].name, 'Crossing')
  assert.equal(h.renameTarget.value, null)
  assert.equal(h.renameError.value, '')
})

test('pending renames cannot submit twice or switch the target map mid-save', async () => {
  let finish, calls = 0
  const h = fixture((_url, options) => {
    calls++
    return new Promise(resolve => { finish = () => resolve({ ...source, ...options.body }) })
  })
  h.startRename(source); h.renameName.value = 'Crossing'
  const pending = h.saveRename()
  await h.saveRename()
  h.startRename({ id: 'other', name: 'Other' }); h.cancelRename()
  assert.equal(calls, 1)
  assert.equal(h.renameSaving.value, true)
  assert.equal(h.renameTarget.value.id, source.id)
  finish(); await pending
  assert.equal(h.renameSaving.value, false)
  assert.equal(h.renameTarget.value, null)
})
