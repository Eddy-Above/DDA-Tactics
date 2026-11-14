import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useCharacterBundle } = loadTypeScript('composables/useCharacterBundle.ts')
const rules = loadTypeScript('utils/creationRules.ts').defaultCreationRules()
const form = (id, extras = {}) => ({ id, name: id, stage: 'rookie', partnerId: 'sora', campaignId: 'campaign',
  baseStats: { accuracy: 1, damage: 1, dodge: 1, armor: 1, health: 1 }, ...extras })
async function withServices(services, run) {
  const values = { useTamers: () => ({}), useDigimon: () => ({}), useEvolution: () => ({}), ...services }
  const originals = new Map(Object.keys(values).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, values)
  try { await run(useCharacterBundle()) }
  finally { for (const [key, value] of originals) value === undefined ? delete globalThis[key] : globalThis[key] = value }
}

test('solo exports embed rules and character data without fetching or carrying partner/evolution links', async () => {
  await withServices({ $fetch: () => { throw Error('solo exports must not fetch related records') } }, async api => {
    const tamer = api.buildTamerBundle({ id: 'sora', name: 'Sora', totalXp: 150, xp: 10, creationRules: rules })
    assert.equal(tamer.tamer.totalXp, 150)
    assert.deepEqual(tamer.rules, rules)
    assert.deepEqual(tamer.digimon, [])
    assert.deepEqual(tamer.evolutionLines, [])
    const solo = api.buildDigimonBundle(form('b', { evolvesFromId: 'a', evolutionPathIds: ['c'] }), rules)
    assert.equal(solo.tamer, undefined)
    assert.equal(solo.digimon.length, 1)
    assert.equal(solo.digimon[0].partneredToTamer, false)
    assert.equal(solo.digimon[0].evolvesFromKey, undefined)
    assert.equal(solo.digimon[0].evolutionPathKeys, undefined)
  })
})

test('full Digimon export traverses ancestors, descendants, branches and saved lines, then imports with fresh IDs and no Tamer', async () => {
  const records = [form('a', { evolutionPathIds: ['b', 'branch'] }), form('b', { evolvesFromId: 'a', evolutionPathIds: ['c'] }),
    form('c', { evolvesFromId: 'b' }), form('branch', { evolvesFromId: 'a' }), form('saved-only')]
  const chain = ids => ids.map((id, index) => ({ digimonId: id, stage: 'rookie', species: id, isUnlocked: true,
    ...(index === 2 ? { evolvesFromIndex: 0 } : {}) }))
  const lines = [{ name: 'Branched', partnerId: 'sora', campaignId: 'campaign', currentStageIndex: 2, chain: chain(['a', 'b', 'branch', 'saved-only']) },
    { name: 'Unrelated', partnerId: 'sora', campaignId: 'campaign', chain: chain(['unrelated']) },
    { name: 'Other Tamer', partnerId: 'other', campaignId: 'campaign', chain: chain(['b', 'foreign']) }]
  const creates = [], updates = [], savedLines = [], lineUpdates = [], fetches = []
  await withServices({
    $fetch: async (url, { query }) => {
      fetches.push({ url, query })
      return url === '/api/evolution-lines' ? lines : { data: records.filter(record => query.ids.split(',').includes(record.id)) }
    },
    useTamers: () => ({ createTamer: () => { throw Error('Digimon exports must not create a Tamer') } }),
    useDigimon: () => ({ createDigimon: async data => { creates.push(data); return { id: `new-${data.name}` } },
      updateDigimon: async (id, data) => { updates.push({ id, data }); return { id } } }),
    useEvolution: () => ({ createEvolutionLine: async data => { savedLines.push(data); return { id: 'new-line' } },
      updateEvolutionLine: async (id, data) => lineUpdates.push({ id, data }) }),
  }, async api => {
    const bundle = await api.buildDigimonLineBundle(records[1], rules)
    assert.deepEqual(fetches[0].query, { partnerId: 'sora' })
    assert.equal(bundle.tamer, undefined)
    assert.deepEqual(bundle.rules, rules)
    assert.deepEqual(bundle.digimon.map(d => d.name).sort(), records.map(d => d.name).sort())
    assert.ok(bundle.digimon.every(d => d.partneredToTamer === false && !('partnerId' in d) && !('campaignId' in d)))
    assert.deepEqual(bundle.evolutionLines.map(line => line.name), ['Branched'])
    assert.deepEqual(bundle.evolutionLines[0].chain.map(entry => entry.evolvesFromIndex), [null, 0, 0, 2])
    const result = await api.importBundle(JSON.parse(JSON.stringify(bundle)), { sandbox: true })
    assert.deepEqual(result.errors, [])
    assert.equal(result.tamerId, null)
    assert.equal(creates.length, 5)
    assert.ok(creates.every(data => data.partnerId === null && data.campaignId === null))
    assert.deepEqual(updates.find(entry => entry.id === 'new-b' && entry.data.evolvesFromId)?.data, { evolvesFromId: 'new-a' })
    assert.deepEqual(updates.find(entry => entry.id === 'new-a')?.data.evolutionPathIds.sort(), ['new-b', 'new-branch'])
    assert.deepEqual(savedLines[0].chain.map(entry => entry.digimonId), ['new-a', 'new-b', 'new-branch', 'new-saved-only'])
    assert.equal(savedLines[0].partnerId, undefined)
    assert.deepEqual(lineUpdates, [{ id: 'new-line', data: { currentStageIndex: 2 } }])
  })
})

