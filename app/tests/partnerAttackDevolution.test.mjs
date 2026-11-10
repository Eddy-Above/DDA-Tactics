import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const unexpected = () => { throw new Error('Unexpected combat side effect or database outside the supplied transaction') }
const sql = { eq: (column, value) => ({ column, value }) }
const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

function fixture(history, { transactionOnly = false, enemy = false } = {}) {
  const tables = Object.fromEntries(['digimon', 'evolutionLines', 'encounters', 'campaigns', 'tamers']
    .map(name => [name, { name, id: name }]))
  const records = {
    champion: { id: 'champion', name: 'Greymon', partnerId: 'owner', isEnemy: enemy, stage: 'champion', qualities: [], baseStats: { dodge: 1 } },
    rookie: {
      id: 'rookie', name: 'Agumon', partnerId: 'owner', stage: 'rookie',
      baseStats: { health: 5 }, bonusStats: { health: 2 }, currentWounds: 3,
      qualities: [{ id: 'digizoid-armor', choiceId: 'red' }, { id: 'combat-monster' }],
    },
  }
  let line = {
    id: 'line', currentStageIndex: 1,
    chain: [
      { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: null, isUnlocked: false },
      { digimonId: 'champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
    ],
  }
  const reads = [], writes = [], refreshes = [], knockoutCalls = []
  const database = {
    select: () => ({ from: table => ({ where: async ({ value }) => {
      reads.push({ table: table.name, id: value })
      if (table === tables.digimon) return records[value] ? [structuredClone(records[value])] : []
      if (table === tables.evolutionLines) return value === line.id ? [structuredClone(line)] : []
      throw new Error(`Unexpected read from ${table.name}`)
    } }) }),
    update: table => ({ set: fields => ({ where: async ({ value }) => {
      assert.equal(table, tables.evolutionLines)
      assert.equal(value, line.id)
      writes.push({ table: table.name, fields: structuredClone(fields) })
      line = { ...line, ...structuredClone(fields) }
    } }) }),
  }
  const moduleDb = { ...tables, db: transactionOnly ? { select: unexpected, update: unexpected } : database }
  const partnerDevolution = loadTrustedGameplayModule('server/utils/partnerDevolution.ts', {
    '../db': moduleDb, 'drizzle-orm': sql,
  })
  const guidingLight = { refreshGuidingLightForParticipants: async (encounterId, participants, positions) => {
    refreshes.push(structuredClone({ encounterId, participants, positions }))
    return participants.map(p => ({ ...p, activeEffects: [] }))
  } }
  const enemyKnockouts = {
    knockedOutEnemyIds: () => [], hasUnusedTimeControl: () => false, triggerTimeControl: unexpected,
    resolveEnemyKnockouts: async (state, ids) => {
      knockoutCalls.push(structuredClone(ids))
      return { ...state, changed: false, turnAdvanced: false, logEntries: [] }
    },
  }
  const target = {
    id: 'partner', type: 'digimon', entityId: 'champion', evolutionLineId: 'line',
    currentWounds: 4, maxWounds: 5, totalHealth: 20, combatMonsterBonus: 14,
    activeEffects: [{ name: 'Guiding Light (Focus)', source: 'partner' }],
    actionsRemaining: { simple: 2 }, ...(enemy ? { isEnemy: true } : {}),
    ...(history === undefined ? {} : { woundsHistory: structuredClone(history) }),
  }
  return {
    database, moduleDb, partnerDevolution, guidingLight, enemyKnockouts, target, records,
    reads, writes, refreshes, knockoutCalls, line: () => line,
  }
}

function attackResolver(f) {
  return loadTrustedGameplayModule('server/utils/resolveNpcAttack.ts', {
    '../db': f.moduleDb, 'drizzle-orm': sql,
    './partnerDevolution': f.partnerDevolution,
    './computeAttackDamage': { computeAttackDamage: async () => ({
      attackDef: { type: 'damage' }, hit: true, damageDealt: 2, netSuccesses: 1,
      attackBaseDamage: 2, targetArmor: 0, armorPiercing: 0, effectiveArmor: 0,
      outsideClashArmorBonus: 0, reflectDamageToAttacker: 0,
    }) },
    './combatSpatial': { loadParticipantDigimon: unexpected },
    './pushPull': { computePushPull: unexpected },
    './damageOverTime': { loadDamageOverTimeRules: unexpected },
    './enemyKnockouts': f.enemyKnockouts,
    './guidingLight': f.guidingLight,
  }).resolveNpcAttack
}

async function hit(f) {
  return attackResolver(f)({
    encounterId: 'encounter', participantPositions: { partner: { x: 1, y: 0, z: 0 } },
    participants: [{ id: 'attacker', type: 'digimon', entityId: 'attacker', activeEffects: [] }, f.target],
    battleLog: [], attackerParticipantId: 'attacker', targetParticipantId: 'partner',
    attackId: 'attack', accuracySuccesses: 1, accuracyDice: [6], round: 1,
    attackerName: 'Attacker', targetName: 'Partner', cannotDodge: true,
    turnOrder: ['attacker', 'partner'], currentTurnIndex: 0,
  })
}

test('the real NPC resolver restores a history-free partner sheet and persists its shared evolution stage', async () => {
  const f = fixture()
  f.target.npcStageIndex = 8
  const result = await hit(f)
  const target = result.participants.find(p => p.id === 'partner')
  assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds, target.totalHealth], ['rookie', 3, 11, 9])
  assert.equal(target.combatMonsterBonus, 9)
  assert.equal(f.line().currentStageIndex, 0)
  assert.equal(target.npcStageIndex, undefined, 'actual partners must not retain stale NPC form tracking')
  assert.equal(f.writes.length, 1)
  assert.equal(f.refreshes.length, 1)
  assert.equal(f.refreshes[0].participants.find(p => p.id === 'partner').currentWounds, 3)
  assert.deepEqual(target.activeEffects, [])
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Auto-Devolve')))
  assert.deepEqual(result.turnOrder, ['attacker', 'partner'])
  assert.equal(f.records.rookie.currentWounds, 3)
})

