import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { detectCapabilities, canStartJump, createJumpTraversal, getMovementCostProfile } = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells, getMovementReachability, isFootprintValid } = loadTypeScript('server/utils/mapMovement.ts')
const point = (y, x = 0) => ({ x, y, z: 0 })
const key = p => `${p.x},${p.y},${p.z}`
const jumper = { id: 'extra-movement', choiceId: 'jumper' }
const swimmer = { id: 'extra-movement', choiceId: 'swimmer' }
const mapOf = values => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [], ...values })
function reachable(map, origin, caps) {
  const movement = useMapMovement()
  const client = movement.computeReachable(origin, 4, caps, map)
  const server = getReachableCells(origin, 4, caps, map)
  server.delete(key(origin))
  assert.deepEqual(client, server)
  return { cells: client, path: to => movement.computePath(origin, to, caps, map) }
}

test('jumping needs dry solid footing and an airborne destination cannot launch another jump', () => {
  const caps = detectCapabilities([jumper], 4, 0, 0)
  for (const map of [mapOf({ groundTiles: [point(0)] }), mapOf({ voxels: [{ ...point(-1), materialId: 'earth' }] }), mapOf({ stairs: [{ ...point(-1), id: 'stairs', face: 'north' }] })]) {
    assert.equal(canStartJump(point(0), map, caps), true)
    assert.ok(reachable(map, point(0), caps).cells.has(key(point(2))))
    assert.equal(canStartJump(point(2), map, caps), false)
    const nextMove = reachable(map, point(2), caps)
    assert.ok(!nextMove.cells.has(key(point(3))))
    assert.equal(nextMove.path(point(3)), null)
  }
})

for (const surface of ['ground', 'volume', 'surface']) {
  test(`only Extra Movement Swimmer can jump out of ${surface} water`, () => {
    const map = surface === 'ground' ? mapOf({ groundTiles: [{ ...point(0), terrain: 'water' }] })
      : mapOf({ voxels: [{ ...point(0), materialId: 'water' }] })
    const origin = surface === 'surface' ? point(1) : point(0)
    const target = point(origin.y + 2)
    for (const qualities of [[jumper], [jumper, { id: 'naturewalk', choiceId: 'water' }]]) {
      const caps = detectCapabilities(qualities, 4, 0, 0)
      assert.equal(canStartJump(origin, map, caps), false)
      assert.ok(!reachable(map, origin, caps).cells.has(key(target)))
    }
    const caps = detectCapabilities([jumper, swimmer], 4, 0, 0)
    assert.equal(canStartJump(origin, map, caps), true)
    assert.ok(reachable(map, origin, caps).cells.has(key(target)))
  })
}

test('airborne flyers retain flight but cannot extend it with Advanced Jumper', () => {
  const caps = detectCapabilities([jumper, { id: 'extra-movement', choiceId: 'flight' }, { id: 'advanced-mobility', choiceId: 'adv-jumper' }], 4, 0, 2)
  const { cells } = reachable(mapOf({}), point(3), caps)
  assert.ok(cells.has(key(point(7))))
  assert.ok(!cells.has(key(point(8))))
})

test('walking into water cannot reuse a dry launch point, but swimming onto a bank permits a new jump', () => {
  const map = mapOf({
    groundTiles: [point(0), { ...point(0, 1), terrain: 'water' }],
  })
  for (const qualities of [[jumper], [jumper, swimmer]]) {
    const caps = detectCapabilities(qualities, 4, 0, 0)
    const traversal = createJumpTraversal(point(0), caps, map, getMovementCostProfile(caps, 4, new Set(), point(0)))
    const water = traversal.step(point(0), point(0, 1), 0, traversal.initial)
    assert.ok(water)
    const jump = traversal.step(point(0, 1), point(1, 1), water.cost, water.state)
    assert.equal(Boolean(jump), qualities.includes(swimmer))
  }
  const bank = mapOf({ groundTiles: [{ ...point(0), terrain: 'water' }, point(0, 1)] })
  const movement = reachable(bank, point(0), detectCapabilities([jumper], 4, 0, 0))
  assert.ok(movement.cells.has(key(point(2, 1))))
  assert.ok(movement.path(point(2, 1)))
  const caps = detectCapabilities([jumper], 4, 0, 0)
  const target = point(2, 1)
  const server = getMovementReachability(point(0), 4, caps, bank)
  assert.ok(isFootprintValid(target, { width: 1, height: 1, depth: 1 }, bank, new Set(), caps, server.launchOriginTo(target)), 'server intercede landing uses the bank launch point')
  const fresh = useMapMovement()
  assert.ok(fresh.computePath(point(0), target, caps, bank), 'uncached pathfinding also retains the dry launch point')
})
