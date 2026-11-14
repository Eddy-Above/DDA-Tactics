import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, shallowRef } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const {
  availableCombatAttacks, requiredAttackActions, canUseCombatAttack,
  canBolsterCombatAttack, hugePowerAvailability,
} = loadTypeScript('utils/combatAttackOptions.ts')
const { BASIC_ATTACKS } = loadTypeScript('data/attackConstants.ts')

const attack = (id, over = {}) => ({ id, name: id, range: 'melee', type: 'damage', description: '', tags: [], ...over })
const actor = (over = {}) => ({ id: 'actor', entityId: 'agumon', type: 'digimon', actionsRemaining: { simple: 2 }, ...over })
const signature = attack('signature', { tags: ['Signature Move'] })
const melee = attack('claw')
const ranged = attack('pepper-breath', { range: 'ranged' })
const area = attack('burst', { range: 'ranged', tags: ['Area Attack: Burst 3'] })
const haste = attack('haste', { type: 'support', effect: 'Haste' })

test('attack lists preserve custom order, append unused basics, and never mutate the inputs', () => {
  const used = Object.freeze(['used', BASIC_ATTACKS[0].id])
  const participant = actor({ usedAttackIds: used })
  const custom = Object.freeze([ranged, attack('used'), melee, signature])
  const basics = Object.freeze([...BASIC_ATTACKS])
  const result = availableCombatAttacks(participant, custom, basics, { round: 3 })
  assert.deepEqual(result.map(item => item.id), [ranged.id, melee.id, signature.id, BASIC_ATTACKS[1].id])
  assert.equal(result[0], ranged, 'selection retains the original attack object')
  assert.deepEqual(custom.map(item => item.id), [ranged.id, 'used', melee.id, signature.id])
  assert.equal(participant.actionsRemaining.simple, 2)
  assert.deepEqual(participant.usedAttackIds, used)
  assert.deepEqual(availableCombatAttacks(actor({ type: 'tamer' }), custom, basics, { round: 3 }), [])
})

test('signature cooldown uses the ordinary and Decimation ready rounds', () => {
  const expected = [
    [0, false, false], [2, false, false], [3, false, true],
    [1, true, false], [2, true, true], [3, true, true],
  ]
  for (const [round, decimationReady, visible] of expected) {
    const attacks = availableCombatAttacks(actor({ decimationReady }), [melee, signature], [], { round })
    assert.equal(attacks.includes(signature), visible, `round=${round}, Decimation=${decimationReady}`)
    assert.equal(attacks.includes(melee), true)
  }
})

test('Battery replaces the round cooldown while used attacks and mixed-case Signature tags still apply', () => {
  const tagged = attack('mixed-case', { tags: ['Enhanced SIGNATURE Move'] })
  const context = { round: 3, houseRules: { signatureMoveBattery: true } }
  for (const battery of [undefined, 0, -1]) {
    assert.deepEqual(availableCombatAttacks(actor({ battery }), [tagged], BASIC_ATTACKS, context), BASIC_ATTACKS)
  }
  assert.deepEqual(availableCombatAttacks(actor({ battery: 1 }), [tagged], [], context), [tagged])
  assert.deepEqual(availableCombatAttacks(actor({ battery: 1, usedAttackIds: [tagged.id] }), [tagged], [], context), [])
  for (const round of [1, 2, 3]) for (const decimationReady of [false, true]) {
    assert.deepEqual(availableCombatAttacks(actor({ battery: 1, decimationReady }), [tagged], [], { ...context, round }), [tagged])
    assert.deepEqual(availableCombatAttacks(actor({ battery: 0, decimationReady }), [tagged], [], { ...context, round }), [])
  }
  assert.deepEqual(availableCombatAttacks(actor({ battery: 0 }), [tagged], [], { round: 3 }), [tagged])
})

test('Combat Monster area attacks require two actions only when the rule and bonus are active', () => {
  const rules = { combatMonsterAreaAttackRequiresComplex: true }
  const participant = actor({ combatMonsterBonus: 2, actionsRemaining: { simple: 1 } })
  assert.equal(requiredAttackActions(participant, area, rules), 2)
  assert.equal(canUseCombatAttack(participant, area, rules), false)
  assert.equal(requiredAttackActions(participant, melee, rules), 1)
  assert.equal(canUseCombatAttack(participant, melee, rules), true)
  assert.equal(requiredAttackActions(participant, area, {}), 1)
  assert.equal(canUseCombatAttack(participant, area, {}), true)
  assert.equal(requiredAttackActions(actor({ combatMonsterBonus: 0 }), area, rules), 1)
  participant.actionsRemaining.simple = 2
  assert.equal(canUseCombatAttack(participant, area, rules), true)
  participant.clash = { isController: true }
  assert.equal(canUseCombatAttack(participant, melee, rules), false)
  assert.equal(canUseCombatAttack(actor({ actionsRemaining: undefined }), melee), false)
  assert.equal(requiredAttackActions(actor(), haste), 2, 'Haste always requires a Complex Action')
})

