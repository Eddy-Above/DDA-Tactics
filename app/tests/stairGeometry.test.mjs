import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createStairGeometry, stairDirectionForFace } = loadTypeScript('utils/voxelGeometry.ts')
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)
const directions = { north: new THREE.Vector3(0, 0, -1), east: new THREE.Vector3(1, 0, 0),
  south: new THREE.Vector3(0, 0, 1), west: new THREE.Vector3(-1, 0, 0) }

for (const [direction, uphill] of Object.entries(directions)) {
  test(`${direction} stairs occupy one voxel and expose three rising treads`, () => {
    const geometry = createStairGeometry(direction)
    geometry.computeBoundingBox()
    for (const axis of ['x', 'y', 'z']) {
      close(geometry.boundingBox.min[axis], -0.5)
      close(geometry.boundingBox.max[axis], 0.5)
    }
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld(true)
    for (const [offset, height] of [[-1 / 3, -1 / 6], [0, 1 / 6], [1 / 3, 0.5]]) {
      const origin = uphill.clone().multiplyScalar(offset).setY(2)
      const [hit] = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(mesh)
      assert.ok(hit)
      close(hit.point.y, height)
      close(hit.face.normal.y, 1)
    }
    const [riser] = new THREE.Raycaster(uphill.clone().multiplyScalar(-2).setY(0.3), uphill).intersectObject(mesh)
    assert.ok(riser)
    close(riser.point.dot(uphill), 1 / 6)
    geometry.dispose(); mesh.material.dispose()
  })
}

test('stairs are a closed solid with flat unit normals and no hidden faces between steps', () => {
  const geometry = createStairGeometry()
  const attribute = geometry.getAttribute('position'), normals = geometry.getAttribute('normal')
  assert.equal(attribute.count, 84, '28 outer triangles, without the internal faces of three separate boxes')
  let volume = 0
  const edgeCounts = new Map()
  const key = p => p.toArray().map(value => value.toFixed(5).replace('-0.00000', '0.00000')).join(',')
  for (let i = 0; i < attribute.count; i += 3) {
    const points = [0, 1, 2].map(offset => new THREE.Vector3().fromBufferAttribute(attribute, i + offset))
    const [a, b, c] = points
    const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
    close(normal.length(), 1)
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6
    for (let offset = 0; offset < 3; offset++) close(normal.dot(new THREE.Vector3().fromBufferAttribute(normals, i + offset)), 1)
    for (const [start, end] of [[a, b], [b, c], [c, a]]) {
      const edge = [key(start), key(end)].sort().join('|')
      edgeCounts.set(edge, (edgeCounts.get(edge) ?? 0) + 1)
    }
  }
  close(volume, 2 / 3)
  assert.ok([...edgeCounts.values()].every(count => count === 2), 'the triangle shell has no open or overlapping seams')
  geometry.dispose()
})

test('stairs without a direction default to north', () => {
  const implicit = createStairGeometry(), north = createStairGeometry('north')
  assert.deepEqual(implicit.getAttribute('position').array, north.getAttribute('position').array)
  implicit.dispose(); north.dispose()
})

test('stored stair faces retain their legacy rotations and round-trip new cardinal directions', () => {
  for (const face of Object.keys(directions)) {
    const legacy = new THREE.Group()
    for (let step = 0; step < 3; step++) {
      const height = (step + 1) / 3
      const box = new THREE.Mesh(new THREE.BoxGeometry(1, height, 1 / 3), new THREE.MeshBasicMaterial())
      box.position.set(0, height / 2 - 0.5, (step - 1) / 3)
      legacy.add(box)
    }
    legacy.rotation.y = face === 'north' ? Math.PI : face === 'east' ? -Math.PI / 2 : face === 'west' ? Math.PI / 2 : 0
    legacy.updateMatrixWorld(true)
    const geometry = createStairGeometry(stairDirectionForFace(face))
    const merged = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial())
    merged.updateMatrixWorld(true)
    for (const x of [-0.3, 0, 0.3]) for (const z of [-0.3, 0, 0.3]) {
      const ray = new THREE.Raycaster(new THREE.Vector3(x, 2, z), new THREE.Vector3(0, -1, 0))
      const [oldHit] = ray.intersectObject(legacy, true), [newHit] = ray.intersectObject(merged)
      close(newHit.point.y, oldHit.point.y)
    }
    assert.equal(stairDirectionForFace(stairDirectionForFace(face)), face)
    geometry.dispose(); merged.material.dispose()
    for (const box of legacy.children) { box.geometry.dispose(); box.material.dispose() }
  }
})

test('the stair drawing ghost uses the actual selected direction at the hovered cell', () => {
  for (const direction of Object.keys(directions)) {
    const { makeStairGhostMesh } = loadPageFunctions('components/MapCanvas.vue', ['makeStairGhostMesh'], {
      THREE, createStairGeometry, props: { rampDirection: direction }, TILE_SIZE: 1,
    })
    const ghost = makeStairGhostMesh({ x: 2, y: 3, z: 4 }, 0x88ccff)
    const actual = createStairGeometry(direction)
    assert.deepEqual(ghost.geometry.getAttribute('position').array, actual.getAttribute('position').array)
    assert.deepEqual(ghost.position.toArray(), [2.5, 3.5, 4.5])
    assert.equal(ghost.material.transparent, true)
    actual.dispose(); ghost.geometry.dispose(); ghost.material.dispose()
  }
})
