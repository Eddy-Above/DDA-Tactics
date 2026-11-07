import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { effectScope, reactive, ref, watch } from 'vue'
import ts from 'typescript'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const pathfinding = loadTypeScript('utils/pathfinding.ts')
const rules = loadTypeScript('utils/movementRules.ts')
const point = (x, z = 0, y = 0) => ({ x, y, z })
const key = p => `${p.x},${p.y},${p.z}`
const walking = { canFly: false, canJump: false, jumpHeight: 0, jumpRange: 0, canClimb: false, canSwim: false, canDig: false }
function floor(width = 8, depth = 5) {
  return {
    id: 'map', groundTiles: Array.from({ length: width * depth }, (_, n) => point(n % width, Math.floor(n / width))),
    spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], stairs: [], ceilings: [],
  }
}
function harness() {
  const calls = { pass: 0, astar: 0 }
  const { useMapMovement } = loadTypeScriptWithMocks('composables/useMapMovement.ts', {
    '~/utils/movementRules': { ...rules, canPassThrough: (...args) => { calls.pass++; return rules.canPassThrough(...args) } },
    '~/utils/pathfinding': { ...pathfinding, findPath: (...args) => { calls.astar++; return pathfinding.findPath(...args) } },
  })
  return { movement: useMapMovement(), calls }
}

test('reachable search retains shortest paths through a detour, with no repeated traversal', () => {
  const allowed = new Set(floor(5, 5).groundTiles.filter(p => p.x !== 2 || p.z === 4).map(key))
  let calls = 0
  const pass = (_, to) => { calls++; return allowed.has(key(to)) }
  const search = pathfinding.searchReachable(point(0), 12, pass)
  const before = calls
  const path = search.pathTo(point(4))
  assert.equal(path.length, pathfinding.findPath(point(0), point(4), (_, to) => allowed.has(key(to))).length)
  assert.deepEqual(path[0], point(0))
  assert.deepEqual(path.at(-1), point(4))
  assert.ok(path.every(p => allowed.has(key(p))))
  assert.deepEqual(search.pathTo(point(0)), [point(0)])
  assert.equal(search.pathTo(point(99)), null)
  assert.equal(calls, before)
  assert.deepEqual(pathfinding.bfsReachable(point(0), 12, (_, to) => allowed.has(key(to))), search.cells)
})

test('movement previews reuse the reachable tree for several destinations and equivalent contexts', () => {
  const { movement, calls } = harness()
  const map = floor()
  movement.computeReachable(point(0), 5, walking, map)
  const before = calls.pass
  for (const destination of [point(4), point(3, 2), point(1)]) {
    const path = movement.computePath(point(0), destination, { ...walking }, map, new Set(), new Map())
    assert.equal(path.length - 1, pathfinding.chebyshev(point(0), destination))
  }
  assert.equal(calls.pass, before)
  assert.equal(calls.astar, 0)
})

test('changed geometry invalidates paths, including an in-place edit signaled by the map owner', () => {
  const { movement, calls } = harness()
  const map = floor(5, 1)
  movement.computeReachable(point(0), 4, walking, map)
  map.walls.push({ id: 'wall', x: 1, y: 0, z: 0, face: 'east' })
  movement.invalidateSearch()
  assert.equal(movement.computePath(point(0), point(4), walking, map), null)
  assert.equal(calls.astar, 1)
  const otherMap = floor(5, 1)
  assert.ok(movement.computePath(point(0), point(4), walking, otherMap))
  assert.equal(calls.astar, 2)
})

test('destroyed-wall, changed origin and changed occupied-footprint contexts never use a stale tree', () => {
  const { movement, calls } = harness()
  const map = floor(6, 1)
  map.walls.push({ id: 'wall', x: 1, y: 0, z: 0, face: 'east' })
  movement.computeReachable(point(0), 5, walking, map, new Set(['wall']))
  assert.equal(movement.computePath(point(0), point(5), walking, map), null)
  assert.equal(calls.astar, 1)
  assert.ok(movement.computePath(point(5), point(3), walking, map))
  assert.equal(calls.astar, 2)
  const occupied = new Map([['enemy', { pos: point(3), size: 'large', isEnemy: true }]])
  assert.equal(movement.computePath(point(0), point(5), walking, map, new Set(['wall']), occupied), null)
  assert.equal(calls.astar, 3)
})

test('allies remain traversable but their complete footprints and the mover footprint cannot be landing sites', () => {
  const { movement, calls } = harness()
  const map = floor(8, 1)
  const units = new Map([['ally', { pos: point(2), size: 'large', isEnemy: false }]])
  const cells = movement.computeReachable(point(0), 6, walking, map, new Set(), units, 'large')
  assert.ok(!cells.has(key(point(1)))) // mover would overlap the ally at x=2
  assert.ok(!cells.has(key(point(2))))
  assert.ok(!cells.has(key(point(3)))) // ally extends through x=3
  assert.ok(cells.has(key(point(4))))
  const before = calls.pass
  const path = movement.computePath(point(0), point(4), walking, map, new Set(), units, 'large')
  assert.ok(path.some(p => p.x === 2))
  assert.equal(calls.pass, before)
  assert.equal(calls.astar, 0)
})