test('Workshop unpartnered line export uses only connected sandbox lines and terminates cycles', async () => {
  const a = form('a', { partnerId: null, campaignId: null, evolutionPathIds: ['b'] })
  const b = form('b', { partnerId: null, campaignId: null, evolutionPathIds: ['a'] })
  await withServices({ $fetch: async (url, { query }) => {
    if (url === '/api/evolution-lines') {
      assert.deepEqual(query, {})
      return [{ name: 'Foreign', campaignId: 'other', chain: [{ digimonId: 'a' }, { digimonId: 'foreign' }] }]
    }
    assert.equal(query.ids, 'b')
    return { data: [b] }
  } }, async api => {
    const bundle = await api.buildDigimonLineBundle(a)
    assert.equal(bundle.digimon.length, 2)
    assert.deepEqual(bundle.evolutionLines, [])
  })
})

test('full line refuses a partial export when a referenced form cannot be read', async () => {
  await withServices({ $fetch: async url => url === '/api/evolution-lines' ? [] : { data: [] } }, async api => {
    await assert.rejects(api.buildDigimonLineBundle(form('a', { evolutionPathIds: ['missing'] })), /missing or cannot be read/)
  })
})

for (const kind of ['tamer', 'digimon']) for (const choice of ['single', 'full']) {
  test(`${kind} Export dropdown dispatches ${choice} with loaded campaign rules`, async () => {
    const calls = [], record = { id: kind }, busy = ref(false), error = ref('old error'), menu = ref({ open: true })
    const method = kind === 'tamer' ? choice === 'single' ? 'exportTamerBundle' : 'exportCharacterBundle'
      : choice === 'single' ? 'exportDigimonBundle' : 'exportDigimonLineBundle'
    const bundle = Object.fromEntries(['exportTamerBundle', 'exportCharacterBundle', 'exportDigimonBundle', 'exportDigimonLineBundle']
      .map(name => [name, (...args) => { assert.equal(busy.value, true); calls.push({ name, args }) }]))
    const handlers = loadPageFunctions('components/CharacterExportMenu.vue', ['exportChoice', 'closeMenu'], {
      props: { kind, record, loadRules: async () => rules }, bundle, busy, error, menu,
      requestErrorMessage: loadTypeScript('utils/requestError.ts').requestErrorMessage,
    })
    await handlers.exportChoice(choice)
    assert.equal(calls.length, 1)
    assert.equal(calls[0].name, method)
    assert.equal(calls[0].args[0], record)
    assert.equal(calls[0].args[1], rules)
    assert.equal(menu.value.open, false)
    assert.equal(busy.value, false)
    assert.equal(error.value, '')
  })
}

