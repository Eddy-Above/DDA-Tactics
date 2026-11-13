import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const original = new Map(['createError', 'defineEventHandler', 'getRouterParam', 'readBody'].map(key => [key, globalThis[key]]))
afterEach(() => { for (const [key, value] of original) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value } })
const clone = value => structuredClone(value)
const databaseScope = loadTypeScript('server/utils/databaseScope.ts')
const cache = loadTypeScript('server/utils/combatRecordCache.ts')
const queue = loadTypeScript('server/utils/intercedeClaims.ts')
const participant = (id, extra = {}) => ({ id, entityId: id, type: 'digimon', currentWounds: 0, maxWounds: 5, actionsRemaining: { simple: 2 }, ...extra })

function fixture({ roster = [participant('actor')], forms = [], lines = [], owners = [], requests = [], responses = [], isDm = false, phase = 'setup' } = {}) {
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  globalThis.defineEventHandler = work => work
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async body => body
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'evolutionLines', 'maps'].map(name => [name, { name, id: name + '.id' }]))
  let encounter = { id: 'encounter', campaignId: 'own', mapId: null, phase, round: 1, currentTurnIndex: 0,
    turnOrder: roster.map(p => p.id), participants: clone(roster), pendingRequests: clone(requests), requestResponses: clone(responses), battleLog: [] }
  const rows = {
    digimon: new Map([{ id: 'actor', campaignId: 'own' }, ...forms].map(row => [row.id, row])),
    evolutionLines: new Map(lines.map(row => [row.id, row])), tamers: new Map(owners.map(row => [row.id, row])), maps: new Map(),
  }
  const calls = { locks: 0, auth: 0, work: 0, writes: 0, prepared: 0, effects: 0, rolledBack: 0, reads: [] }
  const sql = { eq: (_column, value) => ({ ids: [value] }), inArray: (_column, ids) => ({ ids }) }
  const makeDb = (read, write) => ({
    select: () => ({ from: table => ({ where: filter => {
      const readRows = () => {
        const ids = filter?.ids ?? [...rows[table.name].keys()]
        calls.reads.push({ table: table.name, ids })
        return table === tables.encounters ? [clone(read())] : ids.flatMap(id => rows[table.name].has(id) ? [clone(rows[table.name].get(id))] : [])
      }
      return { then: (done, fail) => Promise.resolve().then(readRows).then(done, fail), for: async () => { calls.locks++; return readRows() } }
    } }) }),
    update: table => ({ set: fields => ({ where: async () => {
      assert.equal(table, tables.encounters); calls.writes++; write({ ...read(), ...clone(fields) })
    } }) }),
  })
  const live = makeDb(() => encounter, value => { encounter = value })
  live.transaction = async work => {
    let staged = clone(encounter)
    try {
      const value = await work(makeDb(() => staged, next => { staged = next }))
      encounter = staged
      return value
    } catch (error) { calls.rolledBack++; throw error }
  }
  const db = new Proxy({}, { get: (_target, key) => (databaseScope.scopedDatabase() ?? live)[key] })
  const store = { db, ...tables }
  const entityGraph = loadTypeScriptWithMocks('server/utils/entityScopeGraph.ts', { '../db': store, 'drizzle-orm': sql })
  const characterScope = loadTypeScriptWithMocks('server/utils/encounterCharacterScope.ts', {
    '../db': store, 'drizzle-orm': sql, './combatRecordCache': cache, './entityScopeGraph': entityGraph,
  })
  const contextScope = loadTypeScriptWithMocks('server/utils/encounterContextScope.ts', {
    '../db': store, 'drizzle-orm': sql, './encounterCharacterScope': characterScope,
  })
  const stateScope = loadTypeScriptWithMocks('server/utils/encounterStateScope.ts', {
    '../db': store, 'drizzle-orm': sql, './encounterCharacterScope': characterScope, './encounterContextScope': contextScope,
  })
  const authorization = { authorizeEncounterIntent: async () => {
    calls.auth++
    const [current] = await db.select().from(tables.encounters).where(sql.eq(tables.encounters.id, 'encounter'))
    assert.equal(rows.digimon.get('actor').campaignId, 'own', 'the admitted actor remains in the authorized campaign')
    return { encounter: current, access: { isMember: true, isDm } }
  } }
  const command = loadTypeScriptWithMocks('server/utils/attackCommand.ts', {
    '../db': store, 'drizzle-orm': sql, './databaseScope': databaseScope, './combatRecordCache': cache,
    './intercedeClaims': queue, './encounterRoom': { prepareRoomCommit: async () => {} },
    './encounterAuthorization': authorization, './encounterStateScope': stateScope, './encounterContextScope': contextScope,
  })
  const run = (operation = 'attack', work = async () => { calls.work++ }, body = {}) => command.runAttackCommand({}, 'encounter', { participantId: 'actor', ...body }, operation, work)
  const unexpectedEffect = async () => { calls.effects++; throw new Error('Effects must not run before scope validation') }
  const update = loadTypeScriptWithMocks('server/utils/encounterUpdate.ts', {
    '../db': store, 'drizzle-orm': sql, './encounterStateScope': stateScope, './combatRecordCache': cache,
    './combatSpatial': { loadParticipantDigimon: async roster => new Map(roster.filter(p => p.type === 'digimon').map(p => [p.entityId, rows.digimon.get(p.entityId)])), loadTamersByIds: async () => new Map() },
    './endOfTurnGravity': { applyEndOfTurnGravity: unexpectedEffect },
    './roundStartQualityTriggers': { applyRoundStartQualityTriggers: unexpectedEffect },
    './encounterStartTriggers': { applyEncounterStartTriggers: unexpectedEffect },
    './enemyKnockouts': { knockedOutEnemyIds: () => [], resolveEnemyKnockouts: unexpectedEffect },
    './naturewalk': { applyNaturewalkEnvironment: async (_encounter, participants) => ({ participants, changed: false }) },
    './combatContext': { loadCampaignCombatContext: async () => ({ campaignLevel: 'standard', houseRules: {} }) },
    './guidingLight': { applyGuidingLightAuras: async participants => ({ participants, changed: false }) },
    './encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }) },
  })
  const move = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/move.post.ts', {
    '../../../../db': store, 'drizzle-orm': sql, '../../../../utils/databaseScope': databaseScope,
    '../../../../utils/intercedeClaims': queue, '../../../../utils/encounterAuthorization': authorization,
    '../../../../utils/encounterStateScope': stateScope,
    '../../../../utils/encounterRoom': { prepareRoomCommit: async () => {} },
    '../../../../utils/encounterMovement': { prepareEncounterMovement: async () => { calls.prepared++; throw new Error('Movement must not be prepared') }, movementFingerprint: () => 'fingerprint' },
  }).default
  const evolution = loadTypeScriptWithMocks('server/utils/digivolutionAction.ts', {
    '../db': store, 'drizzle-orm': sql,
    './entitySecurity': { entityCampaignId: async (kind, record) => entityGraph.createEntityScopeResolver([record], kind)(kind, record) },
    './combatContext': { loadCampaignCombatContext: async () => ({ campaignLevel: 'standard', eddySoulRules: {}, houseRules: {} }) },
    './encounterRoom': { getRoomPositions: async () => ({}) },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  })
  const put = loadTypeScriptWithMocks('server/api/encounters/[id].put.ts', {
    '../../db': store,
    '../../utils/encounterCommand': { defineEncounterCommand: work => event => run('update', () => work(event)) },
    '../../utils/campaignSecurity': { requireEncounterAccess: async () => ({ encounter: clone(encounter) }) },
    '../../utils/securityValidation': { tableWriteBody: body => body },
    '../../utils/entitySecurity': { requireLinkedEntity: async () => { throw Error('roster validation must use bulk scope checks') } },
    '../../utils/encounterUpdate': update, '../../utils/intercedeClaims': queue,
  }).default
  return { calls, run, move, put, update: update.updateEncounterState, digivolve: evolution.performDigivolution, stateScope, encounter: () => clone(encounter) }
}

