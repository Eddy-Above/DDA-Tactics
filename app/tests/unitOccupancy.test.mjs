import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const { evaluatePlacement } = loadTypeScript('utils/placementRules.ts')
const serverMovement = loadTypeScript('server/utils/mapMovement.ts')
const sizes = ['tiny', 'small', 'medium', 'large', 'huge', 'gigantic']
const interactions = {
  tiny:     ['shared', 'shared', 'shared', 'shared', 'shared', 'shared'],
  small:    ['shared', 'passable-only', 'passable-only', 'passable-only', 'passable-only', 'passable-only'],
  medium:   ['shared', 'passable-only', 'blocked', 'blocked', 'blocked', 'blocked'],
  large:    ['shared', 'passable-only', 'blocked', 'blocked', 'blocked', 'blocked'],
  huge:     ['shared', 'passable-only', 'blocked', 'blocked', 'blocked', 'blocked'],
  gigantic: ['shared', 'passable-only', 'blocked', 'blocked', 'blocked', 'blocked'],
}
const point = (x, y = 0, z = 0) => ({ x, y, z })
const key = p => `${p.x},${p.y},${p.z}`
const walking = { canFly: false, canJump: false, jumpHeight: 0, jumpRange: 0, canClimb: false, canSwim: false, canDig: false }
const floor = (width = 16, depth = 1) => ({
  groundTiles: Array.from({ length: width * depth }, (_, n) => point(n % width, 0, Math.floor(n / width))),
  voxels: [], spaceTiles: [], walls: [], doors: [], stairs: [], ceilings: [], windows: [],
})

test('size exceptions are reciprocal: Tiny shares, Small passes only, all other pairings block', () => {
  for (const mover of sizes) {
    sizes.forEach((blocker, i) => assert.equal(rules.sizeInteraction(mover, blocker), interactions[mover][i], `${mover} / ${blocker}`))
  }
})

for (const moverSize of sizes) {
  test(`${moverSize} movement obeys occupied-square rules for every size, faction and search mode`, () => {
    sizes.forEach((blockerSize, i) => {
      for (const sameFaction of [true, false]) {
        for (const cached of [true, false]) {
          const movement = useMapMovement()
          const map = floor()
          const units = new Map([['blocker', { pos: point(5), size: blockerSize, isEnemy: !sameFaction }]])
          const args = [walking, map, new Set(), units, moverSize]
          const cells = movement.computeReachable(point(0), 12, ...args)
          const interaction = interactions[moverSize][i]
          const label = `${moverSize} / ${blockerSize}, ally=${sameFaction}, cached=${cached}`
          assert.equal(cells.has(key(point(5))), interaction === 'shared', `landing: ${label}`)
          assert.equal(cells.has(key(point(12))), interaction !== 'blocked', `passage: ${label}`)
          if (!cached) movement.invalidateSearch()
          assert.equal(movement.computePath(point(0), point(5), ...args) !== null, interaction === 'shared', `occupied destination path: ${label}`)
          assert.equal(movement.computePath(point(0), point(12), ...args) !== null, interaction !== 'blocked', `path through blocker: ${label}`)
        }
      }
    })
  })
}

test('a large mover cannot pass a unit that only overlaps the side of its footprint', () => {
  const movement = useMapMovement()
  const map = floor(8, 2)
  const units = new Map([['tamer', { pos: point(3, 0, 1), size: 'medium' }]])
  const args = [walking, map, new Set(), units, 'large']
  const cells = movement.computeReachable(point(0), 6, ...args)
  assert.ok(!cells.has(key(point(6))), 'checking only the anchor would let the body pass through the Tamer')
  assert.equal(movement.computePath(point(0), point(6), ...args), null)
})

test('Tiny sharing still respects walls and solid terrain', () => {
  const movement = useMapMovement()
  const map = floor()
  map.walls.push({ id: 'wall', ...point(4), face: 'east' })
  const units = new Map([['tamer', { pos: point(3), size: 'medium' }]])
  const cells = movement.computeReachable(point(0), 12, walking, map, new Set(), units, 'tiny')
  assert.ok(cells.has(key(point(3))))
  assert.ok(!cells.has(key(point(12))))
})

test('placement permits Tiny sharing in either direction and refuses Small or larger stacking', () => {
  const check = {
    hit: { type: 'ground', tile: { y: 0, isSpawnPoint: true }, point: { x: 3.5, z: 0.5 } },
    isDm: false, participantId: 'mover', footprint: { width: 1, depth: 1 },
    isBlocked: () => false, isSpawnCell: () => true,
  }
  for (const mover of sizes) {
    sizes.forEach((blocker, i) => {
      const result = evaluatePlacement({ ...check, size: mover, occupants: [{ id: 'other', position: point(3), size: blocker, footprint: { width: 1, depth: 1 } }] })
      assert.equal(result.valid, interactions[mover][i] === 'shared', `${mover} / ${blocker}`)
    })
  }
  assert.equal(evaluatePlacement({ ...check, size: 'tiny', isSpawnCell: () => false, occupants: [] }).valid, false)
})

test('charge and Pass landing checks allow Tiny sharing in either direction', () => {
  const props = {
    participants: [{ id: 'mover', type: 'digimon', entityId: 'mon' }, { id: 'tamer', type: 'tamer', entityId: 'tai' }],
    participantPositions: { tamer: point(3) }, digimonMap: { mon: { size: 'tiny' } },
  }
  const { footprintOccupied } = loadPageFunctions('components/MapCanvas.vue', [
    'getParticipantSize', 'getParticipantFootprintDims', 'footprintIntersectsArea', 'footprintOccupied',
  ], { props, ...rules, movingParticipantId: ref('mover') })
  assert.equal(footprintOccupied(point(3), { width: 1, height: 1, depth: 1 }, 'mover'), false)
  props.digimonMap.mon.size = 'small'
  assert.equal(footprintOccupied(point(3), { width: 1, height: 1, depth: 1 }, 'mover'), true)
  props.digimonMap.mon.size = 'tiny'
  props.participantPositions = { mover: point(3) }
  assert.equal(footprintOccupied(point(3), { width: 1, height: 1, depth: 1 }, 'tamer'), false)
})

test('server landing and passage occupancy use the same reciprocal size rules', () => {
  const participants = [{ id: 'mover', type: 'digimon', entityId: 'mon' }, { id: 'tamer', type: 'tamer', entityId: 'tai' }]
  const positions = { tamer: point(3) }
  const records = new Map([['mon', { size: 'tiny' }]])
  const occupied = (...extra) => serverMovement.buildFootprintOccupiedSet(positions, participants, records, new Set(['mover']), participants[0], ...extra)
  assert.equal(occupied().has(key(point(3))), false)
  records.get('mon').size = 'small'
  assert.equal(occupied().has(key(point(3))), true)
  assert.equal(occupied('traversal').has(key(point(3))), false)
  records.get('mon').size = 'medium'
  assert.equal(occupied('traversal').has(key(point(3))), true)
})
