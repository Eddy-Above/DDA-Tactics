import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { createMapTerrainChunks, terrainChunkKey } = loadTypeScriptWithMocks('utils/mapTerrainChunks.ts', { '~/utils/mapEdits': mapEdits })
const { recordMapEdit } = mapEdits
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const voxel = (x = 0, y = 0, z = 0, materialId = 'earth', rest = {}) => ({ x, y, z, materialId, ...rest })
const mapOf = (values = {}) => ({ id: 'map', groundTiles: [], spaceTiles: [], voxels: [], ...values })
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-5, `${a} != ${b}`)
const down = (x, z, y = 5) => new THREE.Raycaster(new THREE.Vector3(x, y, z), new THREE.Vector3(0, -1, 0))
const lines = manager => [...manager.chunks.values()].flatMap(group => group.children.filter(child => child.isLineSegments))
const objects = manager => [...manager.chunks.values()].flatMap(group => group.children)

function fixture(options = {}) {
  const scene = new THREE.Scene()
  const manager = createMapTerrainChunks({ scene, tileHeight: 0.12, ...options })
  return { scene, manager }
}

for (const count of [10000, 50000]) {
  test(`${count} floor cells render with more than 90% fewer objects and draw batches`, () => {
    const { scene, manager } = fixture()
    const groundTiles = Array.from({ length: count }, (_, i) => ({ ...point(i % 100, 0, Math.floor(i / 100)), element: 'void', terrain: 'normal' }))
    manager.sync(mapOf({ groundTiles }), { clipY: 20 })
    const stats = manager.stats()
    assert.equal(stats.instances, count)
    assert.ok(stats.drawCalls < count * 2 * 0.1)
    assert.ok(stats.objects < count * 2 * 0.1)
    assert.equal(stats.geometries, 1)
    assert.equal(stats.materials, 2)
    assert.ok(objects(manager).some(object => object.isInstancedMesh))
    const [hit] = manager.pick(down(30.5, 30.5))
    assert.equal(hit.object.userData.type, 'ground')
    assert.deepEqual(hit.object.userData.tile, groundTiles[3030])
    close(hit.point.y, 0.12)
    manager.dispose()
    assert.equal(scene.children.length, 0)
  })
}

test('local edits retain distant chunk identities and structure-only edits leave terrain intact', () => {
  const { manager } = fixture()
  const map = mapOf({ voxels: [voxel(0), voxel(32), voxel(-32)] })
  manager.sync(map)
  const distant = manager.chunks.get(terrainChunkKey(point(32)))
  const distantGeometry = distant.children[0].geometry
  const firstGeometry = manager.chunks.get(terrainChunkKey(point())).children[0].geometry
  const next = recordMapEdit(map, { ...map, voxels: [voxel(0, 0, 0, 'wood'), ...map.voxels.slice(1)] }, ['voxels'], [point()])
  manager.sync(next)
  assert.deepEqual(manager.stats().lastRebuiltChunkKeys, ['0,0,0'])
  assert.equal(manager.chunks.get(terrainChunkKey(point(32))), distant)
  assert.equal(distant.children[0].geometry, distantGeometry)
  assert.equal(distant.children[0].geometry, firstGeometry, 'unchanged chunks keep shared geometry alive')
  const built = manager.stats().builtChunks
  const structureEdit = recordMapEdit(next, { ...next, doors: [{ id: 'door', wallId: 'wall', isOpen: true }] }, ['doors'], [point()])
  manager.sync(structureEdit)
  assert.equal(manager.stats().builtChunks, built)
  assert.deepEqual(manager.stats().lastRebuiltChunkKeys, [])
  manager.dispose()
})

