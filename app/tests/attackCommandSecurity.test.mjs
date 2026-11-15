import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const scopes = loadTypeScript('server/utils/databaseScope.ts')
const queue = loadTypeScript('server/utils/intercedeClaims.ts')
const records = loadTypeScript('server/utils/combatRecordCache.ts')
const originalError = globalThis.createError
afterEach(() => { if (originalError === undefined) delete globalThis.createError; else globalThis.createError = originalError })
const copy = value => structuredClone(value)
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

function fixture(initial = {}) {
  globalThis.createError = options => Object.assign(new Error(options.message), options)
  const table = { id: 'encounters.id' }
  let state = { id: 'enc', revision: 7, participants: [{ id: 'unit', actionsRemaining: { simple: 2 } }], doors: [], ...initial }
  const control = { allowed: true, transactions: 0, locks: 0, writes: 0, prepares: 0, committed: 0, rolledBack: 0, work: 0, events: [] }
  function database(read, write) {
    return {
      select: () => ({ from: () => ({ where: () => ({
        for: async lock => { assert.equal(lock, 'update'); control.locks++; return [copy(read())] },
        then: (done, fail) => Promise.resolve([copy(read())]).then(done, fail),
      }) }) }),
      update: () => ({ set: fields => ({ where: () => {
        let applied = false
        const apply = () => { if (!applied) { applied = true; control.writes++; write({ ...read(), ...copy(fields), revision: read().revision + 1 }) }; return [copy(read())] }
        return { then: (yes, no) => Promise.resolve().then(apply).then(yes, no), returning: async () => apply() }
      } }) }),
    }
  }
  const live = database(() => state, next => { state = next })
  live.transaction = async work => {
    control.transactions++
    let staged = copy(state)
    const transaction = database(() => staged, next => { staged = next })
    try {
      const result = await work(transaction)
      state = staged; control.committed++
      return result
    } catch (error) { control.rolledBack++; throw error }
  }
  const db = new Proxy({}, { get: (_target, key) => (scopes.scopedDatabase() ?? live)[key] })
  const tankBuster = loadTypeScriptWithMocks('server/utils/tankBuster.ts', {
    '../db': { db, encounters: table }, 'drizzle-orm': { eq: (_column, value) => value },
    './combatSpatial': { loadParticipantDigimon: async participants => new Map(participants.filter(p => p.type === 'digimon')
      .map(p => [p.entityId, { attacks: [{ tags: ['Tank Buster'] }] }])) },
  })
  const module = loadTypeScriptWithMocks('server/utils/attackCommand.ts', {
    './braveStance': loadTypeScriptWithMocks('server/utils/braveStance.ts', {
      '../db': { db, encounters: table }, 'drizzle-orm': { eq: (_column, value) => value },
    }),
    './tankBuster': tankBuster,
    '../db': { db, encounters: table }, 'drizzle-orm': { eq: (_column, value) => value },
    './intercedeClaims': queue, './databaseScope': scopes, './combatRecordCache': records,
    './encounterRoom': { prepareRoomCommit: async () => { control.prepares++ } },
    // This suite isolates the durable queue/transaction; stored-link authorization
    // runs with the actual validator in encounterStoredScopeSecurity.test.mjs.
    './encounterStateScope': { validateEncounterStateScope: async () => {} },
    './encounterAuthorization': { authorizeEncounterIntent: async () => {
      if (!control.allowed) throw Object.assign(new Error('Forbidden'), { statusCode: 403 })
      const [encounter] = await db.select().from(table).where('enc')
      return { encounter, access: { isMember: true, isDm: false } }
    } },
  })
  const spend = async context => {
    control.work++
    const participants = context.encounter.participants.map(actor => ({ ...actor, actionsRemaining: { simple: actor.actionsRemaining.simple - 1 } }))
    await db.update(table).set({ participants }).where('enc')
    const [fresh] = await db.select().from(table).where('enc')
    return fresh
  }
  const run = (body, work = spend) => module.runAttackCommand({}, 'enc', { participantId: 'unit', ...body }, 'attack', work)
  return { control, run, db, table, spend, state: () => copy(state) }
}

