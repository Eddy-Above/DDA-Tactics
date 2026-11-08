import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const copy = value => structuredClone(value)
const unexpected = () => assert.fail('unexpected combat side effect')
const record = (id, extra = {}) => ({
  id, name: id, stage: 'rookie', baseStats: { health: 5 }, bonusStats: { health: 1 },
  currentWounds: 2, qualities: [], partnerId: null, isEnemy: false, ...extra,
})
const participant = (extra = {}) => ({
  id: 'partner', type: 'digimon', entityId: 'champion', evolutionLineId: 'line',
  currentWounds: 10, maxWounds: 10, totalHealth: 7, activeEffects: [],
  actionsRemaining: { simple: 1 }, isActive: true, hasActed: false, ...extra,
})
const evolutionLine = (extra = {}) => ({
  id: 'line', currentStageIndex: 1,
  chain: [
    { species: 'Rookie', stage: 'rookie', digimonId: 'rookie', evolvesFromIndex: null, isUnlocked: false },
    { species: 'Champion', stage: 'champion', digimonId: 'champion', evolvesFromIndex: 0, isUnlocked: true },
  ],
  ...extra,
})

function harness({ records = [], lines = [evolutionLine()], roundEnd, gravity } = {}) {
  const tables = Object.fromEntries(['digimon', 'evolutionLines', 'encounters', 'campaigns']
    .map(name => [name, { name, id: `${name}.id` }]))
  const rows = {
    digimon: new Map(records.map(row => [row.id, copy(row)])),
    evolutionLines: new Map(lines.map(row => [row.id, copy(row)])),
  }
  const writes = []
  const refreshes = []
  const gravityCalls = []
  const roundEndCalls = []
  const store = {
    ...tables,
    db: {
      select: () => ({ from: table => ({ where: async ({ value }) => {
        const row = rows[table.name]?.get(value)
        return row ? [copy(row)] : []
      } }) }),
      update: table => ({ set: fields => ({ where: async ({ value }) => {
        writes.push({ table: table.name, id: value, fields: copy(fields) })
        rows[table.name].set(value, { ...rows[table.name].get(value), ...copy(fields) })
      } }) }),
    },
  }
  const sql = { eq: (column, value) => ({ column, value }) }
  const cache = loadTypeScriptWithMocks('server/utils/combatRecordCache.ts', {})
  const common = { 'drizzle-orm': sql, '../db': store, './combatRecordCache': cache }
  const devolution = loadTypeScriptWithMocks('server/utils/partnerDevolution.ts', common)
  const knockouts = loadTypeScriptWithMocks('server/utils/enemyKnockouts.ts', {
    ...common,
    './partnerDevolution': devolution,
    './resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    './combatSpatial': { loadParticipantDigimon: async participants => new Map(participants
      .filter(p => p.type === 'digimon' && rows.digimon.has(p.entityId))
      .map(p => [p.entityId, rows.digimon.get(p.entityId)])) },
    './endOfTurnGravity': {
      applyEndOfTurnGravity: unexpected,
      computeGravityDrops: async (positions, participants, map, records, round) => {
        gravityCalls.push({ positions: copy(positions), round })
        return gravity ? gravity({ positions, participants, map, records, round }) : { patch: {}, logEntries: [] }
      },
    },
    './roundStartQualityTriggers': { applyRoundStartQualityTriggers: async participants => participants },
    './damageOverTime': {
      loadRoundEndContext: async () => ({ rules: {}, positions: {} }),
      applyRoundEndEffects: async context => {
        roundEndCalls.push(copy(context))
        return roundEnd ? roundEnd(context) : { participants: context.participants, logEntries: [] }
      },
    },
    './guidingLight': { refreshGuidingLightForParticipants: async (encounterId, participants, positions) => {
      refreshes.push({ encounterId, participants: copy(participants), positions: copy(positions) })
      return participants
    } },
  })
  return { ...knockouts, rows, writes, refreshes, gravityCalls, roundEndCalls }
}

const partnerRecords = [record('champion', { stage: 'champion', partnerId: 'absent-tamer' }), record('rookie')]

