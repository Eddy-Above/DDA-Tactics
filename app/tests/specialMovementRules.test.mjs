import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const {
  calculateSpecialMovementSpeeds, detectCapabilities, getDigTerrainMultiplier, hasClimbSupport,
  canPassThrough, canLandOn, resolveFall,
} = loadTypeScript('utils/movementRules.ts')

const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [] })
const qualities = (choice, advanced = false) => [
  { id: 'extra-movement', choiceId: choice },
  ...(advanced ? [{ id: 'advanced-mobility', choiceId: `adv-${choice}` }] : []),
]
const modeCaps = (choice, advanced = false, movement = 6) => ({
  ...detectCapabilities(qualities(choice, advanced), movement, 3, 2, 0, 0),
  canJump: false, jumpHeight: 0, jumpRange: 0,
})
const digger = modeCaps('digger')
const advancedDigger = modeCaps('digger', true)
const climber = modeCaps('wallclimber')
const advancedClimber = modeCaps('wallclimber', true)

function voxelMap(materialId, extras = {}) {
  const map = emptyMap()
  map.voxels.push({ ...point(), materialId, ...extras })
  return map
}

test('special movement requires its Extra Movement choice, uses full Movement and adds Advanced RAM', () => {
  assert.deepEqual(calculateSpecialMovementSpeeds([], 12, 3), { digSpeed: 0, climbSpeed: 0, flySpeed: 0 })
  for (const [choice, field] of [['digger', 'digSpeed'], ['wallclimber', 'climbSpeed'], ['flight', 'flySpeed']]) {
    const basic = calculateSpecialMovementSpeeds(qualities(choice), 12, 3)
    assert.equal(basic[field], 12)
    assert.equal(calculateSpecialMovementSpeeds(qualities(choice, true), 12, 3)[field], 15)
    assert.equal(calculateSpecialMovementSpeeds(qualities(choice, true), 12, -3)[field], 12)
    assert.equal(calculateSpecialMovementSpeeds([{ id: 'advanced-mobility', choiceId: `adv-${choice}` }], 12, 3)[field], 0)
    assert.equal(calculateSpecialMovementSpeeds([{ id: 'unrelated', choiceId: choice }], 12, 3)[field], 0)
  }
})

test('zero movement keeps Flight, Wallclimber and Digger abilities while their travel speeds are zero', () => {
  for (const [choice, capability, speedField] of [
    ['flight', 'canFly', 'flySpeed'], ['wallclimber', 'canClimb', 'climbSpeed'], ['digger', 'canDig', 'digSpeed'],
  ]) {
    const caps = modeCaps(choice, false, 0)
    assert.equal(caps[capability], true)
    assert.equal(caps[speedField], 0)
    assert.equal(detectCapabilities([], 0, 0, 0)[capability], false)
  }
})

for (const material of ['earth', 'sand', 'snow']) {
  test(`Digger enters and ends movement in soft ${material} horizontally and vertically`, () => {
    const map = voxelMap(material)
    assert.equal(getDigTerrainMultiplier(map, point(), digger), 1)
    assert.equal(getDigTerrainMultiplier(map, point(), advancedDigger), 1)
    for (const from of [point(-1), point(0, -1), point(0, 1)]) {
      assert.equal(canPassThrough(from, point(), digger, map), true)
      assert.equal(canPassThrough(from, point(), { ...digger, canDig: false }, map), false)
    }
    assert.equal(canLandOn(point(), digger, map, new Set()), true)
    assert.equal(canLandOn(point(), digger, map, new Set(['0,0,0'])), false)
  })
}

test('legacy earth tiles support vertical digging without enabling travel through empty air', () => {
  for (const layer of ['groundTiles', 'spaceTiles']) {
    const map = emptyMap()
    map[layer].push({ ...point(), ...(layer === 'groundTiles' ? { terrain: 'earth' } : { spaceType: 'earth' }) })
    assert.equal(canPassThrough(point(0, -1), point(), digger, map), true)
    assert.equal(canLandOn(point(), digger, map, new Set()), true)
    assert.equal(getDigTerrainMultiplier(map, point(), { canDig: false }), Infinity)
  }
  assert.equal(canPassThrough(point(), point(0, 1), digger, emptyMap()), false)
  assert.equal(canLandOn(point(), digger, emptyMap(), new Set()), false)
  assert.equal(getDigTerrainMultiplier(emptyMap(), point(), digger), 0)
})

