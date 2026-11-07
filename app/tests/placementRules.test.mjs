import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const {
  isSetupPhase,
  getPlaceableParticipantIds,
  getDraggableParticipantIds,
  dropRoute,
  surfaceAllowsPlacement,
  placementCellFromHit,
  footprintsOverlapXZ,
  evaluatePlacement,
  createDragTracker,
} = loadTypeScript('utils/placementRules.ts')

const roster = [
  { id: 'my-tamer' },
  { id: 'my-digimon' },
  { id: 'other-tamer' },
  { id: 'enemy' },
  { id: 'reserve-mine', inReserve: true },
  { id: 'reserve-enemy', inReserve: true },
]
const mine = ['my-tamer', 'my-digimon', 'reserve-mine']
const positions = { 'my-tamer': { x: 1, y: 0, z: 1 }, 'other-tamer': { x: 2, y: 0, z: 2 } }

const ctx = (over) => ({ participants: roster, positions, isDm: false, phase: 'setup', myParticipantIds: mine, ...over })

test('setup and initiative are the placement phases', () => {
  assert.equal(isSetupPhase('setup'), true)
  assert.equal(isSetupPhase('initiative'), true)
  assert.equal(isSetupPhase('combat'), false)
  assert.equal(isSetupPhase('ended'), false)
  assert.equal(isSetupPhase(undefined), false)
})

test('HUD placement list: a player sees only their own deployed characters, placed or not, during setup', () => {
  assert.deepEqual(getPlaceableParticipantIds(ctx()), ['my-tamer', 'my-digimon'])
  assert.deepEqual(getPlaceableParticipantIds(ctx({ phase: 'initiative' })), ['my-tamer', 'my-digimon'])
})

test('HUD placement list: the GM sees every deployed character in setup, never reserves', () => {
  assert.deepEqual(
    getPlaceableParticipantIds(ctx({ isDm: true })),
    ['my-tamer', 'my-digimon', 'other-tamer', 'enemy'],
  )
})

test('HUD placement list: once combat starts only unplaced characters are offered', () => {
  assert.deepEqual(getPlaceableParticipantIds(ctx({ phase: 'combat' })), ['my-digimon'])
  assert.deepEqual(getPlaceableParticipantIds(ctx({ phase: 'combat', isDm: true })), ['my-digimon', 'enemy'])
})

test('HUD placement list tolerates a missing own-id list', () => {
  assert.deepEqual(getPlaceableParticipantIds(ctx({ myParticipantIds: undefined })), [])
})

test('token dragging: a player may drag only their own placed characters, and only during setup', () => {
  assert.deepEqual(getDraggableParticipantIds(ctx()), ['my-tamer'])
  assert.deepEqual(getDraggableParticipantIds(ctx({ phase: 'initiative' })), ['my-tamer'])
  assert.deepEqual(getDraggableParticipantIds(ctx({ phase: 'combat' })), [])
  assert.deepEqual(getDraggableParticipantIds(ctx({ phase: 'ended' })), [])
})

test('token dragging: the GM may drag any placed deployed character in any live phase', () => {
  for (const phase of ['setup', 'initiative', 'combat']) {
    assert.deepEqual(getDraggableParticipantIds(ctx({ isDm: true, phase })), ['my-tamer', 'other-tamer'])
  }
  assert.deepEqual(getDraggableParticipantIds(ctx({ isDm: true, phase: 'ended' })), [])
  assert.deepEqual(getDraggableParticipantIds(ctx({ isDm: true, phase: undefined })), [])
})

test('token dragging never offers a reserve unit, even one with a stale position', () => {
  const stale = { ...positions, 'reserve-mine': { x: 0, y: 0, z: 0 } }
  assert.ok(!getDraggableParticipantIds(ctx({ positions: stale })).includes('reserve-mine'))
  assert.ok(!getDraggableParticipantIds(ctx({ positions: stale, isDm: true })).includes('reserve-mine'))
})

test('drop routing: unplaced units and setup moves place; a placed unit in combat is a GM move', () => {
  assert.equal(dropRoute('setup', true), 'place')
  assert.equal(dropRoute('initiative', true), 'place')
  assert.equal(dropRoute('setup', false), 'place')
  assert.equal(dropRoute('combat', false), 'place')
  assert.equal(dropRoute('combat', true), 'gm-move')
})

