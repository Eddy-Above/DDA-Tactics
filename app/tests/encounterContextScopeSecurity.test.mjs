import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const names = ['createError', 'defineEventHandler', 'getRouterParam', 'readBody']
const originals = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const clone = value => structuredClone(value)
const scopes = loadTypeScript('server/utils/databaseScope.ts')
const cache = loadTypeScript('server/utils/combatRecordCache.ts')
const queue = loadTypeScript('server/utils/intercedeClaims.ts')

function fixture() {
  const h3 = { defineEventHandler: handler => handler, getRouterParam: event => event.id,
    getMethod: event => event.method, getRequestURL: event => new URL(event.url), readBody: async event => event.body }
  Object.assign(globalThis, h3, { createError: data => Object.assign(new Error(data.message), data) })
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'evolutionLines', 'maps', 'campaigns'].map(name => [name, { name, id: `${name}.id` }]))
  const roster = [{ id: 'tamer-slot', entityId: 'tamer', type: 'tamer', currentWounds: 3 }, { id: 'mon-slot', entityId: 'champion', type: 'digimon', currentWounds: 3 }]
  let rows = {
    encounters: [{ id: 'enc', campaignId: 'own', mapId: null, participants: roster, phase: 'ended', round: 1,
      currentTurnIndex: 0, turnOrder: roster.map(p => p.id), pendingRequests: [], requestResponses: [], battleLog: [], revision: 0 }],
    digimon: [{ id: 'champion', campaignId: 'own', partnerId: 'tamer', currentWounds: 3 }, { id: 'rookie', campaignId: 'own', partnerId: 'tamer', currentWounds: 3 },
      { id: 'foreign', campaignId: 'other', currentWounds: 4 }, { id: 'bad-partner', campaignId: 'own', partnerId: 'foreign-tamer' }, { id: 'legacy', campaignId: null }],
    tamers: [{ id: 'tamer', campaignId: 'own' }, { id: 'setup-tamer', campaignId: 'own' }, { id: 'foreign-tamer', campaignId: 'other' }],
    evolutionLines: [{ id: 'own-line', campaignId: 'own', chain: [{ digimonId: 'legacy' }, { digimonId: 'rookie' }] }],
    maps: [], campaigns: [{ id: 'own', rulesSettings: {} }],
  }
  const calls = { writes: 0, work: 0, rolledBack: 0 }
  const sql = { eq: (_column, value) => ({ ids: [value] }), inArray: (_column, ids) => ({ ids }) }
  const database = state => ({
    select: () => ({ from: table => ({ where: filter => {
      const selected = () => clone((state[table.name] ?? []).filter(row => !filter || filter.ids.includes(row.id)))
      return { then: (yes, no) => Promise.resolve().then(selected).then(yes, no), for: async () => selected() }
    } }) }),
    update: table => ({ set: fields => ({ where: filter => {
      let applied
      const apply = () => applied ??= state[table.name].filter(row => filter.ids.includes(row.id)).map(row => { calls.writes++; Object.assign(row, clone(fields)); return clone(row) })
      return { then: (yes, no) => Promise.resolve().then(apply).then(yes, no), returning: async () => apply() }
    } }) }),
  })
  const live = new Proxy({}, { get: (_target, key) => key === 'transaction' ? async work => {
    const staged = clone(rows)
    try { const result = await work(database(staged)); rows = staged; return result } catch (error) { calls.rolledBack++; throw error }
  } : database(rows)[key] })
  const db = new Proxy({}, { get: (_target, key) => (scopes.scopedDatabase() ?? live)[key] })
  const store = { db, ...tables }
  const graph = loadTypeScriptWithMocks('server/utils/entityScopeGraph.ts', { '../db': store, 'drizzle-orm': sql })
  const characters = loadTypeScriptWithMocks('server/utils/encounterCharacterScope.ts', { '../db': store, 'drizzle-orm': sql, './entityScopeGraph': graph, './combatRecordCache': cache })
  const contexts = loadTypeScriptWithMocks('server/utils/encounterContextScope.ts', { '../db': store, 'drizzle-orm': sql, './encounterCharacterScope': characters })
  const state = loadTypeScriptWithMocks('server/utils/encounterStateScope.ts', { '../db': store, 'drizzle-orm': sql, './encounterCharacterScope': characters, './encounterContextScope': contexts })
  const authorization = { authorizeEncounterIntent: async () => ({ encounter: (await db.select().from(tables.encounters).where(sql.eq(null, 'enc')))[0], access: { isMember: true, isDm: true } }) }
  const command = loadTypeScriptWithMocks('server/utils/attackCommand.ts', {
    '../db': store, 'drizzle-orm': sql, './databaseScope': scopes, './combatRecordCache': cache, './intercedeClaims': queue,
    './encounterAuthorization': authorization, './encounterStateScope': state, './encounterContextScope': contexts,
    './encounterRoom': { prepareRoomCommit: async () => {} },
  })
  const boundary = loadTypeScriptWithMocks('server/utils/encounterCommand.ts', { h3, './attackCommand': command })
  const responses = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', {
    '../../../db': store, 'drizzle-orm': sql, '../../../utils/encounterCommand': boundary,
    '../../../utils/encounterAuthorization': authorization, '../../../utils/combatRecordCache': cache,
    '../../../utils/entitySecurity': { requireLinkedEntity: async () => {} }, '../../../utils/intercedeClaims': queue,
  }).default
  const requests = loadTypeScriptWithMocks('server/api/encounters/[id]/requests.post.ts', {
    '../../../db': store, 'drizzle-orm': sql, '../../../utils/encounterCommand': boundary,
    '../../../utils/encounterAuthorization': authorization, '../../../utils/intercedeClaims': queue,
  }).default
  const encounter = () => clone(rows.encounters[0])
  const recovery = rookieDigimonId => ({ id: 'recovery', type: 'recovery-check', targetTamerId: 'tamer', targetParticipantId: 'tamer-slot',
    data: { tamerParticipantId: 'tamer-slot', digimonParticipantId: 'mon-slot', rookieDigimonId } })
  const respond = body => responses({ id: 'enc', method: 'POST', url: 'http://localhost/api/encounters/enc/responses', body })
  return { contexts, state, calls, encounter, recovery, respond, rows: () => rows, request: body => requests({ id: 'enc', method: 'POST', url: 'http://localhost/api/encounters/enc/requests', body }) }
}