test('transparent cube faces and crease outlines merge across chunk boundaries', () => {
  const { scene, manager } = fixture()
  manager.sync(mapOf({ voxels: [voxel(15, 0, 0, 'water'), voxel(16, 0, 0, 'water')] }))
  assert.equal(manager.stats().transparentInstances, 2)
  const batches = scene.children.filter(child => child.isBatchedMesh)
  assert.equal(batches.length, 1)
  assert.equal(batches[0].sortObjects, true)
  const ray = new THREE.Raycaster(new THREE.Vector3(15.5, 0.5, 0.5), new THREE.Vector3(1, 0, 0))
  assert.deepEqual(manager.pick(ray), [], 'no internal face is hit from inside the volume')
  const [hit] = manager.pick(new THREE.Raycaster(new THREE.Vector3(18, 0.5, 0.5), new THREE.Vector3(-1, 0, 0)))
  close(hit.point.x, 17)
  const segments = lines(manager).reduce((sum, line) => sum + line.geometry.getAttribute('position').count / 2, 0)
  assert.equal(segments, 16, 'outer long edges retain their grid-length segments without a flat boundary seam')
  for (const line of lines(manager)) {
    const positions = line.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i += 2) {
      assert.equal(positions.getX(i) === 16 && positions.getX(i + 1) === 16, false, 'the shared plane has no flat-face outline')
    }
  }
  manager.dispose()
})

test('a single transparent batch preserves mixed material color, opacity and per-cell sorting', () => {
  const { scene, manager } = fixture()
  manager.sync(mapOf({ voxels: [voxel(0, 0, 0, 'water'), voxel(20, 0, 0, 'glass', { color: '#ff0000', opacity: 0.2 })] }))
  const [batch] = scene.children.filter(child => child.isBatchedMesh)
  assert.equal(scene.children.filter(child => child.isBatchedMesh).length, 1)
  const colors = [0, 1].map(id => batch.getColorAt(id, new THREE.Vector4()))
  assert.ok(colors.some(color => Math.abs(color.w - 0.48) < 1e-5))
  const red = colors.find(color => Math.abs(color.w - 0.2) < 1e-5)
  close(red.x, 1); close(red.y, 0); close(red.z, 0)
  assert.equal(batch.material.depthWrite, false)
  assert.equal(batch.sortObjects, true)
  assert.equal(batch.castShadow, true)
  manager.dispose()
})

test('clipping exposes newly cut transparent tops and excludes hidden terrain from picking and occlusion', () => {
  const { manager } = fixture()
  manager.sync(mapOf({ voxels: [voxel(0, 0, 0, 'water'), voxel(0, 1, 0, 'water')] }), { clipY: 1 })
  close(manager.pick(down(0.5, 0.5))[0].point.y, 2)
  manager.setClipY(0)
  close(manager.pick(down(0.5, 0.5))[0].point.y, 1)
  assert.equal(manager.isOccluded(down(0.5, 0.5)), true)
  manager.setClipY(-1)
  assert.deepEqual(manager.pick(down(0.5, 0.5)), [])
  assert.equal(manager.isOccluded(down(0.5, 0.5)), false)
  manager.setClipY(1)
  close(manager.pick(down(0.5, 0.5))[0].point.y, 2)
  manager.dispose()
})

for (const [direction, axis, sign] of [['north', 'z', -1], ['east', 'x', 1], ['south', 'z', 1], ['west', 'x', -1]]) {
  test(`${direction} ramp picking and instanced spawn markers follow the slope`, () => {
    const { manager } = fixture()
    const ramp = voxel(0, 0, 0, 'earth', { shape: 'ramp', rampDirection: direction, isSpawnPoint: true })
    manager.sync(mapOf({ voxels: [ramp] }))
    const x = axis === 'x' ? 0.5 + sign * 0.3 : 0.5
    const z = axis === 'z' ? 0.5 + sign * 0.3 : 0.5
    const [hit] = manager.pick(down(x, z))
    close(hit.point.y, 0.8)
    assert.equal(hit.object.userData.voxel, ramp)
    const marker = objects(manager).find(object => object.userData.spawn)
    const matrix = new THREE.Matrix4()
    marker.getMatrixAt(0, matrix)
    const positions = marker.geometry.getAttribute('position')
    for (let i = 0; i < positions.count; i++) {
      const v = new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(matrix)
      close(v.y, (v[axis] - 0.5) * sign + 0.504)
    }
    manager.setSpawnVisible(false)
    assert.equal(marker.visible, false)
    manager.setSpawnVisible(true)
    assert.equal(marker.visible, true)
    manager.dispose()
  })
}

