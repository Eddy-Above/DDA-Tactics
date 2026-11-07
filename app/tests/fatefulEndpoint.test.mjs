import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const names = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const original = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of original) value === undefined ? delete globalThis[name] : globalThis[name] = value })

function fixture() {
  const tables = Object.fromEntries(['encounters', 'tamers', 'digimon', 'campaigns', 'maps', 'evolutionLines'].map(name => [name, { id: `${name}.id` }]))
  const tamer = { id: 'tamer', name: 'Tamer', inspiration: 5, attributes: { willpower: 3 }, xpBonuses: { attributes: { willpower: 2 }, skills: {}, inspiration: 0 } }
  const attack = { id: 'attack', range: 'melee', type: 'damage', tags: ['Weapon I'] }
  const records = [{ id: 'defender', partnerId: 'tamer', baseStats: { accuracy: 8, damage: 4, dodge: 8, armor: 2 }, bonusStats: {}, qualities: [] },
    { id: 'attacker', stage: 'rookie', size: 'medium', baseStats: { accuracy: 8, damage: 4, dodge: 8, armor: 2 }, bonusStats: {}, qualities: [{ id: 'digizoid-weapon', choiceId: 'blue' }], attacks: [attack] }]
  const encounter = { id: 'enc', campaignId: 'campaign', phase: 'combat', round: 1,
    participants: [{ id: 'owner', type: 'tamer', entityId: 'tamer', currentInspiration: 5 }, { id: 'defender-p', type: 'digimon', entityId: 'defender', quickReactionDiceBonus: 5 }, { id: 'attacker-p', type: 'digimon', entityId: 'attacker', isEnemy: true }],
    pendingRequests: [], requestResponses: [], battleLog: [] }
  let body
  const writes = []
  const db = {
    select: () => ({ from: table => ({ where: async condition => table === tables.encounters ? [encounter]
      : table === tables.tamers ? [tamer] : table === tables.digimon ? records.filter(r => r.id === condition.value) : [{ level: 'standard' }] }) }),
    update: table => ({ set: patch => ({ where: async () => { writes.push({ table, patch }); Object.assign(table === tables.encounters ? encounter : tamer, patch) } }) }),
  }
  const eq = (column, value) => ({ column, value })
  globalThis.defineEventHandler = fn => fn
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async () => body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const spend = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/spend-inspiration.post.ts', {
    '../../../../db': { db, ...tables }, 'drizzle-orm': { eq },
  }).default
  const respond = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', {
    '../../../db': { db, ...tables }, 'drizzle-orm': { eq },
  }).default
  const request = (id = 'request') => ({ id, type: 'dodge-roll', targetTamerId: 'tamer', targetParticipantId: 'defender-p',
    data: { intercedeGroupId: 'cast', attackerParticipantId: 'attacker-p', targetEntityId: 'defender', accuracyDice: [5, 4], accuracySuccesses: 1, attackId: 'attack', attackData: attack, halfDodge: true, finishingTouch: true, totalTargetCount: 2 } })
  return { encounter, tamer, writes, request,
    spend: value => { body = { participantId: 'owner', spendType: 'fateful-intervention', amount: 5, bonusSign: 1, willpowerSign: 1, ...value }; return spend({}) },
    respond: value => { body = value; return respond({}) },
  }
}