const tile = (isSpawnPoint, y = 0) => ({ type: 'ground', tile: { y, isSpawnPoint }, point: { x: 3.7, z: 4.2 } })
const space = (isSpawnPoint, y = 2) => ({ type: 'space', tile: { y, isSpawnPoint }, point: { x: 0.1, z: 9.9 } })
const voxel = (isSpawnPoint) => ({ type: 'voxel', voxel: { x: 5, y: 2, z: 6, isSpawnPoint }, point: { x: 5.5, z: 6.5 } })

test('boundary: a player can only drop on spawn tiles, spawn voxels and spawn-tile airspace', () => {
  assert.equal(surfaceAllowsPlacement(false, tile(true)), true)
  assert.equal(surfaceAllowsPlacement(false, tile(false)), false)
  assert.equal(surfaceAllowsPlacement(false, tile(undefined)), false)
  assert.equal(surfaceAllowsPlacement(false, space(true)), true)
  assert.equal(surfaceAllowsPlacement(false, space(false)), false)
  assert.equal(surfaceAllowsPlacement(false, voxel(true)), true)
  assert.equal(surfaceAllowsPlacement(false, voxel(false)), false)
  assert.equal(surfaceAllowsPlacement(false, { type: 'voxel', point: { x: 0, z: 0 } }), false)
})

test('boundary: the GM can drop anywhere, spawn point or not', () => {
  for (const hit of [tile(true), tile(false), space(false), voxel(true), voxel(false), { type: 'voxel', point: { x: 0, z: 0 } }]) {
    assert.equal(surfaceAllowsPlacement(true, hit), true)
  }
})

test('placement cell: tiles use the hit point, voxels stand the unit on top', () => {
  assert.deepEqual(placementCellFromHit(tile(true, 1)), { x: 3, y: 1, z: 4 })
  assert.deepEqual(placementCellFromHit(space(true, 3)), { x: 0, y: 3, z: 9 })
  assert.deepEqual(placementCellFromHit(voxel(true)), { x: 5, y: 3, z: 6 })
  assert.deepEqual(placementCellFromHit({ type: 'ground', point: { x: 2.9, z: 0.2 } }), { x: 2, y: 0, z: 0 })
})

test('footprint overlap is square-on-square on the XZ plane', () => {
  const at = (x, z) => ({ x, y: 0, z })
  assert.equal(footprintsOverlapXZ(at(0, 0), 1, at(0, 0), 1), true)
  assert.equal(footprintsOverlapXZ(at(0, 0), 1, at(1, 0), 1), false)
  assert.equal(footprintsOverlapXZ(at(0, 0), 2, at(1, 1), 1), true)
  assert.equal(footprintsOverlapXZ(at(0, 0), 2, at(2, 0), 1), false)
  assert.equal(footprintsOverlapXZ(at(3, 3), 1, at(1, 1), 3), true)
  assert.equal(footprintsOverlapXZ(at(4, 4), 1, at(1, 1), 3), false)
})

// The tile hit at (3.5, 4.5) resolves to cell {3, 0, 4}.
function check(over = {}) {
  return {
    hit: tile(true),
    isDm: false,
    participantId: 'me',
    tileCount: 1,
    isBlocked: () => false,
    occupants: [],
    ...over,
  }
}
const at = (x, y, z) => ({ x, y, z })

test('evaluate: a player may land on a free spawn tile', () => {
  assert.deepEqual(evaluatePlacement(check()), { cell: at(3, 0, 4), tileCount: 1, valid: true })
})

test('evaluate: a refused cell is still reported, so a drag can show where it would have gone', () => {
  const result = evaluatePlacement(check({ hit: tile(false) }))
  assert.equal(result.valid, false)
  assert.deepEqual(result.cell, at(3, 0, 4))
})

test('evaluate: the GM is not held to spawn areas', () => {
  assert.equal(evaluatePlacement(check({ hit: tile(false), isDm: true })).valid, true)
  assert.equal(evaluatePlacement(check({ hit: voxel(false), isDm: true })).valid, true)
  assert.equal(evaluatePlacement(check({ hit: tile(false), isDm: false })).valid, false)
})

