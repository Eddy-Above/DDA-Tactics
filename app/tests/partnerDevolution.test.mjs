import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const cache = loadTypeScript('server/utils/combatRecordCache.ts')
const unexpected = () => { throw new Error('unexpected database access or write') }
const participant = overrides => ({
  type: 'digimon', entityId: 'current', evolutionLineId: 'line', woundsHistory: [], ...overrides,
})
const entry = (digimonId, evolvesFromIndex, overrides = {}) => ({
  digimonId, species: digimonId, stage: 'rookie', evolvesFromIndex, isUnlocked: true, ...overrides,
})
const sheet = (id, overrides = {}) => ({
  id, name: id, partnerId: 'owner-with-no-tamer-record', isEnemy: false, stage: 'rookie',
  baseStats: { health: 7 }, bonusStats: { health: 3 }, qualities: [], currentWounds: 4, ...overrides,
})

function fixture({
  chain = [entry('parent', null, { isUnlocked: false }), entry('sibling', 0), entry('current', 0)],
  currentStageIndex = 2,
  sheets = [sheet('current'), sheet('parent')],
  missingLine = false,
} = {}) {
  const tables = { digimon: { name: 'digimon', id: 'digimon.id' }, evolutionLines: { name: 'evolutionLines', id: 'evolutionLines.id' } }
  const rows = new Map(sheets.map(row => [row.id, row]))
  const reads = []
  const writes = []
  const database = {
    select: () => ({ from: table => ({ where: async ({ id }) => {
      reads.push([table.name, id])
      if (table === tables.evolutionLines) return missingLine ? [] : [{ id: 'line', chain, currentStageIndex }]
      if (table === tables.digimon) return rows.has(id) ? [rows.get(id)] : []
      assert.fail('devolution must not load a Tamer or any unrelated table')
    } }) }),
    update: table => ({ set: data => ({ where: async ({ id }) => {
      assert.equal(table, tables.evolutionLines)
      writes.push({ id, ...data })
    } }) }),
  }
  const helpers = loadTypeScriptWithMocks('server/utils/partnerDevolution.ts', {
    'drizzle-orm': { eq: (column, id) => ({ column, id }) },
    // The injected select-only transaction must be used, rather than this module's default DB.
    '../db': { ...tables, db: { select: unexpected, update: unexpected } },
    './combatRecordCache': cache,
  })
  return {
    ...helpers, database, rows, reads, writes,
    resolve: (actor = participant()) => helpers.resolveCombatDevolutionState(actor, database),
    auto: (actor, roster = [actor]) => helpers.autoDevolveParticipant(actor, roster, { round: 4, database }),
  }
}

test('saved combat history takes precedence for partners, NPCs and legacy rows without querying or mutating', async () => {
  const f = fixture()
  const older = Object.freeze({ entityId: 'oldest', stageIndex: 0, maxWounds: 5, wounds: 2 })
  const saved = Object.freeze({ entityId: 'saved', stageIndex: 1, maxWounds: 12, totalHealth: 7, wounds: 6 })
  for (const flags of [{}, { isEnemy: true }, { type: 'tamer', evolutionLineId: undefined }]) {
    const actor = Object.freeze(participant({ ...flags, woundsHistory: Object.freeze([older, saved]) }))
    assert.deepEqual(await f.resolve(actor), saved)
    assert.deepEqual(actor.woundsHistory, [older, saved])
  }
  assert.deepEqual(f.reads, [])
})

test('legacy history without saved wounds restores zero without falling through to a sheet', async () => {
  const f = fixture()
  const saved = { entityId: 'saved', stageIndex: 0, maxWounds: 6 }
  const actor = participant({ woundsHistory: [saved] })
  assert.deepEqual(await f.resolve(actor), { ...saved, wounds: 0 })
  assert.equal(Object.hasOwn(saved, 'wounds'), false)
  assert.deepEqual(f.reads, [])
})

