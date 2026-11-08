import assert from 'node:assert/strict'
import { test } from 'node:test'
import * as THREE from 'three'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildVoxelSurface } = loadTypeScript('utils/voxelSurface.ts')
const { computeAreaCells } = loadTypeScript('utils/areaShapes.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const key = p => `${p.x},${p.y},${p.z}`
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-5, `${actual} != ${expected}`)

function harness() {
  const deps = {
    THREE, buildVoxelSurface, vec3Key: key, TILE_SIZE: 1, TILE_H: 0.1,
    aoeGroup: new THREE.Group(), areaHighlightCells: ref([]), lastAoeKey: '', lastAttackKey: '',
    lastAreaShapeData: ref({}), resetPassState: () => {},
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue', [
    'clearAoeHighlights', 'renderAoeVolume', 'updateAoeHighlight', 'clearAoeState',
  ], deps)
  return { ...deps, ...handlers }
}

const fills = h => h.aoeGroup.children.filter(child => child.isMesh)
const outline = h => h.aoeGroup.children.find(child => child.isLineSegments)
const triangles = h => fills(h).reduce((count, mesh) => count + mesh.geometry.getAttribute('position').count / 3, 0)
function vertices(object) {
  const positions = object.geometry.getAttribute('position')
  return Array.from({ length: positions.count }, (_, i) => [positions.getX(i), positions.getY(i), positions.getZ(i)])
}
function segments(h) {
  const positions = vertices(outline(h))
  return Array.from({ length: positions.length / 2 }, (_, i) => [positions[i * 2], positions[i * 2 + 1]])
}

test('an AoE cell renders as a full translucent voxel above the floor', () => {
  const h = harness()
  const cell = point(2, 3, 4)
  h.updateAoeHighlight([cell])
  const [fill] = fills(h)
  const bounds = new THREE.Box3().setFromObject(fill)
  close(bounds.min.x, 2); close(bounds.max.x, 3)
  close(bounds.min.y, 3.11); close(bounds.max.y, 4.11)
  close(bounds.min.z, 4); close(bounds.max.z, 5)
  assert.equal(fill.material.opacity, 0.3)
  assert.equal(fill.material.transparent, true)
  assert.equal(fill.material.depthWrite, false)
  assert.equal(triangles(h), 12)
  assert.equal(segments(h).length, 12)
  assert.deepEqual(h.areaHighlightCells.value, [cell])
})

test('adjacent AoE voxels remove their shared face and flat outer-face seams', () => {
  const h = harness()
  h.updateAoeHighlight([point(), point(1)])
  assert.equal(fills(h).length, 1)
  assert.equal(triangles(h), 20, 'the two hidden interface faces must not be drawn')
  const seam = segments(h).some(([a, b]) => Math.abs(a[0] - 1) < 1e-5 && Math.abs(b[0] - 1) < 1e-5)
  assert.equal(seam, false, 'the middle plane must not have any grid edges')
})

test('vertically stacked cells form a tall volume without a middle outline', () => {
  const h = harness()
  h.updateAoeHighlight([point(), point(0, 1)])
  const bounds = new THREE.Box3().setFromObject(fills(h)[0])
  close(bounds.max.y - bounds.min.y, 2)
  assert.equal(triangles(h), 20)
  assert.equal(segments(h).some(([a, b]) => Math.abs(a[1] - 1.11) < 1e-5 && Math.abs(b[1] - 1.11) < 1e-5), false)
})

test('irregular AoE volumes preserve their concave outer corners', () => {
  const h = harness()
  h.updateAoeHighlight([point(), point(1), point(0, 0, 1)])
  assert.equal(triangles(h), 28)
  assert.ok(segments(h).some(([a, b]) =>
    Math.abs(a[0] - 1) < 1e-5 && Math.abs(b[0] - 1) < 1e-5 &&
    Math.abs(a[2] - 1) < 1e-5 && Math.abs(b[2] - 1) < 1e-5 && Math.abs(a[1] - b[1]) > 0.9,
  ))
})

test('hit and blocked cells retain their colors with only the complete area outer boundary', () => {
  const h = harness()
  const hit = [point()], blocked = [point(1)]
  h.updateAoeHighlight(hit, blocked)
  assert.deepEqual(fills(h).map(mesh => mesh.material.color.getHex()).sort(), [0xff3300, 0xffaa00].sort())
  assert.ok(fills(h).every(mesh => mesh.material.opacity === 0.3 && !mesh.material.depthWrite))
  assert.equal(triangles(h), 20, 'changing status must not introduce a hidden shared face')
  assert.equal(segments(h).some(([a, b]) => a[0] === 1 && b[0] === 1), false)
  assert.deepEqual(h.areaHighlightCells.value, hit, 'blocked cells must never become attack targets')
})

test('duplicate cells cannot add overlapping translucent faces', () => {
  const h = harness()
  h.updateAoeHighlight([point(), point()], [point()])
  assert.equal(fills(h).length, 1)
  assert.equal(fills(h)[0].material.color.getHex(), 0xffaa00)
  assert.equal(triangles(h), 12)
})

test('equivalent hover cells reuse the preview and replacements dispose its GPU resources', () => {
  const h = harness()
  h.updateAoeHighlight([point(), point(1)])
  const previous = [...h.aoeGroup.children]
  const disposed = []
  for (const object of previous) {
    object.geometry.addEventListener('dispose', () => disposed.push(object.geometry))
    object.material.addEventListener('dispose', () => disposed.push(object.material))
  }
  h.updateAoeHighlight([point(1), point()])
  assert.deepEqual(h.aoeGroup.children, previous)
  assert.equal(disposed.length, 0)
  h.updateAoeHighlight([point(2)])
  assert.equal(disposed.length, previous.length * 2)
  assert.ok(!h.aoeGroup.children.some(object => previous.includes(object)))
})

test('clearing aiming removes the volume and allows the same preview to be drawn again', () => {
  const h = harness()
  h.updateAoeHighlight([point()])
  const previous = [...h.aoeGroup.children]
  let disposed = 0
  previous.forEach(object => object.geometry.addEventListener('dispose', () => disposed++))
  h.clearAoeState()
  assert.equal(disposed, previous.length)
  assert.equal(h.aoeGroup.children.length, 0)
  assert.deepEqual(h.areaHighlightCells.value, [])
  assert.equal(h.lastAreaShapeData.value, null)
  h.updateAoeHighlight([point()])
  assert.equal(fills(h).length, 1)
})

for (const shape of ['blast', 'burst', 'close-blast', 'cone', 'line', 'pass']) {
  test(`${shape} AoE preview preserves its complete gameplay cell volume`, () => {
    const h = harness()
    const cells = computeAreaCells(shape, 'ranged', point(), point(1), 2, 1, 3,
      { width: 1, height: 1, depth: 1 }, point(3, 2, 0))
    assert.ok(cells.length > 0)
    const before = structuredClone(cells)
    h.updateAoeHighlight(cells)
    assert.deepEqual(h.areaHighlightCells.value, before)
    assert.deepEqual(cells, before, 'preview rendering must not change gameplay coverage')
    assert.ok(triangles(h) > 0)
    assert.ok(outline(h))
  })
}
