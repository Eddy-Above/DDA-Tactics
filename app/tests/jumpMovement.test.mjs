import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { calculateJumpProfile, detectCapabilities, canPassThrough, canLandOn, resolveFall, PROJECTILE_CAPS } = loadTypeScript('utils/movementRules.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const jumper = [{ id: 'extra-movement', choiceId: 'jumper' }]
const advanced = { id: 'advanced-mobility', choiceId: 'adv-jumper' }
const emptyMap = () => ({ groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], stairs: [], ceilings: [] })

test('default jump height and length use half Basic Movement before Speedy', () => {
  assert.deepEqual(calculateJumpProfile([], 13, 2, 7), { jumpRange: 3, jumpHeight: 3 })
  assert.deepEqual(calculateJumpProfile([], 7, 2), { jumpRange: 3, jumpHeight: 3 })
  assert.deepEqual(calculateJumpProfile([{ id: 'unrelated', choiceId: 'jumper' }], 13, 2, 7), { jumpRange: 3, jumpHeight: 3 })
})

test('Jumper uses full Movement and Advanced Jumper adds CPU length and CPU times five height', () => {
  assert.deepEqual(calculateJumpProfile(jumper, 13, 2, 7), { jumpRange: 13, jumpHeight: 13 })
  assert.deepEqual(calculateJumpProfile([...jumper, advanced], 13, 2, 7), { jumpRange: 15, jumpHeight: 23 })
  assert.deepEqual(calculateJumpProfile([advanced], 13, 2, 7), { jumpRange: 5, jumpHeight: 13 }, 'Advanced mobility adds to the default without Extra Movement')
  assert.deepEqual(calculateJumpProfile([advanced], 13, -2, 7), { jumpRange: 3, jumpHeight: 3 }, 'negative CPU cannot turn an Advanced bonus into a penalty')
})

test('zero Basic Movement disables ordinary jumping and tamers can opt out explicitly', () => {
  for (const basic of [-3, 0, 1]) {
    const caps = detectCapabilities([], 13, 2, 2, 0, basic)
    assert.equal(caps.canJump, false)
    assert.equal(caps.jumpRange, 0)
    assert.equal(caps.jumpHeight, 0)
  }
  const ordinary = detectCapabilities([], 13, 2, 2, undefined, 7)
  assert.equal(ordinary.canJump, true)
  assert.deepEqual({ jumpHeight: ordinary.jumpHeight, jumpRange: ordinary.jumpRange }, calculateJumpProfile([], 13, 2, 7))
  const tamer = detectCapabilities([], 13, 0, 0, 0, 0)
  assert.equal(tamer.canJump, false)
  assert.equal(tamer.canSwim, false)
  assert.equal(tamer.movementSpeed, 13)
})

for (const painted of [false, true]) {
  test(`${painted ? 'painted' : 'open'} air jump landings respect height and horizontal range from the origin`, () => {
    const map = emptyMap()
    const origin = point(1, 2, 1)
    map.groundTiles.push(origin)
    const caps = detectCapabilities([], 13, 2, 2, undefined, 7)
    const destinations = [point(4, 5, 4), point(4, -5, 4), point(4, 6, 4), point(5, 2, 1)]
    if (painted) map.spaceTiles = destinations.map(pos => ({ ...pos, spaceType: 'air' }))
    assert.equal(canLandOn(destinations[0], caps, map, new Set(), origin), true, 'simultaneous maximum height and diagonal range are legal')
    assert.equal(canLandOn(destinations[1], caps, map, new Set(), origin), true, 'descending still respects horizontal range')
    assert.equal(canLandOn(destinations[2], caps, map, new Set(), origin), false, 'height is measured from the original anchor')
    assert.equal(canLandOn(destinations[3], caps, map, new Set(), origin), false)
    assert.equal(canLandOn(destinations[0], caps, map, new Set()), false, 'the optional origin retains existing strict behavior')
    assert.equal(canLandOn(destinations[0], { ...caps, canFly: true }, map, new Set(), origin), true)
    assert.equal(canLandOn(destinations[3], { ...caps, canFly: true }, map, new Set(), origin), true)
  })
}

