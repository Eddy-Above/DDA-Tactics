import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from 'vue'
import { loadTypeScript, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const { planEvolutionLineSync, getEvolutionBaseIndex, isPersistentEvolutionForm } = loadTypeScript('utils/evolutionLineTree.ts')
const form = (id, parent = null, paths = [], extra = {}) => ({ id, name: id, stage: 'champion', partnerId: 'tai', evolvesFromId: parent, evolutionPathIds: paths, ...extra })
const entry = (id, parent, extra = {}) => ({ digimonId: id, species: id, stage: 'champion', isUnlocked: true, evolvesFromIndex: parent, ...extra })
const line = chain => ({ id: 'line', chain, currentStageIndex: 1, name: 'Custom line' })

test('linking previously unlisted Digimon creates one branched tree, including backward-only links', () => {
  const forms = [form('root', null, ['left']), form('left', 'root'), form('right', 'root'), form('unrelated')]
  const plans = planEvolutionLineSync(forms, [], ['left', 'root'])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].existing, undefined)
  assert.deepEqual(plans[0].chain.map(e => [e.digimonId, e.evolvesFromIndex, e.isUnlocked]), [['root', null, true], ['left', 0, false], ['right', 0, false]])
  assert.deepEqual(planEvolutionLineSync(forms, [], ['unrelated']), [])
})

test('inserting a branch preserves unlocks, chosen base and current form by ID without another line', () => {
  const existing = line([entry('root', null), entry('right', 0, { isBaseForm: true })])
  const forms = [form('root', null, ['left', 'right']), form('left', 'root'), form('right', 'root')]
  const [plan] = planEvolutionLineSync(forms, [existing], ['left'])
  assert.equal(plan.existing.id, 'line')
  assert.equal(plan.chain[plan.currentStageIndex].digimonId, 'right')
  assert.equal(plan.currentStageIndex, 2)
  assert.equal(plan.chain.find(e => e.digimonId === 'left').isUnlocked, false)
  assert.equal(plan.chain[getEvolutionBaseIndex(plan.chain)].digimonId, 'right')
})

test('detaching a linked subtree refreshes its old line and creates a line for the detached family', () => {
  const existing = line([entry('root', null), entry('child', 0), entry('grandchild', 1)])
  const plans = planEvolutionLineSync([form('root'), form('child', null, ['grandchild']), form('grandchild', 'child')], [existing], ['root', 'child'])
  assert.equal(plans.length, 2)
  assert.deepEqual(plans.find(p => p.existing)?.chain.map(e => e.digimonId), ['root'])
  assert.deepEqual(plans.find(p => !p.existing)?.chain.map(e => e.digimonId), ['child', 'grandchild'])
})

test('cycles terminate and stale forward links cannot undo explicit reparenting', () => {
  const plans = planEvolutionLineSync([form('a', 'b', ['b']), form('b', 'a', ['a']), form('old', null, ['a'])], [], ['a'])
  assert.equal(plans.length, 1)
  assert.equal(plans[0].chain.length, 2)
  assert.equal(plans[0].chain[0].evolvesFromIndex, null)
  assert.equal(plans[0].chain[1].evolvesFromIndex, 0)
})

test('base selection uses a marked unlocked form and supports legacy JSON and defaults', () => {
  const chain = [entry('baby', null, { stage: 'fresh' }), entry('rookie', 0, { stage: 'rookie' }), entry('champion', 1, { isBaseForm: true })]
  assert.equal(getEvolutionBaseIndex(JSON.stringify(chain)), 2)
  chain[2].isUnlocked = false
  assert.equal(getEvolutionBaseIndex(chain), 1)
  assert.equal(getEvolutionBaseIndex([entry('other', null)]), 0)
  chain[2].isUnlocked = true
  assert.equal(isPersistentEvolutionForm({ id: 'champion', stage: 'champion' }, { chain }), true)
  assert.equal(isPersistentEvolutionForm({ id: 'other', stage: 'champion' }, { chain }), false)
  assert.equal(isPersistentEvolutionForm({ id: 'champion', stage: 'champion', isEnemy: true }, { chain }), false)
})

test('both end-combat paths and recovery requests target the selected non-Rookie base', async () => {
  for (const recovery of [false, true]) {
    const stored = line([entry('root', null, { stage: 'rookie' }), entry('base', 0, { isBaseForm: true }), entry('mega', 1)])
    stored.currentStageIndex = 2
    const updates = [], requests = []
    const currentEncounter = ref({ id: 'encounter', round: 2, participants: [
      { id: 'tamer', entityId: 'tai', type: 'tamer' },
      { id: 'partner', entityId: 'mega', type: 'digimon', evolutionLineId: 'line' },
    ] })
    const handlers = loadPageFunctions('pages/campaigns/[campaignId]/encounters/[id].vue', ['executeEndCombatSequence', 'handleRequestRecoveryChecks'], {
      currentEncounter, evolutionLines: ref([stored]), campaignId: ref('campaign'), getEvolutionBaseIndex, isPersistentEvolutionForm,
      showEndCombatModal: ref(true), recordRefreshQueue: { run: fn => fn() }, fetchEvolutionLines: async () => {},
      updateEvolutionLine: async (id, body) => { updates.push(body); Object.assign(stored, body) },
      endCombat: async () => {}, addBattleLogEntry: async () => {}, $fetch: async () => {},
      digimonMap: ref(new Map([['mega', { id: 'mega', partnerId: 'tai', stage: 'mega' }]])),
      createRequest: async (...args) => requests.push(args),
    })
    await (recovery ? handlers.handleRequestRecoveryChecks() : handlers.executeEndCombatSequence())
    assert.deepEqual(updates, [{ currentStageIndex: 1 }])
    if (recovery) assert.equal(requests[0][4].rookieDigimonId, 'base')
  }
})
