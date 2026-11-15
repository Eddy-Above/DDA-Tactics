import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { findExpansionAnchor } = loadTypeScript('utils/footprintExpansion.ts')
const { detectCapabilities, canOccupyFootprint } = loadTypeScript('utils/movementRules.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const small = { width: 1, height: 1, depth: 1 }, large = { width: 2, height: 2, depth: 2 }
const caps = detectCapabilities([], 0, 0, 0)
const mapOf = voxels => ({ groundTiles: Array.from({ length: 289 }, (_, n) => point(n % 17 - 8, 0, Math.floor(n / 17) - 8)),
  voxels, walls: [], doors: [], stairs: [], ceilings: [], spaceTiles: [] })
const solid = (x, y = 0, z = 0, extra = {}) => ({ ...point(x, y, z), materialId: 'steel', ...extra })

for (const [obstacles, expected] of [
  [[solid(1)], point(-1)],
  [[solid(0, 0, 1)], point(0, 0, -1)],
  [[solid(1), solid(0, 0, 1)], point(-1, 0, -1)],
  [[solid(1, 1)], point(-1)],
]) test(`growth selects clear expansion ${JSON.stringify(expected)}`, () => {
  const map = mapOf(obstacles)
  const anchor = findExpansionAnchor(point(), small, large, map, caps)
  assert.deepEqual(anchor, expected)
  assert.equal(canOccupyFootprint(anchor, large, caps, map), true)
  assert.ok(anchor.x <= 0 && anchor.x + large.width > 0 && anchor.z <= 0 && anchor.z + large.depth > 0,
    'growth retains the previous body cell')
})

test('clear expansion keeps the current anchor, including explicitly passable material', () => {
  const origin = point()
  assert.equal(findExpansionAnchor(origin, small, large, mapOf([]), caps), origin)
  assert.equal(findExpansionAnchor(origin, small, large, mapOf([solid(1, 1, 0, { blocksMovement: false })]), caps), origin)
})

test('new-form movement permissions determine which materials block expansion', () => {
  const digger = detectCapabilities([{ id: 'extra-movement', choiceId: 'digger' }], 0, 0, 0)
  const map = mapOf([solid(1, 1, 0, { materialId: 'earth' })])
  assert.deepEqual(findExpansionAnchor(point(), small, large, map, caps), point(-1))
  assert.deepEqual(findExpansionAnchor(point(), small, large, map, digger), point())
  assert.deepEqual(findExpansionAnchor(point(), small, large, mapOf([solid(1, 1)]), digger), point(-1))
})

test('expansion avoids other occupied body cells when a clear alternative exists', () => {
  const map = mapOf([solid(1)])
  const anchor = findExpansionAnchor(point(), small, large, map, caps, new Set(['-1,0,1']))
  assert.deepEqual(anchor, point(-1, 0, -1))
})

test('custom gigantic growth shifts only far enough to fit its actual dimensions', () => {
  const map = mapOf([solid(2, 1)])
  const gigantic = { width: 4, height: 3, depth: 6 }
  assert.deepEqual(findExpansionAnchor(point(), large, gigantic, map, caps), point(-2))
})

test('airborne height growth can expand down, while grounded growth never sinks through the floor', () => {
  const map = mapOf([solid(0, 4)])
  assert.deepEqual(findExpansionAnchor(point(0, 3), small, { ...small, height: 4 }, map, caps), point())
  assert.deepEqual(findExpansionAnchor(point(0, 3), small, { ...small, height: 5 }, map, caps), point(0, 3),
    'a taller body must not grow through the floor plane')
  assert.deepEqual(findExpansionAnchor(point(), small, large, mapOf([solid(0, 1)]), caps), point(),
    'a grounded unit cannot evade the ceiling by sinking below its floor')
})

test('shrinking and completely obstructed growth retain the existing anchor', () => {
  const origin = point()
  assert.equal(findExpansionAnchor(origin, large, small, mapOf([solid(1)]), caps), origin)
  assert.equal(findExpansionAnchor(origin, small, large, mapOf([solid(0, 1)]), caps), origin,
    'growth does not teleport to an unrelated empty square')
})

test('growth avoids solid walls and closed doors but permits open or destroyed structures', () => {
  const map = mapOf([])
  map.walls = [{ id: 'wall', ...point(), face: 'east' }]
  assert.deepEqual(findExpansionAnchor(point(), small, large, map, caps), point(-1))
  map.doors = [{ id: 'door', wallId: 'wall', isOpen: false }]
  assert.deepEqual(findExpansionAnchor(point(), small, large, map, caps), point(-1))
  map.doors[0].isOpen = true
  assert.deepEqual(findExpansionAnchor(point(), small, large, map, caps), point())
  map.doors = []
  assert.deepEqual(findExpansionAnchor(point(), small, large, map, caps, new Set(), new Set(['wall'])), point())
})

test('airborne growth can expand below a ceiling without intersecting it', () => {
  const map = mapOf([])
  map.ceilings = [{ id: 'ceiling', ...point(0, 3) }]
  assert.deepEqual(findExpansionAnchor(point(0, 3), small, { ...small, height: 3 }, map, caps), point(0, 1))
})
