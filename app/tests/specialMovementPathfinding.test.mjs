import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells } = loadTypeScript('server/utils/mapMovement.ts')
const { detectCapabilities, getMovementCostProfile } = loadTypeScript('utils/movementRules.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = ({ x, y, z }) => `${x},${y},${z}`
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], stairs: [], ceilings: [] })
const walking = { canFly: false, canJump: false, jumpHeight: 0, jumpRange: 0, canClimb: false, canSwim: false, canDig: false }
const profileFor = (mode, advanced = false, movement = 4, ram = 3) => ({
  ...detectCapabilities([
    { id: 'extra-movement', choiceId: mode },
    ...(advanced ? [{ id: 'advanced-mobility', choiceId: `adv-${mode}` }] : []),
  ], movement, ram, 1, 0, movement),
  // These cases isolate each movement mode from innate jumping.
  canJump: false, jumpHeight: 0, jumpRange: 0,
})
function compareReach(origin, profile, map, destroyed = new Set()) {
  const movement = useMapMovement()
  const client = movement.computeReachable(origin, profile.movementSpeed, profile, map, destroyed)
  const server = getReachableCells(origin, profile.movementSpeed, profile, map, destroyed)
  server.delete(key(origin))
  assert.deepEqual(client, server)
  return { movement, cells: client }
}

test('legacy capability objects retain uniform paths while numeric modes respect disabled flags', () => {
  assert.equal(getMovementCostProfile({ ...walking, canFly: true }), null)
  const caps = { ...walking, movementSpeed: 4, swimSpeed: 0, flySpeed: 7, climbSpeed: 7, digSpeed: 7 }
  assert.equal(getMovementCostProfile(caps).budget, 4, 'disabled modes cannot inflate the shared budget')
  const manualFly = getMovementCostProfile({ ...walking, canFly: true, movementSpeed: 4, swimSpeed: 0 })
  assert.equal(manualFly.budget, 4)
  assert.equal(manualFly.stepCost(point(0), point(1), emptyMap()), 1, 'manual boolean modes fall back to walking speed')
})

test('a numeric flight-only profile keeps its cached allowance when flight is disabled', () => {
  const caps = { ...walking, movementSpeed: 4, flySpeed: 7 }
  const map = emptyMap(), movement = useMapMovement(), origin = point(0)
  map.groundTiles = Array.from({ length: 8 }, (_, x) => ({ ...point(x), terrain: 'normal' }))
  movement.computeReachable(origin, 2, caps, map)
  assert.equal(movement.computePath(origin, point(2), caps, map).length - 1, 2)
  assert.equal(movement.computePath(origin, point(3), caps, map), null, 'cached misses cannot fall back to the larger default allowance')
  movement.clearMovement()
  assert.equal(movement.computePath(origin, point(3), caps, map).length - 1, 3)
})

test('Advanced Flight uses Movement plus RAM horizontally and vertically beyond walking range', () => {
  const caps = profileFor('flight', true), origin = point(0, 10), map = emptyMap()
  assert.equal(caps.flySpeed, 7)
  const { movement, cells } = compareReach(origin, caps, map)
  for (const destination of [point(7, 10), point(0, 17)]) {
    assert.ok(cells.has(key(destination)))
    assert.equal(movement.computePath(origin, destination, caps, map).length - 1, 7)
  }
  assert.ok(!cells.has(key(point(8, 10))))
  movement.clearMovement()
  assert.equal(movement.computePath(origin, point(7, 10), caps, map).length - 1, 7)
  assert.equal(movement.computePath(origin, point(8, 10), caps, map), null)
})

test('water surface travel uses swimming speed with a flight alternative above the volume', () => {
  const map = emptyMap()
  map.voxels = Array.from({ length: 10 }, (_, x) => ({ ...point(x), materialId: 'water' }))
  const swimmer = { ...walking, canSwim: true, movementSpeed: 6, swimSpeed: 3 }
  const surface = compareReach(point(0, 1), swimmer, map)
  assert.ok(surface.cells.has(key(point(3, 1))))
  assert.ok(!surface.cells.has(key(point(4, 1))))

  const flyer = { ...profileFor('flight', true), canSwim: true, swimSpeed: 3 }
  const flying = compareReach(point(0, 1), flyer, map)
  assert.ok(flying.cells.has(key(point(7, 1))))
  assert.ok(!flying.cells.has(key(point(8, 1))))
  const submerged = getMovementCostProfile(flyer)
  assert.equal(submerged.stepCost(point(0), point(1), map, 2), 1)
  assert.equal(submerged.stepCost(point(0), point(1), map, 3), Infinity, 'flight does not accelerate actual underwater travel')
})