test('pending recovery context rejects foreign rookie records before any write through the real response route', async () => {
  const f = fixture(); f.rows().encounters[0].pendingRequests = [f.recovery('foreign')]
  await assert.rejects(f.respond({ requestId: 'recovery', tamerId: 'tamer', response: { type: 'recovery-rolled', tamerSuccesses: 0, digimonSuccesses: 2 } }), { statusCode: 400 })
  assert.equal(f.calls.writes, 0); assert.equal(f.calls.rolledBack, 1)
  assert.equal(f.rows().digimon.find(record => record.id === 'foreign').currentWounds, 4)
})

test('the same real recovery route still heals an authorized stored rookie record', async () => {
  const f = fixture(); f.rows().encounters[0].pendingRequests = [f.recovery('rookie')]
  const result = await f.respond({ requestId: 'recovery', tamerId: 'tamer', response: { type: 'recovery-rolled', tamerSuccesses: 0, digimonSuccesses: 2 } })
  assert.equal(f.rows().digimon.find(record => record.id === 'rookie').currentWounds, 1)
  assert.equal(result.pendingRequests.length, 0); assert.equal(f.calls.writes, 2)
})

test('generic replacement and incoming GM request admission reject the same nested foreign recovery context', async () => {
  const f = fixture(), request = f.recovery('foreign')
  await assert.rejects(f.state.validateEncounterStateScope(f.encounter(), { pendingRequests: [request] }), { statusCode: 400 })
  const { id: _id, ...body } = request
  await assert.rejects(f.request(body), { statusCode: 400 })
  assert.equal(f.calls.writes, 0)
})

test('context IDs resolve through character graphs; arbitrary text and attack/request IDs do not', async () => {
  const f = fixture()
  await f.contexts.validateEncounterContextScope(f.encounter(), { targetTamerId: 'setup-tamer', data: { rookieDigimonId: 'legacy', text: 'foreign', attackId: 'foreign', requestId: 'foreign' } })
  await f.contexts.validateEncounterContextScope(f.encounter(), { targetTamerId: 'GM', targetParticipantId: 'mon-slot', data: { attackerEntityId: 'champion', targetEntityId: 'tamer' } })
  for (const data of [{ rookieDigimonId: 'foreign' }, { attackerEntityId: 'foreign' }, { targetEntityId: 'foreign-tamer' }, { digimonId: 'bad-partner' }]) {
    await assert.rejects(f.contexts.validateEncounterContextScope(f.encounter(), { targetTamerId: 'GM', data }), { statusCode: 400 })
  }
})

test('unknown recipients and participant references are rejected in stored responses and nested area contexts', async () => {
  const f = fixture()
  for (const additional of [{ targetTamerId: 'foreign-tamer' }, { targetParticipantId: 'foreign-slot' }, { data: { targetIds: ['foreign-slot'] } },
    { data: { npcAreaEligibility: { 'mon-slot': ['foreign-slot'] } } }, { response: { participantId: 'foreign-slot' } }]) {
    await assert.rejects(f.contexts.validateEncounterContextScope(f.encounter(), additional), { statusCode: 400 })
  }
  await assert.rejects(f.contexts.validateEncounterContextScope({ ...f.encounter(), requestResponses: [{ tamerId: 'foreign-tamer', response: { type: 'digimon-selected', digimonId: 'foreign' } }] }), { statusCode: 400 })
  await f.contexts.validateEncounterContextScope(f.encounter(), { type: 'intercede-group-state', targetTamerId: '__internal__', data: { originalTargetIds: ['mon-slot'] } })
})

test('retained response history may outlive a removed roster slot while its character records remain scoped', async () => {
  const f = fixture()
  const response = { tamerId: 'tamer', participantId: 'removed-slot', attackerParticipantId: 'removed-attacker', response: { type: 'digimon-selected', digimonId: 'rookie' } }
  await f.contexts.validateEncounterContextScope({ ...f.encounter(), requestResponses: [response] })
  await assert.rejects(f.contexts.validateEncounterContextScope({ ...f.encounter(), requestResponses: [{ ...response, response: { type: 'digimon-selected', digimonId: 'foreign' } }] }), { statusCode: 400 })
  await assert.rejects(f.contexts.validateEncounterContextScope({ ...f.encounter(), pendingRequests: [{ targetTamerId: 'tamer', targetParticipantId: 'removed-slot' }] }), { statusCode: 400 })
})
