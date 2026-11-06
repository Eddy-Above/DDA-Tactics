import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const oldAura = { name: 'Guiding Light', potency: 1, source: 'source' }
const oldFocus = { name: 'Guiding Light (Focus)', potency: 2, source: 'source' }
const unexpected = () => { throw new Error('unexpected combat side effect') }

function database(rows = []) {
  const digimon = { id: 'digimon.id' }
  const evolutionLines = { id: 'evolutionLines.id' }
  const records = new Map(rows.map(row => [row.id, row]))
  const writes = []
  return {
    digimon, evolutionLines, encounters: {}, campaigns: {}, tamers: {}, writes,
    db: {
      select: () => ({ from: table => ({ where: async ({ value }) => {
        assert.equal(table, digimon)
        const record = records.get(value)
        return record ? [record] : []
      } }) }),
      update: table => ({ set: fields => ({ where: async condition => {
        writes.push({ table, fields, condition })
      } }) }),
    },
  }
}

function auraRefresh(calls) {
  return async (encounterId, participants, positions) => {
    calls.push({ encounterId, participants: structuredClone(participants), positions })
    return participants.map(participant => ({ ...participant, activeEffects: [] }))
  }
}

function knockouts(rows) {
  const store = database(rows)
  const refreshes = []
  const { resolveEnemyKnockouts } = loadTypeScriptWithMocks('server/utils/enemyKnockouts.ts', {
    'drizzle-orm': { eq: (column, value) => ({ column, value }) },
    '../db': store,
    './resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    './endOfTurnGravity': { applyEndOfTurnGravity: unexpected, computeGravityDrops: unexpected },
    './combatSpatial': { loadParticipantDigimon: async () => new Map(rows.map(row => [row.id, row])) },
    './roundStartQualityTriggers': { applyRoundStartQualityTriggers: unexpected },
    './damageOverTime': { applyRoundEndEffects: unexpected, loadRoundEndContext: unexpected },
    './guidingLight': { refreshGuidingLightForParticipants: auraRefresh(refreshes) },
  })
  return { resolveEnemyKnockouts, refreshes, store }
}

test('an enemy removal refreshes the remaining aura before returning the state to persist', async () => {
  const { resolveEnemyKnockouts, refreshes } = knockouts([{ id: 'enemy', name: 'Enemy', qualities: [] }])
  const ally = { id: 'ally', type: 'digimon', entityId: 'ally', currentWounds: 2, maxWounds: 10, activeEffects: [oldAura] }
  const enemy = { id: 'source', type: 'digimon', entityId: 'enemy', isEnemy: true, currentWounds: 5, maxWounds: 5 }
  const positions = { ally: { x: 1, y: 0, z: 0 }, source: { x: 0, y: 0, z: 0 } }
  const result = await resolveEnemyKnockouts({
    participants: [ally, enemy], turnOrder: ['ally', 'source'], currentTurnIndex: 0, round: 1,
  }, ['source'], { encounterId: 'encounter', gravity: { map: {}, positions } })

  assert.deepEqual(result.removedIds, ['source'])
  assert.equal(refreshes.length, 1)
  assert.equal(refreshes[0].encounterId, 'encounter')
  assert.deepEqual(refreshes[0].participants.map(participant => participant.id), ['ally'])
  assert.deepEqual(refreshes[0].positions, positions)
  assert.deepEqual(result.participants[0].activeEffects, [])
  assert.equal(result.participants[0].currentWounds, 2)
  assert.deepEqual(result.turnOrder, ['ally'])
  assert.equal(result.currentTurnIndex, 0)
})

