import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { applyEffectToParticipant } = loadTypeScript('server/utils/applyEffect.ts')
const { getBurnArmor, isImmuneToEffect, applyMovementBurn } = loadTypeScript('server/utils/damageOverTime.ts')
const quality = choiceId => ({ id: 'naturewalk', choiceId, ranks: 1 })
const effect = (name, duration = 7, source = 'attacker') => ({ name, duration, source, type: 'debuff', potency: 3 })
const apply = (name, qualities, environment = [], duration = 7) =>
  applyEffectToParticipant([], effect(name, duration), undefined, qualities, 1, environment)

test('Naturewalk Fire prevents Burn at the shared effect boundary without an active environment', () => {
  const poison = { ...effect('Poison', 3), id: 'poison' }
  const original = [poison]
  assert.deepEqual(applyEffectToParticipant(original, effect('Burn'), undefined, [quality('fire')]), original)
  assert.equal(isImmuneToEffect('Burn', [quality('fire')]), true)
  assert.equal(isImmuneToEffect('Burn', [quality('water')]), false)
  assert.equal(isImmuneToEffect('Poison', [quality('fire')]), false)
})

test('Fire also removes a stale Burn before movement or stationary damage can tick', async () => {
  const record = { id: 'mon', stage: 'rookie', qualities: [quality('fire')], baseStats: { armor: 0 } }
  const records = new Map([['mon', record]])
  const burned = () => ({ id: 'unit', entityId: 'mon', type: 'digimon', currentWounds: 0, activeEffects: [{ ...effect('Burn', 3), id: 'burn' }] })
  const moved = applyMovementBurn([burned()], [{ participantId: 'unit', meters: 8 }], { round: 1, digimonById: records })
  assert.equal(moved.participants[0].currentWounds, 0)
  assert.deepEqual(moved.participants[0].activeEffects, [])
  const dot = loadTypeScriptWithMocks('server/utils/damageOverTime.ts', {
    './combatSpatial': { loadParticipantDigimon: async () => records },
  })
  const roundEnd = await dot.applyRoundEndEffects({ participants: [burned()], endingRound: 1, positions: { unit: { x: 0, y: 0, z: 0 } } })
  assert.equal(roundEnd.participants[0].currentWounds, 0)
  assert.deepEqual(roundEnd.participants[0].activeEffects, [])
})

for (const [element, name, other] of [['thunder', 'Paralysis', 'Blind'], ['light', 'Blind', 'Paralysis']]) {
  test(`Naturewalk ${element} adds one Resistant rank only against ${name}`, () => {
    assert.equal(apply(name, [quality(element)])[0].duration, 5)
    assert.equal(apply(other, [quality(element)])[0].duration, 7)
    assert.equal(apply(name, [quality(element), { id: 'resistant', ranks: 2 }])[0].duration, 1)
    assert.equal(apply(name, [{ id: 'resistant', ranks: 2 }])[0].duration, 3)
  })
}

test('Wood lowers the Poison minimum to two only while its environment qualifies', () => {
  const qualities = [quality('wood'), { id: 'resistant', ranks: 3 }]
  assert.equal(apply('Poison', qualities, ['wood'], 1)[0].duration, 2)
  assert.equal(apply('Poison', qualities, [], 1)[0].duration, 3)
  assert.equal(apply('Poison', [quality('wood')], ['fire'], 1)[0].duration, 3)
  assert.equal(apply('Poison', [quality('wood')], ['wood'], 1)[0].duration, 2)
  assert.equal(apply('Poison', qualities, ['wood'], 12)[0].duration, 6)
})

test('Resistant shortens capped durations and Decisive Defenses preserves positive durations', () => {
  const qualities = [{ id: 'resistant', ranks: 1 }]
  assert.equal(apply('Burn', qualities, [], 10)[0].duration, 1)
  const vigor = { ...effect('Vigor'), type: 'buff' }
  assert.equal(applyEffectToParticipant([], vigor, undefined, qualities)[0].duration, 5)
  assert.equal(applyEffectToParticipant([], vigor, undefined, [...qualities, { id: 'decisive-defenses' }])[0].duration, 7)
  assert.equal(apply('Blind', [...qualities, { id: 'decisive-defenses' }])[0].duration, 5)
})

