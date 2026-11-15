import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildLosIndex, losClear, losClip, canSeeFootprint } = loadTypeScript('utils/lineOfSight.ts')
const point = (x, y, z) => ({ x, y, z })
const dims = { width: 1, height: 1, depth: 1 }

for (const direction of ['north', 'east', 'south', 'west']) {
  test(`${direction} ramp blocks its solid wedge, but permits sight above its low edge`, () => {
    const axis = direction === 'east' || direction === 'west' ? 'x' : 'z'
    const low = direction === 'east' || direction === 'south' ? 0.1 : 0.9
    const high = 1 - low
    const endpoints = value => axis === 'z'
      ? [point(-1, 0, value - 0.5), point(1, 0, value - 0.5)]
      : [point(value - 0.5, 0, -1), point(value - 0.5, 0, 1)]
    const map = { groundTiles: [], voxels: [{ x: 0, y: 0, z: 0, materialId: 'steel', shape: 'ramp', rampDirection: direction }] }
    const index = buildLosIndex(map)
    const [from, to] = endpoints(low)
    assert.equal(losClear(index, from, to), true)
    assert.equal(losClear(index, to, from), true)
    assert.deepEqual(losClip(index, from, to), to)
    assert.equal(canSeeFootprint(index, from, dims, to, dims), true)
    const [blockedFrom, blockedTo] = endpoints(high)
    assert.equal(losClear(index, blockedFrom, blockedTo), false)
    assert.equal(losClear(index, blockedTo, blockedFrom), false)
    map.voxels[0].shape = 'cube'
    assert.equal(losClear(buildLosIndex(map), from, to), false)
    map.voxels[0].blocksMovement = false
    map.voxels[0].blocksSight = false
    assert.equal(losClear(buildLosIndex(map), blockedFrom, blockedTo), true)
  })
}

test('diagonal sight enters the slope even after passing through the empty part of a ramp cell', () => {
  const map = { voxels: [{ x: 0, y: 0, z: 0, materialId: 'steel', shape: 'ramp', rampDirection: 'north' }] }
  const index = buildLosIndex(map)
  const from = point(0, 0, 1), to = point(0, 0, -1)
  assert.equal(losClear(index, from, to), false)
  assert.equal(losClear(index, to, from), false)
  assert.notDeepEqual(losClip(index, from, to), to)
})
