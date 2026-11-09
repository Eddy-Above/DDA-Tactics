import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadTypeScript, loadTypeScriptWithMocks, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const naturewalk = loadTypeScript('utils/naturewalk.ts')
const { STAGE_CONFIG } = loadTypeScript('types/index.ts')
const { applyStanceToMovement } = loadTypeScript('utils/stanceModifiers.ts')
const { getAllStatEffectModifier } = loadTypeScript('data/attackConstants.ts')
const { useDigimon } = loadTypeScript('composables/useDigimon.ts')
const point = x => ({ x, y: 0, z: 0 })
const map = { groundTiles: [point(0)], spaceTiles: [], voxels: [
  { ...point(1), materialId: 'soft-metal' }, { ...point(2), materialId: 'steel' },
], walls: [], doors: [], stairs: [], ceilings: [] }
const digger = [{ id: 'extra-movement', choiceId: 'digger' }, { id: 'advanced-mobility', choiceId: 'adv-digger' }]
const chosen = element => ({ id: 'naturewalk', choiceId: element, ranks: 1 })
const cost = caps => rules.getMovementCostProfile(caps, 6).stepCost(point(0), point(1), map)
const settingsHazard = settings => [{ id: naturewalk.NATUREWALK_ENVIRONMENT_ID, naturewalkEnvironment: settings }]

test('GM Naturewalk environments add difficult-terrain immunity, and disabling map terrain removes automatic immunity', () => {
  const automatic = rules.detectCapabilities([...digger, chosen('steel')], 6, 0, 0)
  assert.equal(cost(automatic), 1)
  assert.equal(cost({ ...automatic, naturewalkEnvironment: { elements: [], useMapTerrain: false } }), 2)
  const forest = rules.detectCapabilities([...digger, chosen('wood')], 6, 0, 0)
  assert.equal(cost(forest), 2)
  assert.equal(cost({ ...forest, naturewalkEnvironment: { elements: ['wood'], useMapTerrain: false } }), 1)
  const noDigger = { ...rules.detectCapabilities([chosen('wood')], 6, 0, 0), naturewalkEnvironment: { elements: ['wood'], useMapTerrain: false } }
  assert.equal(cost(noDigger), Infinity)
  const profile = rules.getMovementCostProfile({ ...forest, naturewalkEnvironment: { elements: ['wood'], useMapTerrain: false } }, 6)
  assert.equal(profile.stepCost(point(1), point(2), map), Infinity, 'GM environment benefits never permit digging through Steel')
})

test('server movement profiles carry the GM environment into shared terrain costs', () => {
  const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', {
    'drizzle-orm': {}, '../db': {}, './combatRecordCache': {}, './resolveSupportAttack': {},
  })
  const record = { id: 'mon', stage: 'rookie', size: 'medium',
    baseStats: { accuracy: 6, damage: 6, dodge: 6, armor: 6, health: 6 }, qualities: [...digger, chosen('wood')] }
  const environment = { elements: ['wood'], useMapTerrain: false }
  const { caps } = spatial.getMovementProfile({ type: 'digimon', entityId: 'mon' }, new Map([['mon', record]]), new Map(), environment)
  assert.deepEqual(caps.naturewalkEnvironment, environment)
  assert.equal(cost(caps), 1)
})

test('map preview carries the same encounter environment into shared terrain costs', () => {
  const participant = { id: 'unit', entityId: 'mon', type: 'digimon', activeEffects: [], currentStance: 'neutral' }
  const environment = { elements: ['wood'], useMapTerrain: false }
  const context = {
    props: { encounter: { participants: [participant], hazards: settingsHazard(environment) } },
    positions: ref({ unit: point(0) }), map: ref(map),
    digimonMapForCanvas: ref({ mon: { stage: 'rookie', size: 'medium', movement: 6, baseMovement: 6, ram: 0, cpu: 0, qualities: [...digger, chosen('wood')] } }),
    tamerMapForCanvas: ref({}), movement: rules, STAGE_CONFIG, applyStanceToMovement, getAllStatEffectModifier, ...naturewalk,
  }
  const { caps } = loadPageFunctions('components/EncounterMap.vue', ['npcMoveCaps'], context).npcMoveCaps('unit')
  assert.deepEqual(caps.naturewalkEnvironment, environment)
  assert.equal(cost(caps), 1)
})

test('Steel movement bonuses apply once and keep client/server walking, swimming and jumping in agreement', () => {
  const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', {
    'drizzle-orm': {}, '../db': {}, './combatRecordCache': {}, './resolveSupportAttack': {},
  })
  const environment = { elements: ['steel'], useMapTerrain: false }
  for (const advanced of [[], [{ id: 'advanced-mobility', choiceId: 'adv-jumper' }],
    [{ id: 'advanced-mobility', choiceId: 'adv-jumper' }, { id: 'advanced-mobility', choiceId: 'adv-wallclimber' }]]) {
    const record = { id: 'mon', stage: 'rookie', size: 'medium',
      baseStats: { accuracy: 12, damage: 12, dodge: 12, armor: 12, health: 12 },
      qualities: [chosen('steel'), { id: 'speedy', ranks: 3 }, ...advanced] }
    const previousRef = globalThis.ref
    globalThis.ref = ref
    let derived
    try { derived = useDigimon().calculateDerivedStats(record) }
    finally {
      if (previousRef === undefined) delete globalThis.ref
      else globalThis.ref = previousRef
    }
    for (const currentStance of ['neutral', 'aggressive', 'defensive']) {
      const participant = { id: 'unit', type: 'digimon', entityId: 'mon', currentStance, activeEffects: [], naturewalkActiveElements: ['steel'] }
      const server = spatial.getMovementProfile(participant, new Map([['mon', record]]), new Map(), environment)
      const inactive = spatial.getMovementProfile({ ...participant, naturewalkActiveElements: [] }, new Map([['mon', record]]), new Map(), environment)
      assert.equal(server.budget - inactive.budget, advanced.length ? 4 : 2, 'Steel is added once after stance and Speedy, and advanced qualities do not stack')
      const context = {
        props: { encounter: { participants: [participant], hazards: settingsHazard(environment) } },
        positions: ref({ unit: point(0) }), map: ref(map),
        digimonMapForCanvas: ref({ mon: { ...record, ...derived } }), tamerMapForCanvas: ref({}),
        movement: rules, STAGE_CONFIG, applyStanceToMovement, getAllStatEffectModifier, ...naturewalk,
      }
      const client = loadPageFunctions('components/EncounterMap.vue', ['npcMoveCaps'], context).npcMoveCaps('unit')
      assert.equal(client.budget, server.budget)
      for (const key of ['movementSpeed', 'swimSpeed', 'jumpHeight', 'jumpRange']) assert.equal(client.caps[key], server.caps[key], `${currentStance}: ${key}`)
    }
  }
})