test('flight, jumping, projectile throws and charge-style movement retain their 3D paths', () => {
  for (const caps of [{ ...walking, canFly: true }, { ...walking, canJump: true, jumpHeight: 2, jumpRange: 4 }, rules.PROJECTILE_CAPS]) {
    const { movement, calls } = harness()
    const map = floor()
    if (!caps.canFly) map.spaceTiles = [point(1, 0, 1), point(2, 0, 1)].map(p => ({ ...p, spaceType: 'air' }))
    const destination = point(2, 0, 1)
    const cells = movement.computeReachable(point(0), 4, caps, map)
    assert.ok(cells.has(key(destination)))
    const before = calls.pass
    const path = movement.computePath(point(0), destination, caps, map)
    assert.equal(path.length, 3)
    assert.deepEqual(path.at(-1), destination)
    assert.equal(calls.pass, before)
    assert.equal(calls.astar, 0)
    assert.equal(movement.computePath(point(0), destination, walking, map), null)
    assert.equal(calls.astar, 1)
  }
})

test('clearMovement drops the search; destinations outside its budget keep the existing A* fallback', () => {
  const { movement, calls } = harness()
  const map = floor()
  movement.computeReachable(point(0), 2, walking, map)
  assert.ok(movement.computePath(point(0), point(5), walking, map))
  assert.equal(calls.astar, 1)
  movement.clearMovement()
  assert.equal(movement.reachableCells.value.size, 0)
  assert.deepEqual(movement.activePath.value, [])
  assert.ok(movement.computePath(point(0), point(1), walking, map))
  assert.equal(calls.astar, 2)
})

function hoverHarness() {
  const source = readFileSync(new URL('../components/EncounterMap.vue', import.meta.url), 'utf8')
  const snippet = source.slice(source.indexOf('let lastHoveredMovementCell:'), source.indexOf('function onNpcAction('))
  const compiled = ts.transpileModule(snippet, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText
  const map = ref(floor())
  const positions = ref({ mover: point(0) })
  const props = reactive({ encounter: { destructibleStates: [], participants: [] }, digimonMap: {}, tamerMap: {} })
  const npcMoveParticipantId = ref('mover'), throwAimContext = ref(null), throwAllyAimContext = ref(null)
  const calls = { paths: 0, invalidations: 0, throws: 0 }
  const movement = { reachableCells: ref(new Set()), activePath: ref([]), invalidateSearch: () => calls.invalidations++, computePath: () => calls.paths++ }
  const ctx = { pos: point(0), caps: walking, occupied: new Map(), dInfo: {}, moverSize: 'medium', moverIsEnemy: false, moverGig: null }
  const deps = { map, positions, props, movement, watch, npcMoveParticipantId, throwAimContext, throwAllyAimContext, npcMoveCaps: () => ctx, throwCaps: () => { calls.throws++; return ctx }, destroyedIds: () => new Set() }
  const scope = effectScope()
  const handlers = scope.run(() => new Function(...Object.keys(deps), `${compiled}\nreturn { onCellHovered }`)(...Object.values(deps)))
  return { ...deps, ...handlers, scope, calls }
}

test('real hover handler skips repeated cells and resets after leaving, switching mover or throw mode', () => {
  const h = hoverHarness()
  try {
    h.onCellHovered(point(2)); h.onCellHovered(point(2))
    assert.equal(h.calls.paths, 1)
    h.onCellHovered(null); h.onCellHovered(point(2))
    assert.equal(h.calls.paths, 2)
    h.npcMoveParticipantId.value = 'other'; h.onCellHovered(point(2))
    assert.equal(h.calls.paths, 3)
    h.throwAimContext.value = { thrownTargetId: 'other', controllerId: 'controller' }
    h.onCellHovered(point(2)); h.onCellHovered(point(2))
    assert.equal(h.calls.throws, 1)
    h.throwAimContext.value = null
    h.throwAllyAimContext.value = { allyParticipantId: 'other', interceptorParticipantId: 'controller' }
    h.onCellHovered(point(2))
    assert.equal(h.calls.throws, 2)
  } finally { h.scope.stop() }
})

test('real synchronous map/occupancy/record watchers invalidate even when the hovered cell is unchanged', () => {
  const h = hoverHarness()
  try {
    h.onCellHovered(point(2))
    const mutations = [
      () => h.map.value.voxels.push({ ...point(1), materialId: 'steel' }),
      () => { h.positions.value.mover.x = 1 },
      () => h.props.encounter.destructibleStates.push({ structureId: 'wall', currentWounds: 0 }),
      () => h.props.encounter.participants.push({ id: 'mover', currentStance: 'defensive' }),
      () => { h.props.digimonMap.mon = { size: 'large', giganticDimensions: null } },
      () => { h.props.tamerMap.tamer = { speed: 6 } },
    ]
    for (const mutate of mutations) {
      const before = h.calls.paths
      mutate()
      h.onCellHovered(point(2)); h.onCellHovered(point(2))
      assert.equal(h.calls.paths, before + 1)
    }
    assert.equal(h.calls.invalidations, mutations.length)
  } finally { h.scope.stop() }
})
