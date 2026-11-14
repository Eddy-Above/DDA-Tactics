import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'
const { encounterPartnerForms, currentPartnerFormIds } = loadTypeScript('utils/encounterPartnerForms.ts')
const { requestErrorMessage } = loadTypeScript('utils/requestError.ts')
const page = 'pages/campaigns/[campaignId]/encounters/[id].vue'
const campaign = 'campaign', owners = ['sora', 'tai']
const partners = (forms, lines) => encounterPartnerForms(forms, lines, campaign, owners)

test('current partner forms appear through line association even without a direct Tamer link', () => {
  const forms = [{ id: 'rookie', partnerId: 'sora' }, { id: 'champion', partnerId: null },
    { id: 'standalone', partnerId: 'tai' }, { id: 'npc', partnerId: null, isEnemy: true }]
  const lines = [{ partnerId: 'sora', currentStageIndex: 1, chain: [{ digimonId: 'rookie' }, { digimonId: 'champion' }] }]
  assert.deepEqual(partners(forms, lines).map(form => form.id), ['champion', 'standalone'])
  assert.deepEqual(currentPartnerFormIds(lines, campaign, owners), ['champion'])
  assert.deepEqual(partners(forms, [{ ...lines[0], chain: JSON.stringify(lines[0].chain) }]), partners(forms, lines))
})

test('missing or malformed line metadata does not blank unrelated partner forms', () => {
  const forms = [{ id: 'partner', partnerId: 'sora' }, { id: 'enemy', partnerId: null, isEnemy: true }]
  const lines = [{ partnerId: 'sora', chain: 'bad JSON' }, { partnerId: 'sora', chain: [] },
    { partnerId: null, currentStageIndex: 0, chain: [{ digimonId: 'enemy' }] }]
  assert.deepEqual(partners(forms, lines).map(form => form.id), ['partner'])
})

test('partner choices and missing-current fetch IDs stay within this campaign and its Tamers', () => {
  const forms = [{ id: 'ours', partnerId: 'sora', campaignId: campaign },
    { id: 'foreign', partnerId: 'other-tamer', campaignId: 'other' },
    { id: 'foreign-null', partnerId: 'other-tamer', campaignId: null },
    { id: 'legacy-current', partnerId: null, campaignId: null },
    { id: 'bad-campaign', partnerId: 'sora', campaignId: 'other' }]
  const lines = [{ partnerId: 'other-tamer', campaignId: 'other', chain: [{ digimonId: 'foreign' }] },
    { partnerId: 'other-tamer', chain: [{ digimonId: 'foreign-null' }] },
    { partnerId: 'sora', campaignId: 'other', chain: [{ digimonId: 'bad-campaign' }] },
    { partnerId: 'sora', campaignId: null, chain: [{ digimonId: 'legacy-current' }] }]
  assert.deepEqual(partners(forms, lines).map(form => form.id), ['ours', 'legacy-current'])
  assert.deepEqual(currentPartnerFormIds(lines, campaign, owners), ['legacy-current'])
})

test('current forms outside the initial roster page are fetched by ID and merged without discarding other records', async () => {
  const digimonList = ref([{ id: 'existing' }]), calls = []
  const evolutionLines = ref([{ partnerId: 'sora', currentStageIndex: 0, chain: [{ digimonId: 'missing-current' }] }])
  const { syncCurrentPartnerForms } = loadPageFunctions(page, ['syncCurrentPartnerForms'], {
    digimonList, evolutionLines, currentPartnerFormIds, campaignId: ref(campaign), tamers: ref([{ id: 'sora' }]),
    mergeRecordsById: loadTypeScript('utils/combatRecords.ts').mergeRecordsById,
    $fetch: async (url, options) => { calls.push({ url, options }); return { data: [{ id: 'missing-current' }] } },
  })
  await syncCurrentPartnerForms()
  assert.deepEqual(calls, [{ url: '/api/digimon', options: { query: { ids: 'missing-current' } } }])
  assert.deepEqual(digimonList.value.map(form => form.id), ['existing', 'missing-current'])
  await syncCurrentPartnerForms()
  assert.equal(calls.length, 1)
})

function addFixture({ fail = false, reserve = false } = {}) {
  const selectedTamerIds = ref(['sora', 'tai']), currentEncounter = ref({ id: 'encounter', participants: [] })
  const added = [], requests = [], addingParticipants = ref(false), participantAddError = ref(''), showAddParticipant = ref(true)
  const deps = { selectedTamerIds, currentEncounter, addingParticipants, participantAddError, showAddParticipant,
    pendingParticipantCount: ref(0), failedParticipantBatches: ref([]),
    participantRosterLoading: ref(false), selectedEntityType: ref('tamer'), selectedEntityId: ref(''), selectedNpcEvoLineId: ref(''), addQuantity: ref(1), addToReserve: ref(reserve),
    tamers: ref([{ id: 'sora', name: 'Sora', currentWounds: 2, inspiration: 1, grantedInspiration: 2, xpBonuses: { inspiration: 1 } },
      { id: 'tai', name: 'Tai', currentWounds: 0, inspiration: 3 }]),
    calcTamerStats: tamer => ({ woundBoxes: tamer.id === 'sora' ? 8 : 6 }), eddySoulRules: ref({}), digimonMap: ref(new Map()), error: ref(null), requestErrorMessage,
    createParticipant: (type, entityId, initiative, initiativeRoll, maxWounds, _line, _enemy, currentWounds, _health, inspiration) =>
      ({ type, entityId, initiative, initiativeRoll, maxWounds, currentWounds, inspiration }),
    addParticipants: async (_id, participants) => {
      requests.push(participants)
      if (fail) { fail = false; return null }
      added.push(...participants)
      currentEncounter.value.participants.push(...participants)
      return currentEncounter.value
    },
  }
  return { ...deps, added, requests, ...loadPageFunctions(page, ['handleAddParticipant', 'saveParticipantAdditions', 'retryParticipantBatch'], deps) }
}

