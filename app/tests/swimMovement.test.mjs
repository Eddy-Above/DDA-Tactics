import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const {
  calculateSwimSpeed, detectCapabilities, isWaterCell, isSwimmingCell, getMovementCostProfile,
  canPassThrough, canLandOn, isPositionInAir, isFootprintAirborne,
  settleFootprintY, resolveFall, PROJECTILE_CAPS,
} = loadTypeScript('utils/movementRules.ts')

const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const swimmer = [{ id: 'extra-movement', choiceId: 'swimmer' }]
const advanced = [...swimmer, { id: 'advanced-mobility', choiceId: 'adv-swimmer' }]
const dims = { width: 1, height: 1, depth: 1 }
const caps = detectCapabilities([], 8, 3, 2, undefined, 6)
const noSwim = detectCapabilities([], 8, 3, 2, 0, 6)
const emptyMap = () => ({
  groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [],
})

function waterMap(kind, pos) {
  const map = emptyMap()
  if (kind === 'ground') map.groundTiles.push({ ...pos, terrain: 'water' })
  if (kind === 'space') map.spaceTiles.push({ ...pos, spaceType: 'water' })
  if (kind === 'voxel') map.voxels.push({ id: 'water', ...pos, materialId: 'water' })
  if (kind === 'legacy voxel') map.voxels.push({ id: 'water', ...pos, element: 'water' })
  return map
}

test('ordinary swimming uses half Basic Movement before Speedy; Swimmer uses total Movement', () => {
  assert.equal(calculateSwimSpeed([], 13, 3, 7), 3)
  assert.equal(calculateSwimSpeed(swimmer, 13, 3, 7), 13)
  assert.equal(calculateSwimSpeed(advanced, 13, 3, 7), 16)
  assert.equal(calculateSwimSpeed([], 7, 3), 3, 'omitting Basic Movement preserves the additive API')
  assert.equal(calculateSwimSpeed([{ id: 'unrelated', choiceId: 'swimmer' }], 13, 3, 7), 3)
  assert.equal(calculateSwimSpeed([advanced[1]], 13, 3, 7), 6, 'Advanced Swimmer adds RAM to the default without Extra Movement')
  assert.equal(calculateSwimSpeed(advanced, 13, -3, 7), 13, 'negative RAM cannot turn an Advanced bonus into a penalty')
})

test('capabilities use positive swim speed and allow explicitly excluding tamers', () => {
  assert.equal(caps.canSwim, true)
  assert.equal(caps.movementSpeed, 8)
  assert.equal(caps.swimSpeed, 3)
  assert.equal(noSwim.canSwim, false)
  assert.equal(noSwim.swimSpeed, 0)
  for (const basic of [-2, 0, 1]) {
    const slow = detectCapabilities([], 8, 3, 2, undefined, basic)
    assert.equal(slow.canSwim, false)
    assert.equal(slow.swimSpeed, 0)
  }
  assert.equal(calculateSwimSpeed(swimmer, -2, 3), 0)
})

for (const kind of ['ground', 'space', 'voxel', 'legacy voxel']) {
  test(`${kind} water permits horizontal and vertical swimming and landing at depth`, () => {
    const pos = point(1, 3, 1)
    const map = waterMap(kind, pos)
    assert.equal(isWaterCell(map, pos), true)
    for (const from of [point(0, 3, 1), point(1, 2, 1), point(1, 4, 1), point(0, 2, 0)]) {
      assert.equal(canPassThrough(from, pos, caps, map), true)
      assert.equal(canPassThrough(from, pos, noSwim, map), false)
    }
    assert.equal(canLandOn(pos, caps, map, new Set()), true)
    assert.equal(canLandOn(pos, noSwim, map, new Set()), false)
    assert.equal(canLandOn(pos, caps, map, new Set(['1,3,1'])), false)
    const swimOnly = { ...caps, canJump: false }
    assert.equal(canPassThrough(pos, point(1, 5, 1), swimOnly, map), false, 'swimming does not permit entering air above the water surface')
    assert.equal(canLandOn(point(1, 5, 1), swimOnly, map, new Set()), false)
  })
}

test('swimming can leave water onto a normal floor', () => {
  const map = waterMap('voxel', point())
  map.groundTiles.push({ ...point(1), terrain: 'normal' })
  assert.equal(canPassThrough(point(), point(1), caps, map), true)
  assert.equal(canLandOn(point(1), caps, map, new Set()), true)
})

