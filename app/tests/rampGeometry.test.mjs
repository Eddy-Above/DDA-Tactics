import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createVoxelGeometry, rampRotationY } = loadTypeScript('utils/voxelGeometry.ts')
const { createMapTerrainChunks } = loadTypeScript('utils/mapTerrainChunks.ts')
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)
const directions = {
  north: new THREE.Vector3(0, 0, -1),
  east: new THREE.Vector3(1, 0, 0),
  south: new THREE.Vector3(0, 0, 1),
  west: new THREE.Vector3(-1, 0, 0),
}

function vertices(geometry) {
  const positions = geometry.getAttribute('position')
  const indices = geometry.getIndex()
  return Array.from({ length: indices?.count ?? positions.count }, (_, i) =>
    new THREE.Vector3().fromBufferAttribute(positions, indices ? indices.getX(i) : i))
}

function volume(geometry) {
  const points = vertices(geometry)
  let result = 0
  for (let i = 0; i < points.length; i += 3) {
    result += points[i].dot(new THREE.Vector3().crossVectors(points[i + 1], points[i + 2])) / 6
  }
  return result
}

for (const [direction, uphill] of Object.entries(directions)) {
  test(`${direction} ramp is a closed half-cell wedge with outward flat normals`, () => {
    const geometry = createVoxelGeometry({ shape: 'ramp', rampDirection: direction })
    geometry.computeBoundingBox()
    const { min, max } = geometry.boundingBox
    for (const axis of ['x', 'y', 'z']) { close(min[axis], -0.5); close(max[axis], 0.5) }
    close(volume(geometry), 0.5)

    const points = vertices(geometry)
    assert.equal(points.length, 24, 'five faces require eight nondegenerate triangles')
    const center = uphill.clone().multiplyScalar(1 / 6).setY(-1 / 6)
    const normals = geometry.getAttribute('normal')
    const edges = new Map()
    const pointKey = p => p.toArray().map(value => value.toFixed(5).replace('-0.00000', '0.00000')).join(',')
    for (let i = 0; i < points.length; i += 3) {
      const [a, b, c] = points.slice(i, i + 3)
      const normal = new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize()
      const triangleCenter = a.clone().add(b).add(c).divideScalar(3)
      assert.ok(normal.dot(triangleCenter.sub(center)) > 0, 'every triangle faces outside the wedge')
      for (let j = 0; j < 3; j++) close(normal.dot(new THREE.Vector3().fromBufferAttribute(normals, i + j)), 1)
      for (const [start, end] of [[a, b], [b, c], [c, a]]) {
        const key = [pointKey(start), pointKey(end)].sort().join('|')
        edges.set(key, (edges.get(key) ?? 0) + 1)
      }
    }
    assert.ok([...edges.values()].every(count => count === 2), 'each triangle edge closes against another triangle')
    geometry.dispose()
  })

  test(`${direction} ramp raycasts hit the rising slope and leave its empty upper half open`, () => {
    const mesh = new THREE.Mesh(createVoxelGeometry({ shape: 'ramp', rampDirection: direction }), new THREE.MeshBasicMaterial())
    mesh.updateMatrixWorld(true)
    for (const distance of [-0.3, 0, 0.3]) {
      const origin = uphill.clone().multiplyScalar(distance).setY(2)
      const [hit] = new THREE.Raycaster(origin, new THREE.Vector3(0, -1, 0)).intersectObject(mesh)
      assert.ok(hit)
      close(hit.point.y, distance)
    }
    const origin = uphill.clone().multiplyScalar(-2).setY(0.3)
    const [hit] = new THREE.Raycaster(origin, uphill).intersectObject(mesh)
    assert.ok(hit)
    close(hit.point.dot(uphill), 0.3)
    mesh.geometry.dispose(); mesh.material.dispose()
  })
}

test('legacy voxels remain cubes and omitted ramp directions ascend north', () => {
  for (const definition of [{}, { shape: 'block' }]) {
    const geometry = createVoxelGeometry(definition)
    assert.equal(vertices(geometry).length, 36)
    close(volume(geometry), 1)
    geometry.dispose()
  }
  const implicit = createVoxelGeometry({ shape: 'ramp' })
  const explicit = createVoxelGeometry({ shape: 'ramp', rampDirection: 'north' })
  assert.deepEqual(vertices(implicit), vertices(explicit))
  implicit.dispose(); explicit.dispose()
})

