import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { getFootprintDimensions } = loadTypeScript('utils/movementRules.ts')
const { buildMovementGroundIndex, movementGroundBelow } = loadTypeScript('utils/movementGap.ts')

function close(actual, expected, label) {
  assert.ok(Math.abs(actual - expected) < 1e-7, `${label}: ${actual} should equal ${expected}`)
}

function fixture({ width = 1200, height = 800, dragging = false, ghost = false } = {}) {
  const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 500)
  camera.position.set(25, 18, 25)
  const controls = new OrbitControls(camera)
  controls.target.set(10, 0, 10)
  controls.minPolarAngle = controls.maxPolarAngle = Math.PI / 3
  controls.update()
  camera.updateMatrixWorld(true)

  const participants = [
    { id: 'tamer', type: 'tamer', entityId: 'tai', currentStance: 'neutral' },
    { id: 'small', type: 'digimon', entityId: 'agumon', currentStance: 'aggressive' },
    { id: 'large', type: 'digimon', entityId: 'greymon', currentStance: 'defensive' },
    { id: 'huge', type: 'digimon', entityId: 'metalgreymon', currentStance: 'neutral' },
  ]
  const positions = {
    tamer: { x: 10, y: 0, z: 10 }, small: { x: 12, y: 1, z: 9 },
    large: { x: 7, y: 0, z: 12 }, huge: { x: 14, y: 2, z: 6 },
  }
  const portraits = [
    { id: 'tamer', center: new THREE.Vector3(10.5, 0.62, 10.5), scale: 1 },
    { id: 'small', center: new THREE.Vector3(12.5, 1.62, 9.5), scale: 0.7 },
    { id: 'large', center: new THREE.Vector3(8, 1.12, 13), scale: 2 },
    { id: 'huge', center: new THREE.Vector3(15.5, 3.62, 7.5), scale: 3 },
  ]
  const frames = []
  const characterOverlays = ref({}), movementGhostOverlay = ref(null), movementGapLabel = ref(null)
  const movePendingScreen = ref(null)
  const ghostCell = { x: 14, y: 2, z: 8 }
  let nextFrame = 1, renderedFrames = 0, now = 0, handlers

  const screen = point => {
    const projected = point.clone().project(camera)
    return { x: (projected.x + 1) * width / 2, y: (1 - projected.y) * height / 2 }
  }
  const expectedPortrait = (center, scale) => {
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion)
    const middle = screen(center), edge = screen(center.clone().addScaledVector(right, scale * 0.45))
    const h = Math.max(16, Math.hypot(edge.x - middle.x, edge.y - middle.y) * 2)
    return { x: middle.x, y: middle.y - h / 2, h }
  }
  const verifyProjection = () => {
    // WebGLRenderer refreshes these matrices immediately before drawing. HTML
    // portraits must already describe this same pose, rather than the last turn.
    camera.updateMatrixWorld(true)
    for (const portrait of portraits) {
      const overlay = characterOverlays.value[portrait.id]
      assert.ok(overlay, `${portrait.id} remains visible`)
      const expected = expectedPortrait(portrait.center, portrait.scale)
      close(overlay.x, expected.x, `${portrait.id} center x`)
      close(overlay.y, expected.y, `${portrait.id} top y`)
      close(overlay.h, expected.h, `${portrait.id} height`)
      close(overlay.w, expected.h, `${portrait.id} width`)
    }
    const pending = screen(new THREE.Vector3(11.5, 1.5, 8.5))
    close(movePendingScreen.value.x, pending.x, 'pending destination x')
    close(movePendingScreen.value.y, pending.y, 'pending destination y')
    if (ghost) {
      const expected = expectedPortrait(new THREE.Vector3(15, 3.12, 9), 2)
      const overlay = movementGhostOverlay.value
      assert.ok(overlay, 'the movement portrait remains visible')
      close(overlay.x, expected.x, 'movement portrait x')
      close(overlay.y, expected.y, 'movement portrait y')
      close(overlay.h, expected.h, 'movement portrait size')
      const gap = screen(new THREE.Vector3(15, 1.12, 9))
      assert.equal(movementGapLabel.value.text, '2 m gap')
      close(movementGapLabel.value.x, gap.x, 'movement gap x')
      close(movementGapLabel.value.y, gap.y, 'movement gap y')
    }
    renderedFrames++
  }

  const deps = {
    THREE, camera, controls, scene: new THREE.Scene(), renderer: { render: verifyProjection },
    containerRef: ref({ clientWidth: width, clientHeight: height }),
    TILE_SIZE: 1, TILE_H: 0.12, WINDOW_FRAME: 0.2, WINDOW_H: 0.6,
    getFootprintDimensions, movementGroundBelow,
    movementGroundIndex: ref(buildMovementGroundIndex([
      { x: 14, y: 0, z: 8 }, { x: 15, y: 0, z: 8 },
      { x: 14, y: 0, z: 9 }, { x: 15, y: 0, z: 9 },
    ], [])),
    characterOverlays, movementGhostOverlay, movementGapLabel,
    movementGhost: ref(ghost ? { participantId: 'large', cell: ghostCell, valid: true } : null),
    getMoveAim: () => ghost ? { participantId: 'large', isGm: true, y: ghostCell.y } : null,
    wallMeshes: [], terrain: null, occludeRaycaster: new THREE.Raycaster(), ghostWalls: ref(false),
    props: { map: { windows: [] }, participants, participantPositions: positions,
      tamerMap: { tai: { name: 'Tai', spriteUrl: '/tai.png' } },
      digimonMap: {
        agumon: { name: 'Agumon', size: 'small', spriteUrl: '/agumon.png' },
        greymon: { name: 'Greymon', size: 'large', spriteUrl: '/greymon.png' },
        metalgreymon: { name: 'MetalGreymon', size: 'huge', spriteUrl: '/metalgreymon.png' },
      },
    },
    rafId: 0, canvasDisposed: false, pendingPointerEvent: null,
    overlaysDirty: true, highlightsDirty: false, reticulesDirty: false,
    keysHeld: new Set(), azimuthTween: null, AZIMUTH_STEP: Math.PI / 4, AZIMUTH_TWEEN_MS: 220,
    rightDragActive: dragging, rightDragLastX: 0,
    performance: { now: () => now },
    requestAnimationFrame: callback => { frames.push(callback); return nextFrame++ },
    pendingMovePos: ref({ x: 11, y: 0, z: 8 }), movePendingScreen,
    updateRadialScreen: () => {}, updateMovementHighlights: () => {}, updatePathHighlights: () => {}, updateReticules: () => {},
  }
  handlers = loadPageFunctions('components/MapCanvas.vue', [
    'getSizeParams', 'getParticipantSize', 'getParticipantFootprintDims',
    'setAzimuth', 'applyRightDragRotation', 'stepAzimuth', 'tickAzimuthTween', 'applyKeyMovement',
    'requestRender', 'invalidateFrame', 'queueMouseMove', 'animate', 'onMouseMove',
    'worldToScreen2D', 'updateCharacterOverlays', 'movementPreviewCenter', 'updateMovementGhostOverlay',
  ], deps)
  controls.addEventListener('change', handlers.invalidateFrame)

  return { ...handlers, controls, camera,
    get renderedFrames() { return renderedFrames },
    setTime: time => { now = time },
    frame() {
      assert.ok(frames.length, 'a frame is scheduled')
      frames.shift()()
    },
    drain() {
      let count = 0
      while (frames.length) {
        assert.ok(++count < 10, 'camera settles without idle animation')
        frames.shift()()
      }
    },
    // No DOM element was connected, so only our change listener needs cleanup.
    dispose: () => controls.removeEventListener('change', handlers.invalidateFrame),
  }
}