test('Fateful pays maximum potential Inspiration and includes XP Willpower, with invalid choices changing nothing', async () => {
  const f = fixture()
  await assert.rejects(() => f.spend({ rollId: 'attack', rollType: 'accuracy', baseDicePool: 2, diceResults: Array(11).fill(6) }), /exactly 12/)
  assert.equal(f.writes.length, 0)
  await f.spend({ rollId: 'attack', rollType: 'accuracy', baseDicePool: 2, diceResults: Array(12).fill(6) })
  assert.equal(f.encounter.participants[0].currentInspiration, 0)
  assert.equal(f.tamer.inspiration, 0)
  assert.match(f.encounter.battleLog[0].result, /\[6, 6/)
})

test('Fateful Accuracy changes an entire unanswered cast and retains Finishing Touch plus Blue auto-success', async () => {
  const f = fixture()
  f.encounter.pendingRequests = [f.request('one'), f.request('two')]
  await f.spend({ requestId: 'one', rollType: 'accuracy', diceResults: Array(12).fill(4) })
  assert.deepEqual(f.encounter.pendingRequests.map(r => r.data.accuracySuccesses), [13, 13])
  assert.deepEqual(f.encounter.pendingRequests.map(r => r.data.accuracyDice.length), [12, 12])
})

test('Fateful cannot change an area cast after any defense was answered', async () => {
  const f = fixture()
  f.encounter.pendingRequests = [f.request('one'), { ...f.request('two'), answeredAt: 'already' }]
  await assert.rejects(() => f.spend({ requestId: 'one', rollType: 'accuracy', diceResults: Array(12).fill(6) }), /already has a defense/)
  assert.equal(f.writes.length, 0)
})

test('a request stores paid Dodge dice and the response uses those exact faces after refresh or retry', async () => {
  const f = fixture()
  const request = f.request()
  delete request.data.attackId // Exercise response persistence without damage-side dependencies.
  f.encounter.pendingRequests = [request]
  // Dodge 8 + Quick Reaction 5, halved once = 6; Fateful adds 5 + Willpower 5.
  await f.spend({ requestId: request.id, rollType: 'dodge', baseDicePool: 6, diceResults: Array(16).fill(6) })
  assert.equal(f.encounter.pendingRequests[0].data.fatefulIntervention.diceResults.length, 16)
  await f.respond({ requestId: request.id, tamerId: 'tamer', response: { type: 'dodge-rolled', dodgeDicePool: 1, dodgeDiceResults: [1], dodgeSuccesses: 0 } })
  const stored = f.encounter.requestResponses[0].response
  assert.equal(stored.dodgeDicePool, 16)
  assert.deepEqual(stored.dodgeDiceResults, Array(16).fill(6))
  assert.equal(stored.dodgeSuccesses, 16)
})

test('halved defenses cap unpaid dice on the server for Clash, Counterattack and Strike Fast', async () => {
  for (const flags of [{ clashAttack: true }, { halfDodge: true }, { strikeFast: true }]) {
    const f = fixture()
    Object.assign(f.encounter, { turnOrder: ['attacker-p', 'owner'], currentTurnIndex: 0 })
    const incoming = f.request()
    Object.assign(incoming.data, { halfDodge: false, isSupportAttack: true, ...flags })
    f.encounter.pendingRequests = [incoming]
    await f.respond({ requestId: incoming.id, tamerId: 'tamer', response: {
      type: 'dodge-rolled', dodgeDicePool: 30, dodgeDiceResults: Array(30).fill(6), dodgeSuccesses: 30,
    } })
    const response = f.encounter.requestResponses[0].response
    assert.equal(response.dodgeDicePool, 6, 'Dodge 8 + Quick Reaction 5, then halved once')
    assert.equal(response.dodgeDiceResults.length, 6)
    assert.equal(response.dodgeSuccesses, 6)
    assert.equal(f.encounter.battleLog.at(-1).dodgeSuccesses, 6)
    const before = f.encounter.requestResponses.length
    await f.respond({ requestId: incoming.id, tamerId: 'tamer', response: {
      type: 'dodge-rolled', dodgeDicePool: 30, dodgeDiceResults: Array(30).fill(6), dodgeSuccesses: 30,
    } })
    assert.equal(f.encounter.requestResponses.length, before, 'a retry does not apply a second defense')
  }
})

test('request-bound Act and extra dice survive the half-pool cap; a paid reroll grants no extra dice', async () => {
  const f = fixture()
  Object.assign(f.encounter, { turnOrder: ['attacker-p', 'owner'], currentTurnIndex: 0 })
  const incoming = f.request()
  incoming.data.isSupportAttack = true
  f.encounter.pendingRequests = [incoming]
  await f.spend({ requestId: incoming.id, spendType: 'act-of-inspiration', amount: 2 })
  await f.spend({ requestId: incoming.id, spendType: 'modifier', amount: 1 })
  await f.spend({ requestId: incoming.id, spendType: 'reroll', amount: 1 })
  assert.equal(f.encounter.pendingRequests[0].data.paidDodgeDiceBonus, 6)
  assert.equal(f.encounter.participants[0].currentInspiration, 1)
  const writes = f.writes.length
  await assert.rejects(() => f.spend({ requestId: incoming.id, spendType: 'act-of-inspiration', amount: 2 }), /already paid/)
  assert.equal(f.writes.length, writes)
  await f.respond({ requestId: incoming.id, tamerId: 'tamer', response: {
    type: 'dodge-rolled', dodgeDicePool: 20, dodgeDiceResults: Array(20).fill(6), dodgeSuccesses: 20,
  } })
  assert.equal(f.encounter.requestResponses[0].response.dodgeDiceResults.length, 12)
  assert.equal(f.encounter.requestResponses[0].response.dodgeSuccesses, 12)
})

test('unbound Inspiration spends cannot extend a different halved defense', async () => {
  const f = fixture()
  Object.assign(f.encounter, { turnOrder: ['attacker-p', 'owner'], currentTurnIndex: 0 })
  const incoming = f.request()
  incoming.data.isSupportAttack = true
  f.encounter.pendingRequests = [incoming]
  await f.spend({ spendType: 'act-of-inspiration', amount: 2 })
  assert.equal(f.encounter.pendingRequests[0].data.paidDodgeDiceBonus, undefined)
  await f.respond({ requestId: incoming.id, tamerId: 'tamer', response: {
    type: 'dodge-rolled', dodgeDicePool: 11, dodgeDiceResults: Array(11).fill(6), dodgeSuccesses: 11,
  } })
  assert.equal(f.encounter.requestResponses[0].response.dodgeSuccesses, 6)
})

test('a refused, foreign or answered defense spend grants no dice and charges nothing', async () => {
  for (const reason of ['insufficient', 'foreign', 'answered']) {
    const f = fixture()
    const incoming = f.request()
    f.encounter.pendingRequests = [incoming]
    if (reason === 'insufficient') f.encounter.participants[0].currentInspiration = 0
    if (reason === 'foreign') incoming.targetTamerId = 'someone-else'
    if (reason === 'answered') incoming.answeredAt = 'already'
    await assert.rejects(() => f.spend({ requestId: incoming.id, spendType: 'modifier', amount: 1 }))
    assert.equal(f.writes.length, 0)
    assert.equal(f.encounter.pendingRequests[0].data.paidDodgeDiceBonus, undefined)
  }
})

test('Fateful Dodge cannot claim unpaid base dice and cannot be adjusted after its faces are fixed', async () => {
  const f = fixture()
  const incoming = f.request()
  f.encounter.pendingRequests = [incoming]
  await assert.rejects(() => f.spend({ requestId: incoming.id, rollType: 'dodge', baseDicePool: 100, diceResults: Array(110).fill(6) }), /Invalid Dodge pool/)
  assert.equal(f.writes.length, 0)
  await f.spend({ requestId: incoming.id, rollType: 'dodge', baseDicePool: 6, diceResults: Array(16).fill(6) })
  f.encounter.participants[0].currentInspiration = 5
  const writes = f.writes.length
  await assert.rejects(() => f.spend({ requestId: incoming.id, spendType: 'modifier', amount: 1 }), /already fixed/)
  assert.equal(f.writes.length, writes)
})

test('an accidental second Fateful confirmation for the same local roll cannot spend again', async () => {
  const f = fixture()
  const choice = { rollId: 'check', rollType: 'check', diceResults: [6, 6, 6] }
  await f.spend(choice)
  f.encounter.participants[0].currentInspiration = 5
  const writes = f.writes.length
  await assert.rejects(() => f.spend(choice), /already affected/)
  assert.equal(f.writes.length, writes)
})

test('Fateful Dodge retains prior approved bonus dice without counting them twice on submission', async () => {
  const f = fixture()
  f.tamer.inspiration = 7
  f.encounter.participants[0].currentInspiration = 7
  const incoming = f.request()
  delete incoming.data.attackId
  f.encounter.pendingRequests = [incoming]
  await f.spend({ requestId: incoming.id, spendType: 'act-of-inspiration', amount: 2 })
  await f.spend({ requestId: incoming.id, rollType: 'dodge', baseDicePool: 11, diceResults: Array(21).fill(6) })
  await f.respond({ requestId: incoming.id, tamerId: 'tamer', response: {
    type: 'dodge-rolled', dodgeDicePool: 30, dodgeDiceResults: Array(30).fill(6), dodgeSuccesses: 30,
  } })
  assert.equal(f.encounter.requestResponses[0].response.dodgeDiceResults.length, 21)
  assert.equal(f.encounter.requestResponses[0].response.dodgeSuccesses, 21)
})
