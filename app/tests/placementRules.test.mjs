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
  makeSpawnCellChecker,
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

const sq = (n) => ({ width: n, depth: n })   // an n × n footprint

test('footprint overlap is rectangle-on-rectangle on the XZ plane', () => {
  const at = (x, z) => ({ x, y: 0, z })
  assert.equal(footprintsOverlapXZ(at(0, 0), sq(1), at(0, 0), sq(1)), true)
  assert.equal(footprintsOverlapXZ(at(0, 0), sq(1), at(1, 0), sq(1)), false)
  assert.equal(footprintsOverlapXZ(at(0, 0), sq(2), at(1, 1), sq(1)), true)
  assert.equal(footprintsOverlapXZ(at(0, 0), sq(2), at(2, 0), sq(1)), false)
  assert.equal(footprintsOverlapXZ(at(3, 3), sq(1), at(1, 1), sq(3)), true)
  assert.equal(footprintsOverlapXZ(at(4, 4), sq(1), at(1, 1), sq(3)), false)
})

test('footprint overlap honours unequal width and depth', () => {
  const at = (x, z) => ({ x, y: 0, z })
  const wide = { width: 4, depth: 1 }          // x 0-3, z 0
  assert.equal(footprintsOverlapXZ(at(0, 0), wide, at(3, 0), sq(1)), true)
  assert.equal(footprintsOverlapXZ(at(0, 0), wide, at(4, 0), sq(1)), false)
  assert.equal(footprintsOverlapXZ(at(0, 0), wide, at(0, 1), sq(1)), false, 'depth is only one cell')
  const deep = { width: 1, depth: 4 }          // x 0, z 0-3
  assert.equal(footprintsOverlapXZ(at(0, 0), deep, at(0, 3), sq(1)), true)
  assert.equal(footprintsOverlapXZ(at(0, 0), deep, at(1, 3), sq(1)), false, 'width is only one cell')
})

// The tile hit at (3.5, 4.5) resolves to cell {3, 0, 4}.
function check(over = {}) {
  return {
    hit: tile(true),
    isDm: false,
    participantId: 'me',
    footprint: sq(1),
    isBlocked: () => false,
    isSpawnCell: () => true,
    occupants: [],
    ...over,
  }
}
const at = (x, y, z) => ({ x, y, z })

test('evaluate: a player may land on a free spawn tile', () => {
  assert.deepEqual(evaluatePlacement(check()), { cell: at(3, 0, 4), footprint: sq(1), valid: true })
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
    const result = evaluatePlacement(check({ isDm, footprint: sq(2), isBlocked: blockedSecondCell }))
    assert.equal(result.valid, false, `isDm=${isDm}`)
  }
  assert.equal(evaluatePlacement(check({ footprint: sq(1), isBlocked: blockedSecondCell })).valid, true)
})

test('evaluate: every cell of the footprint is checked', () => {
  const asked = []
  evaluatePlacement(check({ footprint: sq(2), isBlocked: (c) => { asked.push(`${c.x},${c.y},${c.z}`); return false } }))
  assert.deepEqual(asked.sort(), ['3,0,4', '3,0,5', '4,0,4', '4,0,5'])
})

test('evaluate: another unit on the same floor blocks everyone, GM included', () => {
  const occupants = [{ id: 'other', position: at(3, 0, 4), footprint: sq(1) }]
  assert.equal(evaluatePlacement(check({ occupants })).valid, false)
  assert.equal(evaluatePlacement(check({ occupants, isDm: true })).valid, false)
})

test('evaluate: units on another floor, off the map, or the unit itself do not block', () => {
  assert.equal(evaluatePlacement(check({ occupants: [{ id: 'up', position: at(3, 1, 4), footprint: sq(1) }] })).valid, true)
  assert.equal(evaluatePlacement(check({ occupants: [{ id: 'away', position: undefined, footprint: sq(1) }] })).valid, true)
  assert.equal(evaluatePlacement(check({ occupants: [{ id: 'me', position: at(3, 0, 4), footprint: sq(1) }] })).valid, true,
    'a unit can be nudged onto cells it already holds')
})

