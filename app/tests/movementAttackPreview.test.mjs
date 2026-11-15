import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

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
  ghost.value.valid = false
  updateReticules()
  assert.deepEqual(ids.value, [])
  assert.equal(group.children.length, 0)
})