test('an enemy auto-devolution refreshes the aura using its previous form and restored wounds', async () => {
  const { resolveEnemyKnockouts, refreshes } = knockouts([
    { id: 'evolved', name: 'Evolved', qualities: [] }, { id: 'rookie', name: 'Rookie', qualities: [] },
  ])
  const source = {
    id: 'source', type: 'digimon', entityId: 'evolved', isEnemy: true,
    currentWounds: 10, maxWounds: 10, evolutionLineId: 'line', activeEffects: [oldFocus],
    woundsHistory: [{ entityId: 'rookie', stageIndex: 0, maxWounds: 5, wounds: 1 }],
  }
  const result = await resolveEnemyKnockouts({
    participants: [source], turnOrder: ['source'], currentTurnIndex: 0, round: 1,
  }, ['source'], { encounterId: 'encounter' })

  assert.equal(refreshes.length, 1)
  assert.equal(refreshes[0].participants[0].entityId, 'rookie')
  assert.equal(refreshes[0].participants[0].currentWounds, 1)
  assert.equal(result.participants[0].entityId, 'rookie')
  assert.deepEqual(result.participants[0].activeEffects, [])
  assert.deepEqual(result.removedIds, [])
})

test('unchanged knockout checks do not add aura lookups to ordinary attacks', async () => {
  const { resolveEnemyKnockouts, refreshes } = knockouts([])
  const source = { id: 'source', type: 'digimon', currentWounds: 0, maxWounds: 5 }
  const result = await resolveEnemyKnockouts({
    participants: [source], turnOrder: ['source'], currentTurnIndex: 0, round: 1,
  }, ['source'], { encounterId: 'encounter' })
  assert.equal(result.changed, false)
  assert.deepEqual(refreshes, [])
})

test('NPC attack auto-devolution returns refreshed effects even without a knockout removal or position change', async () => {
  const store = database([
    { id: 'evolved', name: 'Evolved', baseStats: { dodge: 1 }, qualities: [] },
    { id: 'rookie', name: 'Rookie', qualities: [] },
  ])
  const refreshes = []
  const { resolveNpcAttack } = loadTypeScriptWithMocks('server/utils/resolveNpcAttack.ts', {
    '../db': store,
    'drizzle-orm': { eq: (column, value) => ({ column, value }) },
    './computeAttackDamage': { computeAttackDamage: async () => ({
      attackDef: { type: 'damage' }, hit: true, damageDealt: 2, netSuccesses: 1,
      attackBaseDamage: 2, targetArmor: 0, armorPiercing: 0, effectiveArmor: 0,
      outsideClashArmorBonus: 0, reflectDamageToAttacker: 0,
    }) },
    './combatSpatial': { loadParticipantDigimon: unexpected },
    './pushPull': { computePushPull: unexpected },
    './damageOverTime': { loadDamageOverTimeRules: unexpected },
    './enemyKnockouts': {
      knockedOutEnemyIds: () => [], hasUnusedTimeControl: () => false, triggerTimeControl: unexpected,
      resolveEnemyKnockouts: async state => ({ ...state, changed: false, turnAdvanced: false, logEntries: [] }),
    },
    './guidingLight': { refreshGuidingLightForParticipants: auraRefresh(refreshes) },
  })
  const positions = { source: { x: 0, y: 0, z: 0 }, ally: { x: 2, y: 0, z: 0 } }
  const result = await resolveNpcAttack({
    encounterId: 'encounter', participantPositions: positions,
    participants: [
      { id: 'attacker', type: 'digimon', entityId: 'attacker', activeEffects: [] },
      {
        id: 'source', type: 'digimon', entityId: 'evolved', activeEffects: [oldFocus],
        currentWounds: 4, maxWounds: 5, evolutionLineId: 'line',
        woundsHistory: [{ entityId: 'rookie', stageIndex: 0, maxWounds: 4, wounds: 1 }],
      },
      { id: 'ally', type: 'digimon', entityId: 'ally', activeEffects: [oldAura] },
    ],
    battleLog: [], attackerParticipantId: 'attacker', targetParticipantId: 'source',
    attackId: 'attack', accuracySuccesses: 1, accuracyDice: [6], round: 1,
    attackerName: 'Attacker', targetName: 'Source', cannotDodge: true,
    turnOrder: ['attacker', 'source'], currentTurnIndex: 0,
  })

  assert.equal(refreshes.length, 1)
  assert.equal(refreshes[0].participants.find(participant => participant.id === 'source').entityId, 'rookie')
  assert.deepEqual(refreshes[0].positions, positions)
  assert.equal(result.participants.find(participant => participant.id === 'source').currentWounds, 1)
  assert.deepEqual(result.participants.find(participant => participant.id === 'ally').activeEffects, [])
  assert.deepEqual(result.turnOrder, ['attacker', 'source'])
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Auto-Devolve')))
})

