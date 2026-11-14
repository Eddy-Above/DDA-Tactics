import assert from 'node:assert/strict'
import test from 'node:test'
import { reactive } from 'vue'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useAttackTags } = loadTypeScript('composables/useAttackTags.ts')

function fixture() {
  const form = reactive({ qualities: [{ id: 'ammo', name: 'Ammo' }], attacks: [] })
  const attack = reactive({ name: '', range: 'ranged', type: 'damage', tags: [], effect: '', description: '' })
  const rules = useAttackTags(form, attack)
  return { form, attack, ammo: () => rules.availableAttackTags.value.find(tag => tag.id === 'ammo') }
}

test('Ammo counts a selected effect toward its extra-tag requirement and reacts to removal', () => {
  const f = fixture()
  assert.equal(f.ammo().disabled, true)
  assert.match(f.ammo().disabledReason, /tag or effect/)
  f.attack.effect = 'Stun'
  assert.equal(f.ammo().disabled, false)
  f.attack.effect = ''
  assert.equal(f.ammo().disabled, true)
  f.attack.effect = '   '
  assert.equal(f.ammo().disabled, true)
})

test('Ammo accepts another tag but does not count itself as its prerequisite', () => {
  const f = fixture()
  f.attack.tags = ['Weapon 1']
  assert.equal(f.ammo().disabled, false)
  f.attack.tags = ['Ammo']
  assert.equal(f.ammo().disabled, true)
  f.attack.effect = 'Stun'
  assert.equal(f.ammo().disabled, false)
})

test('an effect does not bypass Ammo Signature Move or existing-use restrictions', () => {
  const f = fixture()
  f.attack.effect = 'Stun'
  f.attack.tags = ['Signature Move']
  assert.equal(f.ammo().disabled, true)
  assert.equal(f.ammo().disabledReason, 'Cannot combine with Signature Move')
  f.attack.tags = []
  f.form.attacks.push({ ...f.attack, id: 'existing', tags: ['Ammo'] })
  assert.equal(f.ammo().disabled, true)
  assert.equal(f.ammo().disabledReason, 'Already used on another attack')
})
