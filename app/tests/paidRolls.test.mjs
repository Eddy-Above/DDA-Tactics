import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const page = 'pages/campaigns/[campaignId]/player/[tamerId].vue'
const { useAreaDefenseBatch } = loadTypeScript('composables/useAreaDefenseBatch.ts')

function inspiration(result = null) {
  const applications = []
  const dependencies = {
    activeEncounter: ref({ id: 'encounter' }), myTamerParticipant: ref({ id: 'tamer' }),
    inspirationSpendLoading: ref(false), spendInspiration: async () => result,
    applyActionResult: async value => applications.push(value), console: { error: () => {} }, alert: () => {},
  }
  return { dependencies, applications, ...loadPageFunctions(page, ['handleSpendInspiration'], dependencies) }
}

test('the real Inspiration handler reports a null action result as failure, even after a successful resync', async () => {
  const fixture = inspiration()
  assert.equal(await fixture.handleSpendInspiration('act-of-inspiration', 2), false)
  assert.deepEqual(fixture.applications, [null])
  assert.equal(fixture.dependencies.inspirationSpendLoading.value, false)
  const accepted = inspiration({ id: 'encounter' })
  assert.equal(await accepted.handleSpendInspiration('act-of-inspiration', 2), true)
})

test('a rejected server spend cannot grant an Act, reroll or extra die through the real page adapter', async () => {
  const { handleSpendInspiration } = inspiration()
  const batch = useAreaDefenseBatch({
    defense: () => ({ pool: 2, blocked: false }), currentInspiration: () => 5, actOfInspirationCost: () => 2,
    spend: handleSpendInspiration, submit: async () => ({ ok: true }),
    isAnswered: () => false, isTargetPresent: () => true, rollDie: () => 6,
  })
  batch.open('cast', [{ id: 'request', type: 'dodge-roll', targetParticipantId: 'target' }])
  batch.toggleAct('request')
  assert.equal(await batch.rollOne('request'), false)
  assert.equal(batch.entries.value[0].actPaid, false)
  assert.equal(batch.entries.value[0].roll, null)
  batch.toggleAct('request')
  await batch.rollOne('request')
  const original = JSON.stringify(batch.entries.value[0].roll)
  assert.equal(await batch.rerollOne('request'), false)
  assert.equal(await batch.addDieOne('request'), false)
  assert.equal(JSON.stringify(batch.entries.value[0].roll), original)
})

for (const kind of ['dodge', 'counterattack']) {
  test(`a failed Act does not roll an ordinary ${kind} and can be retried after payment succeeds`, async () => {
    let paid = false
    const hasRolled = ref(false)
    const result = ref(null)
    const dependencies = {
      activeEncounter: ref({ participants: [] }), currentCounterattackRequest: ref(null),
      currentDodgeRequest: ref({ id: 'dodge-request' }), defenseFor: () => ({ automaticSuccesses: 0 }),
      prepareAttackAccuracy: loadTypeScript('utils/attackAccuracy.ts').prepareAttackAccuracy,
      getAttackOrderModifiers: loadTypeScript('utils/specialOrderCombat.ts').getAttackOrderModifiers,
      getPaidDodgeDiceBonus: loadTypeScript('utils/areaDefense.ts').getPaidDodgeDiceBonus,
      hasRolledDodge: hasRolled, hasRolledCounterattack: hasRolled,
      dodgeRollResult: result, counterattackRollResult: result,
      dodgeDicePool: ref(2), counterattackAccuracyPool: ref(2),
      dodgeActOfInspirationEnabled: ref(true), counterattackActOfInspirationEnabled: ref(true),
      dodgeBlockedByClash: ref(false), counterattackSelectedAttack: ref({ id: 'attack' }),
      actOfInspirationCost: ref(2), handleSpendInspiration: async () => paid,
      inspirationSpendLoading: ref(false),
    }
    const name = kind === 'dodge' ? 'rollDodgeDice' : 'rollCounterattackDice'
    const roll = loadPageFunctions(page, [name], dependencies)[name]
    await roll()
    assert.equal(result.value, null)
    assert.equal(hasRolled.value, false)
    paid = true
    await roll()
    assert.equal(result.value.dicePool, 7)
    assert.equal(hasRolled.value, true)
  })
}

for (const name of ['confirmAccuracyReview', 'submitDodgeRoll', 'submitCounterattack', 'declineCounterattack']) {
  test(`${name} cannot submit or discard dice while a paid adjustment is pending`, async () => {
    const { [name]: handler } = loadPageFunctions(page, [name], { inspirationSpendLoading: ref(true) })
    await handler()
  })
}

