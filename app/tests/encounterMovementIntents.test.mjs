import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
const { detectCapabilities } = loadTypeScript('utils/movementRules.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const mapOf = fields => ({ groundTiles: Array.from({ length: 12 }, (_, x) => point(x)), voxels: [], walls: [], doors: [], stairs: [], ceilings: [], spaceTiles: [], ...fields })
function fixture({ map = mapOf({}), qualities = [], origin = point(0), actor = {}, other = [], positions = {} } = {}) {
  let writes = 0, burned = 0
  const calls = { maps: 0, tamers: 0, profiles: 0, naturewalk: [] }
  const records = new Map([['mon', { id: 'mon', size: 'medium', qualities }]])
  const participant = { id: 'actor', entityId: 'mon', type: 'digimon', currentWounds: 0, maxWounds: 20, actionsRemaining: { simple: 2 }, ...actor }
  const encounter = { id: 'enc', campaignId: 'campaign', mapId: 'map', revision: 2, phase: 'combat', round: 1, currentTurnIndex: 0, turnOrder: ['actor'], hazards: [], participants: [participant, ...other], battleLog: [] }
  const caps = detectCapabilities(qualities, 7, 0, 0)
  const module = loadTypeScriptWithMocks('server/utils/encounterMovement.ts', {
    '../db': { db: {}, maps: { id: 'map-id' } },
    './databaseScope': { scopedDatabase: () => undefined },
    './encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: { actor: origin, ...positions }, destructibleStates: [] }) },
    './combatSpatial': { loadEncounterMap: async () => { calls.maps++; return map }, loadParticipantDigimon: async () => records,
      loadTamersByIds: async () => { calls.tamers++; return new Map() }, getMovementProfile: () => { calls.profiles++; return { caps, budget: 7 } } },
    './naturewalk': { applyNaturewalkEnvironment: async (_encounter, participants, _positions, options) => { calls.naturewalk.push(options); return { participants, changed: false } } },
    './resolveSupportAttack': { getDigimonDerivedStats: async () => ({ ram: 0 }) },
    './damageOverTime': { loadCampaignDamageOverTimeRules: async () => undefined, applyMovementBurn: (participants, moves) => { burned = moves[0].meters; return { participants, logEntries: [] } } },
  })
  const intent = values => ({ participantId: 'actor', kind: 'normal', destination: point(2), operationId: 'move-1', expectedRevision: 2, ...values })
  return { ...module, encounter, map, caps, intent, calls, burned: () => burned, writes: () => writes }
}

test('a movement intent validates the real path, prepares action/Burn changes and commits nothing', async () => {
  const f = fixture()
  const result = await f.prepareEncounterMovement(f.encounter, f.intent({ path: [point(0), point(1), point(2)] }), { isDm: false })
  assert.equal(result.participants[0].actionsRemaining.simple, 1)
  assert.equal(result.distance, 2)
  assert.equal(f.burned(), 2)
  assert.deepEqual(result.participantPositions.actor, point(2))
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 2)
  assert.equal(f.writes(), 0)
})

for (const [label, values, status] of [
  ['fractional coordinate', { destination: point(1.5) }, 400],
  ['non-finite coordinate', { destination: point(Infinity) }, 400],
  ['unreachable destination', { destination: point(1000) }, 400],
  ['stale revision', { expectedRevision: 1 }, 409],
  ['stale origin', { origin: point(3) }, 409],
  ['teleporting path', { path: [point(0), point(2)] }, 400],
  ['path with wrong origin', { path: [point(1), point(2)] }, 400],
  ['unknown mode', { kind: 'free' }, 400],
  ['player GM movement', { kind: 'gm' }, 403],
  ['invented Charge movement', { kind: 'charge-before' }, 403],
  ['invented Pass movement', { kind: 'pass' }, 403],
  ['invented Charge-after allowance', { kind: 'charge-after', allowanceId: 'fake' }, 409],
]) test(`movement rejects ${label} before preparing side effects`, async () => {
  const f = fixture()
  await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent(values), { isDm: false }), error => error.statusCode === status)
  assert.equal(f.burned(), 0)
})

test('ordinary moves require a Simple Action and reserves cannot move', async () => {
  for (const actor of [{ actionsRemaining: { simple: 0 } }, { inReserve: true }]) {
    const f = fixture({ actor })
    await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent(), { isDm: false }), { statusCode: 400 })
  }
})

test('Charge-after consumes only its stored allowance and remains subject to movement laws', async () => {
  const pendingChargeMove = { castId: 'cast', turnKey: '1:0', entityId: 'mon', mapId: 'map' }
  const { combatTurnKey } = loadTypeScript('utils/specialOrderCombat.ts')
  pendingChargeMove.turnKey = combatTurnKey(1, 0)
  const f = fixture({ actor: { pendingChargeMove, actionsRemaining: { simple: 0 } } })
  const result = await f.prepareEncounterMovement(f.encounter, f.intent({ kind: 'charge-after', allowanceId: 'cast' }), { isDm: false })
  assert.equal(result.participants[0].pendingChargeMove, undefined)
  assert.equal(result.participants[0].actionsRemaining.simple, 0)
  await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent({ kind: 'charge-after', allowanceId: 'cast', destination: point(1000) }), { isDm: false }), { statusCode: 400 })
})