test('a partner that entered combat evolved can return to its locked parent at index zero without a Tamer record', async () => {
  const f = fixture({ sheets: [sheet('current'), sheet('parent', { qualities: [{ id: 'digizoid-armor', choiceId: 'red' }] })] })
  const actor = Object.freeze(participant({ woundsHistory: Object.freeze([]) }))
  assert.deepEqual(await f.resolve(actor), { entityId: 'parent', stageIndex: 0, wounds: 4, totalHealth: 12, maxWounds: 14 })
  assert.deepEqual(actor.woundsHistory, [])
  assert.deepEqual(f.reads, [['digimon', 'current'], ['evolutionLines', 'line'], ['digimon', 'parent']])
})

test('the direct branch parent is used rather than the preceding array entry or a different branch', async () => {
  const f = fixture({ currentStageIndex: 3,
    chain: [entry('root', null), entry('parent', 0), entry('sibling', 0), entry('current', 1)],
  })
  const state = await f.resolve()
  assert.equal(state.entityId, 'parent')
  assert.equal(state.stageIndex, 1)
})

test('legacy JSON chains resolve the same parent and stored sheet wounds as parsed arrays', async () => {
  const chain = [entry('parent', null), entry('current', 0)]
  const parsed = fixture({ chain, currentStageIndex: 1 })
  const legacy = fixture({ chain: JSON.stringify(chain), currentStageIndex: 1 })
  assert.deepEqual(await legacy.resolve(), await parsed.resolve())
})

test('stale line indices locate the participant entity instead of devolving a different form', async () => {
  for (const currentStageIndex of [0, 1, -1, 99, 1.5]) {
    const f = fixture({ currentStageIndex })
    assert.equal((await f.resolve()).entityId, 'parent')
  }
})

test('a matching line index disambiguates repeated entity entries on different branches', async () => {
  const f = fixture({ currentStageIndex: 3,
    chain: [entry('parent-a', null), entry('parent-b', null), entry('current', 0), entry('current', 1)],
    sheets: [sheet('current'), sheet('parent-a'), sheet('parent-b')],
  })
  assert.equal((await f.resolve()).entityId, 'parent-b')
})

test('the stat builder includes base health, bonus health, Digizoid health and the record stage wound bonus', () => {
  const f = fixture()
  const bonuses = { red: 2, chrome: 1, gold: 1, obsidian: 1, black: 0, brown: 0, blue: 0 }
  for (const [choiceId, armorHealth] of Object.entries(bonuses)) {
    const record = sheet('parent', { stage: 'champion', qualities: [{ id: 'digizoid-armor', choiceId }], currentWounds: 9 })
    assert.deepEqual(f.buildCombatDevolutionState(record, 3, 'rookie'), {
      entityId: 'parent', stageIndex: 3, totalHealth: 10 + armorHealth, maxWounds: 15 + armorHealth, wounds: 9,
    })
  }
})

test('the stat builder retains saved zero wounds, defaults absent sheet values and uses a missing stage fallback', () => {
  const f = fixture()
  assert.equal(f.buildCombatDevolutionState(sheet('parent', { currentWounds: 0 }), 0).wounds, 0)
  assert.deepEqual(f.buildCombatDevolutionState(sheet('parent', {
    baseStats: null, bonusStats: null, qualities: null, stage: undefined, currentWounds: undefined,
  }), 0, 'ultimate'), { entityId: 'parent', stageIndex: 0, totalHealth: 0, maxWounds: 7, wounds: 0 })
})

test('non-Digimon, explicit enemies and participants without a line do not attempt fallback reads', async () => {
  for (const overrides of [{ type: 'tamer' }, { isEnemy: true }, { evolutionLineId: undefined }, { evolutionLineId: '' }]) {
    const f = fixture()
    assert.equal(await f.resolve(participant(overrides)), null)
    assert.deepEqual(f.reads, [])
  }
})

