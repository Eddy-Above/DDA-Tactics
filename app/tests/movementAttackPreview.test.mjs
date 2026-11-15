import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { computed, ref } from 'vue'
import { loadPageComputed, loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const floramon = JSON.parse(readFileSync(new URL('./fixtures/floramonMapRange.json', import.meta.url), 'utf8'))

function calculateFullStats(record, rules, partnerStrikeFirst) {
  const previous = globalThis.ref
  globalThis.ref = ref
  try { return loadTypeScript('composables/useDigimon.ts').useDigimon().calculateDerivedStats(record, rules, partnerStrikeFirst) }
  finally { previous === undefined ? delete globalThis.ref : globalThis.ref = previous }
}

function compareRenderedRanges(stats, descriptor) {
  const group = new THREE.Group(), ids = ref([])
  let moving = true
  const props = { selectedAttack: null, chargeMode: null, movementAttackStats: stats,
    attackerRange: stats.range, attackerEffectiveLimit: descriptor.effectiveLimit, attackerMeleeRange: descriptor.meleeRange,
    participants: [{ id: 'target' }], participantPositions: { actor: { x: 0, y: 0, z: 0 }, target: { x: 12, y: 0, z: 0 } } }
  const { updateReticules } = loadPageFunctions('components/MapCanvas.vue', ['meleeInRange', 'updateReticules'], {
    THREE, ...loadTypeScript('utils/movementRules.ts'), props,
    movementGhost: ref({ participantId: 'actor', cell: { x: 1, y: 0, z: 0 }, valid: true }),
    getMoveAim: () => moving ? { participantId: 'actor', isGm: false } : null,
    effectiveAttackerId: ref('actor'), areaHighlightCells: ref([]), lastAttackKey: '', lastAoeKey: '', isAreaTargeting: ref(false),
    reticuleGroup: group, reticuleParticipantIds: ids, TILE_SIZE: 1, TILE_H: 0.1,
    getParticipantFootprintDims: () => ({ width: 1, height: 1, depth: 1 }), currentLosIndex: () => null,
  })
  try {
    updateReticules()
    const movement = group.children.map(ring => ring.geometry.parameters.outerRadius - 0.05)
    assert.deepEqual(ids.value, ['target'], 'movement preview includes targets beyond its old incorrect 8 m limit')
    moving = false; props.selectedAttack = descriptor
    updateReticules()
    const selected = group.children.map(ring => ring.geometry.parameters.outerRadius - 0.05)
    assert.deepEqual(ids.value, ['target'])
    assert.deepEqual(movement, [1, 15], 'green is 1 m melee; orange is 15 m effective limit')
    assert.deepEqual(movement, selected, 'actual movement and selected-attack ring geometry must match')
  } finally { loadTypeScript('utils/mapRenderResources.ts').clearMapGroup(group) }
}

test('movement range and target outlines follow the ghost with range and line-of-sight checks', () => {
  const rules = loadTypeScript('utils/movementRules.ts')
  const los = loadTypeScript('utils/lineOfSight.ts')
  const render = loadTypeScript('utils/mapRenderResources.ts')
  const point = x => ({ x, y: 0, z: 0 })
  const props = { selectedAttack: null, chargeMode: null, participants: ['actor', 'near', 'far', 'blocked'].map(id => ({ id })),
    participantPositions: { actor: point(0), near: point(2), far: point(8), blocked: point(5) },
    movementAttackStats: { range: 3, effectiveLimit: 6, meleeRange: 1, hasRanged: true } }
  const map = { groundTiles: [], spaceTiles: [], walls: [], doors: [], windows: [], ceilings: [], stairs: [],
    voxels: [{ id: 'wall', ...point(3), materialId: 'steel' }] }
  const group = new THREE.Group(), ids = ref([]), ghost = ref({ participantId: 'actor', cell: point(1), valid: true })
  const { updateReticules } = loadPageFunctions('components/MapCanvas.vue', ['meleeInRange', 'updateReticules'], {
    ...rules, ...los, ...render, THREE, props, movementGhost: ghost,
    getMoveAim: () => ({ participantId: 'actor', isGm: false }), effectiveAttackerId: ref('actor'),
    areaHighlightCells: ref([]), lastAttackKey: '', lastAoeKey: '', isAreaTargeting: ref(false),
    reticuleGroup: group, reticuleParticipantIds: ids, TILE_SIZE: 1, TILE_H: 0.1,
    getParticipantFootprintDims: () => ({ width: 1, height: 1, depth: 1 }), currentLosIndex: () => los.buildLosIndex(map),
  })
  updateReticules()
  assert.deepEqual(ids.value, ['near'], 'out-of-range and obscured targets stay unhighlighted')
  assert.equal(group.children.length, 2)
  assert.equal(group.children[0].geometry.parameters.outerRadius, 1.05, 'green shows melee reach, not normal ranged range')
  assert.equal(group.children[1].geometry.parameters.outerRadius, 6.05, 'orange shows the ranged effective limit')
  assert.ok(group.children.every(ring => ring.position.x === 1.5))
  ghost.value.cell = point(4)
  updateReticules()
  assert.deepEqual(ids.value, ['far', 'blocked'])
  assert.ok(group.children.every(ring => ring.position.x === 4.5))
  assert.deepEqual(props.participantPositions.actor, point(0), 'range preview does not move the actual unit')
  props.movementAttackStats.hasRanged = false
  updateReticules()
  assert.deepEqual(ids.value, ['blocked'], 'a unit with only melee attacks previews only melee reach')
  assert.equal(group.children.length, 1)
  assert.equal(group.children[0].geometry.parameters.outerRadius, 1.05)
  props.movementAttackStats.hasRanged = true
  props.movementAttackStats.meleeRange = 4
  props.movementAttackStats.range = 20
  updateReticules()
  assert.equal(group.children[0].geometry.parameters.outerRadius, 4.05, 'Reach changes green independently of ranged range')
  assert.equal(group.children[1].geometry.parameters.outerRadius, 6.05)
  ghost.value.valid = false
  updateReticules()
  assert.deepEqual(ids.value, [])
  assert.equal(group.children.length, 0)
})

for (const [role, page] of [
  ['player', 'pages/campaigns/[campaignId]/player/[tamerId].vue'],
  ['GM', 'pages/campaigns/[campaignId]/encounters/[id].vue'],
]) test(`${role} Floramon movement and selected attacks agree on full ranges, effects and available attacks`, () => {
  const record = structuredClone(floramon.digimon)
  const encounter = ref({ round: 1, participants: [{ id: 'actor', entityId: record.id, type: 'digimon', usedAttackIds: [], activeEffects: [] }] })
  const records = ref([record])
  const constants = loadTypeScript('data/attackConstants.ts')
  const { availableCombatAttacks } = loadTypeScript('utils/combatAttackOptions.ts')
  const { getParticipantAttacks } = loadPageFunctions(page, ['getParticipantAttacks'], {
    partnerDigimon: records, digimonMap: computed(() => new Map(records.value.map(d => [d.id, d]))),
    activeEncounter: encounter, currentEncounter: encounter, houseRules: ref({}),
    BASIC_ATTACKS: constants.BASIC_ATTACKS, availableCombatAttacks,
  })
  const projected = loadPageComputed(page, 'digimonMapForMap', {
    computed, activeEncounter: encounter, currentEncounter: encounter, allDigimon: records, digimonList: records,
    allTamers: ref([]), tamers: ref([]), campaignLevel: ref(1), eddySoulRules: ref(floramon.eddySoulRules),
    hasPartnerStrikeFirst: () => false, _calcDigimonStats: calculateFullStats,
    getParticipantAttacks,
  })
  const movementStats = loadPageComputed('components/EncounterMap.vue', 'movementAttackStats', {
    computed, props: { get encounter() { return encounter.value }, get digimonMap() { return projected.value } },
    npcMoveParticipantId: ref('actor'), chargeMoveParticipantId: ref(null), chargeMode: ref(null),
    calculateDigimonDerivedStats: loadTypeScript('types/index.ts').calculateDigimonDerivedStats,
    applyDerivedStatEffects: constants.applyDerivedStatEffects,
  })
  assert.ok(projected.value[record.id].attacks.some(a => a.id === 'basic-ranged'))
  assert.equal(movementStats.value.hasRanged, true)
  assert.equal(movementStats.value.meleeRange, 1)
  const selectedAttack = computed(() => loadTypeScript('utils/mapAttackDescriptor.ts').buildMapAttackDescriptor({
    participant: encounter.value.participants[0], attack: constants.BASIC_ATTACKS.find(a => a.id === 'basic-ranged'),
  }, { digimon: records.value[0], stats: calculateFullStats(records.value[0]) }))
  assert.equal(calculateFullStats(record).range, 11)
  assert.equal(selectedAttack.value.effectiveLimit, 15)
  assert.equal(movementStats.value.range, 11, 'movement must retain Floramon bonus Accuracy and Effect Warrior BIT')
  assert.equal(movementStats.value.effectiveLimit, 15, 'movement orange ring must match selected ranged attack')
  compareRenderedRanges(movementStats.value, selectedAttack.value)
  encounter.value.participants[0].activeEffects.push({ name: 'Bastion', potency: 2 })
  assert.equal(movementStats.value.range, 13)
  assert.equal(movementStats.value.effectiveLimit, 17, 'effects apply exactly once to the full stat values')
  assert.equal(movementStats.value.effectiveLimit, selectedAttack.value.effectiveLimit)
  encounter.value.participants[0].activeEffects.length = 0
  records.value[0].qualities.push({ id: 'reach', ranks: 2 })
  assert.equal(movementStats.value.meleeRange, 4, 'Reach still affects melee independently')
  encounter.value.participants[0].usedAttackIds.push(...projected.value[record.id].attacks.filter(a => a.range === 'ranged').map(a => a.id))
  assert.equal(movementStats.value.hasRanged, false, 'used ranged attacks do not keep an unavailable orange preview')
  assert.equal(movementStats.value.meleeRange, 4)
})
