import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const originalError = globalThis.createError
afterEach(() => { if (originalError === undefined) delete globalThis.createError; else globalThis.createError = originalError })
const point = (x = 0, y = 0) => ({ x, y, z: 0 })
const { detectCapabilities } = loadTypeScript('utils/movementRules.ts')
const spatialMovement = loadTypeScript('server/utils/mapMovement.ts')
function fixture({ realMovement = false, realStats = false } = {}) {
  globalThis.createError = options => Object.assign(new Error(options.message), options)
  const actor = { id: 'actor', entityId: 'mon', type: 'digimon', actionsRemaining: { simple: 2 }, currentWounds: 0, maxWounds: 10 }
  const encounter = { id: 'enc', mapId: 'map', phase: 'combat', turnOrder: ['actor'], round: 1, revision: 7, currentTurnIndex: 0, participants: [actor, { id: 'target', entityId: 'target-mon', type: 'digimon' }] }
  const positions = { actor: point(), target: point(1) }, writes = [], prepared = []
  const map = { groundTiles: Array.from({ length: 10 }, (_, x) => point(x)), walls: [], doors: [], ceilings: [], stairs: [], spaceTiles: [], voxels: [] }
  const records = new Map([['mon', { id: 'mon', size: 'medium', qualities: [] }], ['target-mon', { id: 'target-mon', size: 'medium' }]])
  const caps = detectCapabilities([], 4, 1, 1)
  const tamers = new Map(), loadedTamerIds = []
  let searches = 0
  const spatial = realStats ? loadTypeScriptWithMocks('server/utils/combatSpatial.ts', {
    '../db': {}, './combatRecordCache': {}, './resolveSupportAttack': {},
  }) : null
  const loadTamersByIds = async ids => { loadedTamerIds.push(...ids); return new Map(ids.filter(id => tamers.has(id)).map(id => [id, tamers.get(id)])) }
  const getMovementProfile = (...args) => spatial ? spatial.getMovementProfile(...args) : { caps, budget: caps.movementSpeed }
  const movement = realMovement ? loadTypeScriptWithMocks('server/utils/encounterMovement.ts', {
    './mapMovement': { ...spatialMovement, getMovementReachability: (...args) => { searches++; return spatialMovement.getMovementReachability(...args) } },
    '../db': { db: {}, maps: { id: 'id' } },
    './databaseScope': { scopedDatabase: () => undefined },
    './encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: positions, destructibleStates: [] }) },
    './combatSpatial': { loadParticipantDigimon: async () => records, loadTamersByIds, loadEncounterMap: async () => map, getMovementProfile },
    './naturewalk': { applyNaturewalkEnvironment: async (_enc, participants) => ({ participants }) },
    './resolveSupportAttack': { getDigimonDerivedStats: async () => ({ ram: 1 }) },
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
    './combatSpatial': { loadParticipantDigimon: async () => records, loadTamersByIds, loadEncounterMap: async () => map, getMovementProfile },
    './resolveSupportAttack': { getDigimonDerivedStats: async () => ({ ram: 1, bit: 2, movement: 4, effectiveLimit: 10 }) },
  })
  const body = () => ({ operationId: 'cast', expectedRevision: 7, movement: { kind: 'pass', origin: point(), destination: point(3), direction: point(1), movement: 2, ram: 1 } })
  return { ...module, actor, encounter, positions, writes, prepared, records, map, caps, tamers, loadedTamerIds, body, searches: () => searches, access: { isDm: false, campaign: { level: 'standard', rulesSettings: {} } } }
}

test('forged Charge timing and movement without a stored Charge attack cannot write', async () => {
  const f = fixture()
  const plain = { id: 'plain', tags: [], range: 'ranged' }
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', plain, { chargeTiming: 'after' }, f.access), { statusCode: 400 })
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', plain, f.body(), f.access), { statusCode: 400 })
  assert.equal(f.writes.length, 0)
})

for (const browserPath of [undefined, [], [point(), point(1), point(2), point(3)]]) {
  test(`Charge validates the chosen destination with browser path ${JSON.stringify(browserPath)}`, async () => {
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

test('melee Charge preserves the chosen tile and route after selecting a target', async () => {
  const f = fixture({ realMovement: true })
  f.positions.target = point(4)
  const destination = { x: 4, y: 0, z: 1 }
  const path = [point(), point(1), point(2), { x: 3, y: 0, z: 1 }, destination]
  const result = await f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'], range: 'melee' }, {
    operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', targetId: 'target',
    movement: { kind: 'charge-before', origin: point(), destination, path },
  }, f.access)
  assert.deepEqual(result.position, destination, 'do not replace the chosen tile with a closer automatic landing')
  assert.deepEqual(result.path, path)
  assert.deepEqual(f.positions.actor, destination)
  assert.deepEqual(f.writes[0].participantPositions.actor, destination)
  assert.equal(result.participants[0].actionsRemaining.simple, 2)
  assert.equal(f.searches(), 0, 'validate the chosen preview route without loading movement locations again')
})

for (const destination of [point(4), point(9), point(0, 3)]) {
  test(`Charge rejects an invalid chosen tile instead of moving elsewhere: ${JSON.stringify(destination)}`, async () => {
    const f = fixture({ realMovement: true })
    f.positions.target = point(4)
    await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'], range: 'melee' }, {
      operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', targetId: 'target',
      movement: { kind: 'charge-before', origin: point(), destination },
    }, f.access), { statusCode: 400 })
    assert.equal(f.writes.length, 0)
    assert.deepEqual(f.positions.actor, point())
  })
}

