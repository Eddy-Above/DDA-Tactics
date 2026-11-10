import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const savedGlobals = Object.fromEntries(['getRouterParam', 'readBody', 'createError'].map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of Object.entries(savedGlobals)) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const cache = loadTypeScript('server/utils/combatRecordCache.ts')
function fixture(action, { failNameRead = false } = {}) {
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async event => event.body
  globalThis.createError = value => Object.assign(new Error(value.message), value)
  let encounter = { id: 'enc', round: 2, phase: 'combat', turnOrder: ['actor'], currentTurnIndex: 0, battleLog: [],
    participants: [{ id: 'actor', entityId: 'mon', type: 'digimon', isEnemy: true, seq: 1, currentStance: 'neutral', actionsRemaining: { simple: 2 } },
      { id: 'other', entityId: 'mon', type: 'digimon', isEnemy: true, seq: 2 }],
  }
  const tables = { encounters: { id: 'encounter-id' }, digimon: { id: 'digimon-id' }, tamers: { id: 'tamer-id' } }
  let writes = 0, recordReads = 0
  const save = fields => { writes++; encounter = { ...encounter, ...structuredClone(fields) }; return structuredClone(encounter) }
  const db = {
    select: () => ({ from: table => ({ where: async () => {
      if (table === tables.encounters) return [structuredClone(encounter)]
      recordReads++
      if (failNameRead) throw new Error('Name lookup failed')
      return [{ id: 'mon', name: 'Stored Agumon', isEnemy: true }]
    } }) }),
    update: () => ({ set: fields => ({ where: () => ({ returning: async () => [save(fields)] }) }) }),
  }
  const log = loadTypeScriptWithMocks('server/utils/participantActionLog.ts', { '../db': { db, ...tables }, './combatRecordCache': cache, 'drizzle-orm': { eq: () => null } })
  const module = loadTypeScriptWithMocks(`server/api/encounters/[id]/actions/${action}.post.ts`, {
    '../../../../db': { db, ...tables }, 'drizzle-orm': { eq: () => null },
    '../../../../utils/encounterCommand': { defineEncounterCommand: work => work },
    '../../../../utils/encounterAuthorization': { authorizeEncounterIntent: async () => ({ access: { isDm: true } }) },
    '../../../../utils/participantTurn': { canActOnEncounterTurn: async () => true },
    '../../../../utils/participantActionLog': log,
    '../../../../utils/encounterUpdate': { updateEncounterState: async (_id, fields) => save(fields) },
  })
  const body = { participantId: 'actor', operationId: 'same-operation', ...(action === 'stance' ? { stance: 'defensive' } : {}) }
  return { invoke: (override = {}) => module.default({ body: { ...body, ...override } }), state: () => encounter, writes: () => writes, recordReads: () => recordReads }
}

for (const [action, label, result] of [['stance', 'Changed stance', 'Switched to defensive stance'], ['card-move', 'Movement', 'Used movement action']]) {
  test(`${action} commits its action and mechanical log together using the stored numbered character name`, async () => {
    const f = fixture(action)
    const snapshot = await f.invoke({ actorName: 'Forged display name' })
    assert.equal(snapshot.participants[0].actionsRemaining.simple, 1)
    assert.equal(snapshot.battleLog.length, 1)
    assert.equal(snapshot.battleLog[0].actorName, 'Stored Agumon 1')
    assert.equal(snapshot.battleLog[0].actorId, 'actor')
    assert.equal(snapshot.battleLog[0].round, 2)
    assert.equal(snapshot.battleLog[0].action, label)
    assert.equal(snapshot.battleLog[0].result, result)
    assert.equal(f.writes(), 1)
    await f.invoke()
    assert.equal(f.state().participants[0].actionsRemaining.simple, 1)
    assert.equal(f.state().battleLog.length, 1, 'replaying an operation must not append another mechanical log')
    assert.equal(f.writes(), 1)
    assert.equal(f.recordReads(), 1)
  })
  test(`${action} cannot spend an action when preparing its stored-identity log fails`, async () => {
    const f = fixture(action, { failNameRead: true })
    await assert.rejects(f.invoke(), /Name lookup failed/)
    assert.equal(f.state().participants[0].actionsRemaining.simple, 2)
    assert.equal(f.state().battleLog.length, 0)
    assert.equal(f.writes(), 0)
  })
}

test('re-selecting the current stance is a server no-op without another log or action cost', async () => {
  const f = fixture('stance')
  await f.invoke()
  await f.invoke({ operationId: 'new-selection' })
  assert.equal(f.state().participants[0].actionsRemaining.simple, 1)
  assert.equal(f.state().battleLog.length, 1)
  assert.equal(f.writes(), 1)
})