test('unauthorised commands fail before starting a transaction, draining rooms or changing state', async () => {
  const f = fixture(); f.control.allowed = false
  await assert.rejects(f.run({ operationId: 'blocked' }), { statusCode: 403 })
  assert.equal(f.control.transactions, 0); assert.equal(f.control.prepares, 0)
  assert.equal(f.control.writes, 0); assert.equal(f.control.work, 0)
  assert.equal(f.state().participants[0].actionsRemaining.simple, 2)
})

test('healing commands reset Brave above half health inside the same durable command', async () => {
  const f = fixture({ phase: 'combat', participants: [{ id: 'unit', type: 'digimon', entityId: 'mon', currentStance: 'brave',
    maxWounds: 20, currentWounds: 12, actionsRemaining: { simple: 2 } }] })
  const heal = (operationId, currentWounds, fail = false) => f.run({ operationId }, async context => {
    await f.db.update(f.table).set({ participants: context.encounter.participants.map(p => ({ ...p, currentWounds })) }).where('enc')
    if (fail) throw Error('Healing failed')
    return (await f.db.select().from(f.table).where('enc'))[0]
  })
  await assert.rejects(heal('failed-heal', 5, true), /Healing failed/)
  assert.equal(f.state().participants[0].currentStance, 'brave')
  assert.equal(f.state().participants[0].currentWounds, 12)
  await heal('half-health', 10)
  assert.equal(f.state().participants[0].currentStance, 'brave')
  const result = await heal('above-half-health', 9)
  assert.equal(result.participants[0].currentStance, 'neutral')
  assert.equal(f.state().participants[0].currentStance, 'neutral')
  assert.equal(f.state().participants[0].actionsRemaining.simple, 2)
  const writes = f.control.writes
  await heal('above-half-health', 9)
  assert.equal(f.control.writes, writes, 'retries cannot repeat the healing or passive transition')
})

test('health commands grant Tank Buster crossings once, preserve earned uses through healing, and roll back failures', async () => {
  const f = fixture({ phase: 'combat', participants: [{ id: 'unit', type: 'digimon', entityId: 'boss',
    maxWounds: 100, currentWounds: 0, tankBusterUses: 0, actionsRemaining: { simple: 2 } }] })
  const change = (operationId, wounds, fail = false) => f.run({ operationId }, async context => {
    const participants = context.encounter.participants.map(p => ({ ...p, currentWounds: wounds }))
    await f.db.update(f.table).set({ participants }).where('enc')
    if (fail) throw new Error('reject health change')
    return (await f.db.select().from(f.table).where('enc'))[0]
  })
  assert.equal((await change('first', 25)).participants[0].tankBusterUses, 1)
  assert.equal((await change('first', 25)).participants[0].tankBusterUses, 1, 'retry does not grant twice')
  assert.equal((await change('heal', 0)).participants[0].tankBusterUses, 1)
  assert.equal((await change('cross-again', 25)).participants[0].tankBusterUses, 2)
  assert.equal((await change('cross-two-more', 80)).participants[0].tankBusterUses, 4)
  await assert.rejects(change('rejected', 0, true), /reject health change/)
  assert.equal(f.state().participants[0].currentWounds, 80)
  assert.equal(f.state().participants[0].tankBusterUses, 4)
  assert.equal((await change('heal-again', 0)).participants[0].tankBusterUses, 4)
  assert.equal((await change('cross-all-again', 80)).participants[0].tankBusterUses, 7)
  const restarted = await f.run({ operationId: 'reset-combat' }, async context => {
    await f.db.update(f.table).set({ phase: 'ended' }).where('enc')
    return (await f.db.select().from(f.table).where('enc'))[0]
  })
  assert.equal(restarted.participants[0].tankBusterUses, 7)
  const fresh = await f.run({ operationId: 'new-combat' }, async context => {
    const participants = context.encounter.participants.map(p => ({ ...p, currentWounds: 0 }))
    await f.db.update(f.table).set({ phase: 'combat', participants }).where('enc')
    return { encounter: (await f.db.select().from(f.table).where('enc'))[0] }
  })
  assert.equal(fresh.encounter.participants[0].tankBusterUses, 0)
})