test('single and area defense payments identify the exact request they extend', async () => {
  const fixture = inspiration({ id: 'encounter' })
  const calls = []
  fixture.dependencies.spendInspiration = async (...args) => { calls.push(args); return { id: 'encounter' } }
  const { handleSpendInspiration } = loadPageFunctions(page, ['handleSpendInspiration'], fixture.dependencies)
  await handleSpendInspiration('act-of-inspiration', 2, 'single-defense')
  assert.deepEqual(calls[0], ['encounter', 'tamer', 'act-of-inspiration', 2, 'single-defense'])
  const batch = useAreaDefenseBatch({
    defense: () => ({ pool: 2, blocked: false }), currentInspiration: () => 5, actOfInspirationCost: () => 2,
    spend: handleSpendInspiration, submit: async () => ({ ok: true }),
    isAnswered: () => false, isTargetPresent: () => true, rollDie: () => 6,
  })
  batch.open('cast', [{ id: 'first-defense' }, { id: 'second-defense' }])
  batch.toggleAct('second-defense')
  await batch.rollOne('second-defense')
  await batch.addDieOne('second-defense')
  assert.deepEqual(calls.slice(1).map(args => [args[2], args[4]]), [
    ['act-of-inspiration', 'second-defense'], ['modifier', 'second-defense'],
  ])
})

test('a refreshed area defense retains its accepted paid dice without paying for Act again', async () => {
  const batch = useAreaDefenseBatch({
    defense: () => ({ pool: 4, blocked: false }), currentInspiration: () => 0, actOfInspirationCost: () => 2,
    spend: async () => { throw new Error('must not pay twice') }, submit: async () => ({ ok: true }),
    isAnswered: () => false, isTargetPresent: () => true, rollDie: () => 6,
  })
  batch.open('cast', [{ id: 'defense', data: { dodgeActPaid: true, paidDodgeDiceBonus: 6 } }])
  assert.equal(await batch.rollOne('defense'), true)
  assert.equal(batch.entries.value[0].roll.dicePool, 10)
  assert.equal(batch.entries.value[0].actPaid, true)
})

test('a vanished single defense cannot spend Inspiration on a replacement roll', async () => {
  const currentDodgeRequest = ref({ id: 'defense' })
  const calls = []
  const { spendDodgeInspiration } = loadPageFunctions(page, ['spendDodgeInspiration'], {
    currentDodgeRequest, handleSpendInspiration: async (...args) => { calls.push(args); return true },
  })
  assert.equal(await spendDodgeInspiration('modifier', 1), true)
  assert.deepEqual(calls[0], ['modifier', 1, 'defense'])
  currentDodgeRequest.value = null
  assert.equal(await spendDodgeInspiration('modifier', 1), false)
  assert.equal(calls.length, 1)
})

test('overlapping Inspiration spends cannot both charge the same pending action', async () => {
  const fixture = inspiration()
  let finish
  let charges = 0
  fixture.dependencies.spendInspiration = async () => {
    charges++
    return new Promise(resolve => { finish = resolve })
  }
  const { handleSpendInspiration } = loadPageFunctions(page, ['handleSpendInspiration'], fixture.dependencies)
  const pending = handleSpendInspiration('modifier', 1)
  assert.equal(await handleSpendInspiration('modifier', 1), false)
  assert.equal(charges, 1)
  finish({ id: 'encounter' })
  assert.equal(await pending, true)
})

for (const kind of ['reroll', 'modifier']) {
  test(`the shared roll panel waits for a paid ${kind} and protects replacement rolls`, async () => {
    const original = { rolls: [1, 2], successes: 0, dicePool: 2 }
    const rollResult = ref(original)
    const spending = ref(false)
    let paid = false
    let release
    const props = {
      loading: false, currentInspiration: 3,
      spendInspiration: async () => paid,
    }
    const { adjustRoll } = loadPageFunctions('components/RollInterceptPanel.vue', ['recompute', 'adjustRoll'], {
      props, spending, rollResult, Math: { floor: Math.floor, random: () => 0.99 },
    })
    await adjustRoll(kind)
    assert.deepEqual(JSON.parse(JSON.stringify(rollResult.value)), original)
    paid = true
    props.spendInspiration = () => new Promise(resolve => { release = resolve })
    const pending = adjustRoll(kind)
    assert.equal(spending.value, true)
    const replacement = { rolls: [3], successes: 0, dicePool: 1 }
    rollResult.value = replacement
    release(true)
    await pending
    assert.deepEqual(JSON.parse(JSON.stringify(rollResult.value)), replacement)
    assert.equal(spending.value, false)
    props.spendInspiration = async () => true
    await adjustRoll(kind)
    assert.equal(rollResult.value.dicePool, kind === 'reroll' ? 1 : 2)
    assert.deepEqual(rollResult.value.rolls, kind === 'reroll' ? [6] : [3, 6])
  })
}

test('paid Accuracy adjustments retain Finishing Touch and automatic-success metadata', async () => {
  const rollResult = ref({ rolls: [1, 4], successes: 2, dicePool: 2, successThreshold: 4, automaticSuccesses: 1 })
  const { adjustRoll } = loadPageFunctions('components/RollInterceptPanel.vue', ['recompute', 'adjustRoll'], {
    props: { loading: false, currentInspiration: 5, spendInspiration: async () => true },
    spending: ref(false), rollResult, Math: { floor: Math.floor, random: () => 0.5 },
  })
  await adjustRoll('reroll')
  assert.equal(rollResult.value.successes, 3, 'both fours and the automatic success still count')
  await adjustRoll('modifier')
  assert.equal(rollResult.value.successes, 4)
  assert.equal(rollResult.value.successThreshold, 4)
  assert.equal(rollResult.value.automaticSuccesses, 1)
})
