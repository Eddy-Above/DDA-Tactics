import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, reactive } from 'vue'
import { loadTypeScript, loadTypeScriptWithMocks, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const naturewalk = loadTypeScript('utils/naturewalk.ts')
const { getNaturewalkBonuses: bonuses, getNaturewalkTerrainElements, resolveNaturewalkEnvironment } = naturewalk
const { buildLosIndex, losClear } = loadTypeScript('utils/lineOfSight.ts')
const { detectCapabilities, getMovementCostProfile } = loadTypeScript('utils/movementRules.ts')
const { combatAttackStats } = loadTypeScript('utils/combatDice.ts')
const { computeDodgeDefense } = loadTypeScript('utils/areaDefense.ts')
const { getEffectiveDPCost, getMaxRanksAtStage, QUALITY_DATABASE } = loadTypeScript('data/qualities.ts')
const { useDigimonDP } = loadTypeScript('composables/useDigimonDP.ts')
const { createDigimonFormDefaults } = loadTypeScript('utils/formDefaults.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const quality = choiceId => ({ id: 'naturewalk', choiceId, dpCost: 1, ranks: 1 })
const adv = choiceId => ({ id: 'advanced-mobility', choiceId: `adv-${choiceId}` })
const mapOf = values => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [], ...values })

test('Naturewalk conditional bonuses require matching terrain and do not multiply duplicate qualities', () => {
  assert.equal(bonuses([quality('fire')], ['fire']).damageBonus, 2)
  assert.equal(bonuses([quality('fire')], ['water']).damageBonus, 0)
  assert.equal(bonuses([quality('wind')], ['wind']).dodgeBonus, 2)
  assert.equal(bonuses([quality('ice')], ['ice']).armorBonus, 2)
  for (const advanced of [[], [adv('wallclimber')], [adv('jumper')], [adv('wallclimber'), adv('jumper')]]) {
    assert.equal(bonuses([quality('steel'), ...advanced], ['steel']).movementBonus, advanced.length ? 4 : 2)
  }
  assert.equal(bonuses([quality('water'), adv('swimmer')], ['water']).waterTempWounds, 2)
  assert.equal(bonuses([quality('water')], ['water']).waterTempWounds, 0)
  assert.equal(bonuses([quality('darkness')]).canSeeDarkness, true)
  assert.equal(bonuses([quality('fire')]).resistsHeat, true)
  assert.equal(bonuses([quality('ice')]).resistsCold, true)
  assert.equal(bonuses([quality('water')]).canBreatheUnderwater, true)
})

test('terrain uses painted elements, water, supporting voxels, sand, snow and optional GM environments', () => {
  const map = mapOf({ groundTiles: [{ ...point(), element: 'wood', terrain: 'normal' }],
    voxels: [{ ...point(1), materialId: 'water' }, { ...point(2, -1), materialId: 'snow', element: 'ice' },
      { ...point(3), materialId: 'sand', element: 'earth' }] })
  assert.deepEqual(getNaturewalkTerrainElements(map, point()), ['wood'])
  assert.deepEqual(getNaturewalkTerrainElements(map, point(1)), ['water'])
  assert.deepEqual(getNaturewalkTerrainElements(map, point(2)), ['ice'])
  assert.deepEqual(getNaturewalkTerrainElements(map, point(3)), ['fire'])
  assert.deepEqual(resolveNaturewalkEnvironment(map, point(), { elements: ['earth'], useMapTerrain: true }), ['earth', 'wood'])
  assert.deepEqual(resolveNaturewalkEnvironment(map, point(), { elements: ['earth'], useMapTerrain: false }), ['earth'])
})

test('Naturewalk removes matching difficult costs while preserving digging permissions and Steel barriers', () => {
  const map = mapOf({ voxels: [{ ...point(1), materialId: 'soft-metal' }, { ...point(2), materialId: 'steel' }] })
  const qualities = [{ id: 'extra-movement', choiceId: 'digger' }, adv('digger')]
  const ordinary = getMovementCostProfile(detectCapabilities(qualities, 6, 2, 0))
  const steel = getMovementCostProfile(detectCapabilities([...qualities, quality('steel')], 6, 2, 0))
  assert.equal(ordinary.stepCost(point(), point(1), map), 2)
  assert.equal(steel.stepCost(point(), point(1), map), 1)
  assert.equal(steel.stepCost(point(1), point(2), map), Infinity)
  const noDigger = getMovementCostProfile(detectCapabilities([quality('steel')], 6, 0, 0))
  assert.equal(noDigger.stepCost(point(), point(1), map), Infinity)
})

