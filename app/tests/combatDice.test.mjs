import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { combatAttackStats, digimonDodgeBase } = loadTypeScript('utils/combatDice.ts')
const { computeDodgeDefense } = loadTypeScript('utils/areaDefense.ts')
const { serverDodgeDefense, recountDodgeDice, recountSubmittedDodge } = loadTypeScript('server/utils/combatDodge.ts')
const { prepareAttackAccuracy } = loadTypeScript('utils/attackAccuracy.ts')
const { useAreaDefenseBatch } = loadTypeScript('composables/useAreaDefenseBatch.ts')
const { getAttackOrderModifiers, consumeAttackOrders, expireRoundSpecialOrders, preserveEnduringSoul } = loadTypeScript('utils/specialOrderCombat.ts')
const { applyFatefulPool } = loadTypeScript('utils/fatefulIntervention.ts')
const { applyDerivedStatEffects } = loadTypeScript('data/attackConstants.ts')

test('Bastion and Debilitate change combat derived stats without changing Health or double-counting Dodge', () => {
  const stats = { body: 10, bit: 2, movement: 4, range: 8, effectiveLimit: 12, dodge: 8, health: 9, woundBoxes: 10, stageBonus: 2 }
  const buffed = applyDerivedStatEffects(stats, [{ name: 'Bastion', potency: 2 }])
  assert.equal(buffed.movement, 6)
  assert.equal(buffed.bit, 4)
  assert.equal(buffed.body, 12)
  assert.equal(buffed.dodge, 8)
  assert.equal(buffed.health, 9)
  assert.equal(buffed.woundBoxes, 10)
  assert.equal(buffed.stageBonus, 2)
  assert.deepEqual(applyDerivedStatEffects(buffed, [{ name: 'Debilitate', potency: 2 }]), stats)
})

test('stored Fateful Dodge can choose zero dice and is applied after once-only halving', () => {
  const result = computeDodgeDefense(request({ halfDodge: true, fatefulIntervention: { diceResults: [] } }), context(target))
  assert.equal(result.pool, 0)
  assert.equal(result.blocked, false)
  assert.deepEqual(result.modifiers.at(-1), { label: 'Fateful Intervention', value: -4 })
})

const record = { id: 'mon', stage: 'rookie', size: 'medium',
  baseStats: { accuracy: 8, damage: 6, dodge: 8, armor: 10, health: 9 }, bonusStats: {}, qualities: [] }
const target = { id: 'target', type: 'digimon', entityId: 'mon', currentStance: 'neutral', activeEffects: [] }
const request = data => ({ targetParticipantId: 'target', data: { attackId: 'fire', ...data } })
const context = (p, d = record) => ({ participants: [p], findDigimon: () => d, findTamer: () => undefined, digimonDodge: digimonDodgeBase })

test('Quick Reaction persists across defenses and is reduced with the successive-attack pool', () => {
  const participant = { ...target, quickReactionDiceBonus: 5 }
  assert.equal(computeDodgeDefense(request(), context(participant)).pool, 13)
  assert.equal(computeDodgeDefense(request({ dodgePenalty: 1 }), context(participant)).pool, 12)
  assert.equal(computeDodgeDefense(request({ dodgePenalty: 2 }), context(participant)).pool, 11)
  assert.equal(participant.quickReactionDiceBonus, 5, 'rolling does not consume the round-long bonus')
})

test('server and player share swaps, Dark Evolution, armor, mood, boss stacks and exactly one half', () => {
  const digimon = { ...record, isDarkEvolution: true, qualities: [
    { id: 'instinct', ranks: 2 }, { id: 'digizoid-armor', choiceId: 'blue' },
    { id: 'positive-reinforcement' }, { id: 'adaptive-intelligence' },
  ] }
  const participant = { ...target, statSwaps: { dodge: 'armor' }, currentStance: 'defensive',
    blackArmorRoundBonus: { dodge: 2 }, quickReactionDiceBonus: 5, moodValue: 6,
    juggernauntBonuses: { dodge: 2 }, tormentorBonusStacks: 1, seenAttackIds: { fire: 2 },
    activeEffects: [{ name: 'Directed', value: 3 }] }
  const incoming = request({ dodgePenalty: 2, clashAttack: true, halfDodge: true, strikeFast: true })
  const client = computeDodgeDefense(incoming, context(participant, digimon))
  const server = serverDodgeDefense(incoming, [participant], digimon)
  assert.deepEqual(client, server)
  // (swapped armor 12 + instinct 2 + blue 2 + black 2) *1.5 + QR5 - penalty2
  // + mood2 + juggernaut2 + tormentor2 + adaptive4 + Directed3 = 43; once halved => 21.
  assert.equal(server.pool, 21)
  assert.equal(server.modifiers.filter(m => m.label.includes('(half)')).length, 1)
})