test('a movement-Burn candidate devolves without history and keeps its active turn, actions and token position', async () => {
  const h = harness({ records: partnerRecords })
  const actor = participant({ lastMovedTurnKey: '1:0' })
  const unrelated = participant({ id: 'already-downed', entityId: 'champion', isActive: false })
  const state = { participants: [actor, unrelated], turnOrder: ['partner'], currentTurnIndex: 0, round: 1 }
  const before = copy(state)
  const positions = { partner: { x: 7, y: 0, z: 3 } }
  const result = await h.resolveEnemyKnockouts(state, ['partner', 'partner'], {
    encounterId: 'encounter', gravity: { map: {}, positions },
  })

  assert.equal(result.changed, true)
  assert.equal(result.turnAdvanced, false)
  assert.deepEqual(result.removedIds, [])
  assert.deepEqual(result.turnOrder, state.turnOrder)
  assert.equal(result.currentTurnIndex, 0)
  assert.equal(result.round, 1)
  assert.equal(result.positionPatch, undefined)
  const reverted = result.participants.find(p => p.id === actor.id)
  assert.equal(reverted.entityId, 'rookie')
  assert.equal(reverted.currentWounds, 2)
  assert.equal(reverted.maxWounds, 8)
  assert.equal(reverted.totalHealth, 6)
  assert.deepEqual(reverted.actionsRemaining, { simple: 1 })
  assert.equal(reverted.isActive, true)
  assert.equal(reverted.hasActed, false)
  assert.equal(reverted.lastMovedTurnKey, '1:0')
  assert.deepEqual(result.participants.find(p => p.id === unrelated.id), unrelated)
  assert.deepEqual(state, before)
  assert.equal(h.rows.evolutionLines.get('line').currentStageIndex, 0)
  assert.equal(h.writes.length, 1)
  assert.equal(h.writes[0].table, 'evolutionLines')
  assert.deepEqual(h.gravityCalls, [])
  assert.equal(h.refreshes.length, 1)
  assert.equal(h.refreshes[0].participants[0].entityId, 'rookie')
  assert.deepEqual(h.refreshes[0].positions, positions)
  assert.equal(result.logEntries.length, 1)
  assert.equal(result.logEntries[0].actorName, 'champion')
  assert.deepEqual(result.logEntries[0].effects, ['Auto-Devolve'])
  assert.deepEqual(h.knockedOutEnemyIds([actor]), [])
})

test('a Clash Throw candidate restores the saved combat form ahead of the line parent and pops one history entry', async () => {
  const h = harness({ records: [...partnerRecords,
    record('saved-form', { currentWounds: 0, qualities: [{ id: 'combat-monster' }] }),
  ] })
  const olderState = { entityId: 'earlier', stageIndex: 0, maxWounds: 5, wounds: 1, totalHealth: 5 }
  const savedState = { entityId: 'saved-form', stageIndex: 2, maxWounds: 13, wounds: 3, totalHealth: 11 }
  const actor = participant({ woundsHistory: [olderState, savedState], combatMonsterBonus: 20, isActive: false })
  const before = copy(actor)
  const result = await h.resolveEnemyKnockouts({
    participants: [actor], turnOrder: ['partner'], currentTurnIndex: 0, round: 3,
  }, ['partner'])

  const reverted = result.participants[0]
  assert.equal(reverted.entityId, 'saved-form')
  assert.equal(reverted.currentWounds, 3)
  assert.equal(reverted.maxWounds, 13)
  assert.equal(reverted.totalHealth, 11)
  assert.equal(reverted.combatMonsterBonus, 11)
  assert.deepEqual(reverted.woundsHistory, [olderState])
  assert.deepEqual(actor, before)
  assert.equal(h.rows.evolutionLines.get('line').currentStageIndex, 2)
  assert.equal(result.turnAdvanced, false)
  assert.deepEqual(result.turnOrder, ['partner'])
  assert.deepEqual(result.removedIds, [])
  assert.equal(result.logEntries[0].round, 3)
})

test('root partners, NPCs, reserves, missing records and record-marked enemies are not removed or devolved', async () => {
  const h = harness({
    records: [...partnerRecords, record('npc'), record('enemy-record', { partnerId: 'tamer', isEnemy: true })],
    lines: [evolutionLine({ currentStageIndex: 0 })],
  })
  const actors = [
    participant({ id: 'root', entityId: 'rookie' }),
    participant({ id: 'npc', entityId: 'npc', woundsHistory: [{ entityId: 'rookie', stageIndex: 0 }] }),
    participant({ id: 'reserve', inReserve: true }),
    participant({ id: 'missing', entityId: 'missing-record' }),
    participant({ id: 'record-enemy', entityId: 'enemy-record' }),
    participant({ id: 'healthy', currentWounds: 9 }),
    participant({ id: 'tamer', type: 'tamer' }),
  ]
  const state = { participants: actors, turnOrder: actors.map(p => p.id), currentTurnIndex: 0, round: 1 }
  const before = copy(state)
  const result = await h.resolveEnemyKnockouts(state, actors.map(p => p.id))
  assert.deepEqual(result.participants, before.participants)
  assert.deepEqual(result.turnOrder, before.turnOrder)
  assert.equal(result.changed, false)
  assert.equal(result.turnAdvanced, false)
  assert.deepEqual(result.removedIds, [])
  assert.deepEqual(result.logEntries, [])
  assert.deepEqual(h.writes, [])
  assert.deepEqual(h.refreshes, [])
})