test('evaluate: footprints of different sizes collide on overlap and not on adjacency', () => {
  const big = [{ id: 'big', position: at(1, 0, 2), footprint: sq(3) }]       // covers x 1-3, z 2-4
  assert.equal(evaluatePlacement(check({ occupants: big })).valid, false)
  const neighbour = [{ id: 'n', position: at(4, 0, 4), footprint: sq(1) }]
  assert.equal(evaluatePlacement(check({ occupants: neighbour })).valid, true)
  assert.equal(evaluatePlacement(check({ occupants: neighbour, footprint: sq(2) })).valid, false,
    'a 2x2 unit at 3,4 reaches x=4')
})

// ── Regression: a big unit must not hang over a non-spawn cell for a player ──────────────────────
// Only the anchor cell used to be checked against the spawn flags, so a 2x2 (or bigger) unit
// anchored on a green square could overhang cells outside the placeable area.
const spawnAt = (...cells) => (c) => cells.some(([x, y, z]) => c.x === x && c.y === y && c.z === z)
const around = (x, y, z, w, d) => {
  const cells = []
  for (let dx = 0; dx < w; dx++) for (let dz = 0; dz < d; dz++) cells.push([x + dx, y, z + dz])
  return cells
}

test('spawn: a player\'s large unit is refused when any footprint cell is not a spawn cell', () => {
  // Anchor (3,0,4) is a spawn cell, but the 2x2 also covers (4,0,4), (3,0,5) and (4,0,5).
  const onlyAnchor = spawnAt([3, 0, 4])
  const result = evaluatePlacement(check({ footprint: sq(2), isSpawnCell: onlyAnchor }))
  assert.equal(result.valid, false)
  assert.deepEqual(result.cell, at(3, 0, 4), 'the refused drop still reports where it would have gone')
  assert.deepEqual(result.footprint, sq(2), 'and how big it is, so the preview can draw the real shape')
})

test('spawn: each single missing cell of a 2x2 refuses it, and a fully covered 2x2 is accepted', () => {
  const full = around(3, 0, 4, 2, 2)
  assert.equal(evaluatePlacement(check({ footprint: sq(2), isSpawnCell: spawnAt(...full) })).valid, true)
  for (let missing = 0; missing < full.length; missing++) {
    const cells = full.filter((_, i) => i !== missing)
    assert.equal(evaluatePlacement(check({ footprint: sq(2), isSpawnCell: spawnAt(...cells) })).valid, false,
      `missing cell ${full[missing]}`)
  }
})

test('spawn: huge and gigantic footprints are held to the area too', () => {
  assert.equal(evaluatePlacement(check({ footprint: sq(3), isSpawnCell: spawnAt(...around(3, 0, 4, 3, 3)) })).valid, true)
  assert.equal(evaluatePlacement(check({ footprint: sq(3), isSpawnCell: spawnAt(...around(3, 0, 4, 3, 2)) })).valid, false)
  assert.equal(evaluatePlacement(check({ footprint: sq(4), isSpawnCell: spawnAt(...around(3, 0, 4, 4, 4)) })).valid, true)
  assert.equal(evaluatePlacement(check({ footprint: sq(4), isSpawnCell: spawnAt(...around(3, 0, 4, 3, 4)) })).valid, false)
})

test('spawn: a non-square footprint is checked along both of its axes', () => {
  const longWay = { width: 1, depth: 3 }       // z 4-6
  assert.equal(evaluatePlacement(check({ footprint: longWay, isSpawnCell: spawnAt(...around(3, 0, 4, 1, 3)) })).valid, true)
  assert.equal(evaluatePlacement(check({ footprint: longWay, isSpawnCell: spawnAt(...around(3, 0, 4, 1, 2)) })).valid, false,
    'the third cell along depth is outside the area')
  const wide = { width: 3, depth: 1 }          // x 3-5
  assert.equal(evaluatePlacement(check({ footprint: wide, isSpawnCell: spawnAt(...around(3, 0, 4, 3, 1)) })).valid, true)
  assert.equal(evaluatePlacement(check({ footprint: wide, isSpawnCell: spawnAt(...around(3, 0, 4, 2, 1)) })).valid, false)
})