test('Charge rejects a forged preview route', async () => {
  const f = fixture({ realMovement: true })
  f.positions.target = point(4)
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'], range: 'melee' }, {
    operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', targetId: 'target',
    movement: { kind: 'charge-before', origin: point(), destination: point(3), path: [point(), point(3)] },
  }, f.access), /adjacent cells/)
  assert.equal(f.writes.length, 0)
})

test('melee Charge rejects a target beyond all legal attack positions without writing', async () => {
  const f = fixture({ realMovement: true })
  f.positions.target = point(9)
  await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'], range: 'melee' }, {
    operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', targetId: 'target',
    movement: { kind: 'charge-before', origin: point(), destination: point(3) },
  }, f.access), { statusCode: 400, message: 'The selected Charge position is outside melee range of the target' })
  assert.equal(f.writes.length, 0)
  assert.deepEqual(f.positions.actor, point())
})

for (const [level, agility, allowed] of [['standard', 3, true], ['enhanced', 3, false], ['enhanced', 5, true], ['extreme', 5, false], ['extreme', 6, true]]) {
  test(`an 11m Charge walking down a step respects Strike First at ${level} Agility ${agility}`, async () => {
    const f = fixture({ realMovement: true, realStats: true })
    Object.assign(f.records.get('mon'), {
      name: 'Pulsemon', stage: 'rookie', partnerId: 'tamer',
      baseStats: { accuracy: 6, damage: 6, dodge: 6, armor: 6, health: 6 },
      qualities: [{ id: 'instinct', ranks: 1 }, { id: 'speedy', ranks: 1 }],
    })
    f.tamers.set('tamer', { id: 'tamer', attributes: { agility, body: 0, charisma: 0, intelligence: 0, willpower: 0 }, xpBonuses: null })
    f.access.campaign.level = level
    const tile = x => point(x, x < 5 ? 1 : 0)
    f.map.groundTiles = Array.from({ length: 13 }, (_, x) => tile(x))
    f.positions.actor = tile(0)
    f.positions.target = tile(12)
    const charge = f.commitAttackMovement(f.encounter, 'actor', { name: 'Elec Rush', tags: ['Charge Attack'], range: 'melee' }, {
      operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', targetId: 'target',
      movement: { kind: 'charge-before', origin: tile(0), destination: tile(11) },
    }, f.access)
    if (allowed) {
      const result = await charge
      assert.equal(result.distance, 11)
      assert.deepEqual(f.positions.actor, tile(11))
      assert.ok(result.path.some((cell, i) => i > 0 && cell.y < result.path[i - 1].y), 'the route descends to the road')
    } else {
      await assert.rejects(charge, /not reachable/)
      assert.equal(f.writes.length, 0)
    }
    assert.ok(f.loadedTamerIds.includes('tamer'), 'load the partner even when the tamer is not on the map')
  })
}

for (const surface of ['ground', 'stairs', 'voxels']) for (const direction of [1, -1]) {
  test(`melee Charge walks ${direction > 0 ? 'up' : 'down'} ${surface} without requiring flight or jumping`, async () => {
    const f = fixture({ realMovement: true })
    f.caps.canJump = false
    f.caps.jumpHeight = f.caps.jumpRange = 0
    f.map.groundTiles = [point()]
    for (let x = 1; x <= 4; x++) {
      if (surface === 'ground') f.map.groundTiles.push(point(x, x * direction))
      else f.map[surface].push({ id: `step-${x}`, ...point(x, x * direction - 1), ...(surface === 'voxels' ? { materialId: 'steel' } : {}) })
    }
    f.positions.target = point(4, 4 * direction)
    const result = await f.commitAttackMovement(f.encounter, 'actor', { tags: ['Charge Attack'], range: 'melee' }, {
      operationId: 'cast', expectedRevision: 7, chargeTiming: 'before', targetId: 'target',
      movement: { kind: 'charge-before', origin: point(), destination: point(3, 3 * direction) },
    }, f.access)
    assert.deepEqual(result.path, [point(), point(1, direction), point(2, 2 * direction), point(3, 3 * direction)])
    assert.deepEqual(f.positions.actor, point(3, 3 * direction))
    assert.equal(result.distance, 3)
  })
}

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

test('directionless Burst derives aiming geometry from stored actor stats when none is supplied', async () => {
  const f = fixture()
  const body = { targetIds: ['target'], areaShapeData: null }
  await f.canonicalizeAreaAttack(f.encounter, f.actor, { tags: ['Area Attack: Burst'], range: 'melee' }, body, f.records)
  assert.equal(body.areaShapeData.shape, 'burst')
  assert.deepEqual(body.areaShapeData.attackerPos, point())
  assert.equal(body.areaShapeData.bit, 2)
})

