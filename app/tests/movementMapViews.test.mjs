import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { createMovementMapView, canPassThrough, canLandOn, detectCapabilities, PROJECTILE_CAPS } = loadTypeScript('utils/movementRules.ts')
const { mapVoxelAt } = loadTypeScript('utils/mapVoxels.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells } = loadTypeScript('server/utils/mapMovement.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = ({ x, y, z }) => `${x},${y},${z}`
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [] })

test('movement views preserve geometry decisions, saved appearance and picked voxel identities', () => {
  const map = emptyMap()
  map.groundTiles = [0, 1, 2, 3].map(x => ({ ...point(x), terrain: 'normal' }))
  map.groundTiles.push({ ...point(4), terrain: 'earth' }, { ...point(5), terrain: 'water' }, { ...point(0), terrain: 'water' })
  map.spaceTiles = [{ ...point(0, 1), spaceType: 'water' }, { ...point(4, 1), spaceType: 'earth' }, { ...point(5, 1), spaceType: 'air' }]
  map.voxels = [
    { ...point(1, 1), materialId: 'steel' },
    { ...point(2, 1), materialId: 'water', shape: 'ramp', direction: 'north', opacity: 0.4 },
    { ...point(2, 1), materialId: 'steel' },
    { ...point(3, 1), materialId: 'wind' },
    { ...point(4, 2), materialId: 'glass', feature: 'window' },
    { ...point(6, 1), materialId: 'soft-metal' },
  ]
  map.walls = [{ id: 'wall', ...point(1), face: 'east' }, { id: 'legacy-wall', x: 3, z: 0, face: 'north' }]
  map.doors = [{ id: 'door', wallId: 'wall', isOpen: false }]
  map.ceilings = [{ id: 'ceiling', ...point(0) }]
  map.stairs = [{ id: 'stairs', ...point(6), direction: 'east' }]
  const before = JSON.stringify(map), view = createMovementMapView(map), origin = point(0)
  assert.equal(JSON.stringify(view), before)
  assert.equal(JSON.stringify(map), before, 'query construction cannot add saved-map fields')

  const allModes = ['swimmer', 'digger', 'wallclimber', 'flight', 'jumper'].flatMap(choiceId => [
    { id: 'extra-movement', choiceId }, { id: 'advanced-mobility', choiceId: `adv-${choiceId}` },
  ])
  const profiles = [detectCapabilities([], 6, 2, 2), detectCapabilities(allModes, 6, 2, 2), PROJECTILE_CAPS]
  const occupied = new Set([key(point(7))])
  for (let x = -1; x <= 7; x++) for (let y = -1; y <= 3; y++) {
    const to = point(x, y), from = point(x - 1, y - 1)
    assert.equal(mapVoxelAt(view, to), mapVoxelAt(map, to), 'picking retains the original cell object')
    for (const caps of profiles) for (const destroyed of [new Set(), new Set(['wall', 'legacy-wall', 'ceiling'])]) {
      assert.equal(canPassThrough(from, to, caps, view, destroyed, origin), canPassThrough(from, to, caps, map, destroyed, origin), `pass ${key(to)}`)
      assert.equal(canLandOn(to, caps, view, occupied, origin, destroyed), canLandOn(to, caps, map, occupied, origin, destroyed), `land ${key(to)}`)
    }
  }
})

test('client and server searches refresh their geometry after edits to the same loaded map', () => {
  const map = emptyMap(), origin = point(0), movement = useMapMovement()
  const caps = { ...detectCapabilities([], 7, 0, 0, 4, 7), canJump: false, jumpHeight: 0, jumpRange: 0 }
  map.groundTiles = Array.from({ length: 9 }, (_, x) => ({ ...point(x), terrain: 'normal' }))
  assert.ok(movement.computeReachable(origin, 7, caps, map).has(key(point(7))))
  assert.equal(movement.computePath(origin, point(7), caps, map).length - 1, 7)

  map.groundTiles[5].terrain = 'water'
  movement.invalidateSearch()
  const waterCells = movement.computeReachable(origin, 7, caps, map)
  assert.ok(!waterCells.has(key(point(5))))
  assert.equal(movement.computePath(origin, point(7), caps, map), null)
  const server = getReachableCells(origin, 7, caps, map)
  server.delete(key(origin))
  assert.deepEqual(server, waterCells)
  movement.clearMovement()
  assert.equal(movement.computePath(origin, point(7), caps, map), null, 'uncached path queries see the same edit')

  map.groundTiles[5].terrain = 'normal'
  map.walls.push({ id: 'new-wall', ...point(1), face: 'east' })
  movement.invalidateSearch()
  assert.deepEqual(movement.computeReachable(origin, 7, caps, map), new Set([key(point(1))]))
  const destroyed = new Set(['new-wall'])
  assert.ok(movement.computeReachable(origin, 7, caps, map, destroyed).has(key(point(7))))
  assert.ok(getReachableCells(origin, 7, caps, map, destroyed).has(key(point(7))))
})
