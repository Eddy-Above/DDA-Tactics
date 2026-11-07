import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, reactive, ref } from 'vue'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { calculateEffectiveBaseMovement, getSpeedyMaxRanks } = loadTypeScript('utils/movementQualities.ts')
const { useDigimonStats } = loadTypeScript('composables/useDigimonStats.ts')
const { useDigimonForm } = loadTypeScript('composables/useDigimonForm.ts')
const { createDigimonFormDefaults } = loadTypeScript('utils/formDefaults.ts')

test('base movement combines optimization, specialization, Bulky and Instinct before clamping', () => {
  const qualities = [
    { id: 'data-optimization', choiceId: 'speed-striker' },
    { id: 'data-specialization', choiceId: 'mobile-artillery' },
    { id: 'bulky', ranks: 2 },
    { id: 'instinct', ranks: 3 },
    { id: 'speedy', ranks: 8 },
    { id: 'advanced-mobility', choiceId: 'adv-movement' },
  ]
  assert.equal(calculateEffectiveBaseMovement(6, qualities), 4)
  qualities[0].choiceId = 'guardian'
  assert.equal(calculateEffectiveBaseMovement(6, qualities), 1)
  qualities[3].ranks = 0
  assert.equal(calculateEffectiveBaseMovement(6, qualities), 1)
  assert.equal(calculateEffectiveBaseMovement(6), 6)
  assert.equal(calculateEffectiveBaseMovement(6, [{ id: 'bulky' }, { id: 'instinct' }]), 6)
})

test('Blue Armor contributes before the movement floor in every calculation', () => {
  const qualities = [{ id: 'bulky', ranks: 1 }, { id: 'digizoid-armor', choiceId: 'blue' }]
  assert.equal(calculateEffectiveBaseMovement(2, qualities), 3, 'Blue Armor applies before the clamp, rather than producing 5')
  assert.equal(calculateEffectiveBaseMovement(2, [{ id: 'bulky', ranks: 1 }]), 1)
  assert.equal(calculateEffectiveBaseMovement(2, [{ id: 'digizoid-armor', choiceId: 'red' }]), 2)
})

test('Speedy rank rounding preserves Advanced Movement differences for odd bases and the minimum', () => {
  assert.equal(getSpeedyMaxRanks(1), 0)
  assert.equal(getSpeedyMaxRanks(1, true), 1)
  assert.equal(getSpeedyMaxRanks(5), 2)
  assert.equal(getSpeedyMaxRanks(5, true), 3)
  assert.equal(getSpeedyMaxRanks(6), 3)
  assert.equal(getSpeedyMaxRanks(6, true), 3)
})

for (const input of ['ref', 'reactive']) {
  test(`stats ${input} consumer reacts to modifiers, Speedy caps and EddySoul rules`, () => {
    const scope = effectScope()
    try {
      const data = createDigimonFormDefaults()
      data.qualities = [
        { id: 'data-optimization', choiceId: 'speed-striker' },
        { id: 'data-specialization', choiceId: 'mobile-artillery' },
        { id: 'bulky', ranks: 1 },
        { id: 'instinct', ranks: 1 },
        { id: 'speedy', ranks: 2 },
      ]
      const source = input === 'ref' ? ref(data) : reactive(data)
      const form = input === 'ref' ? source.value : source
      const rules = ref({})
      const stats = scope.run(() => useDigimonStats(source, rules))
      assert.equal(stats.derivedStats.value.baseMovement, 5)
      assert.equal(stats.derivedStats.value.movement, 9)
      assert.equal(stats.currentSpeedyMaxRanks.value, 2)
      const woundBoxes = stats.derivedStats.value.woundBoxes

      form.qualities.push({ id: 'advanced-mobility', choiceId: 'adv-movement' })
      assert.equal(stats.currentSpeedyMaxRanks.value, 3)
      form.qualities.find(quality => quality.id === 'speedy').ranks = 10
      assert.equal(stats.derivedStats.value.movement, 20, 'existing Advanced Movement bonus cap is retained')
      form.qualities = form.qualities.filter(quality => quality.id !== 'advanced-mobility')
      assert.equal(stats.currentSpeedyMaxRanks.value, 2)
      assert.equal(stats.derivedStats.value.movement, 15, 'existing ordinary Speedy bonus cap is retained')

      rules.value = { instinctBoostsDodgeArmorSpeed: true }
      assert.equal(stats.derivedStats.value.woundBoxes, woundBoxes - 1)
      assert.equal(stats.derivedStats.value.baseMovement, 5)
      assert.equal(stats.derivedStats.value.movement, 15, 'EddySoul stat redistribution keeps its movement calculation')
    } finally {
      scope.stop()
    }
  })
}

test('live stats retain Blue Armor before the movement floor and update Advanced Movement rounding', () => {
  const scope = effectScope()
  try {
    const data = createDigimonFormDefaults()
    data.stage = 'fresh'
    data.qualities = [{ id: 'bulky', ranks: 1 }, { id: 'speedy', ranks: 4 }]
    const form = reactive(data)
    const stats = scope.run(() => useDigimonStats(form))
    assert.equal(stats.derivedStats.value.baseMovement, 1)
    assert.equal(stats.derivedStats.value.movement, 3)
    assert.equal(stats.currentSpeedyMaxRanks.value, 0)

    form.qualities.push({ id: 'digizoid-armor', choiceId: 'blue' })
    assert.equal(stats.derivedStats.value.baseMovement, 3)
    assert.equal(stats.derivedStats.value.movement, 9)
    assert.equal(stats.currentSpeedyMaxRanks.value, 1)
    form.qualities.push({ id: 'advanced-mobility', choiceId: 'adv-movement' })
    assert.equal(stats.derivedStats.value.movement, 11)
    assert.equal(stats.currentSpeedyMaxRanks.value, 2)
  } finally {
    scope.stop()
  }
})

for (const advanced of [false, true]) {
  test(`stage validation and the live Speedy cap agree with Blue Armor${advanced ? ' and Advanced Movement' : ''}`, async () => {
    const scope = effectScope()
    try {
      const cap = advanced ? 3 : 2
      const editor = scope.run(() => useDigimonForm({
        stage: 'fresh',
        qualities: [
          { id: 'bulky', ranks: 1 }, { id: 'digizoid-armor', choiceId: 'blue' },
          { id: 'speedy', ranks: 5 },
          ...(advanced ? [{ id: 'advanced-mobility', choiceId: 'adv-movement', ranks: 1 }] : []),
        ],
      }))
      editor.form.stage = 'in-training'
      await nextTick()
      assert.equal(editor.derivedStats.value.baseMovement, 5)
      assert.equal(editor.currentSpeedyMaxRanks.value, cap)
      assert.equal(editor.form.qualities.find(quality => quality.id === 'speedy').ranks, cap,
        'stage validation clamps to the displayed cap, including Blue Armor')
      assert.equal(editor.derivedStats.value.movement, 5 + cap * 2)

      editor.form.stage = 'fresh'
      await nextTick()
      const lowerCap = advanced ? 2 : 1
      assert.equal(editor.currentSpeedyMaxRanks.value, lowerCap)
      assert.equal(editor.form.qualities.find(quality => quality.id === 'speedy').ranks, lowerCap)
    } finally {
      scope.stop()
    }
  })
}