test('directional area attacks still require explicit aiming data', async () => {
  const f = fixture()
  await assert.rejects(f.canonicalizeAreaAttack(f.encounter, f.actor, { tags: ['Area Attack: Cone'], range: 'melee' },
    { targetIds: ['target'], areaShapeData: null }, f.records), /Area attack aiming data is required/)
})

test('targets must be deployed participants in this encounter', () => {
  const f = fixture()
  assert.throws(() => f.validateAttackTargets(f.encounter, { targetIds: ['another-campaign'] }), { statusCode: 400 })
  assert.throws(() => f.validateAttackTargets(f.encounter, { targetIds: ['target', 'target'] }), { statusCode: 400 })
  f.encounter.participants[1].inReserve = true
  assert.throws(() => f.validateAttackTargets(f.encounter, { targetId: 'target' }), { statusCode: 400 })
})

function passPreview(f, destination) {
  const rules = loadTypeScript('utils/movementRules.ts')
  const methods = loadPageFunctions('components/MapCanvas.vue', [
    'getParticipantSize', 'getParticipantFootprintDims', 'footprintIntersectsArea', 'footprintOccupied', 'isPassLandingValid',
  ], {
    ...rules, ...loadTypeScript('utils/movementPath.ts'),
    props: { map: f.map, participants: f.encounter.participants, participantPositions: f.positions,
      digimonMap: Object.fromEntries(f.records), tamerMap: {}, destructibleStates: [], selectedAttack: { movement: f.caps.movementSpeed, ram: 1 } },
  })
  return methods.isPassLandingValid(destination, { width: 1, height: 1, depth: 1 }, 'actor', f.caps, f.positions.actor)
}

for (const surface of ['groundTiles', 'stairs', 'voxels']) for (const slope of [-1, 1]) {
  test(`Pass preview and commit agree on ${slope > 0 ? 'ascending' : 'descending'} ${surface}`, async () => {
    const f = fixture({ realMovement: true })
    f.positions.target = point(20)
    f.caps.canJump = false
    f.map.groundTiles = [point()]
    for (let x = 1; x <= 2; x++) {
      f.map[surface].push({ id: `step-${x}`, ...point(x, x * slope - (surface === 'groundTiles' ? 0 : 1)), materialId: 'steel', face: 'north' })
    }
    const destination = point(2, slope * 2)
    assert.equal(passPreview(f, destination), true)
    const result = await f.commitAttackMovement(f.encounter, 'actor', { tags: ['Area Attack: Pass'], range: 'melee' }, {
      operationId: 'cast', expectedRevision: 7,
      movement: { kind: 'pass', origin: point(), destination, direction: destination, movement: Math.hypot(2, 2), ram: 0 },
    }, f.access)
    assert.deepEqual(result.path, [point(), point(1, slope), destination], 'vertical diagonal steps are not split into axis steps')
  })
}

test('Pass can launch a jump from lower footing along the route', async () => {
  const f = fixture({ realMovement: true })
  Object.assign(f.caps, { movementSpeed: 8, jumpHeight: 8, jumpRange: 8 })
  f.positions.actor = point(0, 8)
  f.positions.target = point(20)
  f.map.groundTiles = [0, 1, 2, 3].map(x => point(x, 8)).concat(point(4, 7))
  const destination = point(6, 7)
  assert.equal(passPreview(f, destination), true, 'the landing is below the move origin but level with the actual launch')
  const result = await f.commitAttackMovement(f.encounter, 'actor', { tags: ['Area Attack: Pass'], range: 'melee' }, {
    operationId: 'cast', expectedRevision: 7,
    movement: { kind: 'pass', origin: f.positions.actor, destination, direction: point(6, -1), movement: Math.hypot(6, 1), ram: 0 },
  }, f.access)
  assert.deepEqual(result.position, destination)
})

for (const obstacle of ['jump height', 'wall', 'occupied route']) {
  test(`Pass preview rejects a supported endpoint when its route exceeds ${obstacle}`, async () => {
    const f = fixture({ realMovement: true })
    f.positions.target = point(20)
    let destination = point(3)
    if (obstacle === 'jump height') {
      destination = point(0, 4)
      f.map.groundTiles = [point(), destination]
    } else if (obstacle === 'wall') {
      f.map.walls = [{ id: 'wall', ...point(1), face: 'east' }]
    } else {
      f.positions.target = point(1)
    }
    assert.equal(passPreview(f, destination), false, 'hover must not show an invalid route as valid')
    await assert.rejects(f.commitAttackMovement(f.encounter, 'actor', { tags: ['Area Attack: Pass'], range: 'melee' }, {
      operationId: 'cast', expectedRevision: 7,
      movement: { kind: 'pass', origin: point(), destination, direction: destination, movement: Math.hypot(destination.x, destination.y), ram: 0 },
    }, f.access), /movement path is blocked/)
    assert.deepEqual(f.writes, [])
  })
}