test('the real NPC resolver prefers its combat snapshot and consumes it without loading the line fallback', async () => {
  const f = fixture([{ entityId: 'rookie', stageIndex: 0, maxWounds: 7, totalHealth: 5, wounds: 1 }])
  f.target.npcStageIndex = 8
  const result = await hit(f)
  const target = result.participants.find(p => p.id === 'partner')
  assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds, target.totalHealth], ['rookie', 1, 7, 5])
  assert.deepEqual(target.woundsHistory, [])
  assert.equal(target.combatMonsterBonus, 5)
  assert.equal(target.npcStageIndex, undefined)
  assert.equal(f.line().currentStageIndex, 0)
  assert.ok(f.reads.every(read => read.table !== 'evolutionLines'), 'saved snapshots must not depend on the line still existing')
  assert.equal(f.refreshes.length, 1)
})

test('a saved parent that is already knocked out is restored once without re-entering knockout resolution', async () => {
  const f = fixture()
  f.records.rookie.currentWounds = 11
  const result = await hit(f)
  const target = result.participants.find(p => p.id === 'partner')
  assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds], ['rookie', 11, 11])
  assert.ok(f.knockoutCalls.every(ids => !ids.includes('partner')))
  assert.equal(f.writes.length, 1)
  assert.equal(result.battleLog.filter(entry => entry.effects.includes('Auto-Devolve')).length, 1)
})

test('the real NPC resolver does not apply a partner sheet fallback to a history-free enemy', async () => {
  const f = fixture(undefined, { enemy: true })
  const result = await hit(f)
  const target = result.participants.find(p => p.id === 'partner')
  assert.equal(target.entityId, 'champion')
  assert.equal(target.currentWounds, target.maxWounds)
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.refreshes, [])
})