test('overlapping commands serialize and each reads the preceding committed action balance', async () => {
  const f = fixture(), gate = deferred(), began = deferred(), order = []
  const first = f.run({ operationId: 'first' }, async context => {
    order.push('first'); began.resolve(); await gate.promise
    return f.spend(context)
  })
  await began.promise
  const second = f.run({ operationId: 'second' }, async context => { order.push('second'); return f.spend(context) })
  await Promise.resolve(); await Promise.resolve()
  assert.deepEqual(order, ['first'])
  gate.resolve(); await Promise.all([first, second])
  assert.deepEqual(order, ['first', 'second'])
  assert.equal(f.state().participants[0].actionsRemaining.simple, 0)
  assert.equal(f.control.locks, 2)
})

test('same-operation retries return the receipt before revision checks and cannot double-spend', async () => {
  const f = fixture()
  const body = { operationId: 'retry', expectedRevision: 7, attackId: 'strike' }
  await f.run(body)
  const revision = f.state().revision
  const retried = await f.run(body)
  assert.equal(f.control.work, 1)
  assert.equal(f.state().revision, revision)
  assert.equal(retried.participants[0].actionsRemaining.simple, 1)
  await assert.rejects(f.run({ ...body, attackId: 'different' }), { statusCode: 409 })
  assert.equal(f.control.work, 1)
})

test('rejected revision and permission changes while queued perform no command writes', async () => {
  const f = fixture()
  await assert.rejects(f.run({ operationId: 'old', expectedRevision: 6 }), { statusCode: 409 })
  assert.equal(f.control.writes, 0); assert.equal(f.control.work, 0)
  const gate = deferred(), began = deferred()
  const first = f.run({ operationId: 'active' }, async context => { began.resolve(); await gate.promise; return f.spend(context) })
  await began.promise
  const queued = f.run({ operationId: 'revoked' })
  await Promise.resolve(); await Promise.resolve()
  f.control.allowed = false; gate.resolve()
  await first
  await assert.rejects(queued, { statusCode: 403 })
  assert.equal(f.control.work, 1)
})

test('transaction rollback discards resource writes and queued room/door publications', async () => {
  const f = fixture()
  await assert.rejects(f.run({ operationId: 'rollback' }, async context => {
    await f.spend(context)
    scopes.afterDatabaseCommit(() => { f.control.events.push('position') })
    scopes.afterDatabaseCommit(() => { f.control.events.push('door') })
    throw new Error('Later validation failed')
  }), /Later validation/)
  assert.equal(f.state().participants[0].actionsRemaining.simple, 2)
  assert.deepEqual(f.control.events, [])
  assert.equal(f.control.rolledBack, 1)
  assert.equal(f.state().participants[0].attackReceipts, undefined)
})

test('successful publications drain outside the transaction scope and cannot re-queue themselves', async () => {
  const f = fixture()
  await f.run({ operationId: 'commit' }, async context => {
    const result = await f.spend(context)
    assert.ok(scopes.scopedDatabase())
    assert.equal(scopes.afterDatabaseCommit(() => {
      assert.equal(scopes.scopedDatabase(), undefined)
      assert.equal(scopes.afterDatabaseCommit(() => { throw new Error('Should not queue') }), false)
      assert.equal(f.control.committed, 1)
      f.control.events.push('position')
    }), true)
    return result
  })
  assert.deepEqual(f.control.events, ['position'])
  assert.equal(f.control.committed, 1)
})
