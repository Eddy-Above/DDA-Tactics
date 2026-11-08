import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const page = 'pages/campaigns/[campaignId]/encounters/[id].vue'
const { buildCombatEvolutionOptions } = loadTypeScript('utils/combatEvolutionOptions.ts')
const { withRadialActionCosts } = loadTypeScript('utils/radialActionCosts.ts')

function initializer(path, name, deps) {
  const { descriptor } = parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
  const source = ts.createSourceFile(path, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let expression
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Missing ${name}`)
  const { outputText } = ts.transpileModule(`const result = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  return new Function(...Object.keys(deps), `${outputText}; return result`)(...Object.values(deps))
}

function fixture() {
  const encounter = ref({ id: 'encounter', phase: 'combat', currentTurnIndex: 0, turnOrder: ['npc'], participants: [
    { id: 'npc', entityId: 'rookie', type: 'digimon', isEnemy: true, evolutionLineId: 'line', npcStageIndex: 0, actionsRemaining: { simple: 2 } },
  ] })
  const participant = encounter.value.participants[0]
  const calls = [], applied = []
  const deps = { computed, currentEncounter: encounter, digimonMap: ref(new Map([
    ['rookie', { id: 'rookie', name: 'Rookie', isEnemy: true }], ['champion', { id: 'champion', isEnemy: true }],
  ])), tamerMap: ref(new Map()), evolutionLines: ref([{ id: 'line', currentStageIndex: 0, chain: [
    { digimonId: 'rookie', species: 'Rookie', evolvesFromIndex: null, isUnlocked: true },
    { digimonId: 'champion', species: 'Champion', evolvesFromIndex: 0, isUnlocked: true },
    { digimonId: 'locked', species: 'Locked form', evolvesFromIndex: 0, isUnlocked: false },
  ] }]), buildCombatEvolutionOptions, eddySoulRules: ref({}), campaignLevel: ref('standard'), DIGIVOLVE_WILLPOWER_DC: { standard: 12 },
    getParticipantAttacks: () => [], canUseAttack: () => true, attackRadialItem: () => {},
    $fetch: async (url, options) => { calls.push({ url, ...options }); return { id: 'updated' } },
    applyActionResult: async (...args) => applied.push(args),
    openWillpower: () => { throw new Error('An NPC must not need a Tamer Willpower roll') },
    console: { error: () => {} }, alert: error => { throw new Error(error) },
  }
  const handlers = loadPageFunctions(page, ['canParticipantAct', 'getParticipantEvolutionOptions',
    'getTamerForDigimonParticipant', 'handleDigivolve', 'onMapActionSelected'], deps)
  Object.assign(deps, handlers)
  const options = initializer(page, 'mapRadialOptions', deps)
  deps.mapRadialOptions = options
  // Rebind the action handler to the live options computed.
  const actions = loadPageFunctions(page, ['onMapActionSelected'], deps)
  const props = { isDm: true, participants: encounter.value.participants, get radialOptions() { return options.value } }
  const radialParticipantId = ref('npc')
  const radialDeps = { props, radialParticipantId, npcRadialId: ref('npc'), gmRadialId: ref(null),
    npcClashButtons: ref(null), npcOutOfActions: computed(() => participant.actionsRemaining.simple < 1), npcDoorButtons: ref([]),
    computed, withRadialActionCosts }
  Object.assign(radialDeps, loadPageFunctions('components/MapCanvas.vue', ['radialChoiceGroup'], radialDeps))
  const radialItems = initializer('components/MapCanvas.vue', 'radialItems', radialDeps)
  return { encounter, participant, calls, applied, options, radialItems, ...actions }
}

test('an NPC with an assigned evolution line gets unlocked Digivolve choices in the GM map radial', async () => {
  const f = fixture()
  const menu = f.radialItems.value.find(item => item.id === 'digivolve')
  assert.ok(menu)
  assert.deepEqual(menu.children.map(item => item.id), ['digivolve:1'])
  assert.equal(menu.children[0].label, 'Digivolve → Champion')
  await f.onMapActionSelected('npc', 'digivolve', '1')
  assert.deepEqual(f.calls[0].body, { participantId: 'npc', targetChainIndex: 1 })
  assert.equal(f.calls[0].body.force, undefined)
  assert.equal(f.applied[0][1], 'digivolve')
})

test('NPC evolution rejects stale, locked, off-turn, exhausted and already-attempted map choices', async () => {
  const f = fixture()
  await f.onMapActionSelected('removed', 'digivolve', '1')
  await f.onMapActionSelected('npc', 'digivolve', '2')
  f.participant.actionsRemaining.simple = 0
  await f.onMapActionSelected('npc', 'digivolve', '1')
  assert.equal(f.radialItems.value.find(item => item.id === 'digivolve').disabled, true)
  f.participant.actionsRemaining.simple = 2
  f.participant.hasAttemptedDigivolve = true
  await f.onMapActionSelected('npc', 'digivolve', '1')
  f.participant.hasAttemptedDigivolve = false
  f.encounter.value.turnOrder = ['someone-else']
  await f.onMapActionSelected('npc', 'digivolve', '1')
  f.encounter.value.turnOrder = ['npc']
  f.encounter.value.phase = 'initiative'
  await f.onMapActionSelected('npc', 'digivolve', '1')
  assert.deepEqual(f.calls, [])
})

test('an NPC without an assigned line has no map Digivolve entry', () => {
  const f = fixture()
  f.participant.evolutionLineId = undefined
  assert.equal(f.radialItems.value.some(item => item.id === 'digivolve'), false)
})

test('NPC devolution uses its local stage and stays available after an evolution attempt', async () => {
  const f = fixture()
  Object.assign(f.participant, { entityId: 'champion', npcStageIndex: 1, woundsHistory: [{}], hasAttemptedDigivolve: true })
  const choices = f.options.value.npc.digivolve
  assert.deepEqual(choices.map(choice => [choice.id, choice.disabled]), [['0', false]])
  await f.onMapActionSelected('npc', 'digivolve', '0')
  assert.deepEqual(f.calls[0].body, { participantId: 'npc', targetChainIndex: 0 })
})
