import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

const copy = value => structuredClone(value)
const position = x => ({ x, y: 0, z: 0 })
const unit = (id, overrides = {}) => ({
  id, type: 'digimon', entityId: id, currentWounds: 0, maxWounds: 30,
  activeEffects: [], actionsRemaining: { simple: 2 }, ...overrides,
})
const record = (id, overrides = {}) => ({
  id, name: id, stage: 'rookie', size: 'medium', qualities: [], partnerId: null,
  baseStats: { accuracy: 2, damage: 3, dodge: 4, armor: 0, health: 5 }, ...overrides,
})
const effect = name => ({ id: name, name, type: 'debuff', duration: 2, source: 'test', potency: 1 })

// Every real helper receives the same fake DB and the same actual request-cache instance.
// This exercises the handler's scope, rather than priming a separate cache only in the test.
function fixture({ participants = [unit('source'), unit('ally')], phase = 'combat', map = true, records, tamers, rules = {} } = {}) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.id
  globalThis.readBody = async event => copy(event.body)
  globalThis.createError = details => Object.assign(new Error(details.message), details)

  const tables = Object.fromEntries(['encounters', 'campaigns', 'digimon', 'tamers', 'maps', 'evolutionLines']
    .map(name => [name, { name, id: { table: name } }]))
  const rows = {
    encounters: { encounter: {
      id: 'encounter', campaignId: 'campaign', phase, mapId: map ? 'map' : null,
      participants: copy(participants), turnOrder: participants.map(p => p.id), currentTurnIndex: 0,
      round: 1, battleLog: [], pendingRequests: [], intercedeOptOuts: {},
    } },
    campaigns: { campaign: { id: 'campaign', level: 'standard', rulesSettings: rules } },
    digimon: Object.fromEntries((records ?? [record('source', { partnerId: 'owner' }), record('ally')]).map(row => [row.id, row])),
    tamers: Object.fromEntries((tamers ?? [{ id: 'owner', attributes: { charisma: 5 }, xpBonuses: null }]).map(row => [row.id, row])),
    maps: { map: {
      id: 'map', dimensions: { width: 30, depth: 30, height: 10 },
      groundTiles: Array.from({ length: 12 }, (_, x) => ({ x, y: 0, z: 0, terrain: 'grass' })),
      spaceTiles: [], voxels: [], walls: [], doors: [], ceilings: [], stairs: [],
    } },
    evolutionLines: {},
  }
  const positions = map ? Object.fromEntries(participants.map((p, index) => [p.id, position(index)])) : {}
  const reads = []
  const writes = []
  const patches = []
  const sql = {
    eq: (column, value) => ({ column, value }),
    inArray: (column, values) => ({ column, values }),
  }
  const dbModule = {
    ...tables,
    db: {
      select: () => ({ from: table => ({ where: async filter => {
        const ids = filter.values ?? [filter.value]
        reads.push({ table: table.name, ids: [...ids], bulk: !!filter.values })
        return ids.flatMap(id => rows[table.name][id] ? [copy(rows[table.name][id])] : [])
      } }) }),
      update: table => ({ set: data => ({ where: async filter => {
        writes.push({ table: table.name, id: filter.value, data: copy(data) })
        rows[table.name][filter.value] = { ...rows[table.name][filter.value], ...copy(data) }
      } }) }),
    },
  }
  const cache = loadTypeScriptWithMocks('server/utils/combatRecordCache.ts', {})
  const common = { 'drizzle-orm': sql, '../db': dbModule, './combatRecordCache': cache }
  const support = loadTypeScriptWithMocks('server/utils/resolveSupportAttack.ts', common)
  const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', {
    ...common, './resolveSupportAttack': support,
  })
  const context = loadTypeScriptWithMocks('server/utils/combatContext.ts', common)
  const devolution = loadTypeScriptWithMocks('server/utils/partnerDevolution.ts', common)
  const room = {
    getRoomPositions: async () => copy(positions),
    getRoomSnapshot: async () => ({ participantPositions: copy(positions), destructibleStates: [] }),
    broadcastPositionPatch: async (_id, patch) => { patches.push(copy(patch)); Object.assign(positions, copy(patch)) },
    broadcast: () => assert.fail('PUT must not broadcast an independent aura write'),
  }
  const actualGuidingLight = loadTypeScriptWithMocks('server/utils/guidingLight.ts', {
    ...common, './combatSpatial': spatial, './resolveSupportAttack': support,
    './combatContext': context, './encounterRoom': room,
    './encounterPayload': { buildEncounterPayload: () => assert.fail('unexpected standalone aura persistence') },
  })
  const auraCalls = []
  const guidingLight = {
    ...actualGuidingLight,
    applyGuidingLightAuras: async (...args) => {
      auraCalls.push(copy({ participants: args[0], positions: args[1] }))
      return actualGuidingLight.applyGuidingLightAuras(...args)
    },
  }
  const gravity = loadTypeScriptWithMocks('server/utils/endOfTurnGravity.ts', {
    './combatSpatial': spatial, './guidingLight': guidingLight, './encounterRoom': room,
  })
  const roundStart = loadTypeScriptWithMocks('server/utils/roundStartQualityTriggers.ts', { './combatSpatial': spatial })
  const encounterStart = loadTypeScriptWithMocks('server/utils/encounterStartTriggers.ts', { './combatSpatial': spatial })
  const damageOverTime = loadTypeScriptWithMocks('server/utils/damageOverTime.ts', {
    ...common, './combatSpatial': spatial, './resolveSupportAttack': support, './encounterRoom': room,
  })
  const knockouts = loadTypeScriptWithMocks('server/utils/enemyKnockouts.ts', {
    ...common, './combatSpatial': spatial, './resolveSupportAttack': support,
    './partnerDevolution': devolution,
    './endOfTurnGravity': gravity, './roundStartQualityTriggers': roundStart,
    './damageOverTime': damageOverTime, './guidingLight': guidingLight,
  })
  const put = loadTypeScriptWithMocks('server/api/encounters/[id].put.ts', {
    'drizzle-orm': sql, '../../db': dbModule,
    '../../utils/combatRecordCache': cache, '../../utils/combatSpatial': spatial,
    '../../utils/partnerDevolution': devolution,
    '../../utils/combatContext': context, '../../utils/encounterRoom': room,
    '../../utils/endOfTurnGravity': gravity, '../../utils/roundStartQualityTriggers': roundStart,
    '../../utils/encounterStartTriggers': encounterStart, '../../utils/guidingLight': guidingLight,
    '../../utils/damageOverTime': damageOverTime, '../../utils/enemyKnockouts': knockouts,
    '../../utils/intercedeOptOuts': { clearTemporaryPasses: () => assert.fail('unexpected pass cleanup') },
  }).default
  return {
    rows, positions, reads, writes, patches, auraCalls, cache, spatial, knockouts,
    put: body => put({ id: 'encounter', body }),
    state: () => copy(rows.encounters.encounter),
    entityReads: kind => reads.filter(read => read.table === kind),
  }
}