for (const [name, settings] of [
  ['foreign target', { roster: [participant('actor'), participant('target')], forms: [{ id: 'target', campaignId: 'foreign' }] }],
  ['foreign saved old form', { roster: [participant('actor', { woundsHistory: [{ entityId: 'old-form' }] })], forms: [{ id: 'old-form', campaignId: 'foreign' }] }],
  ['own form with foreign partner', { forms: [{ id: 'actor', campaignId: 'own', partnerId: 'foreign-owner' }], owners: [{ id: 'foreign-owner', campaignId: 'foreign' }] }],
  ['own line with foreign chain form', { roster: [participant('actor', { evolutionLineId: 'line' })], lines: [{ id: 'line', campaignId: 'own', chain: [{ digimonId: 'foreign-form' }] }], forms: [{ id: 'foreign-form', campaignId: 'foreign' }] }],
  ['own line with foreign partner', { roster: [participant('actor', { evolutionLineId: 'line' })], lines: [{ id: 'line', campaignId: 'own', partnerId: 'foreign-owner', chain: [{ digimonId: 'actor' }] }], owners: [{ id: 'foreign-owner', campaignId: 'foreign' }] }],
]) {
  test(`the locked command rejects a same-campaign actor with ${name} before combat work`, async () => {
    const f = fixture(settings)
    await assert.rejects(f.run(), { statusCode: 400 })
    assert.equal(f.calls.auth, 2)
    assert.equal(f.calls.locks, 1)
    assert.equal(f.calls.work, 0)
    assert.equal(f.calls.writes, 0)
    assert.equal(f.calls.rolledBack, 1)
  })
}

