import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { getAttackOrderModifiers, consumeAttackOrders, signatureReadyRound, preserveEnduringSoul, expireRoundSpecialOrders } = loadTypeScript('utils/specialOrderCombat.ts')
const { applyFatefulPool, applyFatefulCheck, getFatefulModifier } = loadTypeScript('utils/fatefulIntervention.ts')
const { getEffectStatModifiers } = loadTypeScript('data/attackConstants.ts')
const { queueStrikeLastCounter, offerStrikeLastOnMiss } = loadTypeScript('server/utils/strikeLast.ts')
const { deferSpecialOrderCost, applyDeferredIntercedeCost } = loadTypeScript('utils/intercedeActions.ts')

test('reaction orders borrow from the next round, while ordinary intercede debt still repays at the next turn', () => {
  const participant = deferSpecialOrderCost({ actionsRemaining: { simple: 2 }, interceptPenalty: 1 }, 1)
  applyDeferredIntercedeCost(participant, 1)
  assert.equal(participant.actionsRemaining.simple, 1, 'only the ordinary intercede is due this round')
  assert.equal(participant.interceptPenalty, 1)
  participant.actionsRemaining.simple = 2
  applyDeferredIntercedeCost(participant, 2)
  assert.equal(participant.actionsRemaining.simple, 1)
  assert.equal(participant.interceptPenalty, 0)
  applyDeferredIntercedeCost(participant, 2)
  assert.equal(participant.actionsRemaining.simple, 1, 'the next-round cost is never paid twice')
})

const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const priorGlobals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of priorGlobals) value === undefined ? delete globalThis[name] : globalThis[name] = value })

test('attack orders are snapshotted and consumed once per cast', () => {
  const p = { strikeFastReady: true, finishingTouchReady: true, decimationReady: true }
  assert.deepEqual(getAttackOrderModifiers(p), { halfDodge: true, successThreshold: 4, suppressPower: true })
  const used = consumeAttackOrders(p)
  assert.deepEqual(getAttackOrderModifiers(used), { halfDodge: false, successThreshold: 5, suppressPower: false })
  assert.equal(p.strikeFastReady, true)
  assert.equal(signatureReadyRound(used), 2)
  assert.equal(signatureReadyRound({}), 3)
})

test('Quick Reaction survives defenses and expires only at round rollover', () => {
  const p = { quickReactionDiceBonus: 5, dodgePenalty: 2, activeEffects: [{ name: 'Directed', value: 3 }] }
  assert.equal(expireRoundSpecialOrders(p).quickReactionDiceBonus, 0)
  assert.equal(p.quickReactionDiceBonus, 5)
})

test('Enduring Soul leaves one wound box once and cannot revive an already defeated unit', () => {
  const p = { type: 'digimon', currentWounds: 10, maxWounds: 10, enduringSoulAvailable: true }
  assert.equal(preserveEnduringSoul(p, 4), true)
  assert.equal(p.currentWounds, 9)
  p.currentWounds = 10
  assert.equal(preserveEnduringSoul(p, 9), false)
  assert.equal(p.currentWounds, 10)
  assert.equal(preserveEnduringSoul({ ...p, enduringSoulUsed: false, enduringSoulAvailable: true }, 10), false)
})

test('Bastion and Debilitate alter combat stats by two and cancel', () => {
  const bastion = { name: 'Bastion', potency: 2 }, debilitate = { name: 'Debilitate', potency: 2 }
  assert.deepEqual(getEffectStatModifiers([bastion]), { accuracy: 2, damage: 2, dodge: 2, armor: 2 })
  assert.deepEqual(getEffectStatModifiers([bastion, debilitate]), { accuracy: 0, damage: 0, dodge: 0, armor: 0 })
})

