import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { createMapTerrainChunks } = loadTypeScriptWithMocks('utils/mapTerrainChunks.ts', { '~/utils/mapEdits': mapEdits })
const { voxelLightFlicker } = loadTypeScript('utils/mapVoxelLights.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const source = (x = 0, y = 0, z = 0, extra = {}) => ({ ...point(x, y, z), materialId: 'flickering-light', ...extra })
const mapOf = voxels => ({ id: 'flickering-terrain', groundTiles: [], spaceTiles: [], voxels })
const lights = scene => scene.children.filter(child => child.isPointLight)
const batchOf = scene => scene.children.find(child => child.isBatchedMesh)
const close = (actual, expected, message) => assert.ok(Math.abs(actual - expected) < 1e-5, message ?? `${actual} != ${expected}`)
function fixture(voxels) {
  const scene = new THREE.Scene()
  const manager = createMapTerrainChunks({ scene, tileHeight: 0.12 })
  const map = mapOf(voxels)
  manager.sync(map)
  return { scene, manager, map }
}

test('a flickering voxel casts real local light while only its own batch tint animates', () => {
  const h = fixture([source(), { ...point(2), materialId: 'water' }, { ...point(3), materialId: 'light' }])
  try {
    const [lamp] = lights(h.scene), batch = batchOf(h.scene)
    assert.equal(lamp.isPointLight, true)
    assert.equal(lamp.distance, 5)
    assert.equal(lamp.castShadow, false)
    assert.deepEqual(lamp.position.toArray(), [0.5, 0.5, 0.5])
    assert.equal(batch.material.isMeshLambertMaterial, true, 'the shared terrain material receives local illumination')
    assert.equal(batch.material.emissive.getHex(), 0, 'ordinary transparent materials do not acquire shared emission')
    const original = [0, 1, 2].map(id => batch.getColorAt(id, new THREE.Vector4()).clone())
    const before = h.manager.stats(), saved = JSON.stringify(h.map), revision = mapEdits.getMapGeometryRevision(h.map)
    for (let frame = 0; frame < 120; frame++) {
      assert.equal(h.manager.updateAnimation(frame / 60), true)
      const tint = batch.getColorAt(0, new THREE.Vector4())
      const factor = lamp.intensity / 2.5
      assert.ok(factor >= 0.94 && factor <= 1.06)
      close(tint.y / original[0].y, factor, 'the visible lamp and its emitted light flicker together')
      close(tint.w, original[0].w, 'flickering does not change transparency')
      assert.deepEqual(batch.getColorAt(1, new THREE.Vector4()), original[1])
      assert.deepEqual(batch.getColorAt(2, new THREE.Vector4()), original[2])
    }
    assert.deepEqual(h.manager.stats(), before, 'animation does not rebuild geometry or allocate rendering resources')
    assert.equal(lights(h.scene)[0], lamp)
    assert.equal(batchOf(h.scene), batch)
    assert.equal(batch.sortObjects, true)
    assert.equal(JSON.stringify(h.map), saved, 'animation cannot change saved map values or trigger autosaves')
    assert.equal(mapEdits.getMapGeometryRevision(h.map), revision)
  } finally { h.manager.dispose() }
})

test('gentle flicker is smooth, deterministic and always within six percent of its base', () => {
  for (const phase of [0, 0.5, 19.2]) {
    let previous = voxelLightFlicker(0, phase)
    for (let tick = 0; tick < 1200; tick++) {
      const value = voxelLightFlicker(tick / 60, phase)
      assert.ok(value >= 0.94 && value <= 1.06)
      assert.ok(Math.abs(value - previous) < 0.005, 'adjacent frames never flash abruptly')
      assert.equal(value, voxelLightFlicker(tick / 60, phase))
      previous = value
    }
  }
})

test('only matching connected source cells share a light and custom colors remain distinct', () => {
  const h = fixture([source(), source(1), source(2, 0, 0, { color: '#ff0000' }), source(5), source(16)])
  try {
    assert.equal(h.manager.stats().lightSources, 4)
    assert.equal(h.manager.stats().lightSourceCells, 5)
    const cluster = lights(h.scene).find(light => light.userData.sourceCells === 2)
    assert.deepEqual(cluster.position.toArray(), [1, 0.5, 0.5])
    close(cluster.distance, 5.5, 'the combined source retains the reach of its edge cells')
    close(cluster.intensity, 5)
    const red = lights(h.scene).find(light => light.color.getHex() === 0xff0000)
    assert.ok(red)
    assert.deepEqual(red.position.toArray(), [2.5, 0.5, 0.5])
  } finally { h.manager.dispose() }
})

test('fully enclosed source cells still emit light when their internal faces are removed', () => {
  const voxels = []
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) voxels.push(source(x, y, z))
  const h = fixture(voxels)
  try {
    assert.equal(h.manager.stats().transparentInstances, 26)
    assert.equal(h.manager.stats().lightSourceCells, 27)
    assert.equal(lights(h.scene).length, 3, 'each elevation retains its connected source volume')
    assert.equal(h.manager.updateAnimation(1), true)
    h.manager.setClipY(-1)
    assert.equal(h.manager.updateAnimation(2), false)
    assert.ok(lights(h.scene).every(light => !light.visible))
    h.manager.setClipY(0)
    assert.equal(h.manager.updateAnimation(3), true)
    assert.equal(lights(h.scene).filter(light => light.visible).length, 1)
  } finally { h.manager.dispose() }
})

