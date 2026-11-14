import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const originals = new Map(['ref', '$fetch', 'confirm'].map(key => [key, globalThis[key]]))
afterEach(() => { for (const [key, value] of originals) value === undefined ? delete globalThis[key] : globalThis[key] = value })
function fixture() {
  globalThis.ref = ref
  globalThis.confirm = () => true
  const tamers = loadTypeScript('composables/useTamers.ts').useTamers()
  const digimon = loadTypeScript('composables/useDigimon.ts').useDigimon()
  tamers.tamers.value = [{ id: 'owner-tamer', name: 'Sora', ownerId: 'owner', hidden: false }]
  digimon.digimonList.value = [{ id: 'partner', name: 'Biyomon', partnerId: 'owner-tamer', ownerId: 'owner', hidden: false },
    { id: 'other', name: 'Agumon', partnerId: null, ownerId: 'owner', hidden: false }]
  const deps = { ...tamers, ...digimon, tamerError: tamers.error, digimonError: digimon.error,
    currentUser: ref({ id: 'owner' }), pendingCharacters: ref(new Set()), actionError: ref(''),
    loadAll: () => { throw new Error('A card mutation must not reload any collections') },
  }
  return { ...deps, ...loadPageFunctions('pages/workshop/index.vue', ['isMine', 'canModify', 'mutateCharacter',
    'toggleTamerHidden', 'toggleDigimonHidden', 'handleDeleteTamer', 'handleDeleteDigimon'], deps) }
}

for (const kind of ['tamer', 'digimon']) {
  test(`Workshop ${kind} hiding saves only that record and suppresses duplicate clicks`, async () => {
    const f = fixture(), calls = []
    const record = kind === 'tamer' ? f.tamers.value[0] : f.digimonList.value[1]
    let release
    globalThis.$fetch = (url, options) => new Promise(done => { calls.push({ url, ...options }); release = () => done({ ...record, ...options.body }) })
    const toggle = kind === 'tamer' ? f.toggleTamerHidden : f.toggleDigimonHidden
    const saving = toggle(record)
    await toggle(record)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].method, 'PUT')
    assert.ok(f.pendingCharacters.value.has(`${kind}:${record.id}`))
    assert.equal(record.hidden, false, 'do not claim success before acknowledgement')
    release(); await saving
    const saved = kind === 'tamer' ? f.tamers.value[0] : f.digimonList.value[1]
    assert.equal(saved.hidden, true)
    assert.equal(f.pendingCharacters.value.size, 0)
  })
}

test('Workshop Tamer deletion unlinks its partners locally and keeps all Digimon', async () => {
  const f = fixture(), calls = []
  globalThis.$fetch = async (url, options) => { calls.push({ url, ...options }); return { success: true } }
  await f.handleDeleteTamer(f.tamers.value[0])
  assert.deepEqual(calls, [{ url: '/api/tamers/owner-tamer', method: 'DELETE' }])
  assert.equal(f.tamers.value.length, 0)
  assert.deepEqual(f.digimonList.value.map(d => d.id), ['partner', 'other'])
  assert.equal(f.digimonList.value[0].partnerId, null)
})

test('Workshop Digimon deletion removes only that card without a collection fetch', async () => {
  const f = fixture(), calls = []
  globalThis.$fetch = async (url, options) => { calls.push({ url, ...options }); return { success: true } }
  await f.handleDeleteDigimon(f.digimonList.value[1])
  assert.deepEqual(calls, [{ url: '/api/digimon/other', method: 'DELETE' }])
  assert.deepEqual(f.digimonList.value.map(d => d.id), ['partner'])
  assert.equal(f.tamers.value.length, 1)
})

test('a rejected Tamer delete shows the server explanation and retains all cards', async () => {
  const f = fixture()
  globalThis.$fetch = async () => { throw { message: '[DELETE] /api/tamers: 400', data: { message: 'Invalid standalone evolution form' } } }
  await f.handleDeleteTamer(f.tamers.value[0])
  assert.match(f.actionError.value, /Invalid standalone evolution form/)
  assert.equal(f.tamers.value.length, 1)
  assert.equal(f.digimonList.value.length, 2)
  assert.equal(f.pendingCharacters.value.size, 0)
})
