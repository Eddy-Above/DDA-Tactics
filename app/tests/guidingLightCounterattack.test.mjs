import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const guidingLight = { name: 'Guiding Light', potency: 1 }

function scenario({ effects = [], targetType = 'npc', baseAccuracy = 4, bonusAccuracy = 1, playerCounterattacker = false, chainCounter = false, resolution } = {}) {
  const counterattacker = {
    id: 'counterattacker', type: 'digimon', entityId: 'counterattacker-entity',
    activeEffects: effects, currentWounds: 0, maxWounds: 10,
  }
  const target = {
    id: 'original-attacker', type: targetType === 'tamer' ? 'tamer' : 'digimon',
    entityId: 'target-entity', activeEffects: [], currentWounds: 0, maxWounds: 10,
  }
  const participants = [counterattacker, target]
  const digimonTable = { id: 'digimon.id' }
  const tamerTable = { id: 'tamers.id' }
  const digimonRows = new Map([
    [counterattacker.entityId, {
      id: counterattacker.entityId, name: 'Counterattacker', isEnemy: false,
      partnerId: playerCounterattacker ? 'counterattacker-tamer' : null,
      baseStats: { accuracy: baseAccuracy }, bonusStats: { accuracy: bonusAccuracy },
      attacks: [{ id: 'attack', name: 'Strike', type: 'damage', tags: [], range: 'melee' }],
      qualities: chainCounter ? [{ id: 'chain-counter' }] : [],
    }],
    [target.entityId, {
      id: target.entityId, name: 'Original Attacker',
      isEnemy: targetType === 'npc', partnerId: targetType === 'partner' ? 'target-tamer' : null,
    }],
  ])
  const tamerRows = new Map([[target.entityId, { id: target.entityId, name: 'Target Tamer' }]])
  const db = {
    select: () => ({
      from: table => ({
        where: async condition => {
          const row = (table === digimonTable ? digimonRows : tamerRows).get(condition.value)
          return row ? [row] : []
        },
      }),
    }),
  }
  const resolutions = []
  const { triggerCounterattack } = loadTypeScriptWithMocks('server/utils/triggerCounterattack.ts', {
    'drizzle-orm': { eq: (column, value) => ({ column, value }) },
    '../db': { db, digimon: digimonTable, tamers: tamerTable },
    './resolveNpcAttack': {
      resolveNpcAttack: async params => {
        resolutions.push(params)
        return resolution ? resolution(params) : {
          participants: params.participants,
          battleLog: params.battleLog,
          turnOrder: params.turnOrder,
          nextTurnIndex: params.currentTurnIndex,
          nextRound: params.round,
        }
      },
    },
  })
  const params = {
    participants, battleLog: [], pendingRequests: [], round: 1,
    counterattackerParticipantId: counterattacker.id,
    originalAttackerParticipantId: target.id,
    turnOrder: [target.id, counterattacker.id], currentTurnIndex: 0, encounterId: 'encounter',
  }
  return { run: () => triggerCounterattack(params), params, counterattacker, target, resolutions }
}

test('Guiding Light adds two Accuracy dice to an automatic counterattack against an NPC', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const { run, resolutions } = scenario({ effects: [guidingLight] })
  const result = await run()
  assert.equal(resolutions.length, 1)
  assert.deepEqual(resolutions[0].accuracyDice, [6, 6, 6, 6, 6, 6, 6])
  assert.equal(resolutions[0].accuracySuccesses, 7)
  assert.equal(resolutions[0].counterattack, true)
  assert.equal(resolutions[0].encounterId, 'encounter')
  assert.match(result.battleLog[0].result, /^7d6 => /)
})

