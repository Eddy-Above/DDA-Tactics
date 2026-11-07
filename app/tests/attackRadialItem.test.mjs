import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { attackRadialItem } = loadTypeScript('utils/attackBadges.ts')

const base = { id: 'a1', name: 'Pepper Breath', range: 'ranged', type: 'damage', tags: [], description: '' }

test('melee and ranged attacks expose a capitalised range type and no AoE type', () => {
  assert.equal(attackRadialItem(base, false).range, 'Ranged')
  const melee = attackRadialItem({ ...base, range: 'melee' }, false)
  assert.equal(melee.range, 'Melee')
  assert.equal(melee.aoe, undefined)
  assert.equal(melee.effect, undefined)
  assert.deepEqual(melee.tags, [])
  assert.equal(melee.description, 'Melee')
})

test('area attacks expose the AoE type and drop the redundant area tag from the tag list', () => {
  const item = attackRadialItem({ ...base, name: 'Fire Burst', tags: ['Area Attack: Burst', 'Weapon II'] }, false)
  assert.equal(item.aoe, 'Burst')
  assert.deepEqual(item.tags, ['Weapon II'])
  assert.equal(attackRadialItem({ ...base, tags: ['Area Attack: Close Blast'] }, false).aoe, 'Close Blast')
})

test('effect and every tag reach the tooltip text; the entry keeps its id, label and disabled state', () => {
  const attack = { ...base, effect: 'Paralysis', tags: ['Area Attack: Cone', 'Charge Attack', 'Armor Piercing II'] }
  const item = attackRadialItem(attack, true)
  assert.equal(item.id, 'a1')
  assert.equal(item.label, 'Pepper Breath')
  assert.equal(item.disabled, true)
  assert.equal(item.effect, 'Paralysis')
  assert.deepEqual(item.tags, ['Charge Attack', 'Armor Piercing II'])
  for (const part of ['Ranged', 'Cone', 'Paralysis', 'Area Attack: Cone', 'Charge Attack', 'Armor Piercing II']) {
    assert.ok(item.description.includes(part), `description includes ${part}`)
  }
})

test('attacks without a tag list do not throw', () => {
  const item = attackRadialItem({ ...base, tags: undefined }, false)
  assert.deepEqual(item.tags, [])
})