test('an outside-clash block overrides Quick Reaction and all halving flags', () => {
  const participant = { ...target, quickReactionDiceBonus: 8, clash: { clashId: 'c' } }
  const attacker = { id: 'outside', type: 'digimon' }
  const result = serverDodgeDefense(request({ attackerParticipantId: 'outside', halfDodge: true }), [participant, attacker], record)
  assert.equal(result.pool, 0)
  assert.equal(result.blocked, true)
})

test('Tamer Dodge includes XP and matches the same server formula', () => {
  const participant = { ...target, type: 'tamer', quickReactionDiceBonus: 3 }
  const tamer = { attributes: { agility: 3 }, skills: { dodge: 2 }, xpBonuses: { attributes: { agility: 2 }, skills: { dodge: 1 } } }
  assert.equal(serverDodgeDefense(request({ dodgePenalty: 1 }), [participant], tamer).pool, 10)
})

test('only request-bound paid Act and extra dice extend a halved defense', () => {
  const incoming = request({ halfDodge: true })
  const defense = serverDodgeDefense(incoming, [target], record)
  assert.equal(defense.pool, 4)
  const withAct = [...Array(defense.pool).fill(1), ...Array(5).fill(6)]
  assert.equal(recountSubmittedDodge(incoming, defense, withAct).successes, 0, 'unpaid extra dice are discarded')
  incoming.data.paidDodgeDiceBonus = 5
  assert.equal(recountSubmittedDodge(incoming, defense, withAct).successes, 5)
  incoming.data.paidDodgeDiceBonus = 6
  assert.equal(recountSubmittedDodge(incoming, defense, [...withAct, 5]).successes, 6)
  assert.equal(recountDodgeDice([0, 7]), null)
  assert.equal(recountDodgeDice([4.5]), null)
})

test('Brown Armor reports one automatic success without changing or halving its dice', () => {
  const digimon = { ...record, qualities: [{ id: 'digizoid-armor', choiceId: 'brown' }] }
  const participant = { ...target, brownArmorAutoDodgeAvailable: true }
  const defense = serverDodgeDefense(request({ halfDodge: true }), [participant], digimon)
  assert.equal(defense.pool, 4)
  assert.equal(defense.automaticSuccesses, 1)
  assert.equal(serverDodgeDefense(request({ cannotDodge: true }), [participant], digimon).automaticSuccesses ?? 0, 0)
})

test('Brown Armor automatic success survives paid area-defense rerolls and added dice', async () => {
  const batch = useAreaDefenseBatch({
    defense: () => ({ pool: 2, blocked: false, half: false, basePool: 2, modifiers: [], automaticSuccesses: 1 }),
    currentInspiration: () => 5, actOfInspirationCost: () => 2, spend: async () => true,
    submit: async () => ({ ok: true }), isAnswered: () => false, isTargetPresent: () => true,
    rollDie: () => 1,
  })
  batch.open('cast', [{ id: 'defense' }])
  await batch.rollOne('defense')
  assert.equal(batch.entries.value[0].roll.successes, 1)
  await batch.rerollOne('defense')
  assert.equal(batch.entries.value[0].roll.successes, 1)
  await batch.addDieOne('defense')
  assert.equal(batch.entries.value[0].roll.successes, 1)
  assert.equal(batch.entries.value[0].roll.dicePool, 3)
})

test('selected counterattack uses the same quality, tag, stance, swap and effect modifiers as a normal attack', () => {
  const digimon = { ...record, isDarkEvolution: true, qualities: [{ id: 'data-optimization', choiceId: 'close-combat' }, { id: 'true-guardian' }] }
  const participant = { ...target, statSwaps: { accuracy: 'armor' }, currentStance: 'offensive',
    activeEffects: [{ name: 'Directed', value: 2 }, { name: 'Guiding Light', potency: 1 }] }
  const basic = combatAttackStats(digimon, participant, { range: 'melee', tags: [] })
  const weapon = combatAttackStats(digimon, participant, { range: 'melee', tags: ['Weapon II', 'Certain Strike'] })
  assert.equal(basic.accuracy, 22)
  assert.equal(weapon.accuracy, basic.accuracy + 4)
  assert.equal(weapon.damage, basic.damage + 2)
})