for (const { history, parentKnockedOut } of [
  {},
  { history: [{ entityId: 'rookie', stageIndex: 0, maxWounds: 7, totalHealth: 5, wounds: 1 }] },
  { parentKnockedOut: true },
]) {
  test(`area intercede ${history ? 'restores saved combat history' : parentKnockedOut ? 'restores an already-knocked-out parent once' : 'restores a history-free partner'} using the supplied transaction for all form reads and writes`, async () => {
    const f = fixture(history, { transactionOnly: true })
    if (parentKnockedOut) f.records.rookie.currentWounds = 11
    const { resolveAreaIntercedeGroup } = loadTrustedGameplayModule('server/utils/resolveAreaIntercedeGroup.ts', {
      '../db': f.moduleDb, 'drizzle-orm': sql,
      './partnerDevolution': f.partnerDevolution,
      './resolveNpcAttack': { resolveNpcAttack: unexpected },
      './enemyKnockouts': f.enemyKnockouts,
      '~/server/utils/resolveSupportAttack': {
        resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected,
        resolveNegativeSupportNpc: unexpected, getPositiveSupportResolutionType: unexpected,
      },
      '~/server/utils/selectiveTargeting': { getSelectiveTargetingFilter: unexpected },
      './guidingLight': f.guidingLight,
    })
    const result = await resolveAreaIntercedeGroup({
      encounterId: 'encounter', database: f.database,
      positions: { partner: { x: 1, y: 0, z: 0 } },
      participants: [f.target], battleLog: [], pendingRequests: [],
      turnOrder: ['attacker', 'partner'], currentTurnIndex: 0, round: 1,
      groupState: { id: 'group', data: {
        claims: [{ interceptorParticipantId: 'partner', interceptorName: 'Partner', targetId: 'protected', targetName: 'Ally', damageDealt: 2 }],
        originalTargetIds: ['protected'], npcTargetIds: [], attackerId: 'attacker', attackerName: 'Attacker',
      } },
    })
    const target = result.participants[0]
    const expected = history ? ['rookie', 1, 7, 5] : ['rookie', parentKnockedOut ? 11 : 3, 11, 9]
    assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds, target.totalHealth], expected)
    if (history) assert.deepEqual(target.woundsHistory, [])
    assert.equal(f.line().currentStageIndex, 0)
    assert.equal(f.writes.length, 1)
    assert.ok(f.reads.length > 0)
    assert.equal(f.refreshes.length, 1)
    assert.equal(f.refreshes[0].participants[0].currentWounds, expected[1])
    assert.ok(result.battleLog.some(entry => entry.effects.includes('Auto-Devolve')))
    assert.ok(f.knockoutCalls.every(ids => !ids.includes('partner')))
  })
}