function assertOneBatch(f, kind, ids) {
  const reads = f.entityReads(kind)
  assert.equal(reads.length, ids.length ? 1 : 0, `${kind} query count`)
  if (!ids.length) return
  assert.equal(reads[0].bulk, true)
  assert.deepEqual(reads[0].ids.toSorted(), [...new Set(ids)].toSorted())
  assert.equal(reads[0].ids.length, new Set(ids).size, 'duplicate instances/forms must not duplicate batch IDs')
}

test('ordinary End Turn shares one batch across map gravity and aura, preserving duplicate participant state', async () => {
  const participants = [unit('source'), unit('ally-a', { entityId: 'ally', currentWounds: 2 }),
    unit('ally-b', { entityId: 'ally', currentWounds: 7 }), unit('missing-a', { entityId: 'missing' }),
    unit('missing-b', { entityId: 'missing' }), unit('standalone', { type: 'tamer', entityId: 'unrelated' })]
  const f = fixture({ participants })
  const result = await f.put({ participants, currentTurnIndex: 1 })
  assertOneBatch(f, 'digimon', ['source', 'ally', 'missing'])
  assertOneBatch(f, 'tamers', ['owner'])
  assert.equal(result.participants.find(p => p.id === 'source').activeEffects.find(e => e.name === 'Guiding Light (Focus)').potency, 2)
  for (const id of ['ally-a', 'ally-b']) assert.ok(result.participants.find(p => p.id === id).activeEffects.some(e => e.name === 'Guiding Light'))
  assert.equal(result.participants.find(p => p.id === 'ally-a').currentWounds, 2)
  assert.equal(result.participants.find(p => p.id === 'ally-b').currentWounds, 7)
  assert.deepEqual(result.participants.find(p => p.id === 'missing-a').activeEffects, [])
  assert.deepEqual(f.patches, [])
})