test('GM NPC commands cannot use a foreign stored target', async () => {
  const f = fixture({ isDm: true, roster: [participant('actor', { isEnemy: true }), participant('target')], forms: [{ id: 'target', campaignId: 'foreign' }] })
  await assert.rejects(f.run('npc-attack'), { statusCode: 400 })
  assert.equal(f.calls.work, 0)
})

test('legacy forms and lines derive valid scope from their own-campaign Tamer and chain', async () => {
  const f = fixture({ roster: [participant('actor', { evolutionLineId: 'legacy-line', woundsHistory: [{ entityId: 'old-form' }] })],
    forms: [{ id: 'old-form', campaignId: null, partnerId: 'owner' }], owners: [{ id: 'owner', campaignId: 'own' }],
    lines: [{ id: 'legacy-line', campaignId: null, chain: [{ digimonId: 'actor' }, { digimonId: 'old-form' }] }] })
  await f.run()
  assert.equal(f.calls.work, 1)
})

test('legacy unpartnered forms derive valid scope from a campaign-owned line', async () => {
  const f = fixture({ roster: [participant('actor', { evolutionLineId: 'owned-line', woundsHistory: [{ entityId: 'old-form' }] })],
    forms: [{ id: 'old-form', campaignId: null, partnerId: null }],
    lines: [{ id: 'owned-line', campaignId: 'own', chain: [{ digimonId: 'actor' }, { digimonId: 'old-form' }] }] })
  await f.run()
  assert.equal(f.calls.work, 1)
})

test('trusted evolution can restore a legacy null-campaign form through its owned line', async () => {
  const f = fixture({ isDm: true, roster: [participant('actor', { evolutionLineId: 'owned-line', isEnemy: true, npcStageIndex: 1 })],
    forms: [{ id: 'actor', campaignId: 'own', stage: 'champion', baseStats: { health: 5 } }, { id: 'old-form', campaignId: null, stage: 'rookie', baseStats: { health: 3 }, currentWounds: 1 }],
    lines: [{ id: 'owned-line', campaignId: 'own', currentStageIndex: 1, chain: [
      { digimonId: 'old-form', species: 'Rookie', stage: 'rookie', evolvesFromIndex: null },
      { digimonId: 'actor', species: 'Champion', stage: 'champion', evolvesFromIndex: 0 },
    ] }] })
  const result = await f.run('gm-digivolve', () => f.digivolve('encounter', { participantId: 'actor', targetChainIndex: 0 }))
  assert.equal(result.participants[0].entityId, 'old-form')
  assert.equal(f.calls.writes, 1)
})

test('partial generic updates validate the existing roster before gravity or encounter-start effects', async () => {
  const f = fixture({ roster: [participant('actor', { woundsHistory: [{ entityId: 'foreign-old' }] })], forms: [{ id: 'foreign-old', campaignId: 'foreign' }] })
  await assert.rejects(f.run('update', () => f.update('encounter', { phase: 'combat', currentTurnIndex: 0, round: 2 })), { statusCode: 400 })
  assert.equal(f.calls.effects, 0)
  assert.equal(f.calls.writes, 0)
})

test('GM replacement updates can repair a tainted roster without loading foreign records', async () => {
  const f = fixture({ isDm: true, roster: [participant('actor'), participant('bad')], forms: [{ id: 'bad', campaignId: 'foreign' }] })
  const result = await f.run('update', () => f.update('encounter', { participants: [participant('actor')], turnOrder: ['actor'] }))
  assert.deepEqual(result.participants.map(p => p.id), ['actor'])
  assert.equal(f.calls.writes, 1)
  assert.equal(f.calls.reads.some(read => read.table === 'digimon' && read.ids.includes('bad')), false)
})