test('Fateful Intervention uses independent signs and exactly the resulting pool of chosen dice', () => {
  assert.equal(getFatefulModifier(3, { bonusSign: 1, willpowerSign: -1 }), 2)
  const choice = { bonusSign: 1, willpowerSign: -1, diceResults: Array(10).fill(4) }
  assert.deepEqual(applyFatefulPool(8, 3, choice, 4), { rolls: choice.diceResults, dicePool: 10, successes: 10, modifier: 2 })
  assert.throws(() => applyFatefulPool(8, 3, { ...choice, diceResults: [6] }), /exactly 10/)
  assert.throws(() => applyFatefulPool(0, 0, { bonusSign: 1, willpowerSign: 1, diceResults: [6, 6, 7, 6, 6] }), /1 to 6/)
  assert.equal(applyFatefulCheck(2, 3, { bonusSign: -1, willpowerSign: 1, diceResults: [1, 2, 3] }).total, 6)
})

function fixture(orderName, extra = {}) {
  const tables = { encounters: { id: 'encounters.id' }, tamers: { id: 'tamers.id' }, digimon: { id: 'digimon.id' }, campaigns: { id: 'campaigns.id' } }
  const owner = { id: 'owner', type: 'tamer', entityId: 'tamer', actionsRemaining: { simple: 2 }, usedSpecialOrders: [] }
  const partner = { id: 'partner', type: 'digimon', entityId: 'digimon', currentWounds: 8, maxWounds: 10, activeEffects: [] }
  const enemy = { id: 'enemy', type: 'digimon', entityId: 'enemy-record', isEnemy: true, activeEffects: [] }
  const encounter = { id: 'enc', campaignId: 'campaign', participants: [owner, partner, enemy], phase: 'combat', turnOrder: ['owner'], currentTurnIndex: 0, round: 2, pendingRequests: [], requestResponses: [], battleLog: [] }
  const tamer = { id: 'tamer', name: 'Tamer', campaignId: 'campaign', attributes: { agility: 5, body: 5, charisma: 5, intelligence: 5, willpower: 5 }, xpBonuses: null, usedPerDayOrders: [] }
  const records = [{ id: 'digimon', partnerId: 'tamer' }, { id: 'enemy-record' }]
  const body = { participantId: 'owner', orderName, ...extra }
  const writes = []
  const database = {
    select() { return { from(table) { return { async where() { return table === tables.encounters ? [encounter] : table === tables.tamers ? [tamer] : table === tables.digimon ? records : [{ id: 'campaign', level: 'standard' }] } } } } },
    update(table) { return { set(patch) { return { async where() { writes.push({ table, patch }); Object.assign(table === tables.tamers ? tamer : encounter, patch) } } } } },
  }
  globalThis.defineEventHandler = fn => fn
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async () => body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/special-order.post.ts', {
    '../../../../db': { db: database, ...tables },
    '../../../../utils/resolveSupportAttack': { getDigimonDerivedStats: async () => ({ cpu: 3 }) },
    '../../../../utils/intercedeClaims': { serializeIntercedeClaim: async (_id, run) => run() },
  }).default
  return { encounter, owner, partner, enemy, tamer, writes, body, run: () => handler({}) }
}

test('Peak Performance buffs only the actual partner and pays the complex action', async () => {
  const f = fixture('Peak Performance')
  await f.run()
  assert.deepEqual(f.encounter.participants[1].activeEffects.map(e => [e.name, e.potency, e.duration]), [['Bastion', 2, 1]])
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 0)
  assert.deepEqual(f.enemy.activeEffects, [])
  assert.deepEqual(f.tamer.usedPerDayOrders, ['Peak Performance'])
})

test('Energy Burst heals a fixed five wounds', async () => {
  const f = fixture('Energy Burst')
  await f.run()
  assert.equal(f.encounter.participants[1].currentWounds, 3)
})

test('Strike Fast requires movement in this exact turn and refuses without charging', async () => {
  const f = fixture('Strike Fast!')
  f.partner.lastMovedTurnKey = '1:0'
  await assert.rejects(f.run, /move this turn/)
  assert.equal(f.writes.length, 0)
  f.partner.lastMovedTurnKey = '2:0'
  await f.run()
  assert.equal(f.encounter.participants[1].strikeFastReady, true)
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 0)
})

test('Finishing Touch and Decimation store their next-attack mechanics', async () => {
  const finish = fixture('Finishing Touch')
  await finish.run()
  assert.equal(finish.encounter.participants[1].finishingTouchReady, true)
  assert.equal(finish.encounter.participants[0].actionsRemaining.simple, 1)
  const decimate = fixture('Decimation')
  await decimate.run()
  assert.equal(signatureReadyRound(decimate.encounter.participants[1]), 2)
})