test('queued right-drag keeps token portraits aligned with the rendered camera through direction changes', () => {
  for (const [width, height] of [[1200, 800], [675, 1000]]) {
    const h = fixture({ width, height, dragging: true })
    try {
      let x = 0
      for (const delta of [15, -6, 2, 31, -24, 1, -2, 18]) {
        // Coalesced pointer rotation happens after animate's first controls.update.
        h.queueMouseMove({ clientX: x + delta / 2 })
        x += delta
        h.queueMouseMove({ clientX: x })
        h.frame()
        h.drain()
      }
      assert.ok(h.renderedFrames >= 8)
    } finally { h.dispose() }
  }
})

test('eased Q/E turns keep token and movement portraits, labels and pending destinations on the same camera pose', () => {
  const h = fixture({ ghost: true })
  try {
    h.stepAzimuth(Math.PI / 4)
    h.requestRender()
    for (const time of [0, 33, 80, 140, 200, 220]) {
      h.setTime(time)
      h.frame()
    }
    h.drain()
    h.stepAzimuth(-Math.PI / 4)
    h.requestRender()
    for (const time of [220, 255, 315, 400, 440]) {
      h.setTime(time)
      h.frame()
    }
    h.drain()
    assert.ok(h.renderedFrames >= 11)
  } finally { h.dispose() }
})

test('camera changes inside the frame update matrices before projecting portraits', () => {
  const h = fixture({ ghost: true })
  try {
    // OrbitControls changes orientation during update, after lookAt has sampled
    // the previous quaternion. Damping exercises this without browser events.
    h.controls.enableDamping = true
    h.controls.rotateLeft(0.2)
    h.frame()
    h.controls.enableDamping = false
    h.drain()
    assert.ok(h.renderedFrames >= 2)
  } finally { h.dispose() }
})