for (const damageDealt of [0, 2]) {
  test(`area intercede refreshes only a changed form before resolving uncovered targets (damage ${damageDealt})`, async () => {
    const store = database([
      { id: 'evolved', name: 'Evolved', qualities: [] }, { id: 'rookie', name: 'Rookie', qualities: [] },
      { id: 'uncovered', name: 'Uncovered', qualities: [] },
    ])
    const refreshes = []
    const resolutions = []
    const { resolveAreaIntercedeGroup } = loadTypeScriptWithMocks('server/utils/resolveAreaIntercedeGroup.ts', {
      '../db': store,
      'drizzle-orm': { eq: (column, value) => ({ column, value }) },
      './resolveNpcAttack': { resolveNpcAttack: async params => {
        resolutions.push(structuredClone(params))
        return { participants: params.participants, battleLog: params.battleLog, turnOrder: params.turnOrder }
      } },
      './enemyKnockouts': {
        knockedOutEnemyIds: () => [],
        resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }),
      },
      '~/server/utils/resolveSupportAttack': {
        resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected,
        resolveNegativeSupportNpc: unexpected, getPositiveSupportResolutionType: unexpected,
      },
      '~/server/utils/selectiveTargeting': { getSelectiveTargetingFilter: () => null },
      './guidingLight': { refreshGuidingLightForParticipants: auraRefresh(refreshes) },
    })
    const positions = { source: { x: 0, y: 0, z: 0 }, uncovered: { x: 2, y: 0, z: 0 } }
    const result = await resolveAreaIntercedeGroup({
      encounterId: 'encounter', positions, round: 1, currentTurnIndex: 0, turnOrder: ['source'],
      battleLog: [], pendingRequests: [],
      participants: [
        {
          id: 'source', type: 'digimon', entityId: 'evolved', activeEffects: [oldFocus],
          currentWounds: 4, maxWounds: 5, evolutionLineId: 'line',
          woundsHistory: [{ entityId: 'rookie', stageIndex: 0, maxWounds: 4, wounds: 1 }],
        },
        { id: 'uncovered', type: 'digimon', entityId: 'uncovered', activeEffects: [oldAura] },
      ],
      groupState: { id: 'group', data: {
        claims: [{ interceptorParticipantId: 'source', targetId: 'protected', damageDealt }],
        originalTargetIds: ['protected', 'uncovered'], npcTargetIds: ['uncovered'],
        attackerId: 'attacker', attackerName: 'Attacker', attackId: 'attack', accuracySuccesses: 1, accuracyDice: [6],
      } },
    })
    assert.equal(resolutions.length, 1)
    assert.deepEqual(resolutions[0].participantPositions, positions)
    if (damageDealt > 0) {
      assert.equal(refreshes.length, 1)
      assert.equal(refreshes[0].participants[0].entityId, 'rookie')
      assert.deepEqual(refreshes[0].positions, positions)
      assert.deepEqual(resolutions[0].participants[1].activeEffects, [])
      assert.deepEqual(result.participants[1].activeEffects, [])
    } else {
      assert.deepEqual(refreshes, [])
      assert.deepEqual(resolutions[0].participants[1].activeEffects, [oldAura])
    }
  })
}