test('ordinary jumping enters open air while walls, ceilings and solid voxels still block', () => {
  const map = emptyMap()
  const caps = detectCapabilities([], 8, 2, 2, undefined, 6)
  assert.equal(canPassThrough(point(), point(0, 1), caps, map), true)
  assert.equal(canPassThrough(point(), point(1), caps, map), true)
  assert.equal(canPassThrough(point(), point(0, 4), caps, map), false)
  assert.equal(canPassThrough(point(), point(0, 1), { ...caps, canJump: false }, map), false)
  map.ceilings.push({ id: 'ceiling', ...point() })
  assert.equal(canPassThrough(point(), point(0, 1), caps, map), false)
  map.walls.push({ id: 'wall', ...point(), face: 'east' })
  assert.equal(canPassThrough(point(), point(1), caps, map), false)
  map.voxels.push({ id: 'solid', ...point(-1), materialId: 'steel' })
  assert.equal(canPassThrough(point(), point(-1), caps, map), false)
})

for (const painted of [false, true]) {
  test(`${painted ? 'painted' : 'open'} air traversal bounds the whole jump instead of repeating local rises`, () => {
    const map = emptyMap()
    const caps = detectCapabilities([], 13, 2, 2, undefined, 7)
    const origin = point()
    map.groundTiles.push(origin)
    const transitions = [
      [point(2, 2), point(3, 3), true],
      [point(3, 3), point(3, 4), false],
      [point(3, 0), point(4, 0), false],
      [point(3, 0), point(4, -1), false],
      [point(2, 0), point(3, -1), true],
    ]
    if (painted) map.spaceTiles = transitions.map(([, to]) => ({ ...to, spaceType: 'air' }))
    for (const [from, to, expected] of transitions) {
      assert.equal(canPassThrough(from, to, caps, map, new Set(), origin), expected)
      assert.equal(canPassThrough(from, to, caps, map), true, 'omitted origin preserves legacy local traversal')
      assert.equal(canPassThrough(from, to, { ...caps, canFly: true }, map, new Set(), origin), true)
    }
  })
}

test('manual capability objects and projectile caps retain their existing limits', () => {
  const map = emptyMap()
  map.groundTiles.push(point())
  const manual = { canFly: false, canJump: true, jumpHeight: 2, jumpRange: 4, canClimb: false, canSwim: false, canDig: false }
  assert.equal(canLandOn(point(4, 2, 4), manual, map, new Set(), point()), true)
  assert.equal(canLandOn(point(5, 2), manual, map, new Set(), point()), false)
  assert.equal(canLandOn(point(4, 3), manual, map, new Set(), point()), false)
  assert.equal(canLandOn(point(100, 100), PROJECTILE_CAPS, map, new Set(), point()), true, 'projectile flight retains its own landing behavior')
})

test('ordinary jumps land safely only within their jump height while higher falls still deal damage', () => {
  const map = emptyMap()
  map.groundTiles.push({ ...point(), terrain: 'normal' })
  const dims = { width: 1, height: 1, depth: 1 }
  const profile = { cpu: 0, ram: 0, hasTumbler: false, hasAdvJumper: false, canFly: false, safeJumpHeight: 6 }
  assert.deepEqual(resolveFall(point(0, 6), dims, map, profile), { landingPos: point(), fallHeight: 6, damage: 0 })
  assert.deepEqual(resolveFall(point(0, 8), dims, map, profile), { landingPos: point(), fallHeight: 8, damage: 3 })
  assert.equal(resolveFall(point(0, 6), dims, map, { ...profile, safeJumpHeight: undefined }).damage, 1)
  assert.equal(resolveFall(point(0, 6), dims, map, { ...profile, safeJumpHeight: -6 }).damage, 1)
  assert.equal(resolveFall(point(0, 8), dims, map, { ...profile, airborneByJump: true }).damage, 0, 'explicit legacy jump flags keep their existing exemption')
})
