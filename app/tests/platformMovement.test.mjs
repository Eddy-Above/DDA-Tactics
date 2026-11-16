import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells } = loadTypeScript('server/utils/mapMovement.ts')
const paths = loadTypeScript('utils/pathfinding.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = p => `${p.x},${p.y},${p.z}`
const mapOf = fields => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [], ...fields })

for (const support of ['ground', 'voxel', 'stair']) {
  test(`walking can step off ${support} footing but stays adjacent to it`, () => {
    const origin = point(0, 8)
    const map = mapOf(support === 'ground' ? { groundTiles: [origin] }
      : support === 'voxel' ? { voxels: [{ ...point(0, 7), materialId: 'steel' }] }
        : { stairs: [{ ...point(0, 7), id: 'stairs', face: 'north' }] })
    const caps = rules.detectCapabilities([], 6, 0, 0, 0, 0)
    const movement = useMapMovement()
    const client = movement.computeReachable(origin, 6, caps, map)
    const server = getReachableCells(origin, 6, caps, map)
    server.delete(key(origin))
    assert.deepEqual(client, server)
    assert.ok(client.has(key(point(1, 8))))
    assert.ok(!client.has(key(point(2, 8))))
    assert.ok(!client.has(key(point(1, 7))))
    assert.ok(rules.isFootprintAirborne(point(1, 8), { width: 1, height: 1, depth: 1 }, map))
    assert.ok(movement.computePath(origin, point(1, 8), caps, map))
    assert.equal(movement.computePath(origin, point(2, 8), caps, map), null)
  })

  test(`walking cannot travel along the unsupported strip beside ${support} footing`, () => {
    const footing = Array.from({ length: 7 }, (_, z) => point(0, 8, z))
    const map = mapOf(support === 'ground' ? { groundTiles: footing }
      : support === 'voxel' ? { voxels: footing.map(p => ({ ...p, y: 7, materialId: 'steel' })) }
        : { stairs: footing.map((p, i) => ({ ...p, y: 7, id: `stairs-${i}`, face: 'north' })) })
    const caps = rules.detectCapabilities([], 6, 0, 0, 0, 0)
    const edge = point(1, 8, 1)
    assert.ok(rules.canPassThrough(footing[0], edge, caps, map), 'one step off remains legal')
    assert.equal(rules.canPassThrough(edge, point(1, 8, 2), caps, map), false)
    assert.equal(rules.canPassThrough(edge, point(1, 8, 2), caps, rules.createMovementMapView(map)), false)
    assert.ok(rules.canPassThrough(edge, footing[1], caps, map), 'returning to solid footing remains legal')

    // Block the platform so a route to its far side would require chaining steps through air.
    const blockers = footing.slice(1, 4)
    const units = new Map(blockers.map((pos, i) => [`blocker-${i}`, { pos, size: 'medium' }]))
    const movement = useMapMovement()
    const client = movement.computeReachable(footing[0], 6, caps, map, new Set(), units)
    const server = getReachableCells(footing[0], 6, caps, map, new Set(), new Set(blockers.map(key)))
    server.delete(key(footing[0]))
    assert.deepEqual(client, server)
    assert.ok(client.has(key(edge)))
    assert.ok(!client.has(key(footing[5])))
    assert.equal(movement.computePath(footing[0], footing[5], caps, map, new Set(), units), null)
  })
}

test('jump height is measured at the actual launch after walking down a platform', () => {
  const origin = point(0, 8), launch = point(1, 7), target = point(3, 7)
  const map = mapOf({ groundTiles: [origin, launch] })
  const caps = rules.detectCapabilities([{ id: 'extra-movement', choiceId: 'jumper' }], 6, 0, 0)
  const movement = useMapMovement()
  const cells = movement.computeReachable(origin, 6, caps, map)
  assert.ok(cells.has(key(target)), 'the destination is below the move origin but level with the jump launch')
  assert.ok(movement.computePath(origin, target, caps, map).some(p => key(p) === key(launch)))
  assert.equal(movement.computePath(origin, point(3, 6), caps, map), null)
  assert.equal(rules.canStartJump(point(2, 7), map, caps), false, 'stepping off is not a new launch')
})

for (const weighted of [false, true]) {
  test(`paths prefer fewer unnecessary diagonals (${weighted ? 'weighted' : 'uniform'})`, () => {
    const origin = point(0), goal = point(4), pass = (_from, to) => to.y === 0
    const cost = weighted ? () => 1 : undefined
    const search = paths.searchReachable(origin, 5, pass, cost)
    for (const path of [search.pathTo(goal), paths.findPath(origin, goal, pass, 200, cost)]) {
      assert.equal(path.length, 5)
      assert.ok(path.every(p => p.z === 0))
    }
    const diagonal = search.pathTo(point(4, 0, 2))
    assert.equal(diagonal.length, 5, 'required diagonals still save distance')
    assert.equal(diagonal.slice(1).filter((p, i) => p.z !== diagonal[i].z).length, 2)
  })
}

test('stateful jump paths also avoid unnecessary diagonals', () => {
  const map = mapOf({ groundTiles: Array.from({ length: 5 }, (_, x) => point(x)) })
  const caps = rules.detectCapabilities([], 6, 0, 0)
  const movement = useMapMovement()
  movement.computeReachable(point(0), 6, caps, map)
  assert.ok(movement.computePath(point(0), point(4), caps, map).every(p => p.z === 0 && p.y === 0))
})

test('a voluntary fall releases flight and applies the existing damage and landing rules', async () => {
  const map = mapOf({ groundTiles: [point(0)] })
  const gravity = loadTypeScriptWithMocks('server/utils/endOfTurnGravity.ts', {
    './combatSpatial': { getFallerProfile: async () => ({ cpu: 1, ram: 0, canFly: true, hasTumbler: false, hasAdvJumper: false }) },
    './encounterRoom': {}, './guidingLight': {},
  })
  const actor = { id: 'actor', type: 'tamer', currentWounds: 0, maxWounds: 20, actionsRemaining: { simple: 0 } }
  const positions = { actor: point(0, 10) }
  const normal = await gravity.computeGravityDrops(positions, [actor], map, new Map(), 1)
  assert.deepEqual(normal.patch, {})
  const fall = await gravity.computeGravityDrops(positions, [actor], map, new Map(), 1, new Set(), new Map(), true)
  assert.deepEqual(fall.patch, { actor: point(0) })
  assert.equal(actor.currentWounds, 4)
  assert.equal(actor.actionsRemaining.simple, 0)
  assert.equal(fall.logEntries[0].action, 'Fall')
})