test('opaque overrides and ramps still flicker and retain cell geometry/picking', () => {
  for (const shape of ['block', 'ramp']) {
    const h = fixture([source(0, 0, 0, { opacity: 1, shape, rampDirection: 'north', color: '#88ddff' })])
    try {
      const mesh = [...h.manager.chunks.values()][0].children.find(child => child.isInstancedMesh)
      const before = new THREE.Color()
      mesh.getColorAt(0, before)
      assert.equal(h.manager.updateAnimation(1), true)
      const after = new THREE.Color()
      mesh.getColorAt(0, after)
      assert.notDeepEqual(before.toArray(), after.toArray())
      assert.equal(lights(h.scene).length, 1)
      assert.equal(lights(h.scene)[0].color.getHex(), 0x88ddff)
      const [hit] = h.manager.pick(new THREE.Raycaster(new THREE.Vector3(0.5, 3, 0.5), new THREE.Vector3(0, -1, 0)))
      assert.equal(hit.object.userData.voxel, h.map.voxels[0])
      close(hit.point.y, shape === 'ramp' ? 0.5 : 1)
    } finally { h.manager.dispose() }
  }
})

test('clipping and removal release source lights; repeated edit/undo cycles retain no lights', () => {
  const h = fixture([])
  let map = h.map, disposals = 0
  try {
    for (let cycle = 0; cycle < 30; cycle++) {
      map = mapEdits.recordMapEdit(map, { ...map, voxels: [source()] }, ['voxels'], [point()])
      h.manager.sync(map)
      assert.equal(lights(h.scene).length, 1)
      lights(h.scene)[0].addEventListener('dispose', () => disposals++)
      h.manager.updateAnimation(cycle)
      map = mapEdits.recordMapEdit(map, { ...map, voxels: [] }, ['voxels'], [point()])
      h.manager.sync(map)
      assert.equal(lights(h.scene).length, 0)
      assert.equal(h.manager.stats().lightSourceCells, 0)
      assert.equal(h.manager.updateAnimation(cycle + 0.5), false)
    }
    assert.equal(disposals, 30)
    h.manager.sync(mapOf([source(0, 21)]))
    assert.equal(h.manager.updateAnimation(1), false, 'the default Y clip also applies to local light influence')
    h.manager.sync(mapOf([source(0, 0, 0, { feature: 'window' })]))
    assert.equal(lights(h.scene).length, 0, 'a carved window is not an emitting source')
  } finally { h.manager.dispose() }
  assert.equal(h.scene.children.length, 0)
})
