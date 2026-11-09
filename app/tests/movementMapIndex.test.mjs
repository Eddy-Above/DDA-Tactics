import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const indexModule = loadTypeScript('utils/movementMapIndex.ts')
const rules = loadTypeScriptWithMocks('utils/movementRules.ts', { '~/utils/movementMapIndex': indexModule })
const { getMovementMapIndex } = indexModule
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], ceilings: [], stairs: [] })
const walking = { canFly: false, canJump: false, jumpHeight: 0, jumpRange: 0, canClimb: false, canSwim: false, canDig: false }
const swimmer = { ...walking, canSwim: true }
const climber = { ...walking, canClimb: true, canClimbCeilings: true }
const digger = { ...walking, canDig: true, canDigHardSurfaces: true }

test('search indexes belong only to shallow views and leave map data and object identities intact', () => {
  const map = emptyMap()
  map.groundTiles.push({ ...point(), terrain: 'normal' })
  const before = JSON.stringify(map)
  const view = rules.createMovementMapView(map)
  assert.notEqual(view, map)
  assert.equal(getMovementMapIndex(map), undefined, 'mutable application roots are never cached')
  assert.ok(getMovementMapIndex(view))
  assert.equal(rules.createMovementMapView(view), view)
  assert.notEqual(rules.createMovementMapView(map), view)
  assert.deepEqual(Object.keys(view), Object.keys(map))
  for (const name of Object.keys(map)) assert.equal(view[name], map[name])
  assert.equal(JSON.stringify(map), before)
  assert.equal(JSON.stringify(view), before, 'query indexes are not serialized')
})

test('ground, space and voxel duplicates preserve the first matching saved entry', () => {
  for (const [collection, first, second] of [
    ['groundTiles', { terrain: 'water' }, { terrain: 'normal' }],
    ['spaceTiles', { spaceType: 'water' }, { spaceType: 'air' }],
    ['voxels', { materialId: 'water' }, { materialId: 'steel' }],
  ]) {
    const map = emptyMap()
    map[collection].push({ ...point(), ...first }, { ...point(), ...second })
    assert.equal(rules.isWaterCell(rules.createMovementMapView(map), point()), true)
    map[collection].reverse()
    assert.equal(rules.isWaterCell(rules.createMovementMapView(map), point()), false)
    assert.equal(rules.isWaterCell(map, point()), false, 'unindexed callers retain direct lookup behavior')
  }
})

test('fresh views reflect array replacements, pushes and edits on the same source map', () => {
  const map = emptyMap()
  const oldView = rules.createMovementMapView(map)
  assert.equal(rules.isWaterCell(oldView, point()), false)
  map.voxels.push({ ...point(), materialId: 'water' })
  assert.equal(rules.isWaterCell(rules.createMovementMapView(map), point()), true)
  map.voxels[0].blocksMovement = true
  assert.equal(rules.isWaterCell(rules.createMovementMapView(map), point()), false)
  map.voxels = []
  map.groundTiles = [{ ...point(), terrain: 'water' }]
  assert.equal(rules.isWaterCell(rules.createMovementMapView(map), point()), true)
  assert.equal(getMovementMapIndex(map), undefined)
})

test('all colocated walls and ceilings remain candidates after earlier entries are destroyed', () => {
  const map = emptyMap(), origin = point(), east = point(1)
  map.groundTiles = [origin, east].map(pos => ({ ...pos, terrain: 'normal' }))
  map.walls = ['destroyed-wall', 'active-wall'].map(id => ({ id, ...origin, face: 'east' }))
  map.ceilings = ['destroyed-ceiling', 'active-ceiling'].map(id => ({ id, ...origin }))
  const destroyed = new Set(['destroyed-wall', 'destroyed-ceiling'])
  for (const geometry of [map, rules.createMovementMapView(map)]) {
    assert.equal(rules.canPassThrough(origin, east, walking, geometry, destroyed), false)
    assert.equal(rules.canPassThrough(origin, point(0, 1), rules.PROJECTILE_CAPS, geometry, destroyed), false)
    assert.equal(rules.canPassThrough(origin, east, walking, geometry, new Set(map.walls.map(wall => wall.id))), true)
    assert.equal(rules.hasClimbSupport(geometry, origin, climber, destroyed), true)
  }
})

test('legacy wall elevation, source elevation and first-door climbing semantics match direct queries', () => {
  const map = emptyMap()
  map.walls = [{ id: 'wall', x: 0, z: 0, face: 'east' }]
  const cases = [[], [{ id: 'closed', wallId: 'wall', isOpen: false }, { id: 'open', wallId: 'wall', isOpen: true }],
    [{ id: 'open', wallId: 'wall', isOpen: true }, { id: 'closed', wallId: 'wall', isOpen: false }]]
  for (const doors of cases) {
    map.doors = doors
    const view = rules.createMovementMapView(map)
    for (const from of [point(), point(1), point(0, 1)]) {
      for (const to of [point(1), point(1, 1), point(1, 1, 1)]) {
        assert.equal(rules.canPassThrough(from, to, rules.PROJECTILE_CAPS, view),
          rules.canPassThrough(from, to, rules.PROJECTILE_CAPS, map))
      }
      for (const destroyed of [new Set(), new Set(['wall']), new Set(['closed'])]) {
        assert.equal(rules.hasClimbSupport(view, from, climber, destroyed), rules.hasClimbSupport(map, from, climber, destroyed))
      }
    }
  }
})

test('indexed water, digging, stairs and neighbour supports match direct geometry helpers', () => {
  const map = emptyMap()
  map.voxels = [{ ...point(0, 1), materialId: 'water' }, { ...point(1, 1), materialId: 'soft-metal' },
    { ...point(2, 1), materialId: 'steel' }, { ...point(3, 1), materialId: 'water', blocksMovement: true }]
  map.spaceTiles = [{ ...point(0, -1), spaceType: 'water' }]
  map.stairs = [{ id: 'stairs', ...point(4, 1), face: 'north' }]
  map.ceilings = [{ id: 'ceiling', ...point(5, 2) }]
  const view = rules.createMovementMapView(map)
  for (let x = -1; x <= 6; x++) for (let y = -2; y <= 3; y++) {
    const pos = point(x, y)
    for (const name of ['isWaterCell', 'isSwimmingCell', 'hasSolidVoxelSupport', 'hasSolidStairSupport']) {
      assert.equal(rules[name](view, pos), rules[name](map, pos), `${name} at ${x},${y}`)
    }
    for (const caps of [walking, swimmer, climber, digger]) {
      assert.equal(rules.getDigTerrainMultiplier(view, pos, caps), rules.getDigTerrainMultiplier(map, pos, caps))
      assert.equal(rules.hasClimbSupport(view, pos, caps), rules.hasClimbSupport(map, pos, caps))
      assert.equal(rules.canLandOn(pos, caps, view, new Set(), point()), rules.canLandOn(pos, caps, map, new Set(), point()))
    }
  }
})
