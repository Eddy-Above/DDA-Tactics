import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createMapTerrainChunks } = loadTypeScript('utils/mapTerrainChunks.ts')
const source = (y = 2) => ({ x: 0, y, z: 0, materialId: 'flickering-light' })
const mapOf = voxels => ({ id: 'flicker-frames', groundTiles: [], spaceTiles: [], voxels })

function fixture(voxels = [], disposed = false) {
  const scene = new THREE.Scene()
  const manager = createMapTerrainChunks({ scene, tileHeight: 0.12 })
  manager.sync(mapOf(voxels), { clipY: 20 })
  if (disposed) manager.dispose()
  const frames = []
  const calls = { render: 0, overlays: 0, highlights: 0, paths: 0, reticules: 0 }
  let nextFrame = 0
  const dependencies = {
    terrain: manager, scene, camera: new THREE.PerspectiveCamera(),
    rafId: 0, canvasDisposed: disposed, renderer: { render: () => calls.render++ },
    requestAnimationFrame: callback => { frames.push(callback); return ++nextFrame },
    controls: { update: () => {} }, keysHeld: new Set(), azimuthTween: null,
    overlaysDirty: true, highlightsDirty: true, reticulesDirty: true, pendingPointerEvent: null,
    pendingMovePos: ref(null), movePendingScreen: ref(null),
    applyKeyMovement: () => {}, tickAzimuthTween: () => {},
    updateCharacterOverlays: () => calls.overlays++, updateRadialScreen: () => {},
    updateMovementHighlights: () => calls.highlights++, updatePathHighlights: () => calls.paths++,
    updateReticules: () => calls.reticules++, onMouseMove: () => {},
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue',
    ['requestRender', 'invalidateFrame', 'animate'], dependencies)
  return { manager, scene, frames, calls, ...handlers }
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

test('visible flickering sources keep frames active without recomputing unchanged overlays', () => {
  const h = fixture([source()])
  try {
    h.invalidateFrame()
    h.frames.shift()()
    assert.equal(h.frames.length, 1)
    h.frames.shift()()
    assert.equal(h.frames.length, 1)
    assert.deepEqual(h.calls, { render: 2, overlays: 1, highlights: 1, paths: 1, reticules: 1 })
  } finally { h.manager.dispose() }
})

test('clipping the last flickering source stops frames and revealing it resumes animation', () => {
  const h = fixture([source(3)])
  try {
    h.requestRender()
    h.frames.shift()()
    assert.equal(h.frames.length, 1)
    h.manager.setClipY(2)
    h.frames.shift()()
    assert.equal(h.frames.length, 0, 'the last already-scheduled frame settles the clipped scene')
    h.manager.setClipY(3)
    h.requestRender()
    h.frames.shift()()
    assert.equal(h.frames.length, 1)
    assert.equal(h.calls.overlays, 1)
    assert.equal(h.calls.highlights, 1)
  } finally { h.manager.dispose() }
})

test('removing the last flickering material stops the loop even when old Light remains', () => {
  const h = fixture([source(), { ...source(0), materialId: 'light' }])
  try {
    h.requestRender()
    h.frames.shift()()
    assert.equal(h.frames.length, 1)
    h.manager.sync(mapOf([{ ...source(0), materialId: 'light' }]))
    h.frames.shift()()
    assert.equal(h.frames.length, 0)
    assert.equal(h.calls.render, 2)
  } finally { h.manager.dispose() }
})

test('disposing the terrain ends a pending animation and a disposed canvas schedules no frames', () => {
  const h = fixture([source()])
  h.requestRender()
  h.frames.shift()()
  assert.equal(h.frames.length, 1)
  h.manager.dispose()
  h.frames.shift()()
  assert.equal(h.frames.length, 0)
  assert.equal(h.scene.children.length, 0)

  const disposed = fixture([source()], true)
  disposed.invalidateFrame()
  disposed.requestRender()
  assert.equal(disposed.frames.length, 0)
})
