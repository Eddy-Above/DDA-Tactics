import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { getFootprintDimensions, detectCapabilities } = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const vec3Key = ({ x, y, z }) => `${x},${y},${z}`
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })

function fixture(isDm) {
  const origin = point()
  const map = { groundTiles: [{ ...origin, terrain: 'normal' }], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [] }
  const qualities = [{ id: 'extra-movement', choiceId: 'jumper' }, { id: 'advanced-mobility', choiceId: 'adv-jumper' }]
  const caps = detectCapabilities(qualities, 2, 0, 2, 0, 2)
  const movement = useMapMovement()
  const props = {
    isDm, activeTool: 'select', gmMoveParticipantId: null, chargeMoveParticipantId: null,
    participants: [{ id: 'partner', type: 'digimon', entityId: 'form' }],
    participantPositions: { partner: origin }, digimonMap: { form: { size: 'medium', qualities } },
    map, reachableCells: movement.computeReachable(origin, 2, caps, map), activePath: [],
  }
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  camera.position.set(6, 4, 8)
  const controls = { target: new THREE.Vector3(0.5, 0, 0.5), update() { camera.lookAt(this.target) } }
  controls.update()
  camera.updateMatrixWorld(true)
  const events = []
  const movingParticipantId = ref('partner')
  const deps = {
    spacePanning: ref(false), panGesture: false, editorHint: ref(null),
    props, THREE, camera, controls, movement,
    canvasRef: ref({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 1000, height: 1000 }) }),
    containerRef: ref({ clientWidth: 1000, clientHeight: 1000 }),
    mouse: new THREE.Vector2(), raycaster: new THREE.Raycaster(), scene: new THREE.Scene(),
    spriteGroups: new Map(), buildMeshes: [], terrain: null,
    movingParticipantId, npcMoveY: ref(0), gmMoveY: ref(0), usesVerticalAim: ref(false),
    hoverGhostGroup: new THREE.Group(), hoveredMoveScreen: ref(null),
    movementGhost: ref(null), movementGhostOverlay: ref(null), movementGapLabel: ref(null),
    updateMovementGhostOverlay: () => {}, renderMovementGap: () => {},
    rightDragActive: false, tokenDrag: { isPressed: () => false }, updateTargetHover: () => {},
    suppressNextClick: false, getFootprintDimensions, vec3Key, TILE_SIZE: 1, TILE_H: 0.1,
    emit: (...args) => {
      events.push(args)
      if (args[0] === 'cell-hovered') props.activePath = args[1] ? movement.computePath(origin, args[1], caps, map) ?? [] : []
    },
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue', [
    'getParticipantFootprintDims', 'movementPreviewCenter', 'worldToScreen2D',
    'getMoveAim', 'moveCellAt', 'setMouseFromEvent', 'getIntersection',
    'onMouseMove', 'onWheel', 'onCanvasClick',
  ], deps)
  return { ...deps, ...handlers, events, caps }
}

for (const isDm of [false, true]) {
  test(`${isDm ? 'GM-controlled' : 'player'} jump wheel aims, previews and commits empty air above the starting camera`, () => {
    const h = fixture(isDm)
    const event = { clientX: 500, clientY: 500, deltaY: -1 }
    const initialHeight = h.camera.position.y
    assert.equal(h.caps.jumpHeight, 12)
    assert.ok(h.props.reachableCells.has('0,6,0'), 'Advanced Jumper reaches air beyond its walking allowance')
    for (let y = 1; y <= 6; y++) {
      h.onWheel(event)
      assert.equal(h.npcMoveY.value, y)
      assert.equal(h.movementGhost.value?.valid, true, `jump preview vanished at Y=${y}`)
      assert.deepEqual(h.movementGhost.value.cell, point(0, y, 0))
    }
    assert.equal(h.camera.position.y, initialHeight + 6)
    assert.deepEqual(h.props.activePath.at(-1), point(0, 6, 0))
    assert.equal(h.props.activePath.length - 1, 6)
    assert.deepEqual(h.getIntersection(event), [], 'the destination needs no ground, voxel or sprite hit')
    h.onCanvasClick(event)
    const commits = h.events.filter(([type]) => type === 'unit-moved')
    assert.equal(commits.length, 1)
    assert.equal(commits[0][1], 'partner')
    assert.deepEqual(commits[0][2], point(0, 6, 0))
    assert.deepEqual(commits[0][3].at(-1), point(0, 6, 0))
    assert.equal(h.movingParticipantId.value, null)
  })
}

test('empty-air targets beyond jump height cannot preview or commit', () => {
  const h = fixture(false)
  const event = { clientX: 500, clientY: 500, deltaY: -1 }
  for (let y = 1; y <= 13; y++) h.onWheel(event)
  assert.equal(h.npcMoveY.value, 13)
  assert.equal(h.movementGhost.value, null)
  assert.equal(h.hoverGhostGroup.children.length, 0)
  h.onCanvasClick(event)
  assert.equal(h.events.some(([type]) => type === 'unit-moved'), false)
  assert.equal(h.movingParticipantId.value, 'partner')
})
