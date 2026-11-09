import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { searchReachable, findPath } = loadTypeScript('utils/pathfinding.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells, isValidLandingPosition } = loadTypeScript('server/utils/mapMovement.ts')
const { getMovementCostProfile, detectCapabilities } = loadTypeScript('utils/movementRules.ts')

const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = ({ x, y, z }) => `${x},${y},${z}`
const caps = (movementSpeed = 6, swimSpeed = 3) => ({
  canFly: false, canJump: false, jumpHeight: 0, jumpRange: 0,
  canClimb: false, canSwim: swimSpeed > 0, canDig: false, movementSpeed, swimSpeed,
})
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], stairs: [], ceilings: [] })
function corridor(length, waterFrom = 0) {
  const map = emptyMap()
  map.groundTiles = Array.from({ length }, (_, x) => ({ ...point(x), terrain: x >= waterFrom ? 'water' : 'normal' }))
  return map
}
function costOf(path, profile, map) {
  return path.slice(1).reduce((sum, p, index) => sum + profile.stepCost(path[index], p, map, sum), 0)
}
function compareClientServer(origin, budget, profile, map, blocked = new Map()) {
  const movement = useMapMovement()
  const client = movement.computeReachable(origin, budget, profile, map, new Set(), blocked)
  const occupied = new Set([...blocked.values()].map(unit => key(unit.pos)))
  const server = getReachableCells(origin, budget, profile, map, new Set(), occupied)
  server.delete(key(origin))
  assert.deepEqual(client, server)
  return { movement, cells: client }
}

test('weighted Dijkstra and A* prefer a longer route with a lower terrain cost', () => {
  const start = point(0), expensive = point(1), goal = point(2)
  const detour = [start, point(0, 0, 1), point(1, 0, 2), point(2, 0, 1), goal]
  const pairs = [[start, expensive], [expensive, goal], ...detour.slice(1).map((p, i) => [detour[i], p])]
  const edges = new Set(pairs.map(([a, b]) => `${key(a)}:${key(b)}`))
  const pass = (a, b) => edges.has(`${key(a)}:${key(b)}`)
  const stepCost = (a, b) => key(a) === key(expensive) || key(b) === key(expensive) ? 5 : 1
  assert.deepEqual(searchReachable(start, 4, pass, stepCost).pathTo(goal), detour)
  assert.deepEqual(findPath(start, goal, pass, 200, stepCost), detour)
  assert.equal(searchReachable(start, 3, pass, stepCost).pathTo(goal), null)
})

test('weighted equal-cost routes retain the existing preference for level paths', () => {
  const start = point(0), destination = point(4)
  const pass = (_, p) => p.x >= 0 && p.x <= 4 && p.y >= 0 && p.y <= 1 && p.z === 0
  for (const path of [searchReachable(start, 4, pass, () => 1).pathTo(destination), findPath(start, destination, pass, 200, () => 1)]) {
    assert.equal(path.length - 1, 4)
    assert.ok(path.every(p => p.y === 0))
  }
})

for (const movementSpeed of [6, 7, 12]) {
  test(`swim speed three limits water movement to three cells when walking speed is ${movementSpeed}`, () => {
    const map = corridor(9)
    const profile = caps(movementSpeed, 3)
    const { movement, cells } = compareClientServer(point(0), movementSpeed, profile, map)
    assert.deepEqual(cells, new Set([1, 2, 3].map(x => key(point(x)))))
    assert.equal(movement.computePath(point(0), point(3), profile, map).length - 1, 3)
    assert.equal(movement.computePath(point(0), point(4), profile, map), null)
    movement.clearMovement()
    assert.equal(movement.computePath(point(0), point(3), profile, map).length - 1, 3)
    assert.equal(movement.computePath(point(0), point(4), profile, map), null, 'fallback cannot exceed the swim budget')
  })
}

test('water space cells permit vertical swimming with the same distance limit', () => {
  const map = emptyMap()
  map.spaceTiles = Array.from({ length: 8 }, (_, y) => ({ ...point(0, y), spaceType: 'water' }))
  const profile = caps()
  const { movement, cells } = compareClientServer(point(0), 6, profile, map)
  assert.deepEqual(cells, new Set([1, 2, 3].map(y => key(point(0, y)))))
  assert.deepEqual(movement.computePath(point(0), point(0, 3), profile, map), [0, 1, 2, 3].map(y => point(0, y)))
  assert.equal(movement.computePath(point(0), point(0, 4), profile, map), null)
})