test('multi-select queues every Tamer once with their own wounds, Inspiration and reserve state', async () => {
  const f = addFixture({ reserve: true })
  await f.handleAddParticipant()
  assert.deepEqual(f.added.map(p => p.entityId), ['sora', 'tai'])
  assert.deepEqual(f.added.map(p => [p.maxWounds, p.currentWounds, p.inspiration]), [[8, 2, 4], [6, 0, 3]])
  assert.ok(f.added.every(p => p.initiative === -1 && p.inReserve === true))
  assert.equal(f.showAddParticipant.value, false)
  assert.deepEqual(f.selectedTamerIds.value, [])
  assert.equal(f.addingParticipants.value, false)
  assert.equal(f.requests.length, 1, 'all selected Tamers are saved together')
})

test('a failed background batch retains the exact additions for an atomic retry without reopening the picker', async () => {
  const f = addFixture({ fail: true })
  await f.handleAddParticipant()
  assert.deepEqual(f.added, [])
  assert.deepEqual(f.selectedTamerIds.value, [])
  assert.equal(f.showAddParticipant.value, false)
  assert.equal(f.failedParticipantBatches.value.length, 1)
  assert.deepEqual(f.failedParticipantBatches.value[0].additions.map(p => p.entityId), ['sora', 'tai'])
  await f.retryParticipantBatch(f.failedParticipantBatches.value[0])
  assert.deepEqual(f.added.map(p => p.entityId), ['sora', 'tai'])
  assert.deepEqual(f.failedParticipantBatches.value, [])
})

test('adding characters closes and unlocks the picker before the save completes', async () => {
  const f = addFixture()
  let release
  const held = new Promise(done => { release = done })
  const deps = { ...f, addParticipants: async () => { await held; return { id: 'encounter' } } }
  const handlers = loadPageFunctions(page, ['handleAddParticipant', 'saveParticipantAdditions'], deps)
  const first = handlers.handleAddParticipant()
  assert.equal(f.showAddParticipant.value, false)
  assert.equal(f.addingParticipants.value, false)
  assert.equal(f.pendingParticipantCount.value, 2)
  f.showAddParticipant.value = true
  f.selectedTamerIds.value = ['tai']
  const second = handlers.handleAddParticipant()
  assert.equal(f.showAddParticipant.value, false)
  assert.equal(f.pendingParticipantCount.value, 3)
  release(); await Promise.all([first, second])
  assert.equal(f.pendingParticipantCount.value, 0)
})

test('opening the participant picker reuses the roster without a data request', () => {
  const showAddParticipant = ref(false)
  const { openAddParticipant } = loadPageFunctions(page, ['openAddParticipant'], {
    showAddParticipant, fetchEvolutionLines: () => { throw Error('opening must not fetch') },
    fetchDigimon: () => { throw Error('opening must not fetch') }, fetchTamers: () => { throw Error('opening must not fetch') },
  })
  openAddParticipant()
  assert.equal(showAddParticipant.value, true)
})

test('Refresh roster reloads all three sources for this campaign once and keeps the picker open', async () => {
  const calls = [], loading = ref(false), error = ref('old error')
  const selectedTamerIds = ref(['sora', 'removed-tamer'])
  let release
  const gate = new Promise(done => { release = done })
  const { refreshParticipantRoster } = loadPageFunctions(page, ['refreshParticipantRoster'], {
    participantRosterLoading: loading, participantRosterError: error, campaignId: ref(campaign),
    selectedEntityType: ref('tamer'), selectedTamerIds, participantOptions: ref([{ value: 'sora' }]),
    recordRefreshQueue: { run: work => work() }, digimonRosterError: ref(null), tamerRosterError: ref(null), evolutionLoadError: ref(null),
    fetchEvolutionLines: async (...args) => { calls.push(['lines', ...args]); await gate },
    fetchDigimon: async (...args) => { calls.push(['digimon', ...args]); await gate },
    fetchTamers: async (...args) => { calls.push(['tamers', ...args]); await gate },
    syncCurrentPartnerForms: async () => calls.push(['missing']), requestErrorMessage,
  })
  const first = refreshParticipantRoster()
  await refreshParticipantRoster()
  assert.equal(loading.value, true)
  assert.equal(calls.length, 3, 'refreshes overlap; repeat clicks do not duplicate them')
  release(); await first
  assert.deepEqual(calls, [['lines', undefined, campaign], ['digimon', { campaignId: campaign, pageSize: 500 }], ['tamers', campaign], ['missing']])
  assert.equal(loading.value, false)
  assert.equal(error.value, '')
  assert.deepEqual(selectedTamerIds.value, ['sora'], 'refresh clears choices removed from the latest roster')
})
