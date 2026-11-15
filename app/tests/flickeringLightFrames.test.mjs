import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createMapTerrainChunks } = loadTypeScript('utils/mapTerrainChunks.ts')
const { createMapLightAnimationClock } = loadTypeScript('utils/mapLightAnimationClock.ts')
const source = (y = 2) => ({ x: 0, y, z: 0, materialId: 'flickering-light' })
const mapOf = voxels => ({ id: 'flicker-frames', groundTiles: [], spaceTiles: [], voxels })

function fixture(voxels = [], disposed = false) {
  const scene = new THREE.Scene()
  const manager = createMapTerrainChunks({ scene, tileHeight: 0.12 })
  manager.sync(mapOf(voxels), { clipY: 20 })
  if (disposed) manager.dispose()
  const frames = []
  const timers = new Map()
  let now = 0, timerId = 0, handlers
  const lightAnimationClock = createMapLightAnimationClock(() => handlers.requestRender(), {
    now: () => now,
    setTimeout: (callback, delay) => { const id = ++timerId; timers.set(id, { callback, at: now + delay }); return id },
    clearTimeout: id => timers.delete(id),
  })
  const calls = { render: 0, overlays: 0, highlights: 0, paths: 0, reticules: 0 }
  let nextFrame = 0
  const dependencies = {
    terrain: manager, scene, camera: new THREE.PerspectiveCamera(),
    rafId: 0, canvasDisposed: disposed, renderer: { render: () => calls.render++ },
    lightAnimationClock, document: { hidden: false },
    cancelAnimationFrame: () => { frames.length = 0 }, resetEditorInput: () => {},
    requestAnimationFrame: callback => { frames.push(callback); return ++nextFrame },
    controls: { update: () => {} }, keysHeld: new Set(), azimuthTween: null,
    overlaysDirty: true, highlightsDirty: true, reticulesDirty: true, pendingPointerEvent: null,
    pendingMovePos: ref(null), movePendingScreen: ref(null),
    applyKeyMovement: () => {}, tickAzimuthTween: () => {},
    updateCharacterOverlays: () => calls.overlays++, updateRadialScreen: () => {},
    updateMovementHighlights: () => calls.highlights++, updatePathHighlights: () => calls.paths++,
    updateReticules: () => calls.reticules++, onMouseMove: () => {},
  }
  handlers = loadPageFunctions('components/MapCanvas.vue',
    ['requestRender', 'invalidateFrame', 'animate', 'onMapVisibilityChange'], dependencies)
  function step(time) {
    now = time
    for (const [id, timer] of [...timers]) if (timer.at <= now) {
      timers.delete(id)
      timer.callback()
    }
    const frame = frames.shift()
    if (frame) frame(now)
  }
  return { manager, scene, frames, timers, calls, lightAnimationClock, keysHeld: dependencies.keysHeld,
    document: dependencies.document, step,
    lightTick() { step(now + 50) },
    dispose() { lightAnimationClock.dispose(); manager.dispose() }, ...handlers }
}

test('ordinary and existing Light materials leave a stationary map idle', () => {
  for (const voxels of [[], [{ ...source(), materialId: 'light' }]]) {
    const h = fixture(voxels)
    try {
      h.requestRender()
      assert.equal(h.frames.length, 1)
      h.frames.shift()()
      assert.equal(h.calls.render, 1)
      assert.equal(h.frames.length, 0)
    } finally { h.manager.dispose() }
  }
})

test('visible flickering sources wait between frames without recomputing unchanged overlays', () => {
  const h = fixture([source()])
  try {
    h.invalidateFrame()
    h.step(0)
    assert.equal(h.frames.length, 0, 'no busy requestAnimationFrame polling between lighting updates')
    assert.equal(h.timers.size, 1)
    h.lightTick()
    assert.equal(h.frames.length, 0)
    assert.equal(h.timers.size, 1)
    assert.deepEqual(h.calls, { render: 2, overlays: 1, highlights: 1, paths: 1, reticules: 1 })
  } finally { h.dispose() }
})

