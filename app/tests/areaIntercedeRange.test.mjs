import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { findAreaIntercedePosition } = loadTypeScript('server/utils/mapMovement.ts')
const { detectCapabilities } = loadTypeScript('utils/movementRules.ts')
const dims = { width: 1, height: 1, depth: 1 }
const point = x => ({ x, y: 0, z: 0 })
const key = p => `${p.x},${p.y},${p.z}`
const empty = () => new Set()

test('out-of-range area interceders skip terrain indexing and movement search', () => {
  const map = new Proxy({}, { get() { throw new Error('An unreachable interceder must not search terrain') } })
  const caps = detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }], 8, 1, 1)
  assert.equal(findAreaIntercedePosition(point(40), dims, point(0), 8, caps, dims, map, empty(), new Set([key(point(39))])), null)
  assert.equal(findAreaIntercedePosition(point(1), dims, point(0), 8, caps, dims, map, empty(), empty()), null)
})

test('area intercede retains valid nearby landing and respects flight speed above walking budget', () => {
  const map = { groundTiles: Array.from({ length: 10 }, (_, x) => point(x)), walls: [], doors: [], voxels: [], stairs: [], ceilings: [] }
  const caps = detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }], 4, 1, 1)
  caps.flySpeed = 6
  const area = new Set([key(point(5))])
  assert.deepEqual(findAreaIntercedePosition(point(6), dims, point(0), 1, caps, dims, map, empty(), area), point(5))
  const occupied = new Set([key(point(5))])
  assert.equal(findAreaIntercedePosition(point(6), dims, point(0), 1, caps, dims, map, occupied, area), null)
})
