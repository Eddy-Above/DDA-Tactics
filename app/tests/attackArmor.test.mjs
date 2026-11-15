import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { effectiveAttackArmor } = loadTypeScript('utils/attackArmor.ts')

test('Tank Buster halves odd and even Armor whether stored as a tag or effect', () => {
  for (const attack of [{ tags: ['Tank Buster'] }, { effect: 'Tank Buster' }, { effect: 'Tank Buster', tags: ['Tank Buster'] }]) {
    assert.equal(effectiveAttackArmor(10, 0, attack), 5)
    assert.equal(effectiveAttackArmor(9, 0, attack), 4)
    assert.equal(effectiveAttackArmor(9, 0, attack, true), 4, 'combined declarations cannot halve Armor twice')
    assert.equal(effectiveAttackArmor(9, 2, attack), 2, 'flat piercing follows halving')
    assert.equal(effectiveAttackArmor(1, 2, attack), 0)
  }
})

test('ordinary attacks and Counterblow retain their Armor calculation', () => {
  assert.equal(effectiveAttackArmor(9, 2, { tags: [] }), 7)
  assert.equal(effectiveAttackArmor(9, 2, { tags: [] }, true), 2)
  assert.equal(effectiveAttackArmor(1, 2, undefined), 0)
})
