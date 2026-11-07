import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const cache = loadTypeScript('server/utils/combatRecordCache.ts')
const types = loadTypeScript('types/index.ts')
const unexpected = () => { throw new Error('unexpected combat side effect') }
function deferred() {
  let resolve
  const promise = new Promise(done => { resolve = done })
  return { promise, resolve }
}

test('record and derived reads share pending work only inside an action, including nested resolution', async () => {
  let records = 0, derived = 0
  const read = () => cache.readCombatRecord('digimon', 'mon', async () => { records++; return [{ id: 'mon' }] })
  const stats = () => cache.readCombatDerivedStats('mon', async () => { derived++; return { cpu: 3 } })
  await cache.withCombatRecords(async () => {
    const rows = await Promise.all([read(), read(), cache.withCombatRecords(read)])
    assert.equal(rows[0], rows[1])
    await Promise.all([stats(), stats()])
  })
  assert.equal(records, 1)
  assert.equal(derived, 1)
  await cache.withCombatRecords(read)
  await read(); await read()
  assert.equal(records, 4, 'the next action and unscoped reads must query again')
})

test('overlapping actions never share entity records', async () => {
  const firstReady = deferred(), secondReady = deferred()
  const results = await Promise.all([
    cache.withCombatRecords(async () => {
      const first = await cache.readCombatRecord('digimon', 'same', async () => [{ id: 'same', value: 1 }])
      firstReady.resolve(); await secondReady.promise
      const next = await cache.readCombatRecord('digimon', 'same', unexpected)
      assert.equal(first, next)
      return next.value
    }),
    cache.withCombatRecords(async () => {
      await firstReady.promise
      const row = await cache.readCombatRecord('digimon', 'same', async () => [{ id: 'same', value: 2 }])
      secondReady.resolve()
      return row.value
    }),
  ])
  assert.deepEqual(results, [1, 2])
})

test('an existing bulk load primes both entity kinds without extra per-target queries', async () => {
  await cache.withCombatRecords(async () => {
    cache.primeCombatRecords('digimon', [{ id: 'mon', value: 1 }])
    cache.primeCombatRecords('tamer', [{ id: 'mon', value: 2 }])
    assert.equal((await cache.readCombatRecord('digimon', 'mon', unexpected)).value, 1)
    assert.equal((await cache.readCombatRecord('tamer', 'mon', unexpected)).value, 2)
  })
})

test('writes invalidate the entity and raw derived stats; a late old read cannot refill the cache', async () => {
  await cache.withCombatRecords(async () => {
    const old = deferred()
    const pending = cache.readCombatRecord('digimon', 'mon', () => old.promise)
    await cache.readCombatDerivedStats('mon', async () => ({ cpu: 1 }))
    cache.invalidateCombatRecord('digimon', 'mon')
    const fresh = await cache.readCombatRecord('digimon', 'mon', async () => [{ id: 'mon', value: 2 }])
    assert.equal((await cache.readCombatDerivedStats('mon', async () => ({ cpu: 2 }))).cpu, 2)
    old.resolve([{ id: 'mon', value: 1 }])
    await pending
    assert.equal(await cache.readCombatRecord('digimon', 'mon', unexpected), fresh)
  })
})

test('a failed read can be retried within the same action', async () => {
  await cache.withCombatRecords(async () => {
    await assert.rejects(cache.readCombatRecord('digimon', 'mon', async () => { throw new Error('offline') }), /offline/)
    assert.equal((await cache.readCombatRecord('digimon', 'mon', async () => [{ id: 'mon' }])).id, 'mon')
  })
})

