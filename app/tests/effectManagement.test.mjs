import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive, ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const constants = loadTypeScript('data/attackConstants.ts')
function fixture() {
  const props = { effects: [], sources: [
    { id: 'one', name: 'Same name', cpu: 4, bit: 3 },
    { id: 'two', name: 'Same name', cpu: 2, bit: 5 },
  ] }
  const pendingQuickEffect = ref(null)
  const newEffect = reactive({ name: '', type: 'status', duration: 3, source: '', potency: 0, description: '' })
  const events = []
  return { props, pendingQuickEffect, newEffect, events, ...loadPageFunctions('components/EffectManager.vue', [
    'sourceEffectName', 'hasValidSource', 'sourceSpec', 'storedSourcePotency', 'getEffectType',
    'selectQuickSource', 'selectCustomSource', 'updateEffectSource', 'confirmQuickEffect', 'addEffect',
  ], { ...constants, props, pendingQuickEffect, newEffect, showAddForm: ref(true), emit: (...args) => events.push(args) }) }
}

for (const name of ['Taunt', 'Fear']) {
  test(`Quick Apply ${name} requires an existing source and stores the correct potency`, () => {
    const f = fixture()
    f.pendingQuickEffect.value = { effect: { name, type: 'debuff', description: '' }, duration: 3, potency: 0, source: '' }
    f.confirmQuickEffect()
    assert.deepEqual(f.events, [])
    f.pendingQuickEffect.value.source = 'missing'
    f.confirmQuickEffect()
    assert.deepEqual(f.events, [])
    f.pendingQuickEffect.value.source = 'one'
    f.selectQuickSource()
    assert.equal(f.pendingQuickEffect.value.potency, name === 'Taunt' ? 4 : 3)
    f.confirmQuickEffect()
    const effect = f.events[0][1]
    assert.deepEqual([effect.name, effect.source, effect.potency, effect.potencyStat, effect.duration],
      [name, 'one', name === 'Taunt' ? 8 : 3, name === 'Taunt' ? 'cpu' : 'bit', 3])
    assert.equal(f.pendingQuickEffect.value, null)
  })

  test(`custom ${name} normalizes its name and requires its source`, () => {
    const f = fixture()
    Object.assign(f.newEffect, { name: ` ${name.toLowerCase()} `, source: '', type: 'buff' })
    f.addEffect()
    assert.deepEqual(f.events, [])
    f.newEffect.source = 'two'
    f.selectCustomSource()
    f.addEffect()
    assert.deepEqual([f.events[0][1].name, f.events[0][1].type, f.events[0][1].source, f.events[0][1].potency],
      [name, 'debuff', 'two', name === 'Taunt' ? 4 : 5])
  })

  test(`an existing ${name} can change source without mutating the current props`, () => {
    const f = fixture()
    f.props.effects = [{ id: 'effect', name, type: 'status', source: 'old name', potency: 1, duration: 2 }]
    f.updateEffectSource('effect', 'missing')
    assert.deepEqual(f.events, [])
    f.updateEffectSource('effect', 'two')
    assert.equal(f.props.effects[0].source, 'old name')
    const effect = f.events[0][1][0]
    assert.deepEqual([effect.source, effect.potency, effect.duration, effect.type], ['two', name === 'Taunt' ? 4 : 5, 2, 'debuff'])
  })
}

test('effects that do not depend on a source retain their existing Quick Apply flow', () => {
  const f = fixture()
  f.pendingQuickEffect.value = { effect: { name: 'Stun', type: 'debuff' }, duration: 1, source: '', potency: 0 }
  f.confirmQuickEffect()
  assert.deepEqual([f.events[0][1].name, f.events[0][1].source], ['Stun', 'Quick Apply'])
})