for (const material of ['void', 'wood', 'ice', 'glass']) {
  test(`only Advanced Digger can burrow through solid ${material}`, () => {
    const map = voxelMap(material)
    assert.equal(getDigTerrainMultiplier(map, point(), digger), Infinity)
    assert.equal(getDigTerrainMultiplier(map, point(), advancedDigger), 1)
    assert.equal(canPassThrough(point(-1), point(), digger, map), false)
    assert.equal(canPassThrough(point(-1), point(), advancedDigger, map), true)
    assert.equal(canLandOn(point(), advancedDigger, map, new Set()), true)
  })
}

test('soft metal is difficult Advanced digging while steel and energy solids remain blocked', () => {
  const softMetal = voxelMap('soft-metal')
  assert.equal(getDigTerrainMultiplier(softMetal, point(), digger), Infinity)
  assert.equal(getDigTerrainMultiplier(softMetal, point(), advancedDigger), 2)
  assert.equal(canLandOn(point(), advancedDigger, softMetal, new Set()), true)
  for (const material of ['steel', 'fire', 'thunder', 'light', 'darkness', 'water', 'wind']) {
    const map = voxelMap(material, { blocksMovement: true })
    assert.equal(getDigTerrainMultiplier(map, point(), advancedDigger), Infinity)
    assert.equal(canPassThrough(point(-1), point(), advancedDigger, map), false)
    assert.equal(canLandOn(point(), advancedDigger, map, new Set()), false)
  }
  const repaintedSteel = voxelMap('steel', { tags: ['soft-metal', 'diggable'] })
  assert.equal(getDigTerrainMultiplier(repaintedSteel, point(), advancedDigger), Infinity, 'stale tags cannot make repainted Steel diggable')
  assert.equal(canPassThrough(point(-1), point(), advancedDigger, repaintedSteel), false)
  const window = voxelMap('earth', { feature: 'window' })
  assert.equal(getDigTerrainMultiplier(window, point(), digger), Infinity)
  assert.equal(getDigTerrainMultiplier(window, point(), advancedDigger), 1)
})

test('digging respects walls and ceilings before entering a solid destination', () => {
  const map = voxelMap('earth')
  map.walls.push({ id: 'wall', ...point(-1), face: 'east' })
  assert.equal(canPassThrough(point(-1), point(), digger, map), false)
  assert.equal(canPassThrough(point(-1), point(), digger, map, new Set(['wall'])), true)
  map.walls = []
  map.ceilings.push({ id: 'ceiling', ...point(0, -1) })
  assert.equal(canPassThrough(point(0, -1), point(), digger, map), false)
  assert.equal(canPassThrough(point(0, -1), point(), digger, map, new Set(['ceiling'])), true)
  const stairs = emptyMap()
  stairs.stairs.push({ id: 'stairs', ...point(), face: 'north' })
  assert.equal(canPassThrough(point(-1), point(), digger, stairs), false)
  assert.equal(canPassThrough(point(-1), point(), advancedDigger, stairs), true)
})

test('Wallclimber scales real adjacent wall faces and respects destroyed walls and open doors', () => {
  const map = emptyMap()
  const pos = point(0, 4)
  map.walls.push({ id: 'wall', ...pos, face: 'east' })
  assert.equal(hasClimbSupport(map, pos, climber), true)
  assert.equal(canPassThrough(point(0, 3), pos, climber, map, new Set(), point()), true)
  assert.equal(canLandOn(pos, climber, map, new Set()), true)
  assert.equal(hasClimbSupport(map, pos, climber, new Set(['wall'])), false)
  assert.equal(canLandOn(pos, climber, map, new Set(), point(), new Set(['wall'])), false)
  map.doors.push({ id: 'door', wallId: 'wall', isOpen: true })
  assert.equal(hasClimbSupport(map, pos, climber), false)
  map.doors[0].isOpen = false
  assert.equal(hasClimbSupport(map, pos, climber), true)
  map.walls[0].x = 1
  assert.equal(hasClimbSupport(map, pos, climber), false, 'the opposite face of a neighbouring cell is too far away')
  map.walls[0].face = 'west'
  assert.equal(hasClimbSupport(map, pos, climber), true)
})