test('Bolster shares type, action, per-round, Signature, Combat Monster and Haste gates', () => {
  const rules = { combatMonsterAreaAttackRequiresComplex: true }
  assert.equal(canBolsterCombatAttack(actor(), melee), true)
  assert.equal(canBolsterCombatAttack(actor({ digimonBolsterCount: 1 }), melee), true)
  for (const [participant, selected] of [
    [actor({ type: 'tamer' }), melee],
    [actor({ actionsRemaining: { simple: 1 } }), melee],
    [actor({ digimonBolsterCount: 2 }), melee],
    [actor({ digimonBolsterCount: 3 }), melee],
    [actor(), signature],
    [actor(), attack('mixed', { tags: ['Powered SIGNATURE Attack'] })],
    [actor(), haste],
    [actor({ combatMonsterBonus: 1 }), area],
  ]) assert.equal(canBolsterCombatAttack(participant, selected, rules), false)
  assert.equal(canBolsterCombatAttack(actor({ combatMonsterBonus: 1 }), area, {}), true)
  assert.equal(canBolsterCombatAttack(actor({ combatMonsterBonus: 0 }), area, rules), true)
})

test('Huge Power needs a Digimon with the quality and retains its default rank', () => {
  const context = { round: 4 }
  const quality = [{ id: 'huge-power' }]
  assert.deepEqual(hugePowerAvailability(actor(), melee, [], context), { rank1: false, rank2: false })
  assert.deepEqual(hugePowerAvailability(actor({ type: 'tamer' }), melee, quality, context), { rank1: false, rank2: false })
  assert.deepEqual(hugePowerAvailability(actor(), melee, quality, context), { rank1: true, rank2: false })
  assert.deepEqual(hugePowerAvailability(actor(), melee, [{ id: 'huge-power', ranks: 0 }], context), { rank1: true, rank2: false })
})

test('ordinary Huge Power keeps unlimited rank-one melee and separate ranged/rank-two round limits', () => {
  const qualities = [{ id: 'huge-power', ranks: 2 }]
  const context = { round: 4 }
  assert.deepEqual(hugePowerAvailability(actor(), melee, qualities, context), { rank1: true, rank2: true })
  assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRound: 4 }), melee, qualities, context), { rank1: true, rank2: true })
  assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRound: 4 }), ranged, qualities, context), { rank1: false, rank2: false })
  assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRank2Round: 4 }), melee, qualities, context), { rank1: true, rank2: false })
  assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRank2Round: 4 }), ranged, qualities, context), { rank1: true, rank2: false })
  assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRound: 3, lastHugePowerRank2Round: 3 }), ranged, qualities, context), { rank1: true, rank2: true })
})

test('EddySoul Huge Power shares its all-attack limit and preserves rank-two eligibility', () => {
  const context = { round: 4, eddySoulRules: { hugePowerOncePerTurn: true } }
  const qualities = [{ id: 'huge-power', ranks: 2 }]
  for (const selected of [melee, ranged]) {
    assert.deepEqual(hugePowerAvailability(actor(), selected, qualities, context), { rank1: true, rank2: true })
    assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRound: 4 }), selected, qualities, context), { rank1: false, rank2: false })
    assert.deepEqual(hugePowerAvailability(actor({ lastHugePowerRound: 3, lastHugePowerRank2Round: 4 }), selected, qualities, context), { rank1: true, rank2: true })
    assert.deepEqual(hugePowerAvailability(actor(), selected, [{ id: 'huge-power', ranks: 1 }], context), { rank1: true, rank2: false })
  }
})

const pages = {
  gm: 'pages/campaigns/[campaignId]/encounters/[id].vue',
  player: 'pages/campaigns/[campaignId]/player/[tamerId].vue',
}
for (const [role, page] of Object.entries(pages)) {
  test(`${role} page wrappers use shared options and preserve their record lookup`, () => {
    const participant = actor()
    const record = { id: participant.entityId, attacks: [melee, ranged, signature], qualities: [{ id: 'huge-power', ranks: 2 }] }
    const enemy = { id: 'goblimon', attacks: [attack('enemy-attack')], qualities: [{ id: 'huge-power', ranks: 2 }] }
    const rules = ref({})
    const encounter = ref({ round: 3 })
    const handlers = loadPageFunctions(page, ['getParticipantAttacks', 'canUseAttack', 'canBolsterAttack', 'canUseHugePower'], {
      availableCombatAttacks, canUseCombatAttack, canBolsterCombatAttack, hugePowerAvailability,
      digimonMap: shallowRef(new Map([[record.id, record], [enemy.id, enemy]])),
      partnerDigimon: ref([record]),
      currentEncounter: encounter, activeEncounter: encounter,
      houseRules: ref({}), eddySoulRules: rules, BASIC_ATTACKS,
    })
    assert.deepEqual(handlers.getParticipantAttacks(participant).map(item => item.id), [melee.id, ranged.id, signature.id, ...BASIC_ATTACKS.map(item => item.id)])
    assert.deepEqual(handlers.getParticipantAttacks(actor({ type: 'tamer' })), [])
    const other = actor({ entityId: enemy.id })
    const otherAttackIds = handlers.getParticipantAttacks(other).map(item => item.id)
    assert.deepEqual(otherAttackIds, [...(role === 'gm' ? ['enemy-attack'] : []), ...BASIC_ATTACKS.map(item => item.id)])
    assert.deepEqual(handlers.canUseHugePower(other, melee), role === 'gm' ? { rank1: true, rank2: true } : { rank1: false, rank2: false })
    assert.equal(handlers.canBolsterAttack(participant, haste), false, 'both views reject Bolster on Haste')
    participant.combatMonsterBonus = 1
    participant.actionsRemaining.simple = 1
    rules.value = { combatMonsterAreaAttackRequiresComplex: true }
    assert.equal(handlers.canUseAttack(participant, area), false)
    assert.equal(handlers.canUseAttack(participant, melee), true)
    encounter.value.round = 2
    assert.equal(handlers.getParticipantAttacks(participant).some(item => item.id === signature.id), false)
  })
}
