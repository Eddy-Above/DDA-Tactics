import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { MAP_GEOMETRY: { TILE_H } } = loadTypeScript('utils/lineOfSight.ts')
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`)

function renderRings(y, area) {
  const position = { x: -3, y, z: 5 }
  const reticuleGroup = new THREE.Group()
  const { updateReticules } = loadPageFunctions('components/MapCanvas.vue', ['updateReticules'], {
    THREE, TILE_H, TILE_SIZE: 1, reticuleGroup,
    props: {
      selectedAttack: { range: 'ranged', type: 'damage', tags: area ? ['Area Attack: Blast'] : [] },
      participantPositions: { attacker: position }, participants: [],
      attackerRange: 2, attackerEffectiveLimit: 4, attackerMeleeRange: 1,
    },
    effectiveAttackerId: ref('attacker'),
    areaHighlightCells: ref(area ? [{ x: 0, y, z: 5 }] : []),
    isAreaTargeting: ref(area),
    reticuleParticipantIds: ref([]),
    lastAttackKey: '', lastAoeKey: 'area',
    getParticipantFootprintDims: () => ({ width: 1, height: 1, depth: 1 }),
  })
  updateReticules()
  reticuleGroup.updateMatrixWorld(true)
  return { position, reticuleGroup }
}

for (const area of [false, true]) {
  for (const y of [-2, 0, 3]) {
    for (const support of ['floor', 'voxel']) {
      test(`${area ? 'area' : 'single-target'} ranged rings remain above ${support} tops at elevation ${y}`, () => {
        const { position, reticuleGroup } = renderRings(y, area)
        assert.equal(reticuleGroup.children.length, 2)
        const supportHeight = support === 'floor' ? TILE_H : 1
        const supportGeometry = new THREE.BoxGeometry(1, supportHeight, 1)
        const supportMaterial = new THREE.MeshBasicMaterial()

        try {
          for (const [index, ring] of reticuleGroup.children.entries()) {
            const radius = index === 0 ? 2 : 4
            close(ring.geometry.parameters.innerRadius, radius - 0.05)
            close(ring.geometry.parameters.outerRadius, radius + 0.05)
            assert.equal(ring.geometry.parameters.thetaSegments, 64)
            assert.equal(ring.material.color.getHex(), index === 0 ? 0x00ff00 : 0xffaa00)
            assert.equal(ring.material.side, THREE.DoubleSide)
            assert.equal(ring.material.transparent, true)
            assert.equal(ring.material.opacity, 0.5)
            assert.equal(ring.material.depthTest, true)
            close(ring.position.y, y + TILE_H + 0.015)

            // A real opaque terrain mesh under the ring must lose the depth test to it.
            const terrain = new THREE.Mesh(supportGeometry, supportMaterial)
            const angle = Math.PI / 64
            const sampleX = position.x + 0.5 + radius * Math.cos(angle)
            const sampleZ = position.z + 0.5 + radius * Math.sin(angle)
            terrain.position.set(sampleX, support === 'floor' ? y + TILE_H / 2 : y - 0.5, sampleZ)
            terrain.updateMatrixWorld(true)
            const hits = new THREE.Raycaster(
              new THREE.Vector3(sampleX, y + 2, sampleZ), new THREE.Vector3(0, -1, 0),
            ).intersectObjects([terrain, ring], false)
            assert.ok(hits[0]?.object === ring, 'the ring must be visible in front of the terrain')
            const terrainHit = hits.find(hit => hit.object === terrain)
            assert.ok(terrainHit)
            const clearance = hits[0].point.y - terrainHit.point.y
            close(clearance, support === 'floor' ? 0.015 : TILE_H + 0.015)
          }
        } finally {
          supportGeometry.dispose()
          supportMaterial.dispose()
          for (const ring of reticuleGroup.children) {
            ring.geometry.dispose()
            ring.material.dispose()
          }
        }
      })
    }
  }
}
