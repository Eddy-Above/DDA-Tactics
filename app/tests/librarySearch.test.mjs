import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { matchesLibrarySearch } = loadTypeScript('utils/librarySearch.ts')
const qualities = loadTypeScript('data/qualities.ts')
const { useDigimon } = loadTypeScript('composables/useDigimon.ts')
const globals = new Map(['ref', '$fetch'].map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of globals) value === undefined ? delete globalThis[name] : globalThis[name] = value })

test('library search matches words across metadata and handles empty queries and missing fields', () => {
  const fields = ['Agumon', 'Pepper', 'rookie', 'Vaccine', 'Tai', null, undefined]
  assert.equal(matchesLibrarySearch('  TAI   pepper ', fields), true)
  assert.equal(matchesLibrarySearch('vaccine Rookie', fields), true)
  assert.equal(matchesLibrarySearch('greymon', fields), false)
  assert.equal(matchesLibrarySearch('   ', []), true)
})

test('searchable library loading includes later API pages and preserves scope and warnings', async () => {
  globalThis.ref = ref
  const requests = []
  globalThis.$fetch = async url => {
    const params = new URL(url, 'http://localhost').searchParams
    requests.push(params)
    return { data: [{ id: params.get('page') }], total: 501, page: Number(params.get('page')), pageSize: 500, totalPages: 2,
      warnings: params.get('page') === '2' ? ['Repair needed'] : [] }
  }
  const library = useDigimon()
  await library.fetchDigimon({ campaignId: 'campaign', all: true })
  assert.deepEqual(library.digimonList.value.map(d => d.id), ['1', '2'])
  assert.deepEqual(library.warnings.value, ['Repair needed'])
  assert.equal(library.loading.value, false)
  assert.equal(library.error.value, null)
  assert.ok(requests.every(params => params.get('campaignId') === 'campaign' && params.get('pageSize') === '500'))
})

test('existing saved qualities display current definitions, choices and campaign overrides', () => {
  const props = { houseRules: { signatureMoveBattery: true }, eddySoulRules: { instinctBoostsDodgeArmorSpeed: true } }
  const display = loadPageFunctions('components/QualitySelector.vue', [
    'getCurrentQualityTemplate', 'getEffectiveTemplate', 'getDisplayDescription', 'getDisplayEffect',
  ], { props, QUALITY_DATABASE: qualities.QUALITY_DATABASE, getQualityById: qualities.getQualityById })
  const legacy = { id: 'effect-pacify', description: 'Prevent attacks', effect: 'Cannot attack' }
  assert.match(display.getDisplayDescription(legacy), /Damage and Accuracy/)
  assert.match(display.getDisplayEffect(legacy), /can still attack/)
  assert.match(display.getDisplayDescription({ id: 'signature-move' }), /Battery/)
  assert.match(display.getDisplayEffect({ id: 'signature-move' }), /Battery/)
  assert.match(display.getDisplayDescription({ id: 'instinct' }), /Armor, Dodge/)
  const choice = qualities.getQualityById('naturewalk').choices.find(c => c.id === 'fire')
  assert.equal(display.getDisplayEffect({ id: 'naturewalk', choiceId: 'fire', effect: 'old' }), choice.effect)
  assert.equal(display.getDisplayEffect({ id: 'custom', effect: 'custom effect' }), 'custom effect')
  assert.equal(display.getDisplayEffect({ id: 'naturewalk', choiceId: 'custom', effect: 'custom choice' }), 'custom choice')
})