test('round wrap shares records across Poison, stationary Burn, quality triggers and aura', async () => {
  const participants = [unit('source', { activeEffects: [effect('Poison')] }), unit('ally', { activeEffects: [effect('Burn')] })]
  const f = fixture({ participants, records: [record('source', { partnerId: 'owner' }),
    record('ally', { qualities: [{ id: 'digizoid-armor', choiceId: 'brown' }] })] })
  f.rows.encounters.encounter.currentTurnIndex = 1
  const result = await f.put({ participants, currentTurnIndex: 0, round: 2 })
  assertOneBatch(f, 'digimon', ['source', 'ally'])
  assertOneBatch(f, 'tamers', ['owner'])
  assert.equal(result.round, 2)
  assert.ok(result.participants[0].currentWounds > 0)
  assert.ok(result.participants[1].currentWounds > 0)
  assert.equal(result.participants[0].activeEffects.find(e => e.name === 'Poison').duration, 1)
  assert.equal(result.participants[1].activeEffects.find(e => e.name === 'Burn').duration, 1)
  assert.equal(result.participants[1].brownArmorAutoDodgeAvailable, true)
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Poison')))
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Burn')))
})

test('preload includes both rosters and every history form, reusing the restored form and negative results', async () => {
  const history = [
    { entityId: 'restored', maxWounds: 5, wounds: 1, totalHealth: 3, stageIndex: 0 },
    { entityId: 'missing', maxWounds: 5, stageIndex: 1 },
    { entityId: 'restored', maxWounds: 5, wounds: 1, totalHealth: 3, stageIndex: 0 },
  ]
  const stored = [unit('source', { entityId: 'old', woundsHistory: history }), unit('ally'), unit('missing-unit', { entityId: 'missing' })]
  const incoming = copy(stored)
  Object.assign(incoming[0], { entityId: 'evolved', currentWounds: 30, evolutionLineId: 'line', combatMonsterBonus: 9 })
  const f = fixture({ participants: stored, records: [record('old'), record('evolved', { partnerId: 'owner' }), record('restored', {
    partnerId: 'owner', qualities: [{ id: 'combat-monster' }],
  }), record('ally')] })
  const result = await f.put({ participants: incoming, currentTurnIndex: 1 })
  assertOneBatch(f, 'digimon', ['old', 'evolved', 'restored', 'missing', 'ally'])
  assertOneBatch(f, 'tamers', ['owner'])
  const restored = result.participants.find(p => p.id === 'source')
  assert.equal(restored.entityId, 'restored')
  assert.equal(restored.currentWounds, 1)
  assert.equal(restored.combatMonsterBonus, 3, 'restored record, rather than evolved record, determines the cap')
  assert.equal(restored.woundsHistory.length, 2)
  assert.ok(result.participants.find(p => p.id === 'ally').activeEffects.some(e => e.name === 'Guiding Light'), 'restored partner ownership is used by the final aura')
  assert.deepEqual(f.writes.filter(write => write.table === 'evolutionLines').map(write => write.data.currentStageIndex), [0])
})