function directClaimFixture(history) {
  const f = fixture(history)
  f.records.attacker = { id: 'attacker', name: 'Attacker', attacks: [{ id: 'attack', range: 'melee', type: 'damage', tags: [] }] }
  f.records.protected = { id: 'protected', name: 'Ally', qualities: [] }
  let rows = {
    digimon: structuredClone(f.records), evolutionLines: { line: structuredClone(f.line()) },
    encounters: { encounter: {
      id: 'encounter', phase: 'combat', round: 1, mapId: null,
      participants: [
        { id: 'attacker', type: 'digimon', entityId: 'attacker', activeEffects: [], currentWounds: 0, maxWounds: 10 },
        f.target,
        { id: 'protected', type: 'digimon', entityId: 'protected', activeEffects: [], currentWounds: 0, maxWounds: 10 },
      ],
      pendingRequests: [{ id: 'offer', type: 'intercede-offer', targetTamerId: 'owner', data: {
        intercedeGroupId: 'group', attackerId: 'attacker', attackerName: 'Attacker', attackId: 'attack',
        targetId: 'protected', targetName: 'Ally', accuracySuccesses: 1, isAreaAttack: false,
      } }],
      battleLog: [], turnOrder: ['attacker', 'partner'], currentTurnIndex: 0,
    } },
    tamers: {}, campaigns: {},
  }
  let activeTransaction = false
  const commits = [], writes = []
  const db = {
    select: () => ({ from: table => ({ where: async ({ value }) => {
      assert.equal(activeTransaction, false, 'entity reads during a claim must use the transaction')
      assert.equal(table, f.moduleDb.encounters, 'the default database is only used to return the committed encounter')
      return rows.encounters[value] ? [structuredClone(rows.encounters[value])] : []
    } }) }),
    update: unexpected,
    transaction: async work => {
      activeTransaction = true
      let locked = false
      const staged = structuredClone(rows)
      const transaction = {
        select: () => ({ from: table => ({ where: filter => {
          const execute = async () => (Array.isArray(filter.value) ? filter.value : [filter.value])
            .flatMap(id => staged[table.name][id] ? [structuredClone(staged[table.name][id])] : [])
          return {
            then: (resolve, reject) => execute().then(resolve, reject),
            for: mode => { assert.equal(mode, 'update'); locked = true; return execute() },
          }
        } }) }),
        update: table => ({ set: fields => ({ where: async ({ value }) => {
          assert.ok(locked, 'the encounter lock must precede form or encounter writes')
          staged[table.name][value] = { ...staged[table.name][value], ...structuredClone(fields) }
          writes.push(table.name)
        } }) }),
      }
      try {
        const result = await work(transaction)
        rows = staged
        commits.push(true)
        return result
      } finally { activeTransaction = false }
    },
  }
  const dbModule = { ...f.moduleDb, db }
  const partnerDevolution = loadTrustedGameplayModule('server/utils/partnerDevolution.ts', {
    '../db': dbModule, 'drizzle-orm': sql,
  })
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async body => body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const handler = loadTrustedGameplayModule('server/api/encounters/[id]/actions/intercede-claim.post.ts', {
    '../../../../db': dbModule,
    'drizzle-orm': { ...sql, inArray: (_column, value) => ({ value }) },
    '../../../../utils/partnerDevolution': partnerDevolution,
    '~/server/utils/intercedeClaims': { serializeIntercedeClaim: (_id, work) => work() },
    '~/server/utils/resolveAreaIntercedeGroup': {
      allAreaTargetsDecided: unexpected, resolveAreaIntercedeGroup: unexpected, isAreaTargetCovered: unexpected,
    },
    '~/server/utils/computeAttackDamage': { computeAttackDamage: async () => ({
      attackBaseDamage: 2, armorPiercing: 0, targetArmor: 0, outsideClashArmorBonus: 0,
      effectiveArmor: 0, damageDealt: 2, netSuccesses: 1,
      attackDef: { id: 'attack', type: 'damage' }, reflectDamageToAttacker: 0,
    }) },
    '~/server/utils/encounterRoom': {
      getRoomPositions: async () => ({}),
      getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }),
      broadcastPositionPatch: unexpected,
    },
    '~/server/utils/guidingLight': f.guidingLight,
    '~/server/utils/combatSpatial': { loadEncounterMap: unexpected },
    '~/server/utils/enemyKnockouts': f.enemyKnockouts,
  }).default
  return { ...f, writes, commits, rows: () => rows, claim: () => handler({ requestId: 'offer', interceptorParticipantId: 'partner' }) }
}

for (const { history, parentKnockedOut } of [
  {},
  { history: [{ entityId: 'rookie', stageIndex: 0, maxWounds: 7, totalHealth: 5, wounds: 1 }] },
  { parentKnockedOut: true },
]) {
  test(`the direct intercede endpoint ${history ? 'restores combat history' : parentKnockedOut ? 'restores an already-knocked-out parent once' : 'restores saved parent wounds without history'} under the claim transaction`, async () => {
    const f = directClaimFixture(history)
    if (parentKnockedOut) f.rows().digimon.rookie.currentWounds = 11
    const result = await f.claim()
    const target = result.participants.find(p => p.id === 'partner')
    const expected = history ? ['rookie', 1, 7, 5] : ['rookie', parentKnockedOut ? 11 : 3, 11, 9]
    assert.deepEqual([target.entityId, target.currentWounds, target.maxWounds, target.totalHealth], expected)
    assert.equal(target.actionsRemaining.simple, 1)
    assert.equal(f.rows().evolutionLines.line.currentStageIndex, 0)
    assert.deepEqual(f.writes, ['evolutionLines', 'encounters'])
    assert.equal(f.commits.length, 1)
    assert.equal(f.refreshes.length, 1)
    assert.equal(result.pendingRequests.length, 0)
    assert.ok(result.battleLog.some(entry => entry.effects.includes('Auto-Devolve')))
    assert.ok(f.knockoutCalls.every(ids => !ids.includes('partner')))
  })
}
