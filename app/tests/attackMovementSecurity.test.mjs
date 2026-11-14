import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const originalError = globalThis.createError
afterEach(() => { if (originalError === undefined) delete globalThis.createError; else globalThis.createError = originalError })
const point = (x = 0, y = 0) => ({ x, y, z: 0 })
const { detectCapabilities } = loadTypeScript('utils/movementRules.ts')
function fixture({ realMovement = false } = {}) {
  globalThis.createError = options => Object.assign(new Error(options.message), options)
  const actor = { id: 'actor', entityId: 'mon', type: 'digimon', actionsRemaining: { simple: 2 }, currentWounds: 0, maxWounds: 10 }
  const encounter = { id: 'enc', mapId: 'map', phase: 'combat', turnOrder: ['actor'], round: 1, revision: 7, currentTurnIndex: 0, participants: [actor, { id: 'target', entityId: 'target-mon', type: 'digimon' }] }
  const positions = { actor: point(), target: point(1) }, writes = [], prepared = []
  const map = { groundTiles: Array.from({ length: 10 }, (_, x) => point(x)), walls: [], doors: [], ceilings: [], stairs: [], spaceTiles: [], voxels: [] }
  const records = new Map([['mon', { id: 'mon', size: 'medium', qualities: [] }], ['target-mon', { id: 'target-mon', size: 'medium' }]])
  const caps = detectCapabilities([], 4, 1, 1)
  const movement = realMovement ? loadTypeScriptWithMocks('server/utils/encounterMovement.ts', {
    '../db': { db: {}, maps: { id: 'id' } },
    './databaseScope': { scopedDatabase: () => undefined },
    './encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: positions, destructibleStates: [] }) },
    './combatSpatial': { loadParticipantDigimon: async () => records, loadTamersByIds: async () => new Map(), loadEncounterMap: async () => map,
      getMovementProfile: () => ({ caps, budget: 4 }) },
    './naturewalk': { applyNaturewalkEnvironment: async (_enc, participants) => ({ participants }) },
    './damageOverTime': { loadCampaignDamageOverTimeRules: async () => undefined, applyMovementBurn: participants => ({ participants, logEntries: [] }) },
  }) : null
  const module = loadTypeScriptWithMocks('server/utils/attackMovement.ts', {
    '../db': { db: { update: () => ({ set: value => ({ where: async () => { writes.push(value); Object.assign(encounter, value) } }) }), select: () => ({ from: () => ({ where: async () => [encounter] }) }) }, encounters: { id: 'id' } },
    'drizzle-orm': { eq: () => null },
    './encounterRoom': { getRoomPositions: async () => positions, getRoomSnapshot: async () => ({ destructibleStates: [] }), getDestroyedStructureIds: () => new Set(), publishCommittedPositions: async (_id, patch) => Object.assign(positions, patch), broadcast: () => {} },
    './encounterMovement': { prepareEncounterMovement: async (_enc, intent, options) => {
      prepared.push(intent)
      if (movement) return movement.prepareEncounterMovement(_enc, intent, options)
      return { participants: encounter.participants, battleLog: [], participantPositions: { ...positions, actor: intent.destination }, openedDoorIds: [], defeated: false, commitDoors: async () => {} }
    } },
    './combatSpatial': { loadParticipantDigimon: async () => records, loadTamersByIds: async () => new Map(), loadEncounterMap: async () => map,
      getMovementProfile: () => ({ caps, budget: 4 }) },
    './resolveSupportAttack': { getDigimonDerivedStats: async () => ({ ram: 1, bit: 2, movement: 4, effectiveLimit: 10 }) },
  })
  const body = () => ({ operationId: 'cast', expectedRevision: 7, movement: { kind: 'pass', origin: point(), destination: point(3), direction: point(1), movement: 2, ram: 1 } })
  return { ...module, actor, encounter, positions, writes, prepared, records, body, access: { isDm: false, campaign: { rulesSettings: {} } } }
}

test('forged Charge timing and movement without a stored Charge attack cannot write', async () => {
  const f = fixture()
  const plain = { id: 'plain', tags: [], range: 'ranged' }
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', plain, { chargeTiming: 'after' }, f.access), { statusCode: 400 })
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', plain, f.body(), f.access), { statusCode: 400 })
  assert.equal(f.writes.length, 0)
})