test('Swagger Taunts one enemy for three rounds at CPU times two', async () => {
  const f = fixture('Swagger', { targetId: 'enemy' })
  await f.run()
  const taunt = f.encounter.participants[2].activeEffects[0]
  assert.deepEqual([taunt.name, taunt.duration, taunt.potency, taunt.source], ['Taunt', 3, 6, 'partner'])
  assert.deepEqual(f.partner.activeEffects, [])
})

test('Enemy Scan rejects allies and replaces existing Debilitate rather than stacking', async () => {
  const f = fixture('Enemy Scan', { targetId: 'partner' })
  await assert.rejects(f.run, /enemy Digimon/)
  f.body.targetId = 'enemy'
  f.enemy.activeEffects = [{ id: 'old', name: 'Debilitate', duration: 4, source: 'Another tamer', potency: 2 }]
  await f.run()
  assert.equal(f.encounter.participants[2].activeEffects.length, 1)
  assert.equal(f.encounter.participants[2].activeEffects[0].duration, 1)
})

test('Tough it Out purifies the chosen negative effect and keeps buffs', async () => {
  const f = fixture('Tough it Out!', { effectId: 'fear' })
  f.partner.activeEffects = [{ id: 'burn', name: 'Burn', type: 'debuff' }, { id: 'fear', name: 'Fear', type: 'debuff' }, { id: 'buff', name: 'Fury', type: 'buff' }]
  await f.run()
  assert.deepEqual(f.encounter.participants[1].activeEffects.map(e => e.id), ['burn', 'buff'])
})

test('Strike Last is allowed out of turn, borrows one Tamer action and prepares a separate Counter Blow', async () => {
  const f = fixture('Strike Last!', { requestId: 'incoming' })
  f.encounter.turnOrder = ['enemy', 'owner']
  f.encounter.pendingRequests = [{ id: 'incoming', type: 'dodge-roll', targetParticipantId: 'partner', data: { attackerParticipantId: 'enemy', intercedeGroupId: 'cast' } }]
  await f.run()
  assert.equal(f.encounter.participants[0].interceptPenalty, 1)
  assert.equal(f.encounter.participants[0].actionsRemaining.simple, 2)
  const queued = queueStrikeLastCounter(f.encounter.participants, f.encounter.pendingRequests, f.encounter.pendingRequests[0])
  const prompt = queued.pendingRequests.find(r => r.type === 'counterattack-prompt')
  assert.equal(prompt.data.strikeLast, true)
  assert.equal(prompt.data.counterBlow, true)
  assert.equal(prompt.data.suppressPower, true)
  assert.equal(queued.participants[1].usedCounterattackThisCombat, undefined)
  assert.equal(queueStrikeLastCounter(queued.participants, queued.pendingRequests, f.encounter.pendingRequests[0]).pendingRequests.length, queued.pendingRequests.length)
  await assert.rejects(f.run, /already been used/)
})

test('an automatic miss offers Strike Last without requiring zero-dice rolls or spending the Counterattack quality', async () => {
  const f = fixture('Strike Last!', { requestId: 'unused' })
  const pending = await offerStrikeLastOnMiss(f.encounter.participants, [], {
    id: 'miss', attackerId: 'enemy', targetIds: ['partner'], round: 2, attackerName: 'Enemy', attackName: 'Missed attack',
  }, 'standard', { digimon: async () => ({ id: 'digimon', partnerId: 'tamer', name: 'Partner' }), tamer: async () => f.tamer })
  assert.equal(pending[0].type, 'strike-last-offer')
  f.encounter.pendingRequests = pending
  f.body.requestId = pending[0].id
  await f.run()
  assert.equal(f.encounter.pendingRequests.some(r => r.type === 'dodge-roll'), false)
  assert.equal(f.encounter.pendingRequests.some(r => r.type === 'strike-last-offer'), false)
  assert.equal(f.encounter.pendingRequests[0].type, 'counterattack-prompt')
  assert.equal(f.encounter.pendingRequests[0].data.counterBlow, true)
  assert.equal(f.encounter.participants[0].interceptPenalty, 1)
})
