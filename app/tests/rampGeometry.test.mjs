import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createVoxelGeometry, rampRotationY } = loadTypeScript('utils/voxelGeometry.ts')
const { buildVoxelSurface } = loadTypeScript('utils/voxelSurface.ts')
const { buildLosIndex, MAP_GEOMETRY } = loadTypeScript('utils/lineOfSight.ts')
const voxelMaterials = loadTypeScript('utils/mapVoxels.ts')
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
  let handlers
  const deps = {
    THREE, createVoxelGeometry, rampRotationY, buildVoxelSurface, buildLosIndex, MAP_GEOMETRY,
    ...voxelMaterials,
    props: {
      map: { voxels, groundTiles: [], spaceTiles: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [] },
      destructibleStates: [], activeTool: tool, rampDirection: direction, isDm: true, drawMode: 'square', showSpawnIndicators,
    },
    scene: new THREE.Scene(), voxelMeshes: [], buildMeshes: [], tileMeshes: [], spawnMeshes: [], wallMeshes: [], doorMeshes: new Map(),
    clipY: ref(clipY), ghostWalls: ref(false), transparentVoxelOutline: null,
    losIndex: null, lastAttackKey: '', TILE_SIZE: 1, TILE_H: 0.1, WALL_H: 1,
    hoverGhostGroup: new THREE.Group(), dragStartHit: null,
    vec3Key: ({ x, y, z }) => `${x},${y},${z}`,
    clearTransparentVoxelOutline: () => handlers.clearTransparentVoxelOutline(),
    refreshTransparentVoxels: () => handlers.refreshTransparentVoxels(),
    makeVoxelGhostMesh: (...args) => handlers.makeVoxelGhostMesh(...args),
    planeCell: () => ({ x: 3, y: 2, z: 4 }),
    tilesBetween: () => [{ x: 1, y: 2, z: 4 }, { x: 2, y: 2, z: 4 }, { x: 3, y: 2, z: 4 }],
  }
  handlers = loadPageFunctions('components/MapCanvas.vue', [
    'buildMap', 'clearTransparentVoxelOutline', 'refreshTransparentVoxels', 'makeVoxelGhostMesh', 'updateHoverGhost',
  ], deps)
  return { ...deps, ...handlers }
}

for (const [direction, uphill] of Object.entries(directions)) {
  test(`${direction} map ramp, draw preview and spawn marker follow the same slope`, () => {
    const voxel = { x: 3, y: 2, z: 4, materialId: 'steel', shape: 'ramp', rampDirection: direction, isSpawnPoint: true }
    const h = harness([voxel], { direction })
    h.buildMap()
    h.updateHoverGhost({})
    const [mesh] = h.voxelMeshes, [preview] = h.hoverGhostGroup.children
    assert.deepEqual(vertices(mesh.geometry), vertices(preview.geometry))
    assert.deepEqual(mesh.position.toArray(), [3.5, 2.5, 4.5])
    assert.deepEqual(preview.position.toArray(), mesh.position.toArray())
    assert.equal(mesh.userData.voxel, voxel, 'picking keeps the original voxel and integer cell')

    const [marker] = h.spawnMeshes
    marker.updateMatrixWorld(true)
    for (const local of vertices(marker.geometry)) {
      const position = marker.localToWorld(local).sub(mesh.position)
      close(position.y, position.dot(uphill) + 0.004)
    }
    const edges = h.buildMeshes.filter(object => object.isLineSegments)
    assert.equal(edges.length, 1)
    assert.equal(edges[0].geometry.getAttribute('position').count / 2, 9, 'ramp outline includes all wedge edges')
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
})

test('transparent refresh keeps ramp slopes and outlines beside cubes at every floor cut', () => {
  const ramp = { x: 0, y: 0, z: 0, materialId: 'glass', shape: 'ramp', rampDirection: 'east' }
  const block = { x: 1, y: 0, z: 0, materialId: 'glass' }
  const h = harness([ramp, block])
  h.buildMap()
  const [rampMesh, blockMesh] = h.voxelMeshes
  const original = rampMesh.geometry
  let disposed = false
  original.addEventListener('dispose', () => { disposed = true })
  for (const floor of [-1, 0, 5]) {
    h.clipY.value = floor
    h.refreshTransparentVoxels()
    assert.equal(rampMesh.geometry, original)
    close(volume(rampMesh.geometry), 0.5)
    assert.equal(disposed, false)
    assert.equal(vertices(blockMesh.geometry).length, 36, 'a partial ramp must not hide a cube face')
    const rampOutline = h.buildMeshes.find(object => object.isLineSegments)
    assert.equal(rampOutline.geometry.getAttribute('position').count / 2, 9)
  }
})

test('floor clipping hides ramp meshes, edges and slope markers together after a rebuild', () => {
  const ramp = { x: 0, y: 2, z: 0, materialId: 'water', shape: 'ramp', isSpawnPoint: true }
  for (const floor of [1, 2]) {
    const h = harness([ramp], { clipY: floor })
    h.buildMap()
    assert.equal(h.buildMeshes.length, 3)
    assert.ok(h.buildMeshes.every(object => object.visible === (floor >= 2)))
  }
  const h = harness([ramp], { showSpawnIndicators: false })
  h.buildMap()
  assert.equal(h.spawnMeshes[0].visible, false)
})

test('block brush previews a cube when replacing a ramp; other voxel edits keep its outline', () => {
  const ramp = { x: 0, y: 0, z: 0, materialId: 'earth', shape: 'ramp', rampDirection: 'west' }
  const h = harness([ramp], { tool: 'voxel' })
  close(volume(h.makeVoxelGhostMesh(ramp, 0x88ccff).geometry), 1)
  h.props.activeTool = 'delete'
  close(volume(h.makeVoxelGhostMesh(ramp, 0xff3333).geometry), 0.5)
})