for (const kind of ['space', 'voxel', 'legacy voxel']) {
  test(`${kind} swimming can surface from deep water without flight or a jump`, () => {
    const map = waterMap(kind, point(0, 9))
    const swimOnly = { ...caps, canJump: false, jumpHeight: 0, jumpRange: 0 }
    const surface = point(0, 10)
    assert.equal(isWaterCell(map, surface), false)
    assert.equal(isSwimmingCell(map, surface), true)
    assert.equal(canPassThrough(point(0, 9), surface, swimOnly, map, new Set(), point(0, -10)), true)
    assert.equal(canLandOn(surface, swimOnly, map, new Set(), point(0, -10)), true)
    assert.equal(isSwimmingCell(map, point(0, 11)), false)
    assert.equal(canPassThrough(surface, point(0, 11), swimOnly, map), false)
    map.voxels.push({ id: 'blocked-surface', ...surface, materialId: 'glass' })
    assert.equal(isSwimmingCell(map, surface), false)
  })
}

test('walls, diagonal wall corners, ceilings and stairs continue to block swimmers', () => {
  const map = waterMap('voxel', point(1))
  map.walls.push({ id: 'wall', ...point(), face: 'east' })
  assert.equal(canPassThrough(point(), point(1), caps, map), false)
  assert.equal(canPassThrough(point(), point(1), caps, map, new Set(['wall'])), true)
  map.voxels.push({ id: 'diagonal', ...point(1, 0, 1), materialId: 'water' })
  assert.equal(canPassThrough(point(), point(1, 0, 1), caps, map), false)

  const above = waterMap('space', point(0, 1))
  above.ceilings.push({ id: 'ceiling', ...point() })
  assert.equal(canPassThrough(point(), point(0, 1), caps, above), false)
  assert.equal(canPassThrough(point(), point(0, 1), caps, above, new Set(['ceiling'])), true)
  above.stairs.push({ id: 'stair', ...point(0, 1), face: 'north' })
  assert.equal(canPassThrough(point(), point(0, 1), caps, above, new Set(['ceiling'])), false)
  assert.equal(canLandOn(point(0, 1), caps, above, new Set()), false)
})

test('solid voxel overrides win over water and appearance does not determine movement', () => {
  const map = waterMap('ground', point())
  map.voxels.push({ id: 'solid-water', ...point(), materialId: 'water', blocksMovement: true, opacity: 0 })
  assert.equal(isWaterCell(map, point()), false)
  assert.equal(canPassThrough(point(-1), point(), caps, map), false)
  assert.equal(canLandOn(point(), caps, map, new Set()), false)

  map.voxels[0].blocksMovement = false
  map.voxels[0].opacity = 1
  assert.equal(isWaterCell(map, point()), true)
  assert.equal(canPassThrough(point(-1), point(), caps, map), true)

  map.groundTiles = []
  map.voxels[0] = { id: 'glass', ...point(), materialId: 'glass', opacity: 0 }
  assert.equal(isWaterCell(map, point()), false)
  assert.equal(canPassThrough(point(-1), point(), caps, map), false)
})

test('physical movement spent must fit the destination swim or walk speed', () => {
  const map = waterMap('voxel', point(1))
  map.groundTiles.push(...[0, 2, 3].map(x => ({ ...point(x), terrain: 'normal' })))
  const profile = getMovementCostProfile(caps)
  assert.equal(profile.budget, 8)
  assert.equal(profile.stepCost(point(), point(1), map, 2), 1)
  assert.equal(profile.stepCost(point(), point(1), map, 3), Infinity)
  assert.equal(profile.stepCost(point(1), point(1, 1), map, 2), 1)
  assert.equal(profile.stepCost(point(1), point(1, 1), map, 3), Infinity)
  assert.equal(profile.stepCost(point(1), point(2), map, 3), 1, 'leaving water uses the destination walking limit')
  assert.equal(profile.stepCost(point(1), point(2), map, 7), 1)
  assert.equal(profile.stepCost(point(1), point(2), map, 8), Infinity)
  assert.equal(profile.stepCost(point(2), point(3), map), 1)
  assert.equal(getMovementCostProfile(noSwim).stepCost(point(), point(1), map), Infinity)
})

test('Walk 7 and Swim 4 share physical movement spent across mode changes', () => {
  const map = waterMap('voxel', point(1))
  map.voxels.push({ ...point(2), materialId: 'water' })
  map.groundTiles.push(...[0, 3, 4, 5, 6].map(x => ({ ...point(x), terrain: 'normal' })))
  const profile = getMovementCostProfile(detectCapabilities([], 7, 0, 0, 4, 8))
  assert.equal(profile.budget, 7)
  assert.equal(profile.stepCost(point(), point(1), map, 4), Infinity, 'walking four leaves no swimming movement')
  assert.equal(profile.stepCost(point(), point(1), map, 2), 1)
  assert.equal(profile.stepCost(point(1), point(2), map, 3), 1, 'walking two and swimming two spends four')
  assert.equal(profile.stepCost(point(2), point(3), map, 4), 1)
  assert.equal(profile.stepCost(point(3), point(4), map, 5), 1)
  assert.equal(profile.stepCost(point(4), point(5), map, 6), 1, 'three walking cells remain after four total cells spent')
  assert.equal(profile.stepCost(point(5), point(6), map, 7), Infinity)
})

