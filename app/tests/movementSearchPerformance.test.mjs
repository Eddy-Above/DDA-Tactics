import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { searchReachable, findPath } = loadTypeScript('utils/pathfinding.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const key = p => `${p.x},${p.y},${p.z}`
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], stairs: [], walls: [], doors: [], ceilings: [] })

test('weighted searches skip collisions for unavailable terrain, exhausted allowance and worse arrivals', () => {
  const origin = point(), cheap = point(1), expensive = point(0, 0, 1), beyond = point(2), blocked = point(-1)
  const costs = new Map([[key(origin), 1], [key(cheap), 1], [key(expensive), 2], [key(beyond), 2], [key(blocked), 1]])
  const stepCost = (_from, to) => costs.get(key(to)) ?? Infinity
  for (const targeted of [false, true]) {
    const checked = []
    const canPass = (_from, to) => {
      checked.push(key(to))
      return key(to) !== key(blocked)
    }
    if (targeted) {
      assert.deepEqual(findPath(origin, expensive, canPass, Infinity, stepCost), [origin, expensive])
    } else {
      const search = searchReachable(origin, 2, canPass, stepCost)
      assert.deepEqual(search.cells, new Set([key(origin), key(cheap), key(expensive)]))
      assert.deepEqual(search.pathTo(expensive), [origin, expensive])
      assert.ok(!checked.includes(key(beyond)), 'over-budget edges never reach collision checks')
    }
    assert.ok(checked.every(cell => costs.has(cell)), 'unavailable terrain never reaches collision checks')
    assert.ok(!checked.includes(key(origin)), 'worse arrivals at visited cells skip collision checks')
    assert.ok(checked.includes(key(blocked)), 'potentially affordable edges still check obstacles')
  }
})

test('exhausted movement rejects a step without reading geometry', () => {
  const caps = rules.detectCapabilities([], 6, 0, 0, 0)
  const costs = rules.getMovementCostProfile(caps)
  const unreadable = new Proxy({}, { get() { throw new Error('unnecessary geometry read') } })
  assert.equal(costs.stepCost(point(), point(1), unreadable, costs.budget), Infinity)
})

test('cost and collision checks reuse material and clearance facts, and a new search sees edits', () => {
  let reads = 0, material = 'wind'
  const voxel = { ...point(1), get materialId() { reads++; return material } }
  const map = { ...emptyMap(), voxels: [voxel] }
  const caps = { ...rules.detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }], 6, 0, 0, 0),
    footprint: { width: 1, height: 1, depth: 1 } }
  const costs = rules.getMovementCostProfile(caps)
  assert.equal(costs.stepCost(point(), point(1), map), 1)
  const facts = costs.cellAt(point(1), map)
  assert.equal(rules.canPassThrough(point(), point(1), caps, map, new Set(), point(), facts), true)
  const initialReads = reads
  assert.ok(initialReads > 0)
  for (let spent = 0; spent < 6; spent++) {
    assert.equal(costs.stepCost(point(), point(1), map, spent), 1)
    assert.equal(rules.canPassThrough(point(), point(1), caps, map, new Set(), point(), facts), true)
  }
  assert.equal(reads, initialReads, 'repeated arrivals do not reclassify the destination material')
  material = 'steel'
  const next = rules.getMovementCostProfile(caps)
  assert.equal(next.stepCost(point(), point(1), map), Infinity)
  assert.equal(rules.canPassThrough(point(), point(1), caps, map, new Set(), point(), next.cellAt(point(1), map)), false)
})

test('Naturewalk terrain cost is resolved once per destination, and refreshed for a new search', () => {
  let calls = 0
  const cachedRules = loadTypeScriptWithMocks('utils/movementRules.ts', {
    '~/utils/naturewalk': {
      resolveNaturewalkEnvironment: () => { calls++; return ['steel'] },
    },
  })
  const map = { ...emptyMap(), voxels: [{ ...point(1), materialId: 'soft-metal' }] }
  const caps = { ...rules.detectCapabilities([
    { id: 'extra-movement', choiceId: 'digger' }, { id: 'advanced-mobility', choiceId: 'adv-digger' },
  ], 6, 0, 0, 0), naturewalkElements: ['steel'] }
  const profile = cachedRules.getMovementCostProfile(caps)
  for (let spent = 0; spent < 6; spent++) assert.equal(profile.stepCost(point(), point(1), map, spent), 1)
  assert.equal(calls, 1)
  assert.equal(cachedRules.getMovementCostProfile(caps).stepCost(point(), point(1), map), 1)
  assert.equal(calls, 2)
})