test('each incoming effect is reduced once before stacking or replacing its source', () => {
  const qualities = [quality('light'), { id: 'resistant', ranks: 1 }]
  const first = applyEffectToParticipant([], effect('Blind', 7, 'one'), undefined, qualities)
  const second = applyEffectToParticipant(first, effect('Blind', 7, 'two'), undefined, qualities)
  assert.equal(first[0].duration, 3)
  assert.equal(second[0].duration, 6)
  const replacement = applyEffectToParticipant(second, effect('Blind', 7, 'two'), undefined, qualities)
  assert.equal(replacement[0].duration, 3)
  assert.equal(second[0].duration, 6, 'the prior effects array is unchanged')
})

function damageFixture() {
  const attack = { id: 'strike', name: 'Strike', type: 'damage', range: 'melee', tags: [] }
  const attacker = { id: 'attacker-record', baseStats: { damage: 10, armor: 3 }, bonusStats: {}, qualities: [], attacks: [attack] }
  const defender = { id: 'defender-record', baseStats: { armor: 7, health: 10 }, bonusStats: {}, qualities: [] }
  const participants = [attacker, defender].map((record, index) => ({ id: index ? 'defender' : 'attacker', entityId: record.id, type: 'digimon', activeEffects: [] }))
  const tables = { digimon: { id: 'digimon' }, tamers: { id: 'tamers' } }
  const db = { select: () => ({ from: () => ({ where: async id => [attacker, defender].filter(record => record.id === id) }) }) }
  const module = loadTypeScriptWithMocks('server/utils/computeAttackDamage.ts', {
    '../db': { db, ...tables },
    'drizzle-orm': { eq: (_column, id) => id },
    './resolveSupportAttack': { getDigimonDerivedStats: async () => ({ cpu: 4, bit: 3, ram: 2 }), calculateEffectPotency: () => ({ potency: 3, potencyStat: 'bit' }) },
    './clashArmor': { getOutsideClashArmorBonus: async () => 0 },
    './damageOverTime': { isImmuneToEffect },
  })
  return { attack, attacker, defender, participants, calculate: () => module.computeAttackDamage({
    attackerParticipant: participants[0], targetParticipant: participants[1], participants,
    attackId: attack.id, attackerName: 'Attacker', accuracySuccesses: 0, dodgeSuccesses: 0,
  }) }
}

test('canonical damage adds active Fire Damage, active Ice Armor and one Earth Armor Piercing rank', async () => {
  const f = damageFixture()
  f.attacker.qualities = [quality('fire'), quality('earth'), { id: 'advanced-mobility', choiceId: 'adv-digger' }]
  f.defender.qualities = [quality('ice')]
  f.participants[0].naturewalkActiveElements = ['fire', 'earth']
  f.participants[1].naturewalkActiveElements = ['ice']
  f.attack.tags = ['Armor Piercing II']
  const result = await f.calculate()
  assert.equal(result.attackBaseDamage, 12)
  assert.equal(result.targetArmor, 9)
  assert.equal(result.armorPiercing, 6, 'Earth adds a rank worth two Armor to the existing tags')
  assert.equal(result.damageDealt, 9)
})

test('Earth requires Advanced Digger and environment bonuses require both quality and matching environment', async () => {
  const f = damageFixture()
  f.attacker.qualities = [quality('fire'), quality('earth')]
  f.defender.qualities = [quality('ice')]
  f.participants[0].naturewalkActiveElements = ['earth']
  f.participants[1].naturewalkActiveElements = ['water']
  let result = await f.calculate()
  assert.equal(result.attackBaseDamage, 10)
  assert.equal(result.targetArmor, 7)
  assert.equal(result.armorPiercing, 0)
  f.attacker.qualities = [{ id: 'advanced-mobility', choiceId: 'digger' }]
  f.participants[0].naturewalkActiveElements = ['fire', 'earth']
  result = await f.calculate()
  assert.equal(result.attackBaseDamage, 10)
  assert.equal(result.armorPiercing, 0)
})

test('active Ice Armor also reduces reflected damage and Burn damage', async () => {
  const f = damageFixture()
  f.attacker.qualities = [quality('ice')]
  f.participants[0].naturewalkActiveElements = ['ice']
  f.defender.qualities = [{ id: 'digizoid-armor', choiceId: 'gold' }]
  f.attack.range = 'ranged'
  const result = await f.calculate()
  assert.equal(result.reflectDamageToAttacker, 3, 'CPU 4 times two less Armor 3 plus Ice 2')
  assert.equal(getBurnArmor(f.participants[0], f.attacker), 5)
  f.participants[0].naturewalkActiveElements = []
  assert.equal(getBurnArmor(f.participants[0], f.attacker), 3)
})