test('Darkness sight bypasses only non-solid darkness, retaining Light, floors and physical walls', () => {
  const from = point(0), to = point(3)
  const map = mapOf({ voxels: [{ ...point(1), materialId: 'darkness' }] })
  assert.equal(losClear(buildLosIndex(map), from, to), false)
  assert.equal(losClear(buildLosIndex(map, new Set(), { canSeeDarkness: true }), from, to), true)
  for (const voxel of [{ ...point(1), materialId: 'darkness', blocksMovement: true }, { ...point(1), materialId: 'light' }, { ...point(1), materialId: 'steel' }]) {
    assert.equal(losClear(buildLosIndex(mapOf({ voxels: [voxel] }), new Set(), { canSeeDarkness: true }), from, to), false)
  }
})

test('Fire damage display and Wind dodge pools include their actual conditional bonuses', () => {
  const record = { baseStats: { accuracy: 4, dodge: 4, damage: 6, armor: 3, health: 8 }, stage: 'rookie', size: 'medium', qualities: [quality('fire'), quality('wind')] }
  const participant = { id: 'mon', type: 'digimon', entityId: 'mon', currentStance: 'defensive', activeEffects: [], naturewalkActiveElements: ['fire', 'wind'] }
  assert.equal(combatAttackStats(record, participant, { type: 'damage', range: 'melee' }).damage, 8)
  const defense = computeDodgeDefense({ targetParticipantId: 'mon', data: {} }, { participants: [participant], findDigimon: () => record, findTamer: () => null })
  assert.equal(defense.pool, 9, 'Wind is a Dodge stat bonus before the defensive stance')
  assert.ok(defense.modifiers.some(modifier => modifier.label === 'Naturewalk: Wind' && modifier.value === 2))
})

test('Naturewalk costs one DP total for two separate element entries, with free selection at zero DP', () => {
  const template = QUALITY_DATABASE.find(q => q.id === 'naturewalk')
  const form = ref({ ...createDigimonFormDefaults(), qualities: [quality('fire'), quality('water')] })
  assert.equal(useDigimonDP(form).dpUsedOnQualities.value, 1)
  const props = reactive({ currentQualities: [], stage: 'rookie', availableDP: 0 })
  const added = []
  const pendingQuality = ref(template), showSelector = ref(true)
  const handlers = loadPageFunctions('components/QualitySelector.vue', ['getTemplateDPCost', 'getSelectionDPCost', 'isAtMaxChoices', 'selectChoice'], {
    props, getEffectiveDPCost, getMaxRanksAtStage, pendingQuality, showSelector, showChoiceSelector: ref(true),
    emit: (event, value) => { if (event === 'add') { props.currentQualities.push(value); added.push(value) } },
  })
  handlers.selectChoice(template, template.choices[0])
  assert.equal(added.length, 1)
  handlers.selectChoice(template, template.choices[1])
  assert.equal(added.length, 1, 'the second element requires one DP')
  props.availableDP = 1
  handlers.selectChoice(template, template.choices[1])
  assert.equal(added.length, 2)
  handlers.selectChoice(template, template.choices[2])
  assert.equal(added.length, 2, 'only two Naturewalk elements may be selected')
})

test('Water grants temporary wounds once per combat, including late entry, without refreshing on re-entry', async () => {
  const map = mapOf({ groundTiles: [{ ...point(), element: 'water', terrain: 'water' }] })
  const records = new Map([['mon', { id: 'mon', qualities: [quality('water'), adv('swimmer')] }]])
  const helper = loadTypeScriptWithMocks('server/utils/naturewalk.ts', {
    './combatSpatial': { loadParticipantDigimon: async () => records, loadEncounterMap: async () => map },
    './encounterRoom': { getRoomPositions: async () => ({ mon: point() }) },
  })
  const encounter = { id: 'enc', mapId: 'map', phase: 'combat', hazards: [] }
  const original = [{ id: 'mon', entityId: 'mon', type: 'digimon', currentTempWounds: 0, activeEffects: [] }]
  let result = await helper.applyNaturewalkEnvironment(encounter, original, { mon: point(1) }, { grantWater: true })
  assert.equal(result.participants[0].naturewalkWaterGranted, undefined)
  result = await helper.applyNaturewalkEnvironment(encounter, result.participants, { mon: point() }, { grantWater: true })
  assert.equal(result.participants[0].currentTempWounds, 2)
  assert.equal(result.participants[0].naturewalkWaterGranted, true)
  result.participants[0].currentTempWounds = 0
  result = await helper.applyNaturewalkEnvironment(encounter, result.participants, { mon: point(1) }, { grantWater: true })
  result = await helper.applyNaturewalkEnvironment(encounter, result.participants, { mon: point() }, { grantWater: true })
  assert.equal(result.participants[0].currentTempWounds, 0)
  result = await helper.applyNaturewalkEnvironment(encounter, result.participants, { mon: point() }, { grantWater: true, resetWater: true })
  assert.equal(result.participants[0].currentTempWounds, 2)
  assert.equal(original[0].currentTempWounds, 0)
})
