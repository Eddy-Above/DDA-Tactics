import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, reactive, ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const page = 'pages/campaigns/[campaignId]/encounters/[id].vue'
const canvas = 'components/MapCanvas.vue'
const { withRadialActionCosts } = loadTypeScript('utils/radialActionCosts.ts')
const modeChange = loadTypeScript('utils/modeChange.ts')
const orders = loadTypeScript('utils/specialOrders.ts')
const skills = loadTypeScript('utils/skillOrders.ts')
const { chebyshev } = loadTypeScript('utils/pathfinding.ts')

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
  const { outputText } = ts.transpileModule(`const result = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  return new Function(...Object.keys(deps), `${outputText}; return result`)(...Object.values(deps))
}

function characters() {
  const make = (id, type, entityId = id) => ({ id, type, entityId, actionsRemaining: { simple: 2 }, activeEffects: [], currentStance: 'neutral' })
  return [make('tamer', 'tamer', 'owner'), make('partner', 'digimon'), make('second-partner', 'digimon'),
    make('other-tamer', 'tamer', 'other-owner'), make('other-partner', 'digimon'), { ...make('npc', 'digimon'), isEnemy: true }]
}

function canvasFixture(isDm = true) {
  const props = reactive({ isDm, combatActive: true, activeParticipantId: 'tamer', myParticipantIds: ['other-tamer', 'other-partner'],
    participants: characters(), tamerMap: {}, eddySoulRules: {},
    digimonMap: { partner: { partnerId: 'owner', qualities: [{ id: 'mode-change', ranks: 1 }] },
      'second-partner': { partnerId: 'owner' }, 'other-partner': { partnerId: 'other-owner' }, npc: {} },
    participantPositions: { tamer: { x: 0, y: 0, z: 0 }, partner: { x: 1, y: 0, z: 0 },
      'second-partner': { x: 2, y: 0, z: 0 }, 'other-tamer': { x: 3, y: 0, z: 0 }, 'other-partner': { x: 4, y: 0, z: 0 }, npc: { x: 5, y: 0, z: 0 } },
    radialOptions: { tamer: { attacks: [], stances: [], direct: [{ id: 'direct', label: 'Direct' }],
      'special-order': [{ id: 'special:Fateful Intervention', label: 'Fateful Intervention', cost: '7 Inspiration' }] },
      partner: { attacks: [{ id: 'claw', label: 'Claw' }], stances: [], digivolve: [{ id: '1', label: 'Evolve' }],
        'mode-change': [{ id: 'accuracy:damage', label: 'Swap' }] } },
  })
  const deps = { props, computed, withRadialActionCosts, events: [] }
  for (const name of ['npcRadialId', 'playerRadialId', 'gmRadialId', 'npcRadialScreen', 'playerRadialScreen', 'gmRadialScreen',
    'participantChoice', 'participantChoiceScreen', 'clickedHealthBar']) deps[name] = ref(null)
  Object.assign(deps, { highlightDoor: () => {}, setHoveredTarget: () => {}, updateRadialScreen: () => {},
    worldToScreen2D: () => ({ x: 0, y: 0 }), participantDisplayNames: ref({}),
    tryReticuleTarget: () => false, npcDoorButtons: ref([]), playerDoorButtons: ref([]),
    emit: (...args) => deps.events.push(args),
    radialParticipantId: computed(() => deps.npcRadialId.value ?? deps.playerRadialId.value ?? deps.gmRadialId.value),
  })
  Object.assign(deps, loadPageFunctions(canvas, ['canUseTurnRadial', 'clashRadialButtons', 'radialChoiceGroup'], deps))
  for (const name of ['npcRadialParticipant', 'npcOutOfActions', 'playerRadialParticipantType', 'radialTamerParticipant', 'directDisabled',
    'radialDigimonParticipant', 'radialDigimonPartnerTamer', 'digivolveRange', 'digivolveDisabled', 'radialPlayerOutOfActions',
    'npcClashButtons', 'radialPlayerClashButtons', 'hasModeChangeQuality', 'modeChangeDisabled']) deps[name] = initializer(canvas, name, deps)
  deps.radialItems = initializer(canvas, 'radialItems', deps)
  return Object.assign(deps, loadPageFunctions(canvas, ['selectMapParticipant', 'closeRadial', 'enabledRadialLeaf', 'onRadialSelect',
    'playerRadialAction', 'npcAction', 'gmMove'], deps))
}

test('GM clicks an active Tamer for player actions together with GM controls', () => {
  const h = canvasFixture()
  h.selectMapParticipant('tamer', {})
  assert.equal(h.playerRadialId.value, 'tamer')
  assert.deepEqual(h.radialItems.value.map(item => item.id), ['move', 'direct', 'special-order', 'stance', 'clash', 'gm-move', 'gm-manage'])
  assert.equal(h.radialItems.value.find(item => item.id === 'move').cost, '1 Simple')
  assert.equal(h.radialItems.value.find(item => item.id === 'gm-move').cost, 'Free')
  h.onRadialSelect(h.radialItems.value.find(item => item.id === 'special-order').children[0])
  assert.deepEqual(h.events, [['action-selected', 'tamer', 'special-order', 'special:Fateful Intervention']])
})

test('GM can act for every partner on its Tamer turn, including attack, evolution and Mode Change', () => {
  const h = canvasFixture()
  for (const id of ['partner', 'second-partner']) {
    h.selectMapParticipant(id, {})
    assert.equal(h.playerRadialId.value, id)
    assert.ok(h.radialItems.value.some(item => item.id === 'attack'))
    assert.ok(h.radialItems.value.some(item => item.id === 'gm-move'))
  }
  h.selectMapParticipant('partner', {})
  assert.equal(h.radialItems.value.find(item => item.id === 'digivolve').disabled, false)
  assert.ok(h.radialItems.value.find(item => item.id === 'mode-change').children.length)
  h.onRadialSelect(h.radialItems.value.find(item => item.id === 'move'))
  assert.deepEqual(h.events, [['player-action', 'partner', 'move']])
})

test('off-turn, setup and ended tokens expose only GM controls; stale turn actions cannot dispatch', () => {
  const h = canvasFixture()
  for (const id of ['other-tamer', 'other-partner', 'npc']) {
    h.selectMapParticipant(id, {})
    assert.deepEqual(h.radialItems.value.map(item => item.id), ['gm-move', 'gm-manage'])
  }
  h.selectMapParticipant('partner', {})
  const stale = h.radialItems.value.find(item => item.id === 'move')
  h.props.activeParticipantId = 'other-tamer'
  h.onRadialSelect(stale)
  assert.deepEqual(h.events, [])
  h.props.activeParticipantId = 'tamer'
  h.props.combatActive = false
  h.selectMapParticipant('tamer', {})
  assert.deepEqual(h.radialItems.value.map(item => item.id), ['gm-move', 'gm-manage'])
  h.props.participants[0].inReserve = true
  h.closeRadial()
  h.selectMapParticipant('tamer', {})
  assert.equal(h.radialParticipantId.value, null)
})

test('GM controls remain usable when normal actions are exhausted or a character is controlled in a clash', () => {
  const h = canvasFixture()
  h.props.participants[1].actionsRemaining.simple = 0
  h.selectMapParticipant('partner', {})
  assert.equal(h.radialItems.value.find(item => item.id === 'attack').disabled, true)
  h.props.participants[1].clash = { isController: false }
  assert.deepEqual(h.radialItems.value.map(item => item.id), ['controlled', 'digivolve', 'gm-move', 'gm-manage'])
  h.onRadialSelect(h.radialItems.value.find(item => item.id === 'gm-move'))
  assert.deepEqual(h.events, [['gm-move', 'partner']])
})

test('NPC actions and player ownership remain separate from GM player control', () => {
  const gm = canvasFixture()
  gm.props.activeParticipantId = 'npc'
  gm.selectMapParticipant('npc', {})
  assert.equal(gm.npcRadialId.value, 'npc')
  gm.onRadialSelect(gm.radialItems.value.find(item => item.id === 'move'))
  assert.deepEqual(gm.events, [['npc-action', 'npc', 'move']])
  const player = canvasFixture(false)
  player.selectMapParticipant('partner', {})
  assert.equal(player.radialParticipantId.value, null)
  assert.deepEqual(player.events, [])
})

function pageFixture() {
  const encounter = ref({ id: 'encounter', phase: 'combat', round: 1, currentTurnIndex: 0, turnOrder: ['tamer', 'other-tamer', 'npc'],
    participants: characters(), participantPositions: { tamer: { x: 0, y: 0, z: 0 }, partner: { x: 3, y: 0, z: 0 },
      'second-partner': { x: 12, y: 0, z: 0 }, 'other-partner': { x: 30, y: 0, z: 0 } } })
  const calls = []
  const specialOrders = [{ name: 'Fateful Intervention', type: 'Passive', effect: 'Choose dice' }, { name: 'Swagger', type: 'Simple Action', effect: 'Taunt' },
    { name: 'Passive order', type: 'Passive', effect: 'Always on' }]
  const skillOrders = [{ name: 'Bravado', type: 'Complex Action', effect: 'A skill order' }]
  const deps = { computed, chebyshev, ...modeChange, ...orders, ...skills,
    currentEncounter: encounter, eddySoulRules: ref({}), campaignLevel: ref('standard'),
    tamers: ref([{ id: 'owner', usedPerDayOrders: [], usedPerDaySkillOrders: [] }]),
    digimonMap: ref(new Map([['partner', { id: 'partner', partnerId: 'owner', qualities: [{ id: 'mode-change', ranks: 1, choiceId: 'accuracy-damage' }] }],
      ['second-partner', { id: 'second-partner', partnerId: 'owner' }], ['other-partner', { id: 'other-partner', partnerId: 'other-owner' }]])),
    radialAttackDraft: ref(null), mapDirectMode: ref(null), selectedAttack: ref(null),
    npcAttackParticipantId: ref(null), npcStanceParticipantId: ref(null),
    activeParticipant: computed(() => encounter.value.participants.find(p => p.id === 'other-tamer')),
    showDirectTargetSelector: ref(false), pendingDirectBolstered: ref(false),
    getParticipantAttacks: () => [], radialAttackItem: () => {},
    getParticipantEvolutionOptions: () => ({ evolveTargets: [{ chainIndex: 1, species: 'Champion' }], canDevolve: false }),
    getMapAttackContext: () => ({}), getTamerSpecialOrders: () => specialOrders, getTamerSkillOrders: () => skillOrders,
    specialOrderTargets: { busy: ref(false), open: (...args) => calls.push(['order-targets', ...args]) },
    gmFatefulTamer: ref(null), gmFateful: { open: () => calls.push(['fateful']) },
    INSPIRATION_FATEFUL_COST: { standard: 7 },
    handleDigivolve: (...args) => calls.push(['evolve', ...args]),
    handleModeChangeSwap: (...args) => calls.push(['swap', ...args]),
    showSpecialOrdersModal: ref(false),
    openClashTargetSelector: (...args) => calls.push(['clash', ...args]),
    startClashAttack: (...args) => calls.push(['clash-attack', ...args]),
    executeClashAction: (...args) => calls.push(['clash-action', ...args]),
    handleThrowClick: (...args) => calls.push(['throw', ...args]),
    handleClashCheck: (...args) => calls.push(['clash-check', ...args]),
    $fetch: async (...args) => { calls.push(['fetch', ...args]); return encounter.value },
    applyActionResult: async (...args) => calls.push(['result', ...args]),
    console, alert: message => { throw new Error(message) },
  }
  encounter.value.participants[0].currentInspiration = 7
  encounter.value.participants[1].evolutionLineId = 'line'
  Object.assign(deps, loadPageFunctions(page, ['canParticipantAct', 'canMapDirect', 'getMapAttackTamer', 'canUseGmSpecialOrder', 'isPassiveSkillOrder', 'canUseGmSkillOrder'], deps))
  deps.directRanges = initializer(page, 'directRanges', deps)
  deps.directMapTargetIds = initializer(page, 'directMapTargetIds', deps)
  deps.mapRadialOptions = initializer(page, 'mapRadialOptions', deps)
  return Object.assign(deps, { calls, specialOrders, skillOrders }, loadPageFunctions(page, ['onMapActionSelected', 'onMapTargetSelected',
    'confirmDirect', 'handleUseSpecialOrder', 'handleUseSkillOrder', 'onNpcAction', 'onMapPlayerAction'], deps))
}

test('GM Direct uses the clicked Tamer, normal range, budget and once-per-turn eligibility', async () => {
  const h = pageFixture()
  h.onMapActionSelected('tamer', 'direct', 'bolster')
  assert.deepEqual(h.mapDirectMode.value, { participantId: 'tamer', bolstered: true })
  assert.deepEqual(h.directMapTargetIds.value, ['partner'])
  h.onMapTargetSelected('other-partner')
  assert.deepEqual(h.calls, [])
  await h.onMapTargetSelected('partner')
  assert.deepEqual(h.calls[0], ['fetch', '/api/encounters/encounter/actions/direct', { method: 'POST', body: { participantId: 'tamer', targetDigimonId: 'partner', bolstered: true } }])
  assert.equal(h.mapDirectMode.value, null)
  h.currentEncounter.value.participants[0].actionsRemaining.simple = 1
  h.onMapActionSelected('tamer', 'direct', 'bolster')
  assert.equal(h.mapDirectMode.value, null)
  h.onMapActionSelected('tamer', 'direct', 'direct')
  assert.deepEqual(h.directMapTargetIds.value, ['partner', 'second-partner'])
  h.currentEncounter.value.participants[0].hasDirectedThisTurn = true
  assert.deepEqual(h.directMapTargetIds.value, [])
  await h.onMapTargetSelected('partner')
  assert.equal(h.calls.filter(call => call[0] === 'fetch').length, 1)
})

test('GM Orders include costs, use the selected Tamer for Fateful, and route target and skill orders', async () => {
  const h = pageFixture()
  const choices = h.mapRadialOptions.value.tamer['special-order']
  assert.equal(choices.find(choice => choice.label === 'Fateful Intervention').cost, '7 Inspiration')
  assert.equal(choices.find(choice => choice.label === 'Passive order').disabled, true)
  h.onMapActionSelected('tamer', 'special-order', 'special:Fateful Intervention')
  assert.equal(h.gmFatefulTamer.value.id, 'tamer')
  assert.deepEqual(h.calls.pop(), ['fateful'])
  h.onMapActionSelected('tamer', 'special-order', 'special:Swagger')
  assert.deepEqual(h.calls.pop(), ['order-targets', h.currentEncounter.value.participants[0], 'Swagger'])
  await h.onMapActionSelected('tamer', 'special-order', 'skill:Bravado')
  assert.deepEqual(h.calls.shift(), ['fetch', '/api/encounters/encounter/actions/skill-order', { method: 'POST', body: { participantId: 'tamer', orderName: 'Bravado' } }])
  assert.equal(h.calls.shift()[0], 'result')
  h.currentEncounter.value.currentTurnIndex = 1
  h.onMapActionSelected('tamer', 'special-order', 'special:Fateful Intervention')
  h.onMapActionSelected('tamer', 'direct', 'direct')
  assert.deepEqual(h.calls, [])
})

test('GM player-action events reach the selected partner clash handler and reject off-turn or reserve actors', () => {
  const h = pageFixture()
  h.onMapPlayerAction('partner', 'clash')
  h.onMapPlayerAction('partner', 'clash-attack')
  h.onMapPlayerAction('partner', 'clash-pin')
  h.onMapPlayerAction('partner', 'clash-check')
  assert.deepEqual(h.calls, [['clash', 'partner'], ['clash-attack', 'partner'], ['clash-action', 'partner', 'pin'], ['clash-check', 'partner']])
  h.calls.length = 0
  h.currentEncounter.value.currentTurnIndex = 1
  h.onMapPlayerAction('partner', 'clash')
  h.currentEncounter.value.currentTurnIndex = 0
  h.currentEncounter.value.participants[1].inReserve = true
  h.onMapPlayerAction('partner', 'clash')
  assert.deepEqual(h.calls, [])
})

test('GM partner evolution checks the Tamer budget and preserves normal Mode Change choices', () => {
  const h = pageFixture()
  const partner = h.currentEncounter.value.participants[1]
  partner.actionsRemaining.simple = 0
  assert.equal(h.mapRadialOptions.value.partner.digivolve[0].disabled, false)
  h.onMapActionSelected('partner', 'digivolve', '1')
  assert.deepEqual(h.calls.pop(), ['evolve', partner, 1])
  partner.actionsRemaining.simple = 1
  const pair = h.mapRadialOptions.value.partner['mode-change'][0]
  assert.ok(pair)
  h.onMapActionSelected('partner', 'mode-change', pair.id)
  assert.equal(h.calls.pop()[0], 'swap')
  h.currentEncounter.value.participants[0].actionsRemaining.simple = 0
  assert.equal(h.mapRadialOptions.value.partner.digivolve[0].disabled, true)
  h.onMapActionSelected('partner', 'digivolve', '1')
  h.currentEncounter.value.phase = 'ended'
  h.onMapActionSelected('partner', 'mode-change', pair.id)
  assert.deepEqual(h.calls, [])
})

test('GM player movement uses the paid Move endpoint, while GM Move remains free', () => {
  const calls = [], messages = []
  const deps = { props: { encounter: { id: 'encounter' } }, positions: ref({}),
    throwAimContext: ref(null), throwAllyAimContext: ref(null), chargeMoveParticipantId: ref(null),
    npcMoveParticipantId: ref('partner'), gmMoveParticipantId: ref('partner'),
    movement: { clearMovement: () => {} }, movePathTo: (_id, _pos, path) => path, moveDistance: () => 3,
    openDoorsAlong: () => {}, ws: { send: message => messages.push(message) },
    $fetch: (...args) => { calls.push(args); return Promise.resolve({ success: true }) }, console,
  }
  const handlers = loadPageFunctions('components/EncounterMap.vue', ['onCombatMove', 'postMove', 'onGmMove'], deps)
  handlers.onCombatMove('partner', { x: 3, y: 0, z: 0 }, [])
  assert.deepEqual(calls[0], ['/api/encounters/encounter/actions/move', { method: 'POST', body: { participantId: 'partner', distance: 3 } }])
  handlers.onGmMove('partner', { x: 300, y: 20, z: 0 })
  assert.equal(calls.length, 1)
  assert.equal(messages.length, 2)
})

test('GM map removes the floating Fateful payer control and connects player actions and Direct targets', () => {
  const source = readFileSync(new URL(`../${page}`, import.meta.url), 'utf8')
  const { descriptor } = parse(source)
  const map = descriptor.template.content.slice(descriptor.template.content.indexOf('<EncounterMap'), descriptor.template.content.indexOf('</EncounterMap>'))
  assert.match(map, /@player-action="onMapPlayerAction"/)
  assert.match(map, /:selectable-participant-ids="directMapTargetIds"/)
  assert.doesNotMatch(source, /gmFatefulAvailableTamers|Tamer using Fateful Intervention/)
  assert.match(descriptor.template.content, /<FatefulInterventionDialog/)
})
