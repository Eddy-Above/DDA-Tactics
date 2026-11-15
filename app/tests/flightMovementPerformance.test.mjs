import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { searchReachableWithState } = loadTypeScript('utils/pathfinding.ts')

test('Flight avoids redundant jump states while preserving every reachable cell on multiple levels', () => {
  const map = rules.createMovementMapView({ groundTiles: Array.from({ length: 625 }, (_, n) => ({ x: n % 25, y: (n % 25) % 3, z: Math.floor(n / 25) })),
    voxels: [], stairs: [], walls: [], doors: [], ceilings: [], spaceTiles: [] })
  const caps = rules.detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }], 5, 0, 0)
  const origin = { x: 12, y: 0, z: 12 }, profile = rules.getMovementCostProfile(caps, 5, new Set(), origin)
  function run(traversalCaps) {
    const traversal = rules.createJumpTraversal(origin, traversalCaps, map, profile)
    let edges = 0
    const search = searchReachableWithState(origin, profile.budget, { ...traversal,
      step: (...args) => { edges++; return traversal.step(...args) } })
    return { edges, search }
  }
  // Keep the original geometry and real cost profile, while disabling just the flight fast path.
  const original = run({ ...caps, movementSpeed: 0, flySpeed: 0 })
  const optimized = run(caps)
  assert.deepEqual(optimized.search.cells, original.search.cells)
  assert.ok(optimized.edges < original.edges * 0.6, `${optimized.edges} vs ${original.edges} traversal checks`)
  for (const cell of optimized.search.cells) {
    const [x, y, z] = cell.split(',').map(Number)
    assert.equal(optimized.search.pathTo({ x, y, z }).length, original.search.pathTo({ x, y, z }).length)
  }
})

test('an Advanced Jumper whose jump exceeds flight still retains its launch state', () => {
  const map = rules.createMovementMapView({ groundTiles: [{ x: 0, y: 0, z: 0 }], stairs: [], voxels: [], walls: [], doors: [], ceilings: [], spaceTiles: [] })
  const caps = rules.detectCapabilities([{ id: 'extra-movement', choiceId: 'flight' }, { id: 'advanced-mobility', choiceId: 'adv-jumper' }], 4, 0, 2)
  const origin = { x: 0, y: 0, z: 0 }
  const traversal = rules.createJumpTraversal(origin, caps, map, rules.getMovementCostProfile(caps, 4, new Set(), origin))
  assert.deepEqual(traversal.initial, origin)
})