test('Wallclimber grips cardinal solid voxel faces but cannot climb unsupported air', () => {
  const map = voxelMap('steel', point(1, 4))
  const pos = point(0, 4)
  assert.equal(hasClimbSupport(map, pos, climber), true)
  assert.equal(canPassThrough(point(0, 3), pos, climber, map, new Set(), point()), true)
  assert.equal(canLandOn(pos, climber, map, new Set()), true)
  assert.equal(hasClimbSupport(map, point(0, 4, 1), climber), false)
  assert.equal(canPassThrough(pos, point(-1, 4), climber, map), false)
  map.voxels[0].materialId = 'water'
  assert.equal(hasClimbSupport(map, pos, climber), false)
})

test('legacy walls without an elevation provide climb support on the base floor', () => {
  const map = emptyMap()
  map.walls.push({ id: 'legacy-wall', x: 0, z: 0, face: 'east' })
  assert.equal(hasClimbSupport(map, point(), climber), true)
  assert.equal(hasClimbSupport(map, point(0, 1), climber), false)
})

test('only Advanced Wallclimber grips ceilings and voxel undersides without crossing them', () => {
  const pos = point(0, 4)
  for (const ceilingKind of ['ceiling', 'voxel']) {
    const map = emptyMap()
    if (ceilingKind === 'ceiling') map.ceilings.push({ id: 'roof', ...pos })
    else map.voxels.push({ ...point(0, 5), materialId: 'steel' })
    assert.equal(hasClimbSupport(map, pos, climber), false)
    assert.equal(hasClimbSupport(map, pos, advancedClimber), true)
    assert.equal(canPassThrough(point(-1, 4), pos, advancedClimber, map), true)
    assert.equal(canLandOn(pos, advancedClimber, map, new Set()), true)
    assert.equal(canPassThrough(pos, point(0, 5), advancedClimber, map), false)
    if (ceilingKind === 'ceiling') assert.equal(hasClimbSupport(map, pos, advancedClimber, new Set(['roof'])), false)
  }
})

test('valid climbers and burrowers keep their positions under gravity but unsupported ones fall', () => {
  const dims = { width: 1, height: 1, depth: 1 }
  const pos = point(0, 8)
  const profile = { cpu: 0, ram: 0, hasTumbler: false, hasAdvJumper: false, canFly: false, canClimb: true }
  const map = emptyMap()
  map.groundTiles.push({ ...point(), terrain: 'normal' })
  map.walls.push({ id: 'wall', ...pos, face: 'east' })
  assert.deepEqual(resolveFall(pos, dims, map, profile), { landingPos: pos, fallHeight: 0, damage: 0 })
  assert.deepEqual(resolveFall(pos, dims, map, { ...profile, destroyedStructures: new Set(['wall']) }), { landingPos: point(), fallHeight: 8, damage: 3 })
  map.walls = []
  map.ceilings.push({ id: 'roof', ...pos })
  assert.equal(resolveFall(pos, dims, map, { ...profile, canClimbCeilings: true }).fallHeight, 0)
  assert.equal(resolveFall(pos, dims, map, profile).fallHeight, 8)
  map.ceilings = []
  map.voxels.push({ ...pos, materialId: 'earth' })
  assert.equal(resolveFall(pos, dims, map, { ...profile, canClimb: false, canDig: true }).fallHeight, 0)
  map.voxels[0].materialId = 'glass'
  assert.equal(resolveFall(pos, dims, map, { ...profile, canClimb: false, canDig: true }).fallHeight, 8)
  assert.equal(resolveFall(pos, dims, map, { ...profile, canClimb: false, canDig: true, canDigHardSurfaces: true }).fallHeight, 0)
})