function harness(voxels, { clipY = 10, direction = 'north', tool = 'ramp', showSpawnIndicators = true } = {}) {
  const deps = {
    THREE, createVoxelGeometry, rampRotationY,
    props: {
      map: { id: 'map', voxels, groundTiles: [], spaceTiles: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [] },
      destructibleStates: [], activeTool: tool, rampDirection: direction, isDm: true, drawMode: 'square', showSpawnIndicators,
    },
    scene: new THREE.Scene(), TILE_SIZE: 1, TILE_H: 0.1,
    hoverGhostGroup: new THREE.Group(), dragStartHit: null,
    vec3Key: ({ x, y, z }) => `${x},${y},${z}`,
    planeCell: () => ({ x: 3, y: 2, z: 4 }),
    tilesBetween: () => [{ x: 1, y: 2, z: 4 }, { x: 2, y: 2, z: 4 }, { x: 3, y: 2, z: 4 }],
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue', ['makeVoxelGhostMesh', 'updateHoverGhost'], deps)
  const manager = createMapTerrainChunks({ scene: deps.scene, tileHeight: 0.1 })
  manager.sync(deps.props.map, { clipY, showSpawnIndicators })
  const meshes = () => [...manager.chunks.values()].flatMap(group => group.children)
  return { ...deps, ...handlers, manager, meshes }
}

for (const [direction, uphill] of Object.entries(directions)) {
  test(`${direction} map ramp, draw preview and spawn marker follow the same slope`, () => {
    const voxel = { x: 3, y: 2, z: 4, materialId: 'steel', shape: 'ramp', rampDirection: direction, isSpawnPoint: true }
    const h = harness([voxel], { direction })
    h.updateHoverGhost({})
    const mesh = h.meshes().find(object => object.isInstancedMesh && !object.userData.spawn)
    const [preview] = h.hoverGhostGroup.children
    assert.deepEqual(vertices(mesh.geometry), vertices(preview.geometry))
    const matrix = new THREE.Matrix4()
    mesh.getMatrixAt(0, matrix)
    const center = new THREE.Vector3().setFromMatrixPosition(matrix)
    assert.deepEqual(center.toArray(), [3.5, 2.5, 4.5])
    assert.deepEqual(preview.position.toArray(), center.toArray())
    const [hit] = h.manager.pick(new THREE.Raycaster(new THREE.Vector3(3.5, 8, 4.5), new THREE.Vector3(0, -1, 0)))
    assert.equal(hit.object.userData.voxel, voxel, 'picking keeps the original voxel and integer cell')

    const marker = h.meshes().find(object => object.userData.spawn)
    marker.getMatrixAt(0, matrix)
    for (const local of vertices(marker.geometry)) {
      const position = local.applyMatrix4(matrix).sub(center)
      close(position.y, position.dot(uphill) + 0.004)
    }
    const edges = h.meshes().filter(object => object.isLineSegments)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].geometry.getAttribute('position').count / 2, 9, 'ramp outline includes all wedge edges')
    h.manager.dispose()
  })
}

test('dragging the ramp brush previews a wedge in every covered cell', () => {
  const h = harness([], { direction: 'east' })
  h.dragStartHit = { type: 'cell', cell: { x: 1, y: 2, z: 4 } }
  // Function dependencies are explicit, so set the shared starting hit through a new harness function.
  const handlers = loadPageFunctions('components/MapCanvas.vue', ['updateHoverGhost'], {
    ...h, dragStartHit: h.dragStartHit,
  })
  handlers.updateHoverGhost({})
  assert.equal(h.hoverGhostGroup.children.length, 3)
  for (const mesh of h.hoverGhostGroup.children) close(volume(mesh.geometry), 0.5)
  h.manager.dispose()
})

test('transparent refresh keeps ramp slopes and outlines beside cubes at every floor cut', () => {
  const ramp = { x: 0, y: 0, z: 0, materialId: 'glass', shape: 'ramp', rampDirection: 'east' }
  const block = { x: 1, y: 0, z: 0, materialId: 'glass' }
  const h = harness([ramp, block])
  for (const floor of [-1, 0, 5]) {
    h.manager.setClipY(floor)
    const rampHits = h.manager.pick(new THREE.Raycaster(new THREE.Vector3(0.8, 5, 0.5), new THREE.Vector3(0, -1, 0)))
    if (floor < 0) { assert.deepEqual(rampHits, []); continue }
    close(rampHits[0].point.y, 0.8)
    close(volume(rampHits[0].object.geometry), 0.5)
    const blockHits = h.manager.pick(new THREE.Raycaster(new THREE.Vector3(1.5, 5, 0.5), new THREE.Vector3(0, -1, 0)))
    assert.equal(vertices(blockHits[0].object.geometry).length, 36, 'a partial ramp must not hide a cube face')
    const rampOutline = h.meshes().find(object => object.isLineSegments && object.geometry.getAttribute('position').count / 2 === 9)
    assert.equal(rampOutline.geometry.getAttribute('position').count / 2, 9)
  }
  h.manager.dispose()
})

test('floor clipping hides ramp meshes, edges and slope markers together after a rebuild', () => {
  const ramp = { x: 0, y: 2, z: 0, materialId: 'water', shape: 'ramp', isSpawnPoint: true }
  for (const floor of [1, 2]) {
    const h = harness([ramp], { clipY: floor })
    assert.ok([...h.manager.chunks.values()].every(group => group.visible === (floor >= 2)))
    const hits = h.manager.pick(new THREE.Raycaster(new THREE.Vector3(0.5, 8, 0.5), new THREE.Vector3(0, -1, 0)))
    assert.equal(hits.length > 0, floor >= 2)
    h.manager.dispose()
  }
  const h = harness([ramp], { showSpawnIndicators: false })
  assert.equal(h.meshes().find(object => object.userData.spawn).visible, false)
  h.manager.dispose()
})

test('block brush previews a cube when replacing a ramp; other voxel edits keep its outline', () => {
  const ramp = { x: 0, y: 0, z: 0, materialId: 'earth', shape: 'ramp', rampDirection: 'west' }
  const h = harness([ramp], { tool: 'voxel' })
  close(volume(h.makeVoxelGhostMesh(ramp, 0x88ccff).geometry), 1)
  h.props.activeTool = 'delete'
  close(volume(h.makeVoxelGhostMesh(ramp, 0xff3333).geometry), 0.5)
  h.manager.dispose()
})