function castHarness(caching = true) {
  const sharedCache = caching ? cache : {
    ...cache, withCombatRecords: run => run(),
    readCombatRecord: async (_kind, _id, query) => (await query())[0],
    readCombatDerivedStats: (_id, compute) => compute(),
  }
  const attack = { id: 'blast', name: 'Blast', type: 'damage', range: 'ranged', tags: ['Area Attack: Burst', 'Weapon I'] }
  const baseStats = { accuracy: 8, damage: 5, dodge: 1, armor: 2, health: 20 }
  const records = [
    { id: 'attacker', name: 'Attacker', baseStats, bonusStats: {}, stage: 'rookie', size: 'medium', attacks: [attack], qualities: [{ id: 'combat-monster' }, { id: 'weapons-expert', choiceId: 'cpu' }] },
    ...['one', 'two', 'three'].map(id => ({ id, name: id, baseStats, bonusStats: {}, stage: 'rookie', size: 'medium', attacks: [], qualities: [] })),
  ]
  const tables = { digimon: { id: 'digimon.id' }, tamers: { id: 'tamers.id' }, evolutionLines: {} }
  const calls = { records: 0, derived: 0 }
  const db = { select: () => ({ from: table => ({ where: async ({ value }) => {
    calls.records++
    assert.equal(table, tables.digimon)
    return records.filter(row => row.id === value)
  } }) }), update: unexpected }
  const common = { '../db': { db, ...tables }, 'drizzle-orm': { eq: (column, value) => ({ column, value }) }, './combatRecordCache': sharedCache }
  const support = loadTypeScriptWithMocks('server/utils/resolveSupportAttack.ts', {
    ...common,
    '../../types': { ...types, calculateDigimonDerivedStats: (...args) => { calls.derived++; return types.calculateDigimonDerivedStats(...args) } },
  })
  const damage = loadTypeScriptWithMocks('server/utils/computeAttackDamage.ts', {
    ...common, './resolveSupportAttack': support,
    './clashArmor': { getOutsideClashArmorBonus: async () => 0 }, './damageOverTime': { isImmuneToEffect: () => false },
  })
  const knockouts = { knockedOutEnemyIds: () => [], hasUnusedTimeControl: () => false, resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }) }
  const npc = loadTypeScriptWithMocks('server/utils/resolveNpcAttack.ts', {
    ...common, './computeAttackDamage': damage, './enemyKnockouts': knockouts,
    './guidingLight': { refreshGuidingLightForParticipants: unexpected }, './combatSpatial': { loadParticipantDigimon: unexpected },
    './pushPull': { computePushPull: unexpected }, './damageOverTime': { loadDamageOverTimeRules: unexpected },
  })
  const area = loadTypeScriptWithMocks('server/utils/resolveAreaIntercedeGroup.ts', {
    ...common, './resolveNpcAttack': npc, './enemyKnockouts': knockouts,
    '~/server/utils/resolveSupportAttack': support, './guidingLight': { refreshGuidingLightForParticipants: unexpected },
  })
  const participants = records.map(record => ({ id: record.id, type: 'digimon', entityId: record.id, isEnemy: record.id !== 'attacker', currentWounds: 0, maxWounds: 100, combatMonsterBonus: record.id === 'attacker' ? 2 : 0, activeEffects: [] }))
  const groupState = { id: 'group', data: { intercedeGroupId: 'cast', attackerId: 'attacker', attackerName: 'Attacker', attackId: 'blast', attackData: attack, accuracySuccesses: 3, accuracyDice: [6, 6, 6], originalTargetIds: ['one', 'two', 'three'], npcTargetIds: ['one', 'two', 'three'], claims: [] } }
  return {
    calls, records, support,
    run: () => area.resolveAreaIntercedeGroup({ groupState, participants: structuredClone(participants), battleLog: [], pendingRequests: [groupState], turnOrder: participants.map(p => p.id), round: 1, currentTurnIndex: 0, encounterId: 'encounter', database: db }),
  }
}

test('a real three-target area resolution drops entity reads from 18 to 4 and computes attacker derived stats once', async t => {
  t.mock.method(Math, 'random', () => 0)
  const uncached = castHarness(false), cached = castHarness()
  const before = await uncached.run(), after = await cached.run()
  const gameplayResult = result => ({ wounds: result.participants.map(p => [p.id, p.currentWounds, p.combatMonsterBonus]), log: result.battleLog.map(entry => [entry.actorId, entry.finalDamage, entry.dodgeSuccesses]), turnOrder: result.turnOrder })
  assert.deepEqual(gameplayResult(after), gameplayResult(before))
  const hits = after.battleLog.filter(entry => entry.action === 'Dodge')
  assert.equal(hits[0].finalDamage - hits[1].finalDamage, 2, 'the first hit consumes Combat Monster before later targets')
  assert.equal(uncached.calls.records, 18)
  assert.equal(cached.calls.records, 4)
  assert.equal(uncached.calls.derived, 3)
  assert.equal(cached.calls.derived, 1)
  await cached.run()
  assert.equal(cached.calls.records, 8, 'the next cast reads a fresh snapshot')
})

test('raw derived caching never caches live effects or exposes its mutable result', async () => {
  const { support, calls } = castHarness()
  await cache.withCombatRecords(async () => {
    const base = await support.getDigimonDerivedStats('attacker')
    const buffed = await support.getDigimonDerivedStats('attacker', { activeEffects: [{ name: 'Bastion', potency: 3 }] })
    assert.equal(buffed.cpu, base.cpu + 3)
    assert.equal(buffed.movement, base.movement + 3)
    assert.equal(buffed.woundBoxes, base.woundBoxes)
    assert.equal(buffed.stageBonus, base.stageBonus)
    buffed.cpu = 999
    const debuffed = await support.getDigimonDerivedStats('attacker', { activeEffects: [{ name: 'Debilitate', potency: 2 }] })
    assert.equal(debuffed.cpu, base.cpu - 2)
    assert.equal((await support.getDigimonDerivedStats('attacker')).cpu, base.cpu)
    assert.equal(calls.records, 1)
    assert.equal(calls.derived, 1)
  })
})
