import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { getFootprintDimensions } = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const vec3Key = ({ x, y, z }) => `${x},${y},${z}`
const point = (x, y, z) => ({ x, y, z })

function harness(size = 'large', giganticDimensions = null) {
  const props = {
    participants: [
      { id: 'tamer', entityId: 'tai', type: 'tamer' },
      { id: 'partner', entityId: 'greymon', type: 'digimon' },
    ],
    digimonMap: { greymon: { size, giganticDimensions } },
    activePath: [point(1, 2, 3), point(2, 2, 4)],
    reachableCells: new Set(['4,2,7']),
  }
  const movingParticipantId = ref('partner')
  const pathHighlightGroup = new THREE.Group()
  const hoverGhostGroup = new THREE.Group()
  const hoveredMoveScreen = ref(null)
  const labels = [], events = []
  const dependencies = {
    props, movingParticipantId, pathHighlightGroup, hoverGhostGroup, hoveredMoveScreen,
    movementGhost: ref(null), movementGhostOverlay: ref(null), movementGapLabel: ref(null),
    updateMovementGhostOverlay: () => {}, renderMovementGap: () => {},
    THREE, getFootprintDimensions, vec3Key, TILE_SIZE: 1, TILE_H: 0.1,
    lastPathKey: '', rightDragActive: false,
    tokenDrag: { isPressed: () => false }, updateTargetHover: () => {},
    setMouseFromEvent: () => {}, npcMoveY: ref(2),
    raycaster: new THREE.Raycaster(new THREE.Vector3(4.2, 10, 7.2), new THREE.Vector3(0, -1, 0)),
    worldToScreen2D: position => { labels.push(position.clone()); return { x: position.x, y: position.z } },
    emit: (...args) => events.push(args),
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue', [
    'getParticipantFootprintDims', 'movementPreviewCenter', 'updatePathHighlights', 'getMoveAim', 'moveCellAt', 'onMouseMove',
  ], dependencies)
  return { ...dependencies, ...handlers, labels, events }
}

for (const [size, dimensions, expectedCenter] of [
  ['medium', null, [1.5, 3.5]],
  ['large', null, [2, 4]],
  ['huge', null, [2.5, 4.5]],
  ['gigantic', { width: 4, height: 5, depth: 6 }, [3, 6]],
]) {
  test(`${size} movement path follows the footprint center while retaining anchor cells`, () => {
    const h = harness(size, dimensions)
    const original = structuredClone(h.props.activePath)
    h.updatePathHighlights()
    const marker = h.pathHighlightGroup.children[0]
    assert.equal(marker.position.x, expectedCenter[0])
    assert.equal(marker.position.z, expectedCenter[1])
    assert.equal(marker.position.y, 2 + h.TILE_H + 0.03)
    assert.deepEqual(h.props.activePath, original, 'render offsets must never change committed path anchors')
  })
}

for (const capability of ['canFly', 'canDig']) {
  for (const cached of [true, false]) {
    test(`${capability} partner path markers remain visible above a flat floor (${cached ? 'cached search' : 'A* fallback'})`, () => {
      const map = {
        groundTiles: Array.from({ length: 64 }, (_, i) => point(i % 8, 0, Math.floor(i / 8))),
        spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], stairs: [], ceilings: [],
      }
      const caps = {
        canFly: false, canJump: false, jumpHeight: 0, jumpRange: 0,
        canClimb: false, canSwim: false, canDig: false, [capability]: true,
      }
      const start = point(3, 0, 1), destination = point(3, 0, 6)
      const movement = useMapMovement()
      if (cached) movement.computeReachable(start, 5, caps, map)
      const path = movement.computePath(start, destination, caps, map)
      assert.equal(path.length - 1, 5, 'the visible route must retain the shortest movement cost')
      assert.deepEqual(path[0], start)
      assert.deepEqual(path.at(-1), destination)

      const h = harness('small')
      h.props.activePath = movement.activePath.value
      h.updatePathHighlights()
      const floor = map.groundTiles.map(tile => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, h.TILE_H, 1), new THREE.MeshBasicMaterial())
        mesh.position.set(tile.x + 0.5, tile.y + h.TILE_H / 2, tile.z + 0.5)
        mesh.updateMatrixWorld(true)
        return mesh
      })
      h.pathHighlightGroup.updateMatrixWorld(true)
      const markers = h.pathHighlightGroup.children
      assert.equal(markers.length, 6, 'every path step must have a rendered marker')
      for (const marker of markers) {
        const ray = new THREE.Raycaster(new THREE.Vector3(marker.position.x, 10, marker.position.z), new THREE.Vector3(0, -1, 0))
        const hits = ray.intersectObjects([...floor, ...markers], false)
        assert.ok(hits[0]?.object === marker, `path marker at ${marker.position.toArray()} is hidden underneath the floor; path: ${JSON.stringify(path)}`)
      }
    })
  }
}

test('path alignment refreshes when the mover or its footprint changes without changing the path', () => {
  const h = harness()
  h.updatePathHighlights()
  h.props.digimonMap.greymon.size = 'huge'
  h.updatePathHighlights()
  assert.equal(h.pathHighlightGroup.children[0].position.x, 2.5)
  h.movingParticipantId.value = 'tamer'
  h.updatePathHighlights()
  assert.equal(h.pathHighlightGroup.children[0].position.x, 1.5)
  h.movingParticipantId.value = 'partner'
  h.props.digimonMap.greymon = { size: 'gigantic', giganticDimensions: { width: 4, height: 4, depth: 6 } }
  h.updatePathHighlights()
  assert.equal(h.pathHighlightGroup.children[0].position.z, 6)
  h.props.digimonMap.greymon.giganticDimensions.depth = 8
  h.updatePathHighlights()
  assert.equal(h.pathHighlightGroup.children[0].position.z, 7)
})

for (const [size, dimensions, expectedCenter] of [
  ['large', null, [5, 8]],
  ['gigantic', { width: 4, height: 5, depth: 6 }, [6, 10]],
]) {
  test(`${size} hover ghost and distance label share the footprint center and emit the anchor`, () => {
    const h = harness(size, dimensions)
    h.onMouseMove({})
    const ghost = h.hoverGhostGroup.children[0]
    assert.equal(ghost.position.x, expectedCenter[0])
    assert.equal(ghost.position.z, expectedCenter[1])
    assert.equal(h.labels[0].x, expectedCenter[0])
    assert.equal(h.labels[0].z, expectedCenter[1])
    assert.deepEqual(h.events, [['cell-hovered', point(4, 2, 7)]])
  })
}
