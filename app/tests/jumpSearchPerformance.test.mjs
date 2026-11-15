import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { searchReachableWithState } = loadTypeScript('utils/pathfinding.ts')
const { movementPathError } = loadTypeScript('utils/movementPath.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const key = p => `${p.x},${p.y},${p.z}`
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [] })

// The original traversal is kept as an independent oracle for the optimized edge cache.
function originalTraversal(origin, caps, map, costs) {
  const supported = pos => rules.canStartJump(pos, map, caps), noJump = { ...caps, canJump: false }
  return {
    initial: supported(origin) ? origin : null,
    key: state => state ? caps.jumpHeight === caps.jumpRange ? String(state.y) : key(state) : '',
    step: (from, to, spent, state) => {
      const launch = supported(from) ? from : state
      if (!rules.canPassThrough(from, to, launch ? caps : noJump, map, new Set(), launch ?? from)) return null
      const cost = costs.stepCost(from, to, map, spent, launch)
      if (!Number.isFinite(cost)) return null
      const landed = supported(to) || rules.isSwimmingCell(map, to) || rules.getDigTerrainMultiplier(map, to, caps) > 0
        || rules.hasClimbSupport(map, to, caps)
      return { cost, state: landed ? null : launch }
    },
  }
}

for (const swimmer of [false, true]) for (const advanced of [false, true]) {
  test(`${swimmer ? 'Swimmer + Jumper' : 'Jumper'} ${advanced ? 'advanced' : 'ordinary'} preserves complete reachability and legal preview paths`, () => {
    const map = emptyMap(), origin = point(0, 1)
    for (let x = -2; x <= 3; x++) for (let z = -2; z <= 2; z++) {
      map.voxels.push({ ...point(x, 0, z), materialId: 'water' })
      if (z === 0 || x === 3) map.groundTiles.push(point(x, 1, z))
    }
    map.voxels.push({ ...point(1, 2), materialId: 'steel' })
    map.walls.push({ id: 'wall', ...point(0, 2), face: 'east' })
    const qualities = [{ id: 'extra-movement', choiceId: 'jumper' }]
    if (swimmer) qualities.push({ id: 'extra-movement', choiceId: 'swimmer' })
    if (advanced) qualities.push({ id: 'advanced-mobility', choiceId: 'adv-jumper' })
    const dims = rules.getFootprintDimensions(advanced ? 'large' : 'medium')
    const caps = { ...rules.detectCapabilities(qualities, 3, 1, 1), footprint: dims }
    const view = rules.createMovementMapView(map)
    const costs = rules.getMovementCostProfile(caps, 3, new Set(), origin)
    const reference = searchReachableWithState(origin, costs.budget, originalTraversal(origin, caps, view, costs))
    const optimized = searchReachableWithState(origin, costs.budget, rules.createJumpTraversal(origin, caps, view, costs))
    assert.deepEqual(optimized.cells, reference.cells)
    const movement = useMapMovement()
    const landable = movement.computeReachable(origin, 3, caps, map, new Set(), new Map(), advanced ? 'large' : 'medium')
    const expected = new Set([...reference.cells].filter(k => {
      if (k === key(origin)) return false
      const [x, y, z] = k.split(',').map(Number), pos = point(x, y, z), launch = reference.stateTo(pos)
      return rules.canLandOn(pos, launch ? caps : { ...caps, canJump: false }, view, new Set(), launch ?? undefined)
    }))
    assert.deepEqual(landable, expected)
    for (const k of [...landable].filter((_, i) => i % 23 === 0)) {
      const [x, y, z] = k.split(',').map(Number)
      const path = movement.computePath(origin, point(x, y, z), caps, map, new Set(), new Map(), advanced ? 'large' : 'medium')
      assert.equal(movementPathError(path, caps, 3, view, dims), null, k)
      assert.equal(path.length, reference.pathTo(point(x, y, z)).length)
      const score = route => route.slice(1).reduce((sum, p, i) => [sum[0] + Math.abs(p.y - route[i].y),
        sum[1] + Number(Number(p.x !== route[i].x) + Number(p.y !== route[i].y) + Number(p.z !== route[i].z) > 1)], [0, 0])
      assert.deepEqual(score(path), score(reference.pathTo(point(x, y, z))), 'equally short paths still prefer fewer diagonals')
    }
  })
}

test('targeted jump search keeps looking when the cheapest goal arrival cannot finish there', () => {
  const origin = point(), goal = point(1), detour = point(0, 0, 1)
  const traversal = {
    initial: 'start', key: state => state,
    step: (from, to) => {
      if (key(from) === key(origin) && key(to) === key(goal)) return { cost: 1, state: 'bad' }
      if (key(from) === key(origin) && key(to) === key(detour)) return { cost: 1, state: 'good' }
      if (key(from) === key(detour) && key(to) === key(goal)) return { cost: 1, state: 'good' }
      return null
    },
  }
  const result = searchReachableWithState(origin, 2, traversal, goal, (_pos, state) => state === 'good')
  assert.deepEqual(result.pathTo(goal), [origin, detour, goal])
  assert.equal(result.stateTo(goal), 'good')
})
