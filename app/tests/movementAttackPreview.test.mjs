import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { computed, ref } from 'vue'
import { loadPageComputed, loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

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
]) test(`${role} movement previews receive available basic attacks and preserve melee Reach`, () => {
  const record = { id: 'agumon', name: 'Agumon', size: 'medium', stage: 'rookie',
    baseStats: { accuracy: 10, dodge: 10, health: 10, armor: 10, damage: 10 },
    qualities: [{ id: 'reach', ranks: 2 }], attacks: [{ id: 'claw', range: 'melee', tags: [] }] }
  const encounter = ref({ round: 1, participants: [{ id: 'actor', entityId: 'agumon', type: 'digimon', usedAttackIds: [] }] })
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
    allTamers: ref([]), tamers: ref([]), campaignLevel: ref(1), eddySoulRules: ref({}),
    hasPartnerStrikeFirst: () => false, _calcDigimonStats: () => ({ movement: 4, baseMovement: 4, ram: 1, cpu: 1, woundBoxes: 10 }),
    getParticipantAttacks,
  })
  const movementStats = loadPageComputed('components/EncounterMap.vue', 'movementAttackStats', {
    computed, props: { get encounter() { return encounter.value }, get digimonMap() { return projected.value } },
    npcMoveParticipantId: ref('actor'), chargeMoveParticipantId: ref(null), chargeMode: ref(null),
    calculateDigimonDerivedStats: loadTypeScript('types/index.ts').calculateDigimonDerivedStats,
    applyDerivedStatEffects: constants.applyDerivedStatEffects,
  })
  assert.ok(projected.value.agumon.attacks.some(a => a.id === 'basic-ranged'))
  assert.equal(movementStats.value.hasRanged, true, 'basic ranged attacks count even with only custom melee attacks')
  assert.equal(movementStats.value.meleeRange, 4)
  encounter.value.participants[0].usedAttackIds.push('basic-ranged')
  assert.equal(movementStats.value.hasRanged, false, 'used ranged attacks do not keep an unavailable orange preview')
  assert.equal(movementStats.value.meleeRange, 4)
})