test('missing, unowned and enemy current sheets cannot gain a parent fallback', async () => {
  for (const current of [null, sheet('current', { partnerId: null }), sheet('current', { partnerId: '' }),
    sheet('current', { partnerId: '   ' }), sheet('current', { isEnemy: true })]) {
    const f = fixture({ sheets: current ? [current, sheet('parent')] : [sheet('parent')] })
    assert.equal(await f.resolve(), null)
    assert.deepEqual(f.reads, [['digimon', 'current']])
  }
})

test('a missing line, malformed JSON and non-array chains have no fallback', async () => {
  for (const overrides of [{ missingLine: true }, { chain: 'not-json' }, { chain: 'null' }, { chain: '{}' }, { chain: null }]) {
    const f = fixture(overrides)
    assert.equal(await f.resolve(), null)
    assert.deepEqual(f.reads, [['digimon', 'current'], ['evolutionLines', 'line']])
  }
})

test('roots, absent current entries and invalid direct parents do not fall back to another form', async () => {
  for (const chain of [
    [entry('current', null)], [entry('parent', null)], [entry('parent', null), entry('current', 99)],
    [entry('parent', null), entry('current', -1)], [entry('parent', null), entry('current', 0.5)],
    [entry('parent', null), entry('current', 1)], [null, entry('current', 0)],
    [entry('', null), entry('current', 0)], [entry('   ', null), entry('current', 0)],
  ]) {
    const f = fixture({ chain, currentStageIndex: 1 })
    assert.equal(await f.resolve(), null)
    assert.equal(f.reads.length, 2)
  }
})

test('a linked parent must exist in the library', async () => {
  const f = fixture({ sheets: [sheet('current')] })
  assert.equal(await f.resolve(), null)
  assert.deepEqual(f.reads.at(-1), ['digimon', 'parent'])
})

test('current and parent Digimon reads share the active combat cache and respect request boundaries', async () => {
  const f = fixture()
  await cache.withCombatRecords(async () => {
    cache.primeCombatRecords('digimon', [...f.rows.values()])
    assert.equal((await f.resolve()).wounds, 4)
    assert.deepEqual(f.reads, [['evolutionLines', 'line']])
  })
  f.rows.set('parent', sheet('parent', { currentWounds: 8 }))
  assert.equal((await f.resolve()).wounds, 8)
  assert.deepEqual(f.reads.slice(1), [['digimon', 'current'], ['evolutionLines', 'line'], ['digimon', 'parent']])
})

test('missing parent records are negatively cached within the current combat action', async () => {
  const f = fixture({ sheets: [sheet('current')] })
  await cache.withCombatRecords(async () => {
    assert.equal(await f.resolve(), null)
    assert.equal(await f.resolve(), null)
  })
  assert.deepEqual(f.reads.filter(([table]) => table === 'digimon'), [['digimon', 'current'], ['digimon', 'parent']])
})

const knockedOut = overrides => ({
  id: 'actor', type: 'digimon', entityId: 'current', evolutionLineId: 'line',
  currentWounds: 30, maxWounds: 30, totalHealth: 25, combatMonsterBonus: 19,
  actionsRemaining: { simple: 1 }, activeEffects: [{ name: 'Shield', potency: 3 }],
  currentStance: 'aggressive', npcStageIndex: 99, ...overrides,
})