test('a no-map round wrap batches missing/shared partner records and still runs round resets', async () => {
  const participants = [unit('source'), unit('other'), unit('other-copy', { entityId: 'other' })]
  const f = fixture({ participants, map: false, records: [record('source', { partnerId: 'absent-owner' }),
    record('other', { partnerId: 'absent-owner', qualities: [{ id: 'digizoid-armor', choiceId: 'brown' }] })] })
  f.rows.encounters.encounter.currentTurnIndex = 2
  const result = await f.put({ participants, currentTurnIndex: 0, round: 2 })
  assertOneBatch(f, 'digimon', ['source', 'other'])
  assertOneBatch(f, 'tamers', ['absent-owner'])
  assert.equal(result.participants[1].brownArmorAutoDodgeAvailable, true)
  assert.equal(result.participants[2].brownArmorAutoDodgeAvailable, true)
  assert.deepEqual(result.participantPositions, {})
})

test('metadata-only PUTs perform no combat record reads', async () => {
  const f = fixture()
  const result = await f.put({ name: 'Renamed' })
  assert.equal(result.name, 'Renamed')
  assertOneBatch(f, 'digimon', [])
  assertOneBatch(f, 'tamers', [])
})

test('preload skips invalid legacy history entries and unrelated Tamer histories', async () => {
  const participants = [unit('source', { woundsHistory: [null, {}, { entityId: '' }, { entityId: 7 }] }),
    unit('tamer', { type: 'tamer', woundsHistory: [{ entityId: 'not-a-digimon' }] }),
    unit('ally', { woundsHistory: 'legacy' })]
  const f = fixture({ participants, map: false })
  await f.put({ participants, currentTurnIndex: 1 })
  assertOneBatch(f, 'digimon', ['source', 'ally'])
  assertOneBatch(f, 'tamers', ['owner'])
})

test('a fall keeps both intermediate and final aura refreshes while sharing the entity batches', async () => {
  const f = fixture()
  f.positions.ally.y = 8
  const result = await f.put({ participants: f.state().participants, currentTurnIndex: 1 })
  assertOneBatch(f, 'digimon', ['source', 'ally'])
  assertOneBatch(f, 'tamers', ['owner'])
  assert.equal(f.auraCalls.length, 2)
  assert.deepEqual(f.patches, [{ ally: position(1) }])
  assert.ok(result.battleLog.some(entry => entry.action === 'Fall'))
  assert.ok(result.participants[1].currentWounds > 0)
  assert.ok(result.participants[1].activeEffects.some(e => e.name === 'Guiding Light'))
})

test('combat start without an incoming roster preloads existing partners for start triggers and aura', async () => {
  const f = fixture({ phase: 'setup' })
  const result = await f.put({ phase: 'combat', round: 1 })
  assertOneBatch(f, 'digimon', ['source', 'ally'])
  assertOneBatch(f, 'tamers', ['owner'])
  assert.equal(result.participants[0].strikeFastReady, false)
  assert.ok(result.participants[1].activeEffects.some(e => e.name === 'Guiding Light'))
})

test('card movement partner guard uses the preloaded Digimon record', async () => {
  const participants = [unit('tamer', { type: 'tamer', entityId: 'owner' }), unit('source')]
  const f = fixture({ participants, map: false })
  participants[1].actionsRemaining.simple = 1
  const result = await f.put({ participants, movementActionParticipantId: 'source' })
  assertOneBatch(f, 'digimon', ['source'])
  assertOneBatch(f, 'tamers', ['owner'])
  assert.equal(result.participants[1].lastMovedRound, 1)
  assert.equal(result.participants[1].lastMovedTurnKey, '1:0')
})

