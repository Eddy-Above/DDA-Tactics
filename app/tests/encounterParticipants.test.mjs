import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'
const { encounterPartnerForms, currentPartnerFormIds } = loadTypeScript('utils/encounterPartnerForms.ts')
const { requestErrorMessage } = loadTypeScript('utils/requestError.ts')
const page = 'pages/campaigns/[campaignId]/encounters/[id].vue'

test('current partner forms appear through line association even without a direct Tamer link', () => {
  const forms = [{ id: 'rookie', partnerId: 'sora' }, { id: 'champion', partnerId: null },
    { id: 'standalone', partnerId: 'tai' }, { id: 'npc', partnerId: null, isEnemy: true }]
  const lines = [{ partnerId: 'sora', currentStageIndex: 1, chain: [{ digimonId: 'rookie' }, { digimonId: 'champion' }] }]
  assert.deepEqual(encounterPartnerForms(forms, lines).map(form => form.id), ['champion', 'standalone'])
  assert.deepEqual(currentPartnerFormIds(lines), ['champion'])
  assert.deepEqual(encounterPartnerForms(forms, [{ ...lines[0], chain: JSON.stringify(lines[0].chain) }]), encounterPartnerForms(forms, lines))
})

test('missing or malformed line metadata does not blank unrelated partner forms', () => {
  const forms = [{ id: 'partner', partnerId: 'sora' }, { id: 'enemy', partnerId: null, isEnemy: true }]
  const lines = [{ partnerId: 'sora', chain: 'bad JSON' }, { partnerId: 'sora', chain: [] },
    { partnerId: null, currentStageIndex: 0, chain: [{ digimonId: 'enemy' }] }]
  assert.deepEqual(encounterPartnerForms(forms, lines).map(form => form.id), ['partner'])
})

test('current forms outside the initial roster page are fetched by ID and merged without discarding other records', async () => {
  const digimonList = ref([{ id: 'existing' }]), calls = []
  const evolutionLines = ref([{ partnerId: 'sora', currentStageIndex: 0, chain: [{ digimonId: 'missing-current' }] }])
  const { syncCurrentPartnerForms } = loadPageFunctions(page, ['syncCurrentPartnerForms'], {
    digimonList, evolutionLines, currentPartnerFormIds,
    mergeRecordsById: loadTypeScript('utils/combatRecords.ts').mergeRecordsById,
    $fetch: async (url, options) => { calls.push({ url, options }); return { data: [{ id: 'missing-current' }] } },
  })
  await syncCurrentPartnerForms()
  assert.deepEqual(calls, [{ url: '/api/digimon', options: { query: { ids: 'missing-current' } } }])
  assert.deepEqual(digimonList.value.map(form => form.id), ['existing', 'missing-current'])
  await syncCurrentPartnerForms()
  assert.equal(calls.length, 1)
})

function addFixture({ failAt = 0, reserve = false } = {}) {
  const selectedTamerIds = ref(['sora', 'tai']), currentEncounter = ref({ id: 'encounter', participants: [] })
  const added = [], addingParticipants = ref(false), participantAddError = ref(''), showAddParticipant = ref(true)
  const deps = { selectedTamerIds, currentEncounter, addingParticipants, participantAddError, showAddParticipant,
    participantRosterLoading: ref(false), selectedEntityType: ref('tamer'), selectedEntityId: ref(''), selectedNpcEvoLineId: ref(''), addQuantity: ref(1), addToReserve: ref(reserve),
    tamers: ref([{ id: 'sora', name: 'Sora', currentWounds: 2, inspiration: 1, grantedInspiration: 2, xpBonuses: { inspiration: 1 } },
      { id: 'tai', name: 'Tai', currentWounds: 0, inspiration: 3 }]),
    calcTamerStats: tamer => ({ woundBoxes: tamer.id === 'sora' ? 8 : 6 }), eddySoulRules: ref({}), digimonMap: ref(new Map()), error: ref(null), requestErrorMessage,
    createParticipant: (type, entityId, initiative, initiativeRoll, maxWounds, _line, _enemy, currentWounds, _health, inspiration) =>
      ({ type, entityId, initiative, initiativeRoll, maxWounds, currentWounds, inspiration }),
    addParticipant: async (_id, participant) => {
      if (failAt === added.length + 1) { failAt = 0; return null }
      added.push(participant)
      currentEncounter.value.participants.push(participant)
      return currentEncounter.value
    },
  }
  return { ...deps, added, ...loadPageFunctions(page, ['handleAddParticipant'], deps) }
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
})

test('a partial multi-add retains only unsaved Tamers for retry and cannot duplicate successful additions', async () => {
  const f = addFixture({ failAt: 2 })
  await f.handleAddParticipant()
  assert.deepEqual(f.added.map(p => p.entityId), ['sora'])
  assert.deepEqual(f.selectedTamerIds.value, ['tai'])
  assert.equal(f.showAddParticipant.value, true)
  assert.match(f.participantAddError.value, /Tai/)
  await f.handleAddParticipant()
  assert.deepEqual(f.added.map(p => p.entityId), ['sora', 'tai'])
})