test('a 20-participant addition uses one save and one scope graph snapshot, rather than individual link checks', async () => {
  const forms = Array.from({ length: 20 }, (_, index) => ({ id: `new-${index}`, campaignId: 'own' }))
  const f = fixture({ isDm: true, forms })
  const roster = [participant('actor'), ...forms.map(form => participant(form.id))]
  const result = await f.put({ participants: roster, turnOrder: roster.map(p => p.id), currentTurnIndex: 0 })
  assert.equal(result.participants.length, 21)
  assert.equal(f.calls.writes, 1)
  assert.equal(f.calls.reads.filter(read => read.table === 'evolutionLines').length, 1)
  assert.equal(f.calls.reads.filter(read => read.table === 'digimon').length, 1)
})

test('the optimized update still rejects a foreign addition before saving anything', async () => {
  const f = fixture({ isDm: true, forms: [{ id: 'foreign', campaignId: 'other' }] })
  await assert.rejects(f.put({ participants: [participant('actor'), participant('foreign')], turnOrder: ['actor', 'foreign'] }), { statusCode: 400 })
  assert.equal(f.calls.writes, 0)
})

test('a roster reorder that preserves the active participant does not run turn-end gravity', async () => {
  const roster = [participant('actor', { isActive: true }), participant('other')]
  const f = fixture({ isDm: true, phase: 'combat', roster, forms: [{ id: 'other', campaignId: 'own' }] })
  const result = await f.put({ participants: roster, turnOrder: ['other', 'actor'], currentTurnIndex: 1 })
  assert.equal(result.turnOrder[result.currentTurnIndex], 'actor')
  assert.equal(f.calls.effects, 0)
  assert.equal(f.calls.writes, 1)
})

test('the separate movement transaction rejects foreign saved forms before path preparation', async () => {
  const f = fixture({ roster: [participant('actor', { woundsHistory: [{ entityId: 'bad-form' }] })], forms: [{ id: 'bad-form', campaignId: 'foreign' }] })
  await assert.rejects(f.move({ participantId: 'actor', operationId: 'move' }), { statusCode: 400 })
  assert.equal(f.calls.locks, 1)
  assert.equal(f.calls.prepared, 0)
  assert.equal(f.calls.writes, 0)
})

test('null-campaign encounters remain read-only even with an otherwise valid roster', async () => {
  const f = fixture()
  await assert.rejects(f.stateScope.validateEncounterStateScope({ ...f.encounter(), campaignId: null }, {}), { statusCode: 403 })
})

test('a tainted stored recovery prompt blocks commands before its foreign form can be written', async () => {
  const f = fixture({ requests: [{ id: 'recovery', type: 'recovery-check', targetTamerId: 'gm', data: { rookieDigimonId: 'foreign-rookie' } }], forms: [{ id: 'foreign-rookie', campaignId: 'foreign' }] })
  await assert.rejects(f.run('response'), { statusCode: 400 })
  assert.equal(f.calls.work, 0)
  assert.equal(f.calls.writes, 0)
})

test('new recovery request data is checked under the command lock before persistence', async () => {
  const f = fixture({ isDm: true, forms: [{ id: 'foreign-rookie', campaignId: 'foreign' }] })
  await assert.rejects(f.run('requests-create', undefined, { type: 'recovery-check', targetTamerId: 'gm', data: { rookieDigimonId: 'foreign-rookie' } }), { statusCode: 400 })
  assert.equal(f.calls.work, 0)
  assert.equal(f.calls.locks, 1)
})

test('generic updates reject foreign recovery context and allow a GM to clear a tainted prompt', async () => {
  const bad = { id: 'recovery', type: 'recovery-check', targetTamerId: 'gm', data: { rookieDigimonId: 'foreign-rookie' } }
  const f = fixture({ isDm: true, requests: [bad], forms: [{ id: 'foreign-rookie', campaignId: 'foreign' }] })
  await assert.rejects(f.run('update', () => f.update('encounter', { name: 'Unrelated change' })), { statusCode: 400 })
  assert.equal(f.calls.writes, 0)
  const repaired = await f.run('update', () => f.update('encounter', { pendingRequests: [] }))
  assert.deepEqual(repaired.pendingRequests, [])
  assert.equal(f.calls.writes, 1)
})