test('clipping the last flickering source stops frames and revealing it resumes animation', () => {
  const h = fixture([source(3)])
  try {
    h.requestRender()
    h.step(0)
    assert.equal(h.timers.size, 1)
    h.manager.setClipY(2)
    h.lightTick()
    assert.equal(h.frames.length, 0, 'the last already-scheduled frame settles the clipped scene')
    assert.equal(h.timers.size, 0)
    h.manager.setClipY(3)
    h.requestRender()
    h.lightTick()
    assert.equal(h.timers.size, 1)
    assert.equal(h.calls.overlays, 1)
    assert.equal(h.calls.highlights, 1)
  } finally { h.dispose() }
})

test('removing the last flickering material stops the loop even when old Light remains', () => {
  const h = fixture([source(), { ...source(0), materialId: 'light' }])
  try {
    h.requestRender()
    h.step(0)
    assert.equal(h.timers.size, 1)
    h.manager.sync(mapOf([{ ...source(0), materialId: 'light' }]))
    h.lightTick()
    assert.equal(h.frames.length, 0)
    assert.equal(h.timers.size, 0)
    assert.equal(h.calls.render, 2)
  } finally { h.dispose() }
})

test('disposing the terrain ends a pending animation and a disposed canvas schedules no frames', () => {
  const h = fixture([source()])
  h.requestRender()
  h.step(0)
  assert.equal(h.timers.size, 1)
  h.manager.dispose()
  h.lightTick()
  assert.equal(h.frames.length, 0)
  assert.equal(h.timers.size, 0)
  assert.equal(h.scene.children.length, 0)

  const disposed = fixture([source()], true)
  disposed.invalidateFrame()
  disposed.requestRender()
  assert.equal(disposed.frames.length, 0)
})

test('a stationary flickering map renders at most 20 times per second on a 165 Hz display', () => {
  const h = fixture([source()])
  try {
    h.requestRender()
    for (let tick = 0; tick < 30 * 165; tick++) h.step(tick * 1000 / 165)
    assert.ok(h.calls.render <= 600, `expected <=600 renders, got ${h.calls.render}`)
    assert.ok(h.calls.render >= 450, 'lighting remains animated throughout the recording')
    assert.equal(h.frames.length, 0)
    assert.equal(h.timers.size, 1)
    assert.equal(h.calls.overlays, 1)
  } finally { h.dispose() }
})

test('input immediately preempts a light tick and keyboard camera movement remains at display refresh rate', () => {
  const h = fixture([source()])
  try {
    h.requestRender(); h.step(0)
    assert.equal(h.timers.size, 1)
    h.keysHeld.add('ArrowUp')
    h.requestRender()
    assert.equal(h.timers.size, 0)
    for (let tick = 1; tick <= 165; tick++) h.step(tick * 1000 / 165)
    assert.equal(h.calls.render, 166)
    assert.equal(h.frames.length, 1)
    assert.equal(h.timers.size, 0)
    h.keysHeld.clear(); h.step(1010)
    assert.equal(h.frames.length, 0)
    assert.equal(h.timers.size, 1)
  } finally { h.dispose() }
})

test('hidden maps cancel lighting timers and input frames, and resume with a fresh visible frame', () => {
  const h = fixture([source()])
  try {
    h.requestRender(); h.step(0)
    h.document.hidden = true
    h.onMapVisibilityChange()
    assert.equal(h.timers.size, 0)
    h.requestRender(); h.step(1000)
    assert.equal(h.calls.render, 1)
    h.document.hidden = false
    h.onMapVisibilityChange(); h.step(1010)
    assert.equal(h.calls.render, 2)
    assert.equal(h.timers.size, 1)
    h.requestRender()
    assert.equal(h.frames.length, 1)
    h.document.hidden = true
    h.onMapVisibilityChange()
    assert.equal(h.frames.length, 0)
    h.lightAnimationClock.dispose()
    h.lightAnimationClock.schedule(2000)
    assert.equal(h.timers.size, 0)
  } finally { h.dispose() }
})