test('moving through closed doors prepares only those crossed doors to open', async () => {
  const map = mapOf({ walls: [{ id: 'wall', ...point(0), face: 'east' }], doors: [{ id: 'door', wallId: 'wall', isOpen: false }] })
  const f = fixture({ map })
  const result = await f.prepareEncounterMovement(f.encounter, f.intent({ destination: point(1), path: [point(0), point(1)] }), { isDm: false })
  assert.deepEqual(result.openedDoorIds, ['door'])
  assert.equal(map.doors[0].isOpen, false)
  assert.equal(result.doors[0].isOpen, true)
})

test('players can place only on spawn cells, while GM placement respects solid occupancy', async () => {
  const map = mapOf({ groundTiles: [{ ...point(0), isSpawnPoint: true }, point(1)], voxels: [{ ...point(2), materialId: 'earth' }] })
  const f = fixture({ map, origin: undefined })
  delete f.encounter.participantPositions
  f.encounter.phase = 'setup'
  await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent({ kind: 'placement', destination: point(1) }), { isDm: false }), { statusCode: 403 })
  await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent({ kind: 'gm', destination: point(2) }), { isDm: true }), { statusCode: 400 })
  const valid = await f.prepareEncounterMovement(f.encounter, f.intent({ kind: 'placement', destination: point(0) }), { isDm: false })
  assert.equal(valid.participants[0].actionsRemaining.simple, 2)
})

for (const kind of ['placement', 'gm']) test(`${kind} avoids walking-profile/Tamer reads and reuses the validated map for both Naturewalk checks`, async () => {
  const f = fixture()
  if (kind === 'placement') f.encounter.phase = 'setup'
  await f.prepareEncounterMovement(f.encounter, f.intent({ kind }), { isDm: true })
  assert.equal(f.calls.maps, 1)
  assert.equal(f.calls.tamers, 0)
  assert.equal(f.calls.profiles, 0)
  assert.equal(f.calls.naturewalk.length, 2)
  assert.ok(f.calls.naturewalk.every(options => options.map === f.map))
  assert.equal(f.burned(), 0)
})

test('a dry starting cell cannot grant a jump after the path enters water', async () => {
  const map = mapOf({ groundTiles: [point(0), { ...point(1), terrain: 'water' }] })
  const f = fixture({ map, qualities: [{ id: 'extra-movement', choiceId: 'jumper' }] })
  await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent({ destination: point(1, 1), path: [point(0), point(1), point(1, 1)] }), { isDm: false }), { statusCode: 400 })
})

test('trusted Pass retains actual movement permissions instead of granting flight or digging through Steel', async () => {
  const airborne = fixture({ map: mapOf({ groundTiles: [] }), origin: point(0, 3) })
  await assert.rejects(airborne.prepareEncounterMovement(airborne.encounter, airborne.intent({ kind: 'pass', destination: point(1, 4), path: [point(0, 3), point(1, 4)] }), { isDm: false, attack: { id: 'pass' }, noActionCost: true }), { statusCode: 400 })
  const steel = fixture({ map: mapOf({ voxels: [{ ...point(1), materialId: 'steel' }] }) })
  await assert.rejects(steel.prepareEncounterMovement(steel.encounter, steel.intent({ kind: 'pass', destination: point(1), path: [point(0), point(1)] }), { isDm: false, attack: { id: 'pass' }, noActionCost: true }), { statusCode: 400 })
})

test('clash controllers retain paid contact movement and trusted Pass preparation, while breaking contact is rejected', async () => {
  const clash = { isController: true, opponentParticipantId: 'opponent' }
  const other = [{ id: 'opponent', type: 'tamer', entityId: 'tamer' }]
  const f = fixture({ actor: { clash }, other, positions: { opponent: point(2) } })
  const normal = await f.prepareEncounterMovement(f.encounter, f.intent({ destination: point(1), path: [point(0), point(1)] }), { isDm: false })
  assert.equal(normal.participants[0].actionsRemaining.simple, 1)
  await assert.rejects(f.prepareEncounterMovement(f.encounter, f.intent({ destination: point(-1), path: [point(0), point(-1)] }), { isDm: false }), { statusCode: 403 })
  const pass = await f.prepareEncounterMovement(f.encounter, f.intent({ kind: 'pass', destination: point(1), path: [point(0), point(1)] }), { isDm: false, attack: { id: 'pass' }, noActionCost: true })
  assert.equal(pass.participants[0].actionsRemaining.simple, 2)
})