test('an enemy without a previous combat form is still removed and releases its clash opponent', async () => {
  const h = harness({ records: [record('enemy', { isEnemy: true })] })
  const ally = { id: 'ally', type: 'tamer', entityId: 'tamer', clash: { opponentParticipantId: 'enemy' } }
  const enemy = participant({ id: 'enemy', entityId: 'enemy', isEnemy: true, evolutionLineId: undefined })
  const result = await h.resolveEnemyKnockouts({
    participants: [ally, enemy], turnOrder: ['ally', 'enemy'], currentTurnIndex: 0, round: 1,
  }, ['enemy'])
  assert.deepEqual(result.removedIds, ['enemy'])
  assert.deepEqual(result.turnOrder, ['ally'])
  assert.equal(result.currentTurnIndex, 0)
  assert.equal(result.turnAdvanced, false)
  assert.equal(result.participants[0].clash, null)
  assert.deepEqual(h.writes, [])
  assert.deepEqual(result.logEntries[0].effects, ['Defeated'])
})

test('round-end damage after an enemy removal also devolves newly knocked-out partners', async () => {
  const h = harness({
    records: [...partnerRecords, record('enemy', { isEnemy: true })],
    roundEnd: async ({ participants }) => ({
      participants: participants.map(p => p.id === 'partner' ? { ...p, currentWounds: p.maxWounds } : p),
      logEntries: [],
    }),
  })
  const actor = participant({ currentWounds: 9, isActive: false })
  const alreadyDowned = participant({ id: 'already-downed', isActive: false })
  const enemy = participant({ id: 'enemy', entityId: 'enemy', isEnemy: true, evolutionLineId: undefined })
  const result = await h.resolveEnemyKnockouts({
    participants: [actor, alreadyDowned, enemy], turnOrder: ['partner', 'enemy'], currentTurnIndex: 1, round: 2,
  }, ['enemy'])
  assert.deepEqual(result.removedIds, ['enemy'])
  assert.equal(result.round, 3)
  assert.equal(result.currentTurnIndex, 0)
  assert.equal(result.turnAdvanced, true)
  assert.deepEqual(result.turnOrder, ['partner'])
  assert.equal(result.participants.find(p => p.id === 'partner').entityId, 'rookie')
  assert.equal(result.participants.find(p => p.id === 'partner').currentWounds, 2)
  assert.equal(result.participants.find(p => p.id === 'already-downed').entityId, 'champion')
  assert.equal(h.roundEndCalls.length, 1)
  assert.equal(result.logEntries.find(log => log.effects.includes('Auto-Devolve')).round, 2)
  assert.equal(h.writes.length, 1)
  assert.equal(h.refreshes.length, 1)
})

test('turn-change fall damage also devolves a newly knocked-out partner while preserving the gravity patch', async () => {
  const landing = { x: 3, y: 0, z: 4 }
  const h = harness({
    records: [...partnerRecords, record('enemy', { isEnemy: true })],
    gravity: async ({ participants }) => {
      participants.find(p => p.id === 'partner').currentWounds = 10
      return { patch: { partner: landing }, logEntries: [] }
    },
  })
  const actor = participant({ currentWounds: 9, isActive: false })
  const enemy = participant({ id: 'enemy', entityId: 'enemy', isEnemy: true, evolutionLineId: undefined })
  const result = await h.resolveEnemyKnockouts({
    participants: [enemy, actor], turnOrder: ['enemy', 'partner'], currentTurnIndex: 0, round: 2,
  }, ['enemy'], { encounterId: 'encounter', gravity: { map: {}, positions: { partner: { x: 3, y: 6, z: 4 } } } })
  assert.equal(result.participants[0].entityId, 'rookie')
  assert.equal(result.participants[0].currentWounds, 2)
  assert.equal(result.participants[0].isActive, true)
  assert.equal(result.round, 2)
  assert.deepEqual(result.turnOrder, ['partner'])
  assert.deepEqual(result.removedIds, ['enemy'])
  assert.deepEqual(result.positionPatch, { partner: landing })
  assert.equal(h.gravityCalls.length, 1)
  assert.equal(h.roundEndCalls.length, 0)
  assert.deepEqual(h.refreshes[0].positions, { partner: landing })
})
