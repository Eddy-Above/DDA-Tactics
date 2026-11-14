import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const point = (x, y = 0) => ({ x, y, z: 0 })
const map = { groundTiles: Array.from({ length: 8 }, (_, x) => ({ ...point(x), terrain: 'normal' })), spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [] }
const unit = (id, entityId, extra = {}) => ({ id, entityId, type: 'digimon', currentWounds: 0, maxWounds: 30, ...extra })
const records = new Map([['enemy', { id: 'enemy', name: 'Agumon', size: 'medium', isEnemy: true }], ['partner', { id: 'partner', name: 'Gabumon', size: 'medium' }]])
const owners = new Map([['tai', { id: 'tai', name: 'Tai Kamiya' }]])

function fixture(participants) {
  const positions = Object.fromEntries(participants.map((p, x) => [p.id, point(x, 10)]))
  const reads = [], patches = []
  const gravity = loadTypeScriptWithMocks('server/utils/endOfTurnGravity.ts', {
    './combatSpatial': {
      loadEncounterMap: async () => map, loadParticipantDigimon: async () => records,
      loadTamersByIds: async ids => { reads.push(ids); return owners },
      getFallerProfile: async () => ({ cpu: 1, ram: 0, canFly: false, hasTumbler: false, hasAdvJumper: false }),
    },
    './encounterRoom': {
      getRoomSnapshot: async () => ({ participantPositions: positions, destructibleStates: [] }),
      getDestroyedStructureIds: () => new Set(), broadcastPositionPatch: async (_id, patch) => patches.push(patch),
    },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, current) => current },
  })
  return { gravity, positions, reads, patches }
}

test('fall logs use stored Tamer and Digimon names and stable numbering for enemy duplicates', async () => {
  const participants = [unit('uuid-1', 'enemy', { seq: 1, isEnemy: true }), unit('uuid-2', 'enemy', { seq: 2, isEnemy: true }),
    unit('uuid-3', 'partner'), unit('uuid-4', 'tai', { type: 'tamer' })]
  const f = fixture(participants)
  const result = await f.gravity.applyEndOfTurnGravity('enc', 'map', participants, 3)
  assert.deepEqual(result.logEntries.map(entry => entry.actorName), ['Agumon 1', 'Agumon 2', 'Gabumon', 'Tai Kamiya'])
  assert.deepEqual(result.logEntries.map(entry => entry.actorId), participants.map(p => p.id))
  assert.ok(result.logEntries.every(entry => entry.damage > 0 && entry.round === 3))
  assert.deepEqual(f.reads, [['tai']], 'falling Tamer names use one batch')
  assert.equal(f.patches.length, 1)
})

test('the pure knockout gravity path accepts the same Tamer names and never exposes missing-record IDs', async () => {
  const participants = [unit('uuid-tamer', 'tai', { type: 'tamer' }), unit('missing-uuid', 'missing')]
  const f = fixture(participants)
  const result = await f.gravity.computeGravityDrops(f.positions, participants, map, records, 1, new Set(), owners)
  assert.deepEqual(result.logEntries.map(entry => entry.actorName), ['Tai Kamiya', 'Digimon'])
  assert.deepEqual(f.reads, [])
})

test('legacy fall IDs can display current names without rewriting correctly named history', () => {
  const { battleLogActorName } = loadTypeScript('utils/participantDisplayNames.ts')
  const legacy = { action: 'Fall', actorId: 'uuid', actorName: 'uuid' }, names = { uuid: 'Agumon 2' }
  assert.equal(battleLogActorName(legacy, names), 'Agumon 2')
  assert.equal(legacy.actorName, 'uuid')
  assert.equal(battleLogActorName({ ...legacy, actorName: 'Greymon' }, names), 'Greymon')
})
