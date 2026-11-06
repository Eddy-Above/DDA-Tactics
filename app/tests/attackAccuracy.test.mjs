import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { prepareAttackAccuracy, snapshotAttackRiders } = loadTypeScript('utils/attackAccuracy.ts')

function diceSequence(...dice) {
  let index = 0
  return () => {
    assert.ok(index < dice.length, 'the roll consumed more random values than expected')
    return (dice[index++] - 1) / 6
  }
}

test('ordinary attack and clash accuracy count only fives and sixes', () => {
  const result = prepareAttackAccuracy(6, {}, { random: diceSequence(1, 2, 3, 4, 5, 6) })
  assert.deepEqual(result.rolls, [1, 2, 3, 4, 5, 6])
  assert.equal(result.dicePool, 6)
  assert.equal(result.successes, 2)
  assert.equal(result.hadHugePowerRerolls, false)
})

test('damage/accuracy bolster and Act of Inspiration add to the same shared pool', () => {
  const result = prepareAttackAccuracy(2, { bolster: true }, {
    actOfInspiration: true,
    random: diceSequence(1, 2, 3, 4, 5, 6, 1, 5, 6),
  })
  assert.equal(result.dicePool, 9)
  assert.equal(result.rolls.length, 9)
  assert.equal(result.successes, 4)
})

test('BIT/CPU bolster and Lifesteal do not add accuracy dice', () => {
  const result = prepareAttackAccuracy(2, { bolster: true, bolsterType: 'bit-cpu', lifesteal: true }, {
    random: diceSequence(5, 4),
  })
  assert.equal(result.dicePool, 2)
  assert.deepEqual(result.rolls, [5, 4])
  assert.equal(result.riders.lifesteal, true)
})

test('Huge Power rank 1 rerolls only original ones, once each', () => {
  const result = prepareAttackAccuracy(4, { hugePower: true }, {
    random: diceSequence(1, 2, 1, 5, 1, 6),
  })
  assert.deepEqual(result.originalRolls, [1, 2, 1, 5])
  assert.deepEqual(result.rolls, [1, 2, 6, 5])
  assert.equal(result.successes, 2)
  assert.equal(result.hadHugePowerRerolls, true)
})

test('Huge Power rank 2 rerolls original ones and twos and preserves the original log dice', () => {
  const result = prepareAttackAccuracy(4, { hugePower: true, hugePowerRank2: true }, {
    random: diceSequence(2, 3, 1, 6, 5, 2),
  })
  assert.deepEqual(result.originalRolls, [2, 3, 1, 6])
  assert.deepEqual(result.rolls, [5, 3, 2, 6])
  assert.equal(result.successes, 2)
  assert.equal(result.hadHugePowerRerolls, true)
})

test('rank 2 alone does not activate Huge Power', () => {
  const result = prepareAttackAccuracy(2, { hugePowerRank2: true }, { random: diceSequence(1, 2) })
  assert.deepEqual(result.rolls, [1, 2])
  assert.equal(result.hadHugePowerRerolls, false)
})

test('Huge Power with no low dice does not consume rerolls or mark the log', () => {
  const result = prepareAttackAccuracy(2, { hugePower: true }, { random: diceSequence(4, 6) })
  assert.deepEqual(result.rolls, [4, 6])
  assert.equal(result.hadHugePowerRerolls, false)
})

test('zero accuracy rolls no dice and is a zero-success attack', () => {
  const result = prepareAttackAccuracy(0, {}, { random: diceSequence() })
  assert.deepEqual(result.rolls, [])
  assert.equal(result.successes, 0)
})

test('rider choices and original dice remain stable when review state changes', () => {
  const choices = { bolster: true, hugePower: false }
  const snapshot = snapshotAttackRiders(choices)
  choices.bolster = false
  const result = prepareAttackAccuracy(0, snapshot, { random: diceSequence(5, 6) })
  snapshot.bolster = false
  result.rolls[0] = 1
  assert.equal(result.riders.bolster, true)
  assert.deepEqual(result.originalRolls, [5, 6])
})