test('water voxels are valid swimmer destinations and retain weighted vertical limits', () => {
  const map = emptyMap()
  map.voxels = Array.from({ length: 8 }, (_, y) => ({ ...point(0, y), materialId: 'water' }))
  const profile = caps()
  const { cells } = compareClientServer(point(0), 6, profile, map)
  assert.deepEqual(cells, new Set([1, 2, 3].map(y => key(point(0, y)))))
  assert.equal(isValidLandingPosition(point(0, 3), map, new Set(), profile), true)
  assert.equal(isValidLandingPosition(point(0, 3), map, new Set(), caps(6, 0)), false)
})

test('walking four cells prevents swimming when Walk is seven and Swim is four', () => {
  const map = corridor(10, 5), profile = caps(7, 4)
  const { movement, cells } = compareClientServer(point(0), 7, profile, map)
  assert.ok(cells.has(key(point(4))))
  assert.ok(!cells.has(key(point(5))), 'the fifth cell exceeds swimming speed even though walking speed remains')
  assert.equal(movement.computePath(point(0), point(5), profile, map), null)
  movement.clearMovement()
  assert.equal(movement.computePath(point(0), point(5), profile, map), null)
})

test('walking two then swimming two leaves three walking cells at Walk seven and Swim four', () => {
  const map = corridor(10, Infinity), profile = caps(7, 4)
  for (const x of [3, 4]) map.groundTiles[x].terrain = 'water'
  const { movement, cells } = compareClientServer(point(0), 7, profile, map)
  assert.ok(cells.has(key(point(7))))
  assert.ok(!cells.has(key(point(8))))
  const weighted = getMovementCostProfile(profile)
  assert.equal(costOf(movement.computePath(point(0), point(7), profile, map), weighted, map), 7)
  movement.invalidateSearch()
  assert.equal(costOf(movement.computePath(point(0), point(7), profile, map), weighted, map), 7)
  assert.equal(movement.computePath(point(0), point(8), profile, map), null)
})

test('leaving water counts against walking speed rather than another swimming step', () => {
  const map = corridor(10, Infinity), profile = caps(7, 4)
  for (const x of [0, 1, 2, 3, 4]) map.groundTiles[x].terrain = 'water'
  const { movement, cells } = compareClientServer(point(0), 7, profile, map)
  assert.ok(cells.has(key(point(7))))
  assert.ok(!cells.has(key(point(8))))
  assert.equal(movement.computePath(point(0), point(7), profile, map).length - 1, 7)
  const slowerWalk = caps(3, 7)
  assert.ok(!compareClientServer(point(0), 3, slowerWalk, map).cells.has(key(point(5))), 'swimming four cells leaves no walking speed')
})

test('advanced swimming can reach farther in water than walking can reach on land', () => {
  const profile = caps(4, 7)
  const wet = compareClientServer(point(0), 4, profile, corridor(10))
  assert.ok(wet.cells.has(key(point(7))))
  assert.ok(!wet.cells.has(key(point(8))))
  const dry = compareClientServer(point(0), 4, profile, corridor(10, Infinity))
  assert.ok(dry.cells.has(key(point(4))))
  assert.ok(!dry.cells.has(key(point(5))))
})

test('zero speeds prevent movement in their terrain without preventing the other terrain', () => {
  assert.equal(compareClientServer(point(0), 0, caps(0, 0), corridor(5)).cells.size, 0)
  assert.equal(compareClientServer(point(0), 6, caps(6, 0), corridor(5)).cells.size, 0)
  assert.ok(compareClientServer(point(0), 0, caps(0, 3), corridor(5)).cells.has(key(point(3))))
  assert.equal(compareClientServer(point(0), 0, caps(0, 3), corridor(5, Infinity)).cells.size, 0)
})