for (const targetType of ['partner', 'tamer']) {
  test(`the aura also applies when the NPC counterattack sends a dodge prompt to a player ${targetType}`, async t => {
    t.mock.method(Math, 'random', () => 0.99)
    const { run, resolutions, target } = scenario({ effects: [guidingLight], targetType })
    const result = await run()
    assert.equal(resolutions.length, 0)
    assert.equal(result.pendingRequests.length, 1)
    const request = result.pendingRequests[0]
    assert.equal(request.type, 'dodge-roll')
    assert.equal(request.targetParticipantId, target.id)
    assert.equal(request.targetTamerId, targetType === 'partner' ? 'target-tamer' : target.entityId)
    assert.deepEqual(request.data.accuracyDice, [6, 6, 6, 6, 6, 6, 6])
    assert.equal(request.data.accuracySuccesses, 7)
    assert.equal(request.data.halfDodge, true)
    assert.equal(request.data.isCounterattack, true)
  })
}

test('an automatic counterattack without the aura retains its original base plus bonus pool', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const { run, resolutions } = scenario()
  await run()
  assert.equal(resolutions[0].accuracyDice.length, 5)
  assert.equal(resolutions[0].accuracySuccesses, 5)
})

test('Guiding Light combines with the shared positive and negative Accuracy modifiers', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const { run, resolutions } = scenario({ effects: [guidingLight, { name: 'Fury', potency: 2 }, { name: 'Distract', potency: 1 }] })
  await run()
  assert.equal(resolutions[0].accuracyDice.length, 8)
})

test('negative Accuracy effects cannot reduce the automatic pool below one die', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const { run, resolutions } = scenario({ effects: [{ name: 'Distract', potency: 9 }] })
  await run()
  assert.deepEqual(resolutions[0].accuracyDice, [6])
})

test('the existing three-die zero-stat fallback remains, with the aura added afterward', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const withoutAura = scenario({ baseAccuracy: 0, bonusAccuracy: 0 })
  const withAura = scenario({ baseAccuracy: 0, bonusAccuracy: 0, effects: [guidingLight] })
  await withoutAura.run()
  await withAura.run()
  assert.equal(withoutAura.resolutions[0].accuracyDice.length, 3)
  assert.equal(withAura.resolutions[0].accuracyDice.length, 5)
})

test('a player-controlled counterattacker still receives the attack-choice prompt without automatic resolution', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const { run, params, resolutions, counterattacker } = scenario({ playerCounterattacker: true, effects: [guidingLight] })
  const result = await run()
  assert.equal(resolutions.length, 0)
  assert.strictEqual(result.participants, params.participants)
  assert.strictEqual(result.battleLog, params.battleLog)
  assert.equal(result.participants[0].usedCounterattackThisCombat, undefined)
  assert.equal(result.pendingRequests.length, 1)
  assert.equal(result.pendingRequests[0].type, 'counterattack-prompt')
  assert.equal(result.pendingRequests[0].targetTamerId, 'counterattacker-tamer')
  assert.equal(result.pendingRequests[0].targetParticipantId, counterattacker.id)
  assert.equal(result.pendingRequests[0].data.accuracyDice, undefined)
})

test('zero successes still auto-miss after rolling the augmented pool', async t => {
  t.mock.method(Math, 'random', () => 0)
  const { run, resolutions } = scenario({ effects: [guidingLight] })
  const result = await run()
  assert.equal(resolutions.length, 0)
  assert.equal(result.pendingRequests.length, 0)
  assert.equal(result.participants[0].usedCounterattackThisCombat, true)
  assert.match(result.battleLog[0].result, /^7d6 => /)
  assert.equal(result.battleLog[1].result, 'AUTO MISS - 0 accuracy successes')
})

test('a knockout retains the shortened turn order, next turn and Chain Counter behavior', async t => {
  t.mock.method(Math, 'random', () => 0.99)
  const { run } = scenario({
    effects: [guidingLight], chainCounter: true,
    resolution: params => ({
      participants: params.participants.filter(participant => participant.id === 'counterattacker'),
      battleLog: params.battleLog,
      turnOrder: ['counterattacker'], nextTurnIndex: 0, nextRound: 2,
    }),
  })
  const result = await run()
  assert.deepEqual(result.turnOrder, ['counterattacker'])
  assert.equal(result.nextTurnIndex, 0)
  assert.equal(result.nextRound, 2)
  assert.equal(result.participants[0].usedCounterattackThisCombat, false)
  assert.ok(result.battleLog.some(entry => entry.effects.includes('Chain Counter')))
})