test('a later PUT reads fresh records and removes an aura whose owner changed', async () => {
  const f = fixture()
  const first = await f.put({ participants: f.state().participants, currentTurnIndex: 1 })
  assert.ok(first.participants[1].activeEffects.some(e => e.name === 'Guiding Light'))
  f.rows.digimon.source.partnerId = 'new-owner'
  f.rows.tamers['new-owner'] = { id: 'new-owner', attributes: { charisma: 0 }, xpBonuses: null }
  f.reads.length = 0
  const second = await f.put({ participants: first.participants, currentTurnIndex: 0 })
  assertOneBatch(f, 'digimon', ['source', 'ally'])
  assertOneBatch(f, 'tamers', ['new-owner'])
  assert.ok(second.participants.every(p => !p.activeEffects.some(e => e.name.startsWith('Guiding Light'))))
})

test('enemy auto-devolution single reads reuse the bulk history records in the same scope', async () => {
  const participants = [unit('enemy', { isEnemy: true, entityId: 'evolved', currentWounds: 30,
    evolutionLineId: 'line', combatMonsterBonus: 8,
    woundsHistory: [{ entityId: 'restored', stageIndex: 0, maxWounds: 6, totalHealth: 4, wounds: 2 }] })]
  const f = fixture({ participants, map: false, records: [record('evolved', { name: 'Large enemy' }),
    record('restored', { name: 'Small enemy', qualities: [{ id: 'combat-monster' }] })] })
  const result = await f.cache.withCombatRecords(async () => {
    await f.spatial.loadParticipantDigimon([...participants, { type: 'digimon', entityId: 'restored' }])
    return f.knockouts.resolveEnemyKnockouts({ participants, turnOrder: ['enemy'], currentTurnIndex: 0, round: 1 }, ['enemy'])
  })
  assertOneBatch(f, 'digimon', ['evolved', 'restored'])
  assert.equal(result.participants[0].entityId, 'restored')
  assert.equal(result.participants[0].combatMonsterBonus, 4)
  assert.ok(result.logEntries[0].action.includes('Small enemy'))
  assert.equal(result.logEntries[0].actorName, 'Large enemy')
})


test('a partner entering above Rookie devolves through each available parent with saved sheet wounds', async () => {
  const participant = unit('partner', { entityId: 'ultimate', evolutionLineId: 'line', npcStageIndex: 99 })
  const f = fixture({ participants: [participant], map: false, records: [
    record('ultimate', { stage: 'ultimate', partnerId: 'owner' }),
    record('champion', { stage: 'champion', partnerId: 'owner', currentWounds: 2,
      baseStats: { accuracy: 2, damage: 3, dodge: 4, armor: 0, health: 8 } }),
    record('rookie', { partnerId: 'owner', currentWounds: 3 }),
  ] })
  f.rows.evolutionLines.line = { id: 'line', currentStageIndex: 2, chain: [
    { species: 'Rookie', digimonId: 'rookie', stage: 'rookie', evolvesFromIndex: null, isUnlocked: true },
    { species: 'Champion', digimonId: 'champion', stage: 'champion', evolvesFromIndex: 0, isUnlocked: false },
    { species: 'Ultimate', digimonId: 'ultimate', stage: 'ultimate', evolvesFromIndex: 1, isUnlocked: true },
  ] }
  const first = await f.put({ participants: [{ ...participant, currentWounds: participant.maxWounds }] })
  assert.equal(first.participants[0].id, 'partner')
  assert.equal(first.participants[0].entityId, 'champion')
  assert.equal(first.participants[0].currentWounds, 2)
  assert.equal(first.participants[0].totalHealth, 8)
  assert.equal(first.participants[0].npcStageIndex, undefined)
  assert.equal(f.rows.evolutionLines.line.currentStageIndex, 1)
  const second = await f.put({ participants: first.participants.map(p => ({ ...p, currentWounds: p.maxWounds })) })
  assert.equal(second.participants[0].entityId, 'rookie')
  assert.equal(second.participants[0].currentWounds, 3)
  assert.equal(second.participants[0].maxWounds, 7)
  assert.equal(second.participants[0].totalHealth, 5)
  assert.equal(f.rows.evolutionLines.line.currentStageIndex, 0)
  const root = await f.put({ participants: second.participants.map(p => ({ ...p, currentWounds: p.maxWounds })) })
  assert.equal(root.participants[0].entityId, 'rookie')
  assert.equal(root.participants[0].currentWounds, 7)
  assert.deepEqual(root.turnOrder, ['partner'])
})