test('spawn: every footprint cell is asked about for a player, and never for the GM', () => {
  const asked = []
  const spy = (c) => { asked.push(`${c.x},${c.y},${c.z}`); return true }
  evaluatePlacement(check({ footprint: sq(2), isSpawnCell: spy }))
  assert.deepEqual(asked.sort(), ['3,0,4', '3,0,5', '4,0,4', '4,0,5'])
  asked.length = 0
  const gm = evaluatePlacement(check({ isDm: true, footprint: sq(2), isSpawnCell: spy }))
  assert.deepEqual(asked, [], 'the GM is not held to spawn areas')
  assert.equal(gm.valid, true)
})

test('spawn: the GM may place a large unit anywhere, but walls and units still block it', () => {
  const nothingIsSpawn = () => false
  assert.equal(evaluatePlacement(check({ isDm: true, footprint: sq(3), isSpawnCell: nothingIsSpawn })).valid, true)
  assert.equal(evaluatePlacement(check({ isDm: true, footprint: sq(3), isSpawnCell: nothingIsSpawn, isBlocked: (c) => c.x === 5 && c.z === 6 })).valid, false)
  assert.equal(evaluatePlacement(check({
    isDm: true, footprint: sq(3), isSpawnCell: nothingIsSpawn,
    occupants: [{ id: 'other', position: at(5, 0, 6), footprint: sq(1) }],
  })).valid, false)
})

test('spawn: an unequal-footprint unit collides with a neighbour along its true depth', () => {
  const deep = { width: 1, depth: 4 }          // z 4-7 from the anchor
  const neighbour = [{ id: 'n', position: at(3, 0, 7), footprint: sq(1) }]
  assert.equal(evaluatePlacement(check({ footprint: deep, occupants: neighbour })).valid, false)
  assert.equal(evaluatePlacement(check({ footprint: { width: 1, depth: 3 }, occupants: neighbour })).valid, true)
})

test('spawn cells: a flagged ground tile is a spawn cell at its own height', () => {
  const isSpawn = makeSpawnCellChecker(
    [{ x: 1, y: 0, z: 1, isSpawnPoint: true }, { x: 2, y: 0, z: 1 }, { x: 3, y: 2, z: 1, isSpawnPoint: false }],
    [],
  )
  assert.equal(isSpawn(at(1, 0, 1)), true)
  assert.equal(isSpawn(at(2, 0, 1)), false, 'an unflagged tile is not')
  assert.equal(isSpawn(at(3, 2, 1)), false, 'neither is one flagged false')
  assert.equal(isSpawn(at(1, 1, 1)), false, 'the cell above a flagged tile is a different floor')
})

test('spawn cells: a flagged voxel makes the cell on top of it a spawn cell, not the voxel\'s own cell', () => {
  const isSpawn = makeSpawnCellChecker([], [{ x: 5, y: 2, z: 6, isSpawnPoint: true }, { x: 6, y: 2, z: 6 }])
  assert.equal(isSpawn(at(5, 3, 6)), true)
  assert.equal(isSpawn(at(5, 2, 6)), false)
  assert.equal(isSpawn(at(6, 3, 6)), false, 'an unflagged voxel gives nothing')
  assert.equal(isSpawn(at(5, 4, 6)), false, 'only the cell directly on top counts')
})

test('spawn cells: a large unit may straddle a spawn tile and a spawn voxel when both put it on the same level', () => {
  // Tile at (3,1,4) and a voxel at (4,0,4) both give standing level y=1.
  const isSpawn = makeSpawnCellChecker([{ x: 3, y: 1, z: 4, isSpawnPoint: true }], [{ x: 4, y: 0, z: 4, isSpawnPoint: true }])
  const hit = { type: 'ground', tile: { y: 1, isSpawnPoint: true }, point: { x: 3.5, z: 4.5 } }
  assert.equal(evaluatePlacement(check({ hit, footprint: { width: 2, depth: 1 }, isSpawnCell: isSpawn })).valid, true)
  assert.equal(evaluatePlacement(check({ hit, footprint: { width: 3, depth: 1 }, isSpawnCell: isSpawn })).valid, false)
})

test('spawn cells: an empty map has no spawn cells', () => {
  const isSpawn = makeSpawnCellChecker([], [])
  assert.equal(isSpawn(at(0, 0, 0)), false)
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
