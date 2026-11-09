import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { clearMapGroup, mapPreviewChanged } = loadTypeScript('utils/mapRenderResources.ts')

function fixture(canvasDisposed = false) {
  const frames = [], pointers = []
  const calls = { render: 0, overlays: 0, highlights: 0, paths: 0, reticules: 0 }
  const deps = {
    rafId: 0, canvasDisposed, renderer: { render: () => calls.render++ }, camera: new THREE.PerspectiveCamera(), scene: {}, terrain: null,
    requestAnimationFrame: callback => { frames.push(callback); return frames.length },
    controls: { update: () => {} }, keysHeld: new Set(), azimuthTween: null,
    overlaysDirty: true, highlightsDirty: true, reticulesDirty: true, pendingPointerEvent: null,
    pendingMovePos: ref(null), movePendingScreen: ref(null),
    applyKeyMovement: () => {}, tickAzimuthTween: () => {},
    updateCharacterOverlays: () => calls.overlays++, updateRadialScreen: () => {},
    updateMovementHighlights: () => calls.highlights++, updatePathHighlights: () => calls.paths++,
    updateReticules: () => calls.reticules++, onMouseMove: event => pointers.push(event),
  }
  return { ...deps, frames, pointers, calls, ...loadPageFunctions('components/MapCanvas.vue',
    ['requestRender', 'invalidateFrame', 'queueMouseMove', 'animate'], deps) }
}

test('multiple updates share one frame and a stationary map schedules no idle frames', () => {
  const h = fixture()
  h.invalidateFrame(); h.invalidateFrame(); h.requestRender()
  assert.equal(h.frames.length, 1)
  h.frames.shift()()
  assert.deepEqual(h.calls, { render: 1, overlays: 1, highlights: 1, paths: 1, reticules: 1 })
  assert.equal(h.frames.length, 0)
  h.requestRender()
  h.frames.shift()()
  assert.deepEqual(h.calls, { render: 2, overlays: 1, highlights: 1, paths: 1, reticules: 1 })
  assert.equal(h.frames.length, 0)
})

test('a disposed canvas cannot schedule another GPU frame', () => {
  const h = fixture(true)
  h.invalidateFrame(); h.requestRender()
  assert.equal(h.frames.length, 0)
})

test('pointer events are coalesced to the latest position once per frame', () => {
  const h = fixture()
  h.queueMouseMove({ clientX: 1 }); h.queueMouseMove({ clientX: 2 }); h.queueMouseMove({ clientX: 3 })
  assert.equal(h.frames.length, 1)
  h.frames.shift()()
  assert.deepEqual(h.pointers, [{ clientX: 3 }])
  assert.equal(h.calls.render, 1)
  assert.equal(h.frames.length, 0)
})

test('keyboard camera movement keeps frames active only while a key is held', () => {
  const h = fixture()
  h.keysHeld.add('ArrowUp')
  h.requestRender(); h.frames.shift()()
  assert.equal(h.frames.length, 1)
  h.keysHeld.clear(); h.frames.shift()()
  assert.equal(h.frames.length, 0)
})

test('leaving the canvas cancels a queued hover and redraws the cleared preview', () => {
  const h = fixture()
  const group = new THREE.Group()
  group.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial()))
  const changes = []
  const deps = { ...h, pendingPointerEvent: null, hoverGhostGroup: group,
    setHoveredTarget: value => changes.push(value), tokenDrag: { isPressed: () => false },
    movementGhost: ref({}), movementGhostOverlay: ref({}), movementGapLabel: ref({}), hoveredMoveScreen: ref({}) }
  const handlers = loadPageFunctions('components/MapCanvas.vue', ['queueMouseMove', 'onCanvasLeave', 'animate'], deps)
  handlers.queueMouseMove({ clientX: 1 })
  handlers.onCanvasLeave()
  handlers.animate()
  assert.deepEqual(h.pointers, [])
  assert.deepEqual(changes, [null])
  assert.equal(group.children.length, 0)
  assert.equal(deps.movementGhost.value, null)
})

test('preview caching avoids replacement and clearing disposes shared resources once', () => {
  const group = new THREE.Group()
  const geometry = new THREE.BoxGeometry(), material = new THREE.MeshBasicMaterial()
  let geometryDisposals = 0, materialDisposals = 0
  geometry.addEventListener('dispose', () => geometryDisposals++)
  material.addEventListener('dispose', () => materialDisposals++)
  assert.equal(mapPreviewChanged(group, 'ramp:north'), true)
  group.add(new THREE.Mesh(geometry, material), new THREE.Mesh(geometry, material))
  assert.equal(mapPreviewChanged(group, 'ramp:north'), false)
  assert.equal(mapPreviewChanged(group, 'ramp:east'), true)
  clearMapGroup(group)
  assert.equal(group.children.length, 0)
  assert.equal(geometryDisposals, 1)
  assert.equal(materialDisposals, 1)
  assert.equal(mapPreviewChanged(group, 'ramp:east'), true)
})