test('ground blends use global neighbours and release unused textures and shared resources', () => {
  let textures = 0, released = 0
  const { scene, manager } = fixture({
    makeBlendTexture: () => { textures++; return new THREE.Texture() },
    releaseBlendTexture: texture => { released++; texture.dispose() },
  })
  const groundTiles = [{ ...point(15), element: 'earth', terrain: 'normal' }, { ...point(16), element: 'wood', terrain: 'normal' }]
  const map = mapOf({ groundTiles })
  manager.sync(map)
  assert.equal(textures, 2)
  assert.equal(manager.stats().textures, 2)
  assert.equal(objects(manager).filter(object => object.material?.map).length, 2)
  const next = recordMapEdit(map, { ...map, groundTiles: groundTiles.map(tile => ({ ...tile, element: 'wood' })) }, ['groundTiles'], [point(15)])
  manager.sync(next)
  assert.equal(released, 2)
  assert.equal(manager.stats().textures, 0)
  let disposed = 0
  const shared = new Set(objects(manager).map(object => object.geometry))
  for (const geometry of shared) geometry.addEventListener('dispose', () => disposed++)
  manager.dispose()
  assert.equal(disposed, shared.size)
  assert.equal(scene.children.length, 0)
})

test('repeated replacement/deletion releases instances and keeps geometry/material caches bounded', () => {
  const { manager } = fixture()
  let map = mapOf({ voxels: [voxel()] })
  manager.sync(map)
  for (let i = 0; i < 25; i++) {
    const next = recordMapEdit(map, { ...map, voxels: [voxel(0, 0, 0, i % 2 ? 'wood' : 'earth')] }, ['voxels'], [point()])
    manager.sync(next)
    map = next
    assert.equal(manager.stats().geometries, 1)
    assert.equal(manager.stats().materials, 2)
    assert.equal(manager.stats().objects, 2)
  }
  const deleted = recordMapEdit(map, { ...map, voxels: [] }, ['voxels'], [point()])
  manager.sync(deleted)
  assert.equal(manager.stats().chunks, 0)
  assert.equal(manager.stats().objects, 0)
  assert.equal(manager.stats().geometries, 0)
  assert.equal(manager.stats().materials, 0)
  assert.ok(manager.stats().disposedGeometries >= 25)
  manager.dispose()
})

test('fifty transparent edits reuse instance slots and bound exposed-face geometry variants', () => {
  const { scene, manager } = fixture()
  let map = mapOf({ voxels: [voxel(0, 0, 0, 'water'), voxel(1, 0, 0, 'water')] })
  manager.sync(map)
  const [batch] = scene.children.filter(object => object.isBatchedMesh)
  const capacity = batch.maxInstanceCount
  for (let i = 0; i < 50; i++) {
    const next = recordMapEdit(map, { ...map, voxels: [map.voxels[0], voxel(1, 0, 0, i % 2 ? 'water' : 'glass')] }, ['voxels'], [point(1)])
    manager.sync(next)
    map = next
    manager.setClipY(i % 3 === 0 ? -1 : 0)
    assert.equal(manager.stats().transparentInstances, 2)
    assert.equal(batch.instanceCount, 2)
    assert.equal(batch.maxInstanceCount, capacity)
    assert.ok(manager.stats().geometries <= 4, 'only full/east-cut/west-cut cube variants are retained')
  }
  let geometryDisposals = 0, materialDisposals = 0
  batch.geometry.addEventListener('dispose', () => geometryDisposals++)
  batch.material.addEventListener('dispose', () => materialDisposals++)
  manager.dispose()
  assert.equal(geometryDisposals, 1)
  assert.equal(materialDisposals, 1)
  assert.equal(scene.children.length, 0)
})
