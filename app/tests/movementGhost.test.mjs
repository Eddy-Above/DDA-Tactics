import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import * as THREE from 'three'
import { loadTypeScript, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const { buildMovementGroundIndex, movementGroundBelow } = loadTypeScript('utils/movementGap.ts')
const dims = { width: 1, height: 1, depth: 1 }
const cell = { x: 2, y: 3, z: 4 }

test('movement gap uses the nearest floor or voxel surface below the token, including lower floors', () => {
  const index = buildMovementGroundIndex([{ x: 2, y: -3, z: 4 }, { x: 2, y: 0, z: 4 }, { x: 2, y: 8, z: 4 }], [{ x: 2, y: 1, z: 4 }])
  assert.equal(movementGroundBelow(index, cell, dims), 2)
  assert.equal(movementGroundBelow(index, { ...cell, y: 1 }, dims), 0)
  assert.equal(movementGroundBelow(index, { ...cell, y: -1 }, dims), -3)
  assert.equal(movementGroundBelow(index, { ...cell, x: 9 }, dims), null)
})

test('large token ground queries use its actual footprint center', () => {
  const index = buildMovementGroundIndex([{ x: 4, y: 0, z: 7 }], [])
  assert.equal(movementGroundBelow(index, cell, { width: 4, depth: 6 }), 0)
})

function fixture() {
  const ghost = ref({ participantId: 'mover', cell, valid: true })
  const overlay = ref(null), gap = ref(null), aim = ref({ participantId: 'mover' })
  const deps = { THREE, TILE_SIZE: 1, TILE_H: 0.1, movementGhost: ghost, movementGhostOverlay: overlay, movementGapLabel: gap,
    props: { participants: [{ id: 'mover', type: 'digimon', entityId: 'form', currentStance: 'aggressive' }],
      digimonMap: { form: { spriteUrl: '/portrait.png', name: 'Partner' } }, tamerMap: {} },
    getMoveAim: () => aim.value, getParticipantSize: () => 'medium', getSizeParams: () => ({ imageScale: 1 }),
    getParticipantFootprintDims: () => dims, camera: new THREE.PerspectiveCamera(),
    worldToScreen2D: position => ({ x: position.x * 100, y: -position.y * 100 }),
    movementGroundIndex: ref(buildMovementGroundIndex([{ ...cell, y: 0 }], [])), movementGroundBelow,
    hoverGhostGroup: new THREE.Group(),
  }
  return { ...deps, ghost, overlay, gap, aim, ...loadPageFunctions('components/MapCanvas.vue',
    ['movementPreviewCenter', 'updateMovementGhostOverlay', 'renderMovementGap'], deps) }
}

test('movement ghost uses the mover portrait and stance at the destination, with a measured gap', () => {
  const f = fixture()
  f.updateMovementGhostOverlay()
  assert.equal(f.overlay.value.spriteUrl, '/portrait.png')
  assert.equal(f.overlay.value.stance, 'aggressive')
  assert.equal(f.overlay.value.x, 250)
  assert.equal(f.gap.value.text, '3 m gap')
  f.renderMovementGap(cell, dims)
  const line = f.hoverGhostGroup.children[0]
  assert.equal(line.isLine, true)
  const positions = line.geometry.attributes.position.array
  assert.ok(Math.abs(positions[1] - positions[4] - 3) < 1e-6)
  assert.equal(positions[0], 2.5)
  assert.equal(positions[2], 4.5)
  f.aim.value = null
  f.updateMovementGhostOverlay()
  assert.equal(f.overlay.value, null)
  assert.equal(f.gap.value, null)
})

test('a grounded movement ghost has no gap; a bottomless column has an explicit label', () => {
  const f = fixture()
  f.ghost.value.cell = { ...cell, y: 0 }
  f.updateMovementGhostOverlay()
  assert.equal(f.gap.value, null)
  f.renderMovementGap(f.ghost.value.cell, dims)
  assert.equal(f.hoverGhostGroup.children.length, 0)
  f.movementGroundIndex.value = new Map()
  f.updateMovementGhostOverlay()
  assert.equal(f.gap.value.text, 'No ground below')
})
