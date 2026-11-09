import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createMapTerrainChunks } = loadTypeScript('utils/mapTerrainChunks.ts')
const { buildLosIndex, losClear } = loadTypeScript('utils/lineOfSight.ts')

function fixture(voxels) {
  const map = { id: 'visibility', groundTiles: [], spaceTiles: [], voxels, windows: [] }
  const terrain = createMapTerrainChunks({ scene: new THREE.Scene(), tileHeight: 0.12 })
  terrain.sync(map)
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100)
  camera.position.set(0.5, 0.62, 4)
  camera.lookAt(0.5, 0.62, 0.5)
  camera.updateMatrixWorld(true)
  const deps = { THREE, camera, terrain, TILE_SIZE: 1, TILE_H: 0.12, WINDOW_FRAME: 0.2, WINDOW_H: 0.6,
    occludeRaycaster: new THREE.Raycaster(), wallMeshes: [], ghostWalls: ref(false), characterOverlays: ref({}),
    props: { map, participants: [{ id: 'token', entityId: 'tai', type: 'tamer', currentStance: 'neutral' }],
      participantPositions: { token: { x: 0, y: 0, z: 0 } },
      tamerMap: { tai: { name: 'Tai', spriteUrl: '/tai.png', woundBoxes: 6, currentWounds: 0 } }, digimonMap: {} },
    worldToScreen2D: position => { const projected = position.clone().project(camera); return { x: projected.x, y: projected.y } },
    updateMovementGhostOverlay: () => {},
  }
  return { ...deps, ...loadPageFunctions('components/MapCanvas.vue', ['getSizeParams', 'updateCharacterOverlays'], deps) }
}

test('transparent terrain leaves the actual token portrait overlay visible without changing targeting rules', () => {
  for (const materialId of ['water', 'wind', 'glass', 'ice', 'light', 'darkness', 'flickering-light']) {
    const blocker = { x: 0, y: 0, z: 2, materialId }
    const h = fixture([blocker])
    try {
      h.updateCharacterOverlays()
      assert.equal(h.characterOverlays.value.token?.spriteUrl, '/tai.png', materialId)
      assert.ok(h.terrain.pick(new THREE.Raycaster(h.camera.position, new THREE.Vector3(0, 0, -1))).length, 'transparent terrain remains selectable')
      assert.equal(losClear(buildLosIndex(h.props.map), { x: 0, y: 0, z: 4 }, { x: 0, y: 0, z: 0 }),
        materialId === 'water' || materialId === 'wind', 'attack visibility retains its material rules')
    } finally { h.terrain.dispose() }
  }
})

test('opaque terrain behind a transparent voxel still hides the token portrait', () => {
  const h = fixture([{ x: 0, y: 0, z: 2, materialId: 'glass' }, { x: 0, y: 0, z: 1, materialId: 'earth' }])
  try {
    h.updateCharacterOverlays()
    assert.equal(h.characterOverlays.value.token, undefined)
    h.ghostWalls.value = true
    h.updateCharacterOverlays()
    assert.equal(h.characterOverlays.value.token.spriteUrl, '/tai.png')
  } finally { h.terrain.dispose() }
})