test('Advanced Wallclimber uses Movement plus RAM on vertical walls without climbing unsupported air', () => {
  const map = emptyMap()
  map.walls = Array.from({ length: 10 }, (_, y) => ({ id: `wall-${y}`, ...point(0, y), face: 'east' }))
  const basic = profileFor('wallclimber'), advanced = profileFor('wallclimber', true)
  assert.equal(basic.climbSpeed, 4)
  assert.equal(advanced.climbSpeed, 7)
  assert.ok(compareReach(point(0), basic, map).cells.has(key(point(0, 4))))
  assert.ok(!compareReach(point(0), basic, map).cells.has(key(point(0, 5))))
  const { movement, cells } = compareReach(point(0), advanced, map)
  assert.ok(cells.has(key(point(0, 7))))
  assert.ok(!cells.has(key(point(3, 7))))
  assert.equal(movement.computePath(point(0), point(0, 7), advanced, map).length - 1, 7)
  assert.equal(movement.computePath(point(0), point(3, 7), advanced, map), null)
})

test('only Advanced Wallclimber traverses ceilings, and destroyed ceilings no longer provide speed or support', () => {
  const map = emptyMap()
  map.ceilings = Array.from({ length: 10 }, (_, x) => ({ id: `ceiling-${x}`, ...point(x, 5) }))
  const origin = point(0, 5), basic = profileFor('wallclimber'), advanced = profileFor('wallclimber', true)
  assert.equal(compareReach(origin, basic, map).cells.size, 0)
  const { cells } = compareReach(origin, advanced, map)
  assert.ok(cells.has(key(point(7, 5))))
  assert.ok(!cells.has(key(point(8, 5))))
  const destroyed = new Set(map.ceilings.map(ceiling => ceiling.id))
  assert.equal(compareReach(origin, advanced, map, destroyed).cells.size, 0)
  const cost = getMovementCostProfile(advanced, undefined, destroyed)
  assert.equal(cost.stepCost(origin, point(1, 5), map, 4), Infinity, 'destroyed supports cannot grant Advanced Climber speed')
})

for (const materialId of ['earth', 'sand', 'snow']) {
  test(`ordinary Digger burrows through ${materialId} at its full movement speed`, () => {
    const map = emptyMap(), caps = profileFor('digger')
    map.voxels = Array.from({ length: 10 }, (_, x) => ({ ...point(x), materialId }))
    const { movement, cells } = compareReach(point(0), caps, map)
    assert.ok(cells.has(key(point(4))))
    assert.ok(!cells.has(key(point(5))))
    assert.equal(movement.computePath(point(0), point(4), caps, map).length - 1, 4)
  })
}

test('Advanced Digger burrows hard surfaces at Movement plus RAM while Steel remains blocked', () => {
  for (const materialId of ['void', 'wood', 'ice', 'glass']) {
    const map = emptyMap()
    map.voxels = Array.from({ length: 10 }, (_, x) => ({ ...point(x), materialId }))
    assert.ok(!compareReach(point(0), profileFor('digger'), map).cells.has(key(point(1))), 'ordinary Digger cannot enter hard material')
    const { cells } = compareReach(point(0), profileFor('digger', true), map)
    assert.ok(cells.has(key(point(7))), materialId)
    assert.ok(!cells.has(key(point(8))), materialId)
  }
  const steel = emptyMap()
  steel.voxels = Array.from({ length: 8 }, (_, x) => ({ ...point(x), materialId: 'steel' }))
  assert.ok(!compareReach(point(0), profileFor('digger', true), steel).cells.has(key(point(1))))
})

test('Soft Metal requires Advanced Digger and costs twice as much distance per cell', () => {
  for (const staleTags of [false, true]) {
    const map = emptyMap()
    map.voxels = Array.from({ length: 10 }, (_, x) => ({ ...point(x), materialId: 'soft-metal', ...(staleTags ? { tags: ['diggable'] } : {}) }))
    map.voxels.push(...Array.from({ length: 10 }, (_, x) => ({ ...point(x, 1), materialId: 'steel' })))
    assert.ok(!compareReach(point(0), profileFor('digger'), map).cells.has(key(point(1))))
    const advanced = profileFor('digger', true, 4, 2), { movement, cells } = compareReach(point(0), advanced, map)
    assert.equal(advanced.digSpeed, 6)
    assert.ok(cells.has(key(point(3))))
    assert.ok(!cells.has(key(point(4))))
    assert.equal(movement.computePath(point(0), point(3), advanced, map).length - 1, 3)
  }
})

test('mixed walking and burrowing count total distance against each destination speed', () => {
  const map = emptyMap(), caps = profileFor('digger', true)
  map.groundTiles = Array.from({ length: 10 }, (_, x) => ({ ...point(x), terrain: x < 3 ? 'normal' : 'earth' }))
  const cost = getMovementCostProfile(caps)
  assert.equal(cost.stepCost(point(0), point(1), map), 1)
  assert.equal(cost.stepCost(point(2), point(3), map), 1)
  const { movement, cells } = compareReach(point(0), caps, map)
  assert.ok(cells.has(key(point(7))))
  assert.ok(!cells.has(key(point(8))))
  assert.equal(movement.computePath(point(0), point(7), caps, map).length - 1, 7)
  movement.clearMovement()
  assert.equal(movement.computePath(point(0), point(7), caps, map).length - 1, 7)
  assert.equal(movement.computePath(point(0), point(8), caps, map), null)
})
