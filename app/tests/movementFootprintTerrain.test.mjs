import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells } = loadTypeScript('server/utils/mapMovement.ts')
const { movementPathError } = loadTypeScript('utils/movementPath.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = p => `${p.x},${p.y},${p.z}`
const dims = { width: 2, height: 2, depth: 2 }, origin = point(0), destination = point(1)

for (const [material, qualities, extra, allowed] of [
  ['steel', [], {}, false],
  ['earth', [], {}, false],
  ['earth', [{ id: 'extra-movement', choiceId: 'digger' }], {}, true],
  ['steel', [{ id: 'extra-movement', choiceId: 'digger' }, { id: 'advanced-mobility', choiceId: 'adv-digger' }], {}, false],
  ['wood', [{ id: 'extra-movement', choiceId: 'digger' }, { id: 'advanced-mobility', choiceId: 'adv-digger' }], {}, true],
  ['steel', [], { blocksMovement: false }, true],
  ['water', [], {}, true],
  ['wind', [], {}, true],
  ['steel', [{ id: 'extra-movement', choiceId: 'flight' }], {}, false],
]) {
  test(`large movement checks its upper corner against ${material}: ${JSON.stringify(qualities)} ${JSON.stringify(extra)}`, () => {
    const map = { groundTiles: Array.from({ length: 36 }, (_, n) => point(n % 9, 0, Math.floor(n / 9))),
      voxels: [{ id: 'upper-corner', ...point(2, 1, 1), materialId: material, ...extra }], spaceTiles: [], walls: [], doors: [], stairs: [], ceilings: [] }
    const caps = rules.detectCapabilities(qualities, 6, 0, 0, 0, 0)
    const movement = useMapMovement()
    const cells = movement.computeReachable(origin, 6, caps, map, new Set(), new Map(), 'large')
    const server = getReachableCells(origin, 6, caps, map, new Set(), new Set(), dims)
    server.delete(key(origin))
    assert.deepEqual(cells, server)
    assert.equal(cells.has(key(destination)), allowed)
    assert.equal(movement.computePath(origin, destination, caps, map, new Set(), new Map(), 'large') !== null, allowed)
    assert.equal(movementPathError([origin, destination], caps, 6, rules.createMovementMapView(map), dims) === null, allowed)
  })
}

test('burrowing with an upper body cell uses Dig speed even when the anchor is on ordinary ground', () => {
  const caps = { ...rules.detectCapabilities([{ id: 'extra-movement', choiceId: 'digger' }], 6, 0, 0, 0, 0), footprint: dims, digSpeed: 1 }
  const map = rules.createMovementMapView({ groundTiles: [origin, destination, point(2)], voxels: [{ ...point(2, 1, 1), materialId: 'earth' }], stairs: [], walls: [], doors: [], ceilings: [], spaceTiles: [] })
  const profile = rules.getMovementCostProfile(caps, 6, new Set(), origin)
  assert.equal(profile.stepCost(origin, destination, map), 1)
  assert.equal(profile.stepCost(destination, point(2), map, 1), Infinity)
})
