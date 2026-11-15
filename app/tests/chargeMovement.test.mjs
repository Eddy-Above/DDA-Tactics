import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { chargeDestinationCells } = loadTypeScript('utils/chargeMovement.ts')
const { footprintDistance, getFootprintCells, sizeInteraction } = loadTypeScript('utils/movementRules.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const dims = (width = 1, height = width, depth = width) => ({ width, height, depth })
const cube = radius => Array.from({ length: (radius * 2 + 1) ** 3 }, (_, i) => {
  const side = radius * 2 + 1
  return `${i % side - radius},${Math.floor(i / side) % side - radius},${Math.floor(i / side ** 2) - radius}`
})

test('rectangular footprint distance matches every cell-pair calculation including vertical reach', () => {
  for (const ad of [dims(), dims(2), dims(4, 2, 3)]) for (const bd of [dims(), dims(3)]) {
    for (let x = -5; x <= 5; x++) for (let y = -3; y <= 3; y++) {
      const a = point(), b = point(x, y, 2)
      let expected = Infinity
      for (const ac of getFootprintCells(a, ad)) for (const bc of getFootprintCells(b, bd)) {
        expected = Math.min(expected, Math.max(Math.abs(ac.x - bc.x), Math.abs(ac.y - bc.y), Math.abs(ac.z - bc.z)))
      }
      assert.equal(footprintDistance(a, ad, b, bd), expected)
    }
  }
})

function brute(reachable, mover, units, reach) {
  return new Set([...reachable].filter(key => {
    const [x, y, z] = key.split(',').map(Number), pos = { x, y, z }
    return units.some(unit => footprintDistance(pos, mover.dims, unit.pos, unit.dims) <= reach)
      && !units.some(unit => sizeInteraction(mover.size, unit.size) !== 'shared' && footprintDistance(pos, mover.dims, unit.pos, unit.dims) === 0)
  }))
}

test('Charge highlights query target neighbourhoods instead of scanning the full flight volume', () => {
  let probes = 0
  class TrackedSet extends Set {
    has(key) { probes++; return super.has(key) }
    [Symbol.iterator]() { throw new Error('The full flight volume should not be scanned') }
  }
  const cells = cube(10), reachable = new TrackedSet(cells)
  const mover = { pos: point(), dims: dims(), size: 'medium' }
  const units = [-5, 5].map(x => ({ pos: point(x), dims: dims(), size: 'medium' }))
  const result = chargeDestinationCells(reachable, mover, units, 1)
  assert.deepEqual(result, brute(new Set(cells), mover, units, 1))
  assert.equal(result.size, 52)
  assert.ok(probes <= 54, `${probes} queries for ${reachable.size} reachable flight cells`)
})

test('Charge filtering agrees for large bodies, Reach, occupied tiles and Tiny sharing', () => {
  const reachable = new Set(cube(3))
  for (const size of ['medium', 'tiny']) for (const reach of [1, 6]) {
    const mover = { pos: point(), dims: dims(2, 3, 2), size }
    const units = [{ pos: point(2, 2), dims: dims(3), size: 'large' }, { pos: point(-2), dims: dims(), size: 'small' }]
    assert.deepEqual(chargeDestinationCells(reachable, mover, units, reach), brute(reachable, mover, units, reach))
  }
})