for (const browserPath of [undefined, [], [point(9), point(3)]]) {
  test(`automatic Charge derives a valid route with browser path ${JSON.stringify(browserPath)}`, async () => {
    const f = fixture({ realMovement: true })
    f.positions.target = point(4)
    const result = await f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'] }, {
      operationId: 'cast', expectedRevision: 7, chargeTiming: 'before',
      movement: { kind: 'charge-before', origin: point(), destination: point(3), path: browserPath },
    }, f.access)
    assert.deepEqual(result.path[0], point())
    assert.deepEqual(result.path.at(-1), point(3))
    assert.equal(result.distance, 3)
    for (let i = 1; i < result.path.length; i++) {
      const from = result.path[i - 1], to = result.path[i]
      assert.equal(Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y), Math.abs(to.z - from.z)), 1)
    }
    assert.deepEqual(f.positions.actor, point(3))
    assert.equal(result.participants[0].actionsRemaining.simple, 2)
  })
}

for (const destination of [point(1), point(8)]) {
  test(`automatic Charge still rejects occupied or unreachable destination ${destination.x}`, async () => {
    const f = fixture({ realMovement: true })
    await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'] }, {
      operationId: 'cast', expectedRevision: 7, chargeTiming: 'before',
      movement: { kind: 'charge-before', origin: point(), destination, path: [] },
    }, f.access), { statusCode: 400, message: 'The destination is not reachable' })
    assert.deepEqual(f.positions.actor, point())
    assert.equal(f.writes.length, 0)
  })
}

test('automatic Charge can attack from its current anchor when already in range', async () => {
  const f = fixture({ realMovement: true })
  const result = await f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'] }, {
    operationId: 'cast', expectedRevision: 7, chargeTiming: 'before',
    movement: { kind: 'charge-before', origin: point(), destination: point() },
  }, f.access)
  assert.deepEqual(result.path, [point()])
  assert.equal(result.distance, 0)
})

test('attack movement requires a live preview origin, revision and enough attack actions', async () => {
  const f = fixture(), attack = { id: 'charge', tags: ['Charge Attack'], range: 'melee' }
  const body = { operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', movement: { kind: 'charge-before', origin: point(), destination: point(1) } }
  f.actor.actionsRemaining.simple = 0
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', attack, body, f.access), { statusCode: 403 })
  f.actor.actionsRemaining.simple = 2
  delete body.expectedRevision
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', attack, body, f.access), { statusCode: 400 })
  body.expectedRevision = 7
  body.movement.origin = point(8)
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', attack, body, f.access), { statusCode: 409 })
  assert.equal(f.prepared.length, 0)
  assert.equal(f.writes.length, 0)
})

test('Pass derives a straight endpoint, bounds RAM and never adds RAM to its hit beam', async () => {
  const f = fixture(), attack = { id: 'pass', tags: ['Area Attack: Pass'], range: 'melee' }
  const wrong = f.body()
  wrong.movement.destination = point(8)
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', attack, wrong, f.access), { statusCode: 400 })
  const excessive = f.body()
  excessive.movement.ram = 9
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', attack, excessive, f.access), { statusCode: 400 })
  const body = f.body()
  body.movement.path = [point(), point(9), point(3)]
  await f.commitAttackMovement(f.encounter, 'actor', attack, body, f.access)
  assert.deepEqual(f.prepared[0].path, [point(), point(1), point(2), point(3)])
  assert.equal(body.areaShapeData.movement, 2)
  assert.equal(body.areaShapeData.ram, 1)
  assert.deepEqual(body.areaShapeData.attackerPos, point())
  assert.deepEqual(f.positions.actor, point(3))
})

test('serialized Pass geometry cannot impersonate a server-validated movement', async () => {
  const f = fixture(), attack = { id: 'pass', tags: ['Area Attack: Pass'], range: 'melee' }
  const body = f.body()
  await f.commitAttackMovement(f.encounter, 'actor', attack, body, f.access)
  body.targetIds = ['target']
  await f.canonicalizeAreaAttack(f.encounter, f.actor, attack, body, f.records)
  const forged = JSON.parse(JSON.stringify(body))
  await assert.rejects(f.canonicalizeAreaAttack(f.encounter, f.actor, attack, forged, f.records), { statusCode: 400 })
})

test('targets must be deployed participants in this encounter', () => {
  const f = fixture()
  assert.throws(() => f.validateAttackTargets(f.encounter, { targetIds: ['another-campaign'] }), { statusCode: 400 })
  assert.throws(() => f.validateAttackTargets(f.encounter, { targetIds: ['target', 'target'] }), { statusCode: 400 })
  f.encounter.participants[1].inReserve = true
  assert.throws(() => f.validateAttackTargets(f.encounter, { targetId: 'target' }), { statusCode: 400 })
})