test('automatic partner devolution restores one saved state, synchronizes its line and preserves unrelated combat state', async () => {
  const f = fixture({ sheets: [sheet('current'), sheet('parent', { qualities: [{ id: 'combat-monster' }] })] })
  const older = { entityId: 'oldest', stageIndex: 0, maxWounds: 5, wounds: 0 }
  const saved = { entityId: 'parent', stageIndex: 1, maxWounds: 9, totalHealth: 6, wounds: 3 }
  const history = [older, saved]
  const actor = knockedOut({ woundsHistory: history, seq: 2 })
  const effects = actor.activeEffects
  const actions = actor.actionsRemaining
  const peer = { id: 'other', type: 'digimon', entityId: 'current', seq: 1 }
  const log = await f.auto(actor, [actor, peer])
  assert.equal(actor.entityId, 'parent')
  assert.equal(actor.currentWounds, 3)
  assert.equal(actor.maxWounds, 9)
  assert.equal(actor.totalHealth, 6)
  assert.equal(actor.combatMonsterBonus, 6)
  assert.equal(Object.hasOwn(actor, 'npcStageIndex'), false)
  assert.deepEqual(actor.woundsHistory, [older])
  assert.notEqual(actor.woundsHistory, history)
  assert.deepEqual(history, [older, saved], 'the original shared history array remains untouched')
  assert.equal(actor.activeEffects, effects)
  assert.equal(actor.actionsRemaining, actions)
  assert.equal(actor.currentStance, 'aggressive')
  assert.deepEqual(f.writes.map(({ id, currentStageIndex }) => ({ id, currentStageIndex })), [{ id: 'line', currentStageIndex: 1 }])
  assert.equal(log.actorId, actor.id)
  assert.equal(log.actorName, 'current', 'partners never receive duplicate-name numbers')
  assert.equal(log.round, 4)
  assert.deepEqual(log.effects, ['Auto-Devolve'])
  assert.ok(log.action.includes('parent'))
})

test('automatic no-history partners use saved sheet wounds without fabricating history or rereading their records', async () => {
  const f = fixture()
  const actor = knockedOut()
  const log = await f.auto(actor)
  assert.equal(actor.entityId, 'parent')
  assert.equal(actor.currentWounds, 4)
  assert.equal(actor.totalHealth, 10)
  assert.equal(actor.maxWounds, 12)
  assert.equal(actor.combatMonsterBonus, 0)
  assert.equal(Object.hasOwn(actor, 'woundsHistory'), false)
  assert.equal(Object.hasOwn(actor, 'npcStageIndex'), false)
  assert.equal(log.result, 'Wounds restored to 4')
  assert.deepEqual(f.reads, [['digimon', 'current'], ['evolutionLines', 'line'], ['digimon', 'parent']])
  assert.equal(f.writes.length, 1, 'all writes use the supplied transaction, not the default database')
})

test('automatic NPC devolution keeps a local stage, legacy totals and enemy-only numbered names without shared-line writes', async () => {
  const f = fixture({ sheets: [sheet('current', { partnerId: null, isEnemy: true }), sheet('parent')] })
  const actor = knockedOut({ isEnemy: true, seq: 2,
    woundsHistory: [{ entityId: 'parent', stageIndex: 0, maxWounds: 8, wounds: 1 }],
  })
  const log = await f.auto(actor, [actor, { id: 'other', type: 'digimon', entityId: 'current', isEnemy: true, seq: 1 }])
  assert.equal(actor.entityId, 'parent')
  assert.equal(actor.npcStageIndex, 0)
  assert.equal(actor.totalHealth, 25, 'legacy history without totalHealth preserves the existing value')
  assert.equal(actor.combatMonsterBonus, 0)
  assert.equal(log.actorName, 'current 2', 'the old form determines the name before mutation')
  assert.deepEqual(f.writes, [])
})

test('explicit enemies, enemy library records and unowned Digimon keep NPC stage behavior even when history exists', async () => {
  for (const [current, flags] of [
    [sheet('current'), { isEnemy: true }],
    [sheet('current', { isEnemy: true }), {}],
    [sheet('current', { partnerId: null }), { isEnemy: false }],
  ]) {
    const f = fixture({ sheets: [current, sheet('parent')] })
    const actor = knockedOut({ ...flags, woundsHistory: [{ entityId: 'parent', stageIndex: 0, maxWounds: 8, wounds: 0 }] })
    assert.ok(await f.auto(actor))
    assert.equal(actor.npcStageIndex, 0)
    assert.deepEqual(f.writes, [])
  }
})