test('Advanced Swimmer can swim farther than its walking speed and dry movement retains its limit', () => {
  const profile = getMovementCostProfile(detectCapabilities(advanced, 8, 3, 2, undefined, 6))
  const map = waterMap('voxel', point(1))
  map.groundTiles.push(...[0, 2, 3].map(x => ({ ...point(x), terrain: 'normal' })))
  assert.equal(profile.budget, 11)
  assert.equal(profile.stepCost(point(), point(1), map, 10), 1)
  assert.equal(profile.stepCost(point(), point(1), map, 11), Infinity)
  assert.equal(profile.stepCost(point(2), point(3), map, 7), 1)
  assert.equal(profile.stepCost(point(2), point(3), map, 8), Infinity)
  const stationary = getMovementCostProfile({ ...caps, movementSpeed: 0 })
  assert.equal(stationary.stepCost(point(2), point(3), map), Infinity)
  assert.equal(getMovementCostProfile(PROJECTILE_CAPS, 5), null)
  assert.equal(getMovementCostProfile({ ...caps, swimSpeed: undefined, digSpeed: undefined, climbSpeed: undefined, flySpeed: undefined }, 5), null)
})

for (const kind of ['ground', 'space', 'voxel', 'legacy voxel']) {
  test(`${kind} Extra Swimmers float while ordinary Digimon fall through water to the floor`, () => {
    const map = waterMap(kind, point(0, 4))
    map.groundTiles.push({ ...point(), terrain: 'normal' })
    const profile = { cpu: 2, ram: 3, hasTumbler: false, hasAdvJumper: false, canFly: false, floatsOnWater: true }
    assert.equal(isPositionInAir(point(0, 4), map), true, 'water provides no solid footing without buoyancy')
    assert.equal(isPositionInAir(point(0, 4), map, true), false)
    assert.equal(isFootprintAirborne(point(0, 4), dims, map, true), false)
    assert.equal(settleFootprintY(point(0, 4), dims, map, true), 4)
    assert.deepEqual(resolveFall(point(0, 4), dims, map, profile), { landingPos: point(0, 4), fallHeight: 0, damage: 0 })
    const surfaceY = kind === 'ground' ? 4 : 5
    assert.equal(isPositionInAir(point(0, 5), map, true), kind === 'ground', 'only water volumes provide a surface one level above their cell')
    assert.deepEqual(resolveFall(point(0, 14), dims, map, profile), { landingPos: point(0, surfaceY), fallHeight: 14 - surfaceY, damage: 14 - surfaceY - 7 })
    assert.deepEqual(resolveFall(point(0, 14), dims, map, { ...profile, floatsOnWater: false }), { landingPos: point(), fallHeight: 14, damage: 7 })
    assert.deepEqual(resolveFall(point(0, 4), dims, map, { ...profile, floatsOnWater: false }), { landingPos: point(), fallHeight: 4, damage: 0 })
    assert.equal(settleFootprintY(point(0, 4), dims, map), 0)
  })
}

test('water spaces below the base level can catch a falling Extra Swimmer without another structure', () => {
  const map = waterMap('space', point(0, -3))
  assert.equal(settleFootprintY(point(), dims, map, true), -2)
  assert.equal(settleFootprintY(point(), dims, map), 0)
})

test('water ground supports Extra Swimmers and preserves solid footing beneath ordinary swimmers', () => {
  const map = waterMap('ground', point(0, 3))
  map.groundTiles.push({ ...point(), terrain: 'normal' })
  assert.equal(isPositionInAir(point(0, 3), map), true)
  assert.equal(settleFootprintY(point(0, 6), dims, map), 0)
  assert.equal(isPositionInAir(point(0, 4), map, true), true, 'ground water stays a surface at its own Y')
  assert.equal(settleFootprintY(point(0, 6), dims, map, true), 3)
  map.voxels.push({ id: 'underwater-floor', ...point(0, 2), materialId: 'steel' })
  assert.equal(isPositionInAir(point(0, 3), map), false)
  assert.equal(settleFootprintY(point(0, 6), dims, map), 3)
  map.voxels = []
  map.stairs.push({ id: 'underwater-stair', ...point(0, 2), face: 'north' })
  assert.equal(isPositionInAir(point(0, 3), map), false)
  assert.equal(settleFootprintY(point(0, 6), dims, map), 3)
  assert.equal(isPositionInAir(point(1, 3), map, true), true)
  const large = { width: 2, height: 2, depth: 2 }
  const volume = waterMap('voxel', point(1, 3, 1))
  assert.equal(isFootprintAirborne(point(0, 3, 0), large, volume, true), false, 'partial base support follows existing footprint support rules')
})
