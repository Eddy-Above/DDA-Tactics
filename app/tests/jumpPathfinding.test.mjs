import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells } = loadTypeScript('server/utils/mapMovement.ts')
const { detectCapabilities, getMovementCostProfile } = loadTypeScript('utils/movementRules.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = ({ x, y, z }) => `${x},${y},${z}`
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [] })
const jumpCaps = {
  canFly: false, canClimb: false, canDig: false, canSwim: false,
  canJump: true, jumpHeight: 4, jumpRange: 4, movementSpeed: 7, swimSpeed: 0,
}
function compareReach(origin, caps, map) {
  const movement = useMapMovement()
  const cells = movement.computeReachable(origin, caps.movementSpeed, caps, map)
  const server = getReachableCells(origin, caps.movementSpeed, caps, map)
  server.delete(key(origin))
  assert.deepEqual(cells, server)
  return { movement, cells }
}

test('walking four cells consumes a Jump four allowance before entering air', () => {
  const map = emptyMap(), origin = point(0), destination = point(4, 1)
  map.groundTiles = Array.from({ length: 5 }, (_, x) => point(x))
  const { movement, cells } = compareReach(origin, jumpCaps, map)
  assert.ok(cells.has(key(point(4))))
  const costs = getMovementCostProfile(jumpCaps, undefined, new Set(), origin)
  assert.equal(costs.stepCost(point(4), destination, map, 4), Infinity, 'a jump cannot start after four cells have already been spent')
  assert.ok(cells.has(key(destination)), 'starting the jump earlier can reach the same destination in four cells')
  assert.equal(movement.computePath(origin, destination, jumpCaps, map).length - 1, 4)
  movement.clearMovement()
  assert.equal(movement.computePath(origin, destination, jumpCaps, map).length - 1, 4)
})

test('Walk seven and Jump four allow walking two, jumping two, then walking three', () => {
  const map = emptyMap(), origin = point(0)
  map.groundTiles = [point(0), point(1), point(2), point(5, 1), point(6, 1), point(7, 1)]
  const { movement, cells } = compareReach(origin, jumpCaps, map)
  assert.ok(cells.has(key(point(4, 1))), 'the fourth spent cell may still use Jump four')
  const costs = getMovementCostProfile(jumpCaps, undefined, new Set(), origin)
  assert.equal(costs.stepCost(point(4, 1), point(4, 2), map, 4), Infinity, 'a later extra air step cannot use walking speed')
  assert.ok(cells.has(key(point(7, 1))))
  const path = movement.computePath(origin, point(7, 1), jumpCaps, map)
  assert.equal(path.length - 1, 7)
  const sequence = [point(0), point(1), point(2), point(3, 1), point(4, 1), point(5, 1), point(6, 1), point(7, 1)]
  let spent = 0
  for (let i = 1; i < sequence.length; i++) spent += costs.stepCost(sequence[i - 1], sequence[i], map, spent)
  assert.equal(spent, 7, 'the specified two walk, two jump and three walk sequence is valid')
  movement.clearMovement()
  assert.equal(movement.computePath(origin, point(7, 1), jumpCaps, map).length - 1, 7)
})

test('Advanced Jumper can use its full vertical height beyond walking speed', () => {
  const caps = detectCapabilities([
    { id: 'extra-movement', choiceId: 'jumper' },
    { id: 'advanced-mobility', choiceId: 'adv-jumper' },
  ], 4, 0, 1, 0, 4)
  assert.equal(caps.jumpHeight, 9)
  assert.equal(caps.jumpRange, 5)
  const map = emptyMap(), origin = point(0)
  map.groundTiles.push(origin)
  const { movement, cells } = compareReach(origin, caps, map)
  for (const destination of [point(0, 9), point(5, 9), point(5)]) {
    assert.ok(cells.has(key(destination)), key(destination))
    assert.equal(movement.computePath(origin, destination, caps, map).length - 1, Math.max(destination.x, destination.y))
  }
  assert.ok(!cells.has(key(point(0, 10))))
  assert.ok(!cells.has(key(point(6))))
  movement.clearMovement()
  assert.equal(movement.computePath(origin, point(0, 9), caps, map).length - 1, 9)
})

test('jump direction uses the relevant height or horizontal limit after prior movement', () => {
  const caps = { ...jumpCaps, movementSpeed: 4, jumpRange: 5, jumpHeight: 9 }
  const map = emptyMap(), origin = point(0), costs = getMovementCostProfile(caps, undefined, new Set(), origin)
  map.groundTiles.push(origin)
  assert.equal(costs.budget, 9)
  assert.equal(costs.stepCost(point(2, 3), point(2, 4), map, 5), 1, 'vertical rise uses Jump Height nine')
  assert.equal(costs.stepCost(point(3, 1), point(4, 1), map, 5), Infinity, 'horizontal movement cannot exceed Jump Range five')
  assert.equal(costs.stepCost(point(2, 7), point(2, 8), map, 9), Infinity, 'walking already spent counts against jump height')
})

test('an airborne jump can land on a high platform before walking speed is checked again', () => {
  const caps = { ...jumpCaps, movementSpeed: 4, jumpHeight: 9, jumpRange: 5 }
  const map = emptyMap(), origin = point(0), platform = point(1, 8), next = point(2, 8)
  map.groundTiles = [origin, next]
  map.voxels = Array.from({ length: 8 }, (_, y) => ({ ...point(1, y), materialId: 'steel' }))
  const { movement, cells } = compareReach(origin, caps, map)
  assert.ok(cells.has(key(platform)))
  assert.equal(movement.computePath(origin, platform, caps, map).length - 1, 8)
  const costs = getMovementCostProfile(caps, undefined, new Set(), origin)
  assert.equal(costs.stepCost(point(0, 7), platform, map, 7), 1, 'the landing finishes the airborne jump')
  assert.equal(costs.stepCost(platform, next, map, 8), Infinity, 'walking after landing has no remaining Walk four allowance')
  movement.clearMovement()
  assert.equal(movement.computePath(origin, platform, caps, map).length - 1, 8)
})

test('straight upward floor moves cannot chain walking speed beyond jump height', () => {
  const map = emptyMap(), origin = point(0)
  const caps = { ...jumpCaps, movementSpeed: 12, jumpHeight: 3, jumpRange: 3 }
  map.groundTiles = Array.from({ length: 10 }, (_, y) => point(0, y))
  for (let x = -1; x <= 1; x++) for (let z = -1; z <= 1; z++) {
    if (x === 0 && z === 0) continue
    for (let y = -1; y <= 10; y++) map.voxels.push({ ...point(x, y, z), materialId: 'steel' })
  }
  const { movement, cells } = compareReach(origin, caps, map)
  assert.ok(cells.has(key(point(0, 3))))
  assert.ok(!cells.has(key(point(0, 4))))
  assert.equal(movement.computePath(origin, point(0, 4), caps, map), null)
})