test('automatic devolution consumes exactly one history state even when that restored state is already knocked out', async () => {
  const f = fixture()
  const older = { entityId: 'oldest', stageIndex: 0, maxWounds: 5, wounds: 0 }
  const actor = knockedOut({ woundsHistory: [older, { entityId: 'parent', stageIndex: 1, maxWounds: 12, wounds: 12 }] })
  assert.ok(await f.auto(actor))
  assert.equal(actor.entityId, 'parent')
  assert.equal(actor.currentWounds, 12)
  assert.deepEqual(actor.woundsHistory, [older])
  assert.ok(!f.reads.some(([, id]) => id === 'oldest'))
  assert.equal(f.writes.length, 1)
})

test('automatic devolution guards missing legacy wound totals and non-knockouts without queries', async () => {
  for (const overrides of [
    { type: 'tamer' }, { evolutionLineId: undefined }, { currentWounds: 29 },
    { currentWounds: undefined }, { maxWounds: undefined }, { maxWounds: 0 },
    { maxWounds: -1 }, { currentWounds: Number.NaN }, { maxWounds: Number.NaN },
  ]) {
    const f = fixture()
    const actor = knockedOut(overrides)
    const before = structuredClone(actor)
    assert.equal(await f.auto(actor), null)
    assert.deepEqual(actor, before)
    assert.deepEqual(f.reads, [])
    assert.deepEqual(f.writes, [])
  }
})

test('unresolvable automatic devolution leaves the original participant and history untouched', async () => {
  const f = fixture({ sheets: [sheet('current', { partnerId: null })] })
  const actor = knockedOut({ woundsHistory: [] })
  const history = actor.woundsHistory
  const before = structuredClone(actor)
  assert.equal(await f.auto(actor), null)
  assert.deepEqual(actor, before)
  assert.equal(actor.woundsHistory, history)
  assert.deepEqual(f.writes, [])
})

test('a failed shared-line write leaves every participant field and saved history unchanged', async () => {
  const f = fixture()
  const actor = knockedOut({ woundsHistory: [{ entityId: 'parent', stageIndex: 0, maxWounds: 8, wounds: 1 }] })
  const before = structuredClone(actor)
  const history = actor.woundsHistory
  f.database.update = () => ({ set: () => ({ where: async () => {
    assert.deepEqual(actor, before, 'the line write precedes all combat mutation')
    assert.equal(actor.woundsHistory, history)
    throw new Error('transaction rolled back')
  } }) })
  await assert.rejects(f.auto(actor), /transaction rolled back/)
  assert.deepEqual(actor, before)
  assert.equal(actor.woundsHistory, history)
})

test('a failed new-form read leaves history available and performs no line write', async () => {
  const f = fixture()
  const actor = knockedOut({ woundsHistory: [{ entityId: 'parent', stageIndex: 0, maxWounds: 8, wounds: 1 }] })
  const before = structuredClone(actor)
  const history = actor.woundsHistory
  const select = f.database.select
  f.database.select = () => ({ from: table => ({ where: async filter => {
    if (filter.id === 'parent') throw new Error('record lookup failed')
    return select().from(table).where(filter)
  } }) })
  await assert.rejects(f.auto(actor), /record lookup failed/)
  assert.deepEqual(actor, before)
  assert.equal(actor.woundsHistory, history)
  assert.deepEqual(f.writes, [])
})

test('automatic calls join an outer record cache and read fresh records in a later request', async () => {
  const f = fixture()
  await cache.withCombatRecords(async () => {
    cache.primeCombatRecords('digimon', [...f.rows.values()])
    assert.ok(await f.auto(knockedOut()))
    assert.deepEqual(f.reads, [['evolutionLines', 'line']])
  })
  f.rows.set('parent', sheet('parent', { currentWounds: 7 }))
  f.reads.length = 0
  const actor = knockedOut()
  assert.ok(await f.auto(actor))
  assert.equal(actor.currentWounds, 7)
  assert.deepEqual(f.reads, [['digimon', 'current'], ['evolutionLines', 'line'], ['digimon', 'parent']])
})