test('evaluate: a unit stands on top of the voxel it is dropped on', () => {
  const asked = []
  const result = evaluatePlacement(check({ hit: voxel(true), isBlocked: (c) => { asked.push(c); return false } }))
  assert.deepEqual(result.cell, at(5, 3, 6))
  assert.deepEqual(asked, [at(5, 3, 6)])
})

test('evaluate: a solid voxel under any cell of a big footprint blocks everyone, GM included', () => {
  const blockedSecondCell = (c) => c.x === 4 && c.z === 5
  for (const isDm of [false, true]) {
    const result = evaluatePlacement(check({ isDm, tileCount: 2, isBlocked: blockedSecondCell }))
    assert.equal(result.valid, false, `isDm=${isDm}`)
  }
  assert.equal(evaluatePlacement(check({ tileCount: 1, isBlocked: blockedSecondCell })).valid, true)
})

test('evaluate: every cell of the footprint is checked', () => {
  const asked = []
  evaluatePlacement(check({ tileCount: 2, isBlocked: (c) => { asked.push(`${c.x},${c.y},${c.z}`); return false } }))
  assert.deepEqual(asked.sort(), ['3,0,4', '3,0,5', '4,0,4', '4,0,5'])
})

test('evaluate: another unit on the same floor blocks everyone, GM included', () => {
  const occupants = [{ id: 'other', position: at(3, 0, 4), tileCount: 1 }]
  assert.equal(evaluatePlacement(check({ occupants })).valid, false)
  assert.equal(evaluatePlacement(check({ occupants, isDm: true })).valid, false)
})

test('evaluate: units on another floor, off the map, or the unit itself do not block', () => {
  assert.equal(evaluatePlacement(check({ occupants: [{ id: 'up', position: at(3, 1, 4), tileCount: 1 }] })).valid, true)
  assert.equal(evaluatePlacement(check({ occupants: [{ id: 'away', position: undefined, tileCount: 1 }] })).valid, true)
  assert.equal(evaluatePlacement(check({ occupants: [{ id: 'me', position: at(3, 0, 4), tileCount: 1 }] })).valid, true,
    'a unit can be nudged onto cells it already holds')
})

test('evaluate: footprints of different sizes collide on overlap and not on adjacency', () => {
  const big = [{ id: 'big', position: at(1, 0, 2), tileCount: 3 }]       // covers x 1-3, z 2-4
  assert.equal(evaluatePlacement(check({ occupants: big })).valid, false)
  const neighbour = [{ id: 'n', position: at(4, 0, 4), tileCount: 1 }]
  assert.equal(evaluatePlacement(check({ occupants: neighbour })).valid, true)
  assert.equal(evaluatePlacement(check({ occupants: neighbour, tileCount: 2 })).valid, false,
    'a 2x2 unit at 3,4 reaches x=4')
})

test('drag tracker: moving less than the threshold is a click, not a drag', () => {
  const t = createDragTracker(4)
  t.press(100, 100, 'agumon')
  assert.equal(t.isPressed(), true)
  assert.equal(t.move(102, 101), false)
  assert.equal(t.isDragging(), false)
  assert.deepEqual(t.release(), { subject: 'agumon', dragged: false })
  assert.equal(t.isPressed(), false)
})

test('drag tracker: crossing the threshold starts a drag and it stays a drag when the pointer returns', () => {
  const t = createDragTracker(4)
  t.press(0, 0, 'gabumon')
  assert.equal(t.move(3, 0), false)
  assert.equal(t.move(3, 3), true)       // hypot(3,3) ≈ 4.24
  assert.equal(t.move(0, 0), true)       // back at the start: still dragging
  assert.equal(t.isDragging(), true)
  assert.equal(t.subject(), 'gabumon')
  assert.deepEqual(t.release(), { subject: 'gabumon', dragged: true })
})

test('drag tracker: cancel and release without a press are inert and reusable', () => {
  const t = createDragTracker()
  assert.equal(t.release(), null)
  assert.equal(t.move(50, 50), false)
  t.press(0, 0, 'a')
  t.move(20, 0)
  t.cancel()
  assert.equal(t.isPressed(), false)
  assert.equal(t.isDragging(), false)
  assert.equal(t.release(), null)
  t.press(0, 0, 'b')
  assert.equal(t.isDragging(), false, 'a new press starts from a clean state')
  assert.deepEqual(t.release(), { subject: 'b', dragged: false })
})
