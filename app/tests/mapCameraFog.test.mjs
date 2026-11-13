import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { mapContentView, updateMapContentBounds } = loadTypeScript('utils/mapContentBounds.ts')

test('fitted fog regains normal encounter density when zooming into a large map and restores on zoom out', () => {
  const bounds = updateMapContentBounds(null, { voxels: [{ x: -100, y: 0, z: -100 }, { x: 100, y: 20, z: 100 }] })
  const view = mapContentView(bounds, 16 / 9)
  const target = new THREE.Vector3(view.target.x, view.target.y, view.target.z)
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(view.position.x, view.position.y, view.position.z)
  const fitDistance = camera.position.distanceTo(target)
  const scene = new THREE.Scene()
  scene.fog = new THREE.FogExp2(0x1a1a2e, view.fogDensity)
  const { updateCameraFog } = loadPageFunctions('components/MapCanvas.vue', ['updateCameraFog'], {
    THREE, scene, camera, controls: { target }, fogReferenceDistance: fitDistance, fogReferenceDensity: view.fogDensity,
  })
  updateCameraFog()
  assert.equal(scene.fog.density, view.fogDensity, 'the fitted overview keeps its readable fog')
  camera.position.copy(target).add(new THREE.Vector3(0, 0, 20))
  updateCameraFog()
  assert.equal(scene.fog.density, 0.04)
  const fade = 1 - Math.exp(-((scene.fog.density * 20) ** 2))
  assert.ok(fade > 0.45, 'fog is visibly present at encounter zoom')
  target.addScalar(1000); camera.position.addScalar(1000)
  updateCameraFog()
  assert.equal(scene.fog.density, 0.04, 'panning does not dilute fog')
  camera.position.copy(target).add(new THREE.Vector3(0, 0, fitDistance))
  updateCameraFog()
  assert.equal(scene.fog.density, view.fogDensity)
  camera.position.copy(target).add(new THREE.Vector3(0, 0, fitDistance * 2))
  updateCameraFog()
  assert.equal(scene.fog.density, view.fogDensity / 2, 'zooming further out does not hide the whole map in fog')
  camera.position.copy(target)
  updateCameraFog()
  assert.equal(scene.fog.density, 0.04, 'zero camera distance remains finite')
})
