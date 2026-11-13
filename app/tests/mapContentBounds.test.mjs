import assert from 'node:assert/strict'
import { PerspectiveCamera, Vector3 } from 'three'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { mapContentSize, mapContentSizeLabel, updateMapContentBounds, mapContentCenter, mapContentView } = loadTypeScript('utils/mapContentBounds.ts')

test('empty maps display zero bounds regardless of legacy dimensions', () => {
  assert.equal(mapContentSizeLabel({ dimensions: { width: 20, depth: 20 } }), 'Bounds: (0, 0, 0)')
})

test('display bounds include all terrain collections, negative positions and elevation', () => {
  const map = {
    groundTiles: [{ x: -10, z: -20 }],
    spaceTiles: [{ x: 2, y: -3, z: 4 }],
    voxels: [{ x: 5, y: 6, z: 7 }],
    walls: [{ x: 9, y: 1, z: 2 }],
    ceilings: [{ x: 2, y: 12, z: 3 }],
    stairs: [{ x: 3, y: 4, z: 15 }],
  }
  assert.deepEqual(mapContentSize(map), { x: 20, y: 16, z: 36 })
  assert.equal(mapContentSizeLabel({ contentBounds: updateMapContentBounds(null, map) }), 'Bounds: (20, 16, 36)')
  assert.deepEqual(mapContentSize({ voxels: [{ x: -500, y: 100, z: 700 }] }), { x: 1, y: 1, z: 1 })
})

test('partial saves combine cached collections and shrink after deleting outermost objects', () => {
  const initial = updateMapContentBounds(null, { voxels: [{ x: -100, y: -20, z: -50 }], walls: [{ x: 5, y: 10, z: 7 }] })
  assert.equal(mapContentSizeLabel({ contentBounds: initial }), 'Bounds: (106, 31, 58)')
  const edited = updateMapContentBounds(initial, { voxels: [{ x: -3, y: -4, z: -5 }] })
  assert.equal(mapContentSizeLabel({ contentBounds: edited }), 'Bounds: (9, 15, 13)')
  assert.equal(mapContentSizeLabel({ contentBounds: updateMapContentBounds(edited, { voxels: [] }) }), 'Bounds: (1, 1, 1)')
  const empty = updateMapContentBounds(edited, { voxels: [], walls: [] })
  assert.equal(mapContentSizeLabel({ contentBounds: empty }), 'Bounds: (0, 0, 0)')
})

test('list labels use stored metadata without iterating map content', () => {
  const map = { contentBounds: { x: 2, y: 3, z: 4 }, get voxels() { throw new Error('must not read geometry') } }
  assert.equal(mapContentSizeLabel(map), 'Bounds: (2, 3, 4)')
})

test('initial camera target uses cached world extents, including negative coordinates and elevation', () => {
  assert.deepEqual(mapContentCenter(null), { x: 0, y: 0, z: 0 })
  const bounds = updateMapContentBounds(null, { voxels: [{ x: -20, y: 10, z: -40 }, { x: -10, y: 20, z: -30 }] })
  assert.deepEqual(mapContentCenter(bounds), { x: -14.5, y: 15.5, z: -34.5 })
})

test('corner isometric view fits every content corner in wide and narrow viewports', () => {
  const bounds = updateMapContentBounds(null, { voxels: [{ x: -400, y: -30, z: -100 }, { x: 800, y: 250, z: 400 }] })
  for (const aspect of [0.4, 1, 16 / 9]) {
    const view = mapContentView(bounds, aspect)
    const camera = new PerspectiveCamera(60, aspect, 0.1, view.far)
    camera.position.set(view.position.x, view.position.y, view.position.z)
    camera.lookAt(new Vector3(view.target.x, view.target.y, view.target.z))
    camera.updateMatrixWorld()
    const direction = camera.position.clone().sub(new Vector3(view.target.x, view.target.y, view.target.z)).normalize()
    for (const axis of ['x', 'y', 'z']) assert.ok(Math.abs(direction[axis] - 1 / Math.sqrt(3)) < 1e-10)
    for (const x of [-400, 801]) for (const y of [-30, 251]) for (const z of [-100, 401]) {
      const projected = new Vector3(x, y, z).project(camera)
      assert.ok(Math.abs(projected.x) < 1 && Math.abs(projected.y) < 1 && Math.abs(projected.z) < 1)
    }
  }
})
