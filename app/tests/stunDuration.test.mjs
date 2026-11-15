import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { applyEffectToParticipant } = loadTypeScript('server/utils/applyEffect.ts')
const stun = (source, duration) => ({ name: 'Stun', type: 'debuff', source, duration })

for (const rules of [undefined, { stunMaxDuration1: false }, { stunMaxDuration1: true }]) {
  test(`Stun has a one-round maximum regardless of campaign settings: ${JSON.stringify(rules)}`, () => {
    const original = []
    const effects = applyEffectToParticipant(original, stun('first', 8), rules)
    assert.equal(effects[0].duration, 1)
    assert.deepEqual(original, [])
    assert.equal(applyEffectToParticipant(effects, stun('second', 5), rules)[0].duration, 1)
    assert.equal(applyEffectToParticipant(effects, stun('first', 5), rules)[0].duration, 1)
    const legacy = [{ ...effects[0], duration: 9 }]
    assert.equal(applyEffectToParticipant(legacy, stun('second', 5), rules)[0].duration, 1)
    assert.equal(legacy[0].duration, 9, 'the stored input is not mutated')
  })
}

test('Stun duration cap preserves immunity and resistance', () => {
  assert.deepEqual(applyEffectToParticipant([], stun('source', 8), undefined, [{ id: 'immunity' }]), [])
  assert.equal(applyEffectToParticipant([], stun('source', 8), undefined, [{ id: 'resistant', ranks: 2 }])[0].duration, 1)
})

test('other debuffs keep their duration and stacking rules', () => {
  const poison = { name: 'Poison', type: 'debuff', duration: 1, source: 'first' }
  const effects = applyEffectToParticipant([], poison)
  assert.equal(effects[0].duration, 3)
  assert.equal(applyEffectToParticipant(effects, { ...poison, source: 'second' })[0].duration, 6)
})