test('Combat Monster damage is included in shared attack display totals only while the quality is present', () => {
  const digimon = { ...record, qualities: [{ id: 'combat-monster' }] }
  const attack = { range: 'melee', tags: ['Weapon II'] }
  const participant = { ...target, combatMonsterBonus: 4 }
  const boosted = combatAttackStats(digimon, participant, attack)
  assert.equal(boosted.accuracyBonus, 2)
  assert.equal(boosted.damageBonus, 6)
  assert.equal(boosted.damage, record.baseStats.damage + 6)
  assert.deepEqual(boosted.modifiers.find(modifier => modifier.label === 'Combat Monster'), { label: 'Combat Monster', accuracy: 0, damage: 4 })
  assert.equal(combatAttackStats(digimon, { ...participant, combatMonsterBonus: 0 }, attack).damageBonus, 2)
  assert.equal(combatAttackStats(record, participant, attack).damageBonus, 2, 'a stale stored bonus does not apply after losing the quality')
})

test('Finishing Touch counts fours and power suppression prevents Huge Power from rerolling', () => {
  let calls = 0
  const dice = [1, 4, 5]
  const result = prepareAttackAccuracy(3, { hugePower: true }, {
    successThreshold: 4, suppressPower: true, automaticSuccesses: 1,
    random: () => (dice[calls++] - 1) / 6,
  })
  assert.equal(calls, 3)
  assert.deepEqual(result.rolls, dice)
  assert.equal(result.successes, 3)
  assert.equal(result.hadHugePowerRerolls, false)
  assert.equal(result.riders.hugePower, false)
  assert.equal(result.riders.hugePowerRank2, false)
  assert.equal(result.successThreshold, 4)
  assert.equal(result.automaticSuccesses, 1)
})

test('Taunt uses CPU x2 against others and CPU -2 for an area attack that includes its source', () => {
  const actor = { ...target, activeEffects: [{ name: 'Taunt', source: 'taunter', potency: 6 }] }
  const attack = { range: 'ranged', tags: [] }
  const area = { ...attack, tags: ['Area Attack: Burst'] }
  assert.equal(combatAttackStats(record, actor, attack, { targetIds: ['other'] }).accuracy, 2)
  assert.equal(combatAttackStats(record, actor, attack, { targetIds: ['taunter'] }).accuracy, 8)
  assert.equal(combatAttackStats(record, actor, area, { targetIds: ['other'] }).accuracy, 2)
  assert.equal(combatAttackStats(record, actor, area, { targetIds: ['other', 'taunter'] }).accuracy, 7)
  assert.equal(combatAttackStats(record, actor, area, { targetIds: ['taunter'] }).accuracy, 7)
  assert.equal(combatAttackStats(record, actor, area).accuracy, 8, 'no target-dependent penalty before aiming')
  for (const cpu of [0, 1, 2]) {
    const lowCpu = { ...actor, activeEffects: [{ name: 'Taunt', source: 'taunter', potency: cpu * 2 }] }
    assert.equal(combatAttackStats(record, lowCpu, area, { targetIds: ['taunter'] }).accuracy, 8, 'a small CPU never grants bonus accuracy')
  }
})

test('next-attack order snapshots survive consumption, while round expiry only removes Quick Reaction', () => {
  const participant = { strikeFastReady: true, finishingTouchReady: true, decimationReady: true, quickReactionDiceBonus: 5 }
  const snapshot = getAttackOrderModifiers(participant)
  const spent = consumeAttackOrders(participant)
  assert.deepEqual(snapshot, { halfDodge: true, successThreshold: 4, suppressPower: true })
  assert.equal(spent.strikeFastReady, false)
  assert.equal(spent.finishingTouchReady, false)
  assert.equal(spent.decimationReady, true)
  const nextRound = expireRoundSpecialOrders(participant)
  assert.equal(nextRound.quickReactionDiceBonus, 0)
  assert.equal(nextRound.finishingTouchReady, true)
})

test('Enduring Soul prevents the first knockout before devolution and cannot prevent a second', () => {
  const participant = { type: 'digimon', currentWounds: 8, maxWounds: 8, enduringSoulAvailable: true, enduringSoulUsed: false }
  assert.equal(preserveEnduringSoul(participant, 3), true)
  assert.equal(participant.currentWounds, 7)
  assert.equal(participant.enduringSoulAvailable, false)
  assert.equal(participant.enduringSoulUsed, true)
  participant.currentWounds = 8
  assert.equal(preserveEnduringSoul(participant, 7), false)
  assert.equal(participant.currentWounds, 8)
})

test('Fateful transforms the assembled pool while respecting Finishing Touch success faces', () => {
  const result = applyFatefulPool(4, 2, { bonusSign: 1, willpowerSign: -1, diceResults: [4, 4, 5, 6, 1, 2, 3] }, 4)
  assert.equal(result.dicePool, 7)
  assert.equal(result.successes, 4)
  assert.equal(result.modifier, 3)
})