test('dropdown displays server export errors and stays open for retry', async () => {
  const busy = ref(false), error = ref(''), menu = ref({ open: true })
  const handlers = loadPageFunctions('components/CharacterExportMenu.vue', ['exportChoice', 'closeMenu'], {
    props: { kind: 'digimon', record: form('a') }, busy, error, menu,
    bundle: { exportDigimonLineBundle: async () => { throw { data: { message: 'Linked form access denied' } } } },
    requestErrorMessage: loadTypeScript('utils/requestError.ts').requestErrorMessage,
  })
  await handlers.exportChoice('full')
  assert.equal(error.value, 'Linked form access denied')
  assert.equal(menu.value.open, true)
  assert.equal(busy.value, false)
})

test('bundle import surfaces the API reason when Tamer creation fails', async () => {
  await withServices({ useTamers: () => ({ createTamer: async () => null, error: ref('Total XP cannot be negative') }) }, async api => {
    const bundle = api.buildTamerBundle({ name: 'Sora' })
    assert.match((await api.importBundle(bundle, { sandbox: true })).errors[0], /Sora.*Total XP cannot be negative/)
  })
})

test('Workshop imports discard all source campaign/owner IDs and remap every relationship to new records', async () => {
  const creates = [], updates = []
  const imported = {
    format: 'dda-character-bundle', version: 1, rules,
    campaignId: 'source-campaign', ownerId: 'source-owner',
    tamer: { id: 'source-tamer', name: 'Sora', campaignId: 'source-campaign', ownerId: 'source-owner' },
    digimon: [
      { ...form('source-a'), localKey: 'a', name: 'A', partneredToTamer: true, evolutionPathKeys: ['b'], evolutionPathIds: ['source-b'] },
      { ...form('source-b'), localKey: 'b', name: 'B', partneredToTamer: true, evolvesFromKey: 'a', evolvesFromId: 'source-a' },
    ],
    evolutionLines: [{ id: 'source-line', name: 'Line', campaignId: 'source-campaign', partnerId: 'source-tamer',
      chain: [{ digimonKey: 'a', digimonId: 'source-a' }, { digimonKey: 'b', digimonId: 'source-b' }] }],
  }
  await withServices({
    useTamers: () => ({ createTamer: async body => { creates.push(body); return { id: 'new-tamer' } } }),
    useDigimon: () => ({ createDigimon: async body => { creates.push(body); return { id: 'new-' + body.name } },
      updateDigimon: async (id, body) => { updates.push({ id, body }); return { id } } }),
    useEvolution: () => ({ createEvolutionLine: async body => { creates.push(body); return { id: 'new-line' } } }),
  }, async api => {
    const result = await api.importBundle(imported, { sandbox: true, campaignId: 'ignored-campaign' })
    assert.deepEqual(result.errors, [])
    assert.ok(creates.every(body => body.campaignId === null))
    assert.ok(creates.every(body => !Object.hasOwn(body, 'id') && !Object.hasOwn(body, 'ownerId')))
    assert.deepEqual(creates.slice(1, 3).map(body => body.partnerId), ['new-tamer', 'new-tamer'])
    assert.deepEqual(creates[3].chain.map(entry => entry.digimonId), ['new-A', 'new-B'])
    assert.ok(!JSON.stringify({ creates, updates }).includes('source-'))
    assert.ok(!JSON.stringify({ creates, updates }).includes('ignored-campaign'))
  })
})

test('Workshop import refuses an existing campaign Tamer before creating any records', async () => {
  await withServices({
    $fetch: async () => ({ id: 'source-tamer', campaignId: 'source-campaign' }),
    useDigimon: () => ({ createDigimon: () => { throw Error('Must not create a cross-campaign import') } }),
  }, async api => {
    const result = await api.importBundle(api.buildDigimonBundle(form('source')), { sandbox: true, partnerTamerId: 'source-tamer' })
    assert.match(result.errors[0], /campaign Tamers cannot be linked/)
    assert.deepEqual(result.digimonIds, [])
  })
})