test('a no-history partner knocked out by turn-end Poison restores its linked parent in that save', async () => {
  const participant = unit('partner', { entityId: 'champion', maxWounds: 1,
    evolutionLineId: 'line', activeEffects: [effect('Poison')] })
  const f = fixture({ participants: [participant, unit('ally')], map: false,
    rules: { eddySoulRules: { poisonTicksAtTurnEnd: true } }, records: [
      record('champion', { stage: 'champion', partnerId: 'owner' }),
      record('rookie', { partnerId: 'owner', currentWounds: 1 }), record('ally'),
    ] })
  f.rows.evolutionLines.line = { id: 'line', currentStageIndex: 1, chain: [
    { species: 'Rookie', digimonId: 'rookie', stage: 'rookie', evolvesFromIndex: null, isUnlocked: true },
    { species: 'Champion', digimonId: 'champion', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
  ] }
  const result = await f.put({ participants: [participant, unit('ally')], currentTurnIndex: 1 })
  assert.equal(result.participants[0].entityId, 'rookie')
  assert.equal(result.participants[0].currentWounds, 1)
  assert.equal(f.rows.evolutionLines.line.currentStageIndex, 0)
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Poison')))
})

test('a turn-end NPC devolution changes only its local stage and restores one form even if that form is already knocked out', async () => {
  const history = [
    { entityId: 'rookie', stageIndex: 0, maxWounds: 7, wounds: 1, totalHealth: 5 },
    { entityId: 'champion', stageIndex: 1, maxWounds: 8, wounds: 8 },
  ]
  const npc = unit('npc', {
    entityId: 'ultimate', isEnemy: true, evolutionLineId: 'shared-line', npcStageIndex: 2,
    currentWounds: 0, maxWounds: 1, totalHealth: 15, combatMonsterBonus: 10,
    woundsHistory: history, activeEffects: [effect('Poison')],
  })
  const f = fixture({ participants: [npc, unit('ally')], map: false,
    rules: { eddySoulRules: { poisonTicksAtTurnEnd: true } }, records: [
      record('ultimate', { isEnemy: true }),
      record('champion', { isEnemy: true, qualities: [{ id: 'combat-monster' }] }),
      record('rookie', { isEnemy: true }), record('ally'),
    ] })
  f.rows.evolutionLines['shared-line'] = { id: 'shared-line', currentStageIndex: 2 }
  const result = await f.put({ participants: [npc, unit('ally')], currentTurnIndex: 1 })
  const restored = result.participants.find(p => p.id === 'npc')
  assert.equal(restored.entityId, 'champion')
  assert.equal(restored.currentWounds, 8)
  assert.equal(restored.maxWounds, 8)
  assert.equal(restored.totalHealth, 15, 'legacy history without a health snapshot preserves the prior value')
  assert.equal(restored.combatMonsterBonus, 8)
  assert.equal(restored.npcStageIndex, 1)
  assert.deepEqual(restored.woundsHistory, [history[0]])
  assert.equal(f.rows.evolutionLines['shared-line'].currentStageIndex, 2)
  assert.deepEqual(f.writes.filter(write => write.table === 'evolutionLines'), [])
  assert.deepEqual(result.turnOrder, ['npc', 'ally'])
  assert.equal(result.currentTurnIndex, 1)
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Poison')))
  assert.ok(!result.battleLog.some(entry => entry.effects.includes('Auto-Devolve')), 'PUT retains its existing silent form restoration')
})
