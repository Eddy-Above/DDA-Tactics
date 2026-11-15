import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { getReachableCells } = loadTypeScript('server/utils/mapMovement.ts')
const { movementPathError } = loadTypeScript('utils/movementPath.ts')
const key = p => `${p.x},${p.y},${p.z}`

for (const size of ['large', 'huge', 'gigantic']) for (const direction of ['west', 'east', 'north', 'south']) {
  test(`${size} stepping ${direction} pays enough movement to clear its whole footprint`, () => {
    const custom = size === 'gigantic' ? { width: 4, height: 3, depth: 6 } : null
    const dims = rules.getFootprintDimensions(size, custom), origin = { x: 0, y: 8, z: 0 }
    const axis = direction === 'west' || direction === 'east' ? 'x' : 'z'
    const distance = axis === 'x' ? dims.width : dims.depth
    const sign = direction === 'west' || direction === 'north' ? -1 : 1
    const destination = { ...origin, [axis]: distance * sign }
    const map = { groundTiles: [], voxels: [], stairs: [], walls: [], doors: [], ceilings: [], spaceTiles: [] }
    for (let x = -dims.width; x <= dims.width * 2; x++) for (let z = -dims.depth; z <= dims.depth * 2; z++) {
      map.groundTiles.push({ x, y: 0, z })
      if (x >= 0 && x < dims.width && z >= 0 && z < dims.depth) map.groundTiles.push({ x, y: 8, z })
    }
    function reach(budget) {
      const caps = rules.detectCapabilities([], budget, 0, 0, 0, 0)
      const movement = useMapMovement()
      const cells = movement.computeReachable(origin, budget, caps, map, new Set(), new Map(), size, false, custom)
      const server = getReachableCells(origin, budget, caps, map, new Set(), new Set(), dims)
      server.delete(key(origin))
      assert.deepEqual(cells, server)
      return { caps, movement, cells }
    }
    const short = reach(distance - 1)
    assert.ok(!short.cells.has(key(destination)))
    const partial = { ...origin, [axis]: (distance - 1) * sign }
    assert.equal(rules.isFootprintAirborne(partial, dims, map), false, 'the last row still grounds the unit')
    const full = reach(distance)
    assert.ok(full.cells.has(key(destination)))
    const path = full.movement.computePath(origin, destination, full.caps, map, new Set(), new Map(), size, false, custom)
    assert.equal(path.length - 1, distance)
    assert.equal(movementPathError(path, full.caps, distance, rules.createMovementMapView(map), dims), null)
    assert.equal(rules.isFootprintAirborne(destination, dims, map), true)
    assert.equal(rules.settleFootprintY(destination, dims, map), 0)
    const farther = { ...destination, [axis]: destination[axis] + sign }
    assert.ok(!reach(distance + 1).cells.has(key(farther)), 'the whole footprint must remain within one cell of footing')
  })
}