test('walls, ceilings and occupied cells still block weighted swimming', () => {
  const profile = caps()
  const horizontal = corridor(8)
  horizontal.walls.push({ id: 'wall', ...point(1), face: 'east' })
  assert.deepEqual(compareClientServer(point(0), 6, profile, horizontal).cells, new Set([key(point(1))]))

  const vertical = emptyMap()
  vertical.spaceTiles = Array.from({ length: 6 }, (_, y) => ({ ...point(0, y), spaceType: 'water' }))
  vertical.ceilings.push({ id: 'ceiling', ...point(0, 1) })
  assert.deepEqual(compareClientServer(point(0), 6, profile, vertical).cells, new Set([key(point(0, 1))]))

  const occupied = new Map([['blocker', { pos: point(2), size: 'medium' }]])
  assert.deepEqual(compareClientServer(point(0), 6, profile, corridor(8), occupied).cells, new Set([key(point(1))]))
})

test('weighted fallback cannot bypass destination landing checks', () => {
  const map = corridor(3)
  map.spaceTiles.push({ ...point(2, 1), spaceType: 'air' })
  const movement = useMapMovement(), profile = caps()
  assert.equal(movement.computePath(point(0), point(2, 1), profile, map), null)
})

test('caller-supplied charge budgets remain authoritative for cached paths', () => {
  const movement = useMapMovement(), profile = caps(6, 3), map = corridor(20, Infinity)
  movement.computeReachable(point(0), 12, profile, map)
  assert.equal(movement.computePath(point(0), point(12), profile, map).length - 1, 12)
  assert.equal(movement.computePath(point(0), point(13), profile, map), null)
})

test('innate jumps cannot bypass swim limits by crossing distant water through open air', () => {
  const profile = detectCapabilities([{ id: 'speedy', ranks: 3 }], 12, 2, 1, undefined, 6)
  assert.equal(profile.jumpRange, 3)
  assert.equal(profile.swimSpeed, 3)
  const origin = point(0), destination = point(6), map = corridor(12)
  const { movement, cells } = compareClientServer(origin, 12, profile, map)
  assert.ok(!cells.has(key(destination)), 'walking speed must not enable an unlimited jump over water')
  assert.equal(movement.computePath(origin, destination, profile, map), null)
  movement.clearMovement()
  assert.equal(movement.computePath(origin, destination, profile, map), null, 'uncached paths obey the same jump origin')
})

test('jump origin bounds still allow deep vertical swimming beyond jump height', () => {
  const profile = detectCapabilities([
    { id: 'extra-movement', choiceId: 'swimmer' },
    { id: 'advanced-mobility', choiceId: 'adv-swimmer' },
  ], 12, 2, 1, undefined, 6)
  const map = emptyMap(), origin = point(0, -18), destination = point(0, -4)
  map.voxels = Array.from({ length: 18 }, (_, index) => ({ ...point(0, index - 18), materialId: 'water' }))
  const { movement, cells } = compareClientServer(origin, 12, profile, map)
  assert.equal(profile.jumpHeight, 3)
  assert.equal(profile.swimSpeed, 14)
  assert.ok(cells.has(key(destination)))
  assert.equal(movement.computePath(origin, destination, profile, map).length - 1, 14)
})

test('fresh searches observe in-place water and solid-voxel edits on the same map', () => {
  const map = corridor(9, Infinity), profile = caps(), origin = point(0)
  const movement = useMapMovement()
  assert.ok(movement.computeReachable(origin, 6, profile, map).has(key(point(6))))

  for (const tile of map.groundTiles) tile.terrain = 'water'
  movement.invalidateSearch()
  assert.deepEqual(movement.computeReachable(origin, 6, profile, map), new Set([1, 2, 3].map(x => key(point(x)))))
  const server = getReachableCells(origin, 6, profile, map)
  server.delete(key(origin))
  assert.deepEqual(server, new Set(movement.reachableCells.value))

  map.voxels.push(...[0, 1].map(y => ({ ...point(2, y), materialId: 'water', blocksMovement: true })))
  movement.invalidateSearch()
  assert.deepEqual(movement.computeReachable(origin, 6, profile, map), new Set([key(point(1))]))
  assert.deepEqual(getReachableCells(origin, 6, profile, map), new Set([key(origin), key(point(1))]))

  for (const voxel of map.voxels) voxel.blocksMovement = false
  movement.invalidateSearch()
  assert.ok(movement.computeReachable(origin, 6, profile, map).has(key(point(3))))
})
