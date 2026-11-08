import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { getFootprintDimensions } = loadTypeScript('utils/movementRules.ts')
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
    THREE, getFootprintDimensions, vec3Key, TILE_SIZE: 1, TILE_H: 0.1,
    lastPathKey: '', rightDragActive: false,
    tokenDrag: { isPressed: () => false }, updateTargetHover: () => {},
    setMouseFromEvent: () => {}, npcMoveY: ref(2),
    raycaster: new THREE.Raycaster(new THREE.Vector3(4.2, 10, 7.2), new THREE.Vector3(0, -1, 0)),
    worldToScreen2D: position => { labels.push(position.clone()); return { x: position.x, y: position.z } },
    emit: (...args) => events.push(args),
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue', [
    'getParticipantFootprintDims', 'movementPreviewCenter', 'updatePathHighlights', 'onMouseMove',
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
