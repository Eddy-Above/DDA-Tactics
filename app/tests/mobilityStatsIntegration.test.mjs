import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, effectScope } from 'vue'
import { loadTypeScript, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { STAGE_CONFIG } = loadTypeScript('types/index.ts')
const { applyStanceToMovement } = loadTypeScript('utils/stanceModifiers.ts')
const { getAllStatEffectModifier } = loadTypeScript('data/attackConstants.ts')
const { useDigimon } = loadTypeScript('composables/useDigimon.ts')
const { useDigimonStats } = loadTypeScript('composables/useDigimonStats.ts')
const { createDigimonFormDefaults } = loadTypeScript('utils/formDefaults.ts')

function derived(record) {
  const previous = globalThis.ref
  globalThis.ref = ref
  try { return useDigimon().calculateDerivedStats(record) }
  finally {
    if (previous === undefined) delete globalThis.ref
    else globalThis.ref = previous
  }
}

function record(qualities = []) {
  return {
    ...createDigimonFormDefaults(), id: 'mon', stage: 'rookie', size: 'medium',
    baseStats: { accuracy: 12, damage: 12, dodge: 12, armor: 12, health: 12 },
    bonusStats: { accuracy: 8, damage: 8, dodge: 8, armor: 8, health: 8 },
    qualities,
  }
}

function preview(digimon, participantOverrides = {}) {
  const stats = derived(digimon)
  const participant = { id: 'unit', entityId: 'mon', type: 'digimon', currentStance: 'neutral', activeEffects: [], ...participantOverrides }
  const context = {
    props: { encounter: { participants: [participant] } },
    positions: ref({ unit: { x: 0, y: 0, z: 0 } }),
    digimonMapForCanvas: ref({ mon: { ...digimon, ...stats } }),
    tamerMapForCanvas: ref({ mon: { speed: 6 } }),
    movement: rules, STAGE_CONFIG, applyStanceToMovement, getAllStatEffectModifier,
  }
  return loadPageFunctions('components/EncounterMap.vue', ['npcMoveCaps'], context).npcMoveCaps('unit')
}

test('saved Digimon and form editor agree on Basic Movement and actual CPU/RAM', () => {
  const digimon = record([
    { id: 'speedy', ranks: 3 }, { id: 'instinct', ranks: 2 },
    { id: 'improved-derived-stat', choiceId: 'body', ranks: 10 },
    { id: 'improved-derived-stat', choiceId: 'agility', ranks: 10 },
    { id: 'system-boost', choiceId: 'cpu', ranks: 2 },
    { id: 'system-boost', choiceId: 'ram', ranks: 2 },
    { id: 'data-optimization', choiceId: 'effect-warrior' },
  ])
  const scope = effectScope()
  try {
    const formStats = scope.run(() => useDigimonStats(ref(digimon))).derivedStats.value
    const savedStats = derived(digimon)
    for (const key of ['baseMovement', 'movement', 'cpu', 'ram', 'body', 'agility']) {
      assert.equal(savedStats[key], formStats[key], key)
    }
    assert.equal(savedStats.baseMovement, 8)
    assert.equal(savedStats.movement, 14)
    assert.equal(savedStats.cpu, 7)
    assert.equal(savedStats.ram, 7)
  } finally { scope.stop() }
})

test('map preview distinguishes Basic Movement from Speedy and preserves Tamer movement', () => {
  const digimon = record([{ id: 'speedy', ranks: 3 }])
  const { budget, caps } = preview(digimon)
  assert.equal(budget, 12)
  assert.equal(caps.swimSpeed, 3)
  assert.equal(caps.jumpHeight, 3)
  const tamer = preview(digimon, { type: 'tamer' })
  assert.equal(tamer.budget, 6)
  assert.equal(tamer.caps.canSwim, false)
  assert.equal(tamer.caps.canJump, false)
})

test('map preview uses CPU/RAM and active effects for advanced swimming and jumping', () => {
  const digimon = record([
    { id: 'speedy', ranks: 3 },
    { id: 'extra-movement', choiceId: 'swimmer' },
    { id: 'extra-movement', choiceId: 'jumper' },
    { id: 'advanced-mobility', choiceId: 'adv-swimmer' },
    { id: 'advanced-mobility', choiceId: 'adv-jumper' },
  ])
  const stats = derived(digimon)
  const { budget, caps } = preview(digimon, { activeEffects: [{ name: 'Bastion', potency: 2 }], currentStance: 'brave' })
  assert.equal(budget, 13)
  assert.equal(caps.swimSpeed, budget + stats.ram + 2)
  assert.equal(caps.jumpHeight, budget + (stats.cpu + 2) * 5)
  assert.equal(caps.jumpRange, budget + stats.cpu + 2)
})

test('player movement display shares the map formulas for swim, jump height and length', () => {
  const digimon = record([
    { id: 'speedy', ranks: 3 },
    { id: 'extra-movement', choiceId: 'swimmer' },
    { id: 'extra-movement', choiceId: 'jumper' },
    { id: 'advanced-mobility', choiceId: 'adv-swimmer' },
    { id: 'advanced-mobility', choiceId: 'adv-jumper' },
  ])
  const stats = derived(digimon)
  const { getMovementTypes } = loadPageFunctions('pages/campaigns/[campaignId]/player/[tamerId].vue', ['getMovementTypes'], {
    calcDigimonStats: () => stats, ...rules,
  })
  const shown = Object.fromEntries(getMovementTypes(digimon).map(row => [row.type, row.speed]))
  assert.equal(shown.Swim, 12 + stats.ram)
  assert.equal(shown['Jump height'], 12 + stats.cpu * 5)
  assert.equal(shown['Jump length'], 12 + stats.cpu)
  assert.equal(shown.Walk, 12)
})

test('advanced flight, digging and wallclimbing previews and player display use actual RAM', () => {
  const digimon = record([
    { id: 'speedy', ranks: 3 },
    ...['flight', 'digger', 'wallclimber'].map(choiceId => ({ id: 'extra-movement', choiceId })),
    ...['adv-flight', 'adv-digger', 'adv-wallclimber'].map(choiceId => ({ id: 'advanced-mobility', choiceId })),
    { id: 'system-boost', choiceId: 'ram', ranks: 2 },
  ])
  const stats = derived(digimon)
  const { caps } = preview(digimon)
  for (const key of ['flySpeed', 'digSpeed', 'climbSpeed']) assert.equal(caps[key], 12 + stats.ram, key)
  assert.equal(caps.canClimbCeilings, true)
  assert.equal(caps.canDigHardSurfaces, true)
  const { getMovementTypes } = loadPageFunctions('pages/campaigns/[campaignId]/player/[tamerId].vue', ['getMovementTypes'], {
    calcDigimonStats: () => stats, ...rules,
  })
  const shown = Object.fromEntries(getMovementTypes(digimon).map(row => [row.type, row.speed]))
  for (const key of ['Fly', 'Burrow', 'Climb']) assert.equal(shown[key], 12 + stats.ram, key)
})
