import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadTypeScript, loadVueComponent } from './helpers/loadTypeScript.mjs'

const { useDigivolveWillpower } = loadTypeScript('composables/useDigivolveWillpower.ts')
const WillpowerDialog = loadVueComponent('components/DigivolveWillpowerDialog.vue')
const originalFetch = globalThis.$fetch
afterEach(() => { globalThis.$fetch = originalFetch })

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

function createCheck(overrides = {}) {
  let randomValue = 0
  const campaignLevel = ref('standard')
  const warpEnabled = ref(true)
  const encounterId = ref('encounter-1')
  const participant = ref({ id: 'tamer-participant', currentInspiration: 2 })
  const fetchCalls = []
  const errors = []
  let refreshCount = 0
  let afterRerollCount = 0
  const spending = []
  globalThis.$fetch = async (...args) => { fetchCalls.push(args); return {} }

  const pending = {
    participant: { id: 'digimon-participant', type: 'digimon', entityId: 'agumon' },
    targetChainIndex: 1,
    targetSpecies: 'Greymon',
    tamer: {
      id: 'tamer-entity',
      attributes: { willpower: 3 },
      xpBonuses: { attributes: { willpower: 2 } },
    },
  }
  const targets = [
    { chainIndex: 2, species: 'MetalGreymon' },
    { chainIndex: 3, species: 'WarGreymon' },
  ]
  const check = useDigivolveWillpower({
    campaignLevel,
    warpEnabled: () => warpEnabled.value,
    getEncounterId: () => encounterId.value,
    getTamerParticipant: (tamerId) => {
      assert.equal(tamerId, pending.tamer.id)
      return participant.value
    },
    getWarpTargets: () => targets,
    spendInspiration: async (...args) => { spending.push(args); return {} },
    refresh: async () => { refreshCount++ },
    afterReroll: async () => { afterRerollCount++ },
    onError: (message) => { errors.push(message) },
    random: () => randomValue,
    ...overrides,
  })

  return {
    check, pending, targets, campaignLevel, warpEnabled, encounterId,
    participant, fetchCalls, errors, spending,
    setRandom: (value) => { randomValue = value },
    get refreshCount() { return refreshCount },
    get afterRerollCount() { return afterRerollCount },
  }
}

test('a Willpower check rolls once with base and XP modifiers and cannot be cancelled afterward', () => {
  const { check, pending, setRandom } = createCheck()
  check.open(pending)
  assert.equal(check.modifier.value, 5)
  check.roll()
  assert.deepEqual(check.rollResult.value, { rolls: [1, 1, 1], total: 8 })

  setRandom(0.99)
  check.roll()
  check.cancel()
  assert.deepEqual(check.rollResult.value, { rolls: [1, 1, 1], total: 8 })
  assert.equal(check.pendingDigivolve.value.participant.id, pending.participant.id)
})

test('an unrolled check can be cancelled and instances keep separate state', () => {
  const first = createCheck()
  const second = createCheck()
  first.check.open(first.pending)
  second.check.open(second.pending)
  first.check.roll()
  assert.equal(second.check.rollResult.value, null)
  second.check.cancel()
  assert.equal(second.check.pendingDigivolve.value, null)
  assert.ok(first.check.pendingDigivolve.value)
  assert.ok(first.check.rollResult.value)
})

test('campaign difficulty and Inspiration follow reactive campaign/participant data', () => {
  const { check, pending, campaignLevel, participant } = createCheck()
  check.open(pending)
  assert.equal(check.dc.value, 12)
  assert.equal(check.inspiration.value, 2)
  campaignLevel.value = 'extreme'
  participant.value.currentInspiration = 0
  assert.equal(check.dc.value, 17)
  assert.equal(check.inspiration.value, 0)
})

test('ordinary success submits the existing digivolve contract without a warp rollTotal', async () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  fixture.setRandom(0.99)
  fixture.check.roll()
  await fixture.check.submit()
  assert.deepEqual(fixture.fetchCalls, [[
    '/api/encounters/encounter-1/actions/digivolve',
    { method: 'POST', body: { participantId: 'digimon-participant', targetChainIndex: 1 } },
  ]])
  assert.equal(fixture.check.pendingDigivolve.value, null)
  assert.equal(fixture.refreshCount, 1)
})

test('failure submits the selected species, total and campaign DC to the failure endpoint', async () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  await fixture.check.submit()
  assert.deepEqual(fixture.fetchCalls, [[
    '/api/encounters/encounter-1/actions/digivolve-fail',
    { method: 'POST', body: {
      participantId: 'digimon-participant', targetSpecies: 'Greymon', rollTotal: 8, dc: 12,
    } },
  ]])
  assert.equal(fixture.refreshCount, 1)
})

test('warp becomes available at DC + 5 and sends the chosen chain index and roll', async () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  fixture.setRandom(0.5)
  fixture.check.roll()
  assert.equal(fixture.check.rollResult.value.total, 17)
  assert.equal(fixture.check.warpAvailable.value, true)
  fixture.check.toggleWarp(fixture.targets[0])
  assert.equal(fixture.check.warpChoice.value.chainIndex, 2)
  fixture.check.toggleWarp(fixture.targets[0])
  assert.equal(fixture.check.warpChoice.value, null)
  fixture.check.toggleWarp(fixture.targets[0])
  await fixture.check.submit()
  assert.deepEqual(fixture.fetchCalls[0][1].body, {
    participantId: 'digimon-participant', targetChainIndex: 2, rollTotal: 17,
  })
})

test('warp stays unavailable below its threshold or while the campaign rule is disabled', () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  fixture.setRandom(0.4)
  fixture.check.roll()
  assert.equal(fixture.check.rollResult.value.total, 14)
  assert.equal(fixture.check.warpAvailable.value, false)
  fixture.check.toggleWarp(fixture.targets[0])
  assert.equal(fixture.check.warpChoice.value, null)

  const disabled = createCheck({ warpEnabled: () => false })
  disabled.check.open(disabled.pending)
  disabled.setRandom(0.99)
  disabled.check.roll()
  assert.equal(disabled.check.warpAvailable.value, false)
})

test('a failed Inspiration spend preserves the failed roll and reports the problem', async () => {
  const fixture = createCheck({ spendInspiration: async () => null })
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  fixture.setRandom(0.99)
  await fixture.check.reroll()
  assert.deepEqual(fixture.check.rollResult.value, { rolls: [1, 1, 1], total: 8 })
  assert.equal(fixture.errors.length, 1)
  assert.equal(fixture.afterRerollCount, 0)
  assert.equal(fixture.check.loading.value, false)
})

test('a paid Inspiration reroll replaces the failed roll and refreshes dependent data', async () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  fixture.setRandom(0.99)
  await fixture.check.reroll()
  assert.deepEqual(fixture.spending, [['encounter-1', 'tamer-participant']])
  assert.deepEqual(fixture.check.rollResult.value, { rolls: [6, 6, 6], total: 23 })
  assert.equal(fixture.afterRerollCount, 1)
  assert.equal(fixture.check.loading.value, false)
})

test('a pending Inspiration spend prevents another spend or resolving the check', async () => {
  const spend = deferred()
  let spendCount = 0
  const fixture = createCheck({ spendInspiration: () => { spendCount++; return spend.promise } })
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  const reroll = fixture.check.reroll()
  assert.equal(fixture.check.loading.value, true)
  await fixture.check.reroll()
  await fixture.check.submit()
  assert.equal(spendCount, 1)
  assert.equal(fixture.fetchCalls.length, 0)
  spend.resolve({})
  await reroll
})

test('a pending submission cannot be submitted twice', async () => {
  const fetch = deferred()
  let fetchCount = 0
  const fixture = createCheck()
  globalThis.$fetch = () => { fetchCount++; return fetch.promise }
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  const submit = fixture.check.submit()
  assert.equal(fixture.check.submitting.value, true)
  await fixture.check.submit()
  assert.equal(fetchCount, 1)
  fetch.resolve({})
  await submit
  assert.equal(fixture.refreshCount, 1)
  assert.equal(fixture.check.submitting.value, false)
})

test('no request is sent before rolling or when the encounter is unavailable', async () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  await fixture.check.submit()
  fixture.check.roll()
  fixture.encounterId.value = null
  await fixture.check.submit()
  await fixture.check.reroll()
  assert.equal(fixture.fetchCalls.length, 0)
  assert.equal(fixture.spending.length, 0)
})

test('GM and player reroll refresh hooks stay independent from submission refreshes', async () => {
  const gm = createCheck({ afterReroll: undefined })
  gm.check.open(gm.pending)
  gm.check.roll()
  gm.setRandom(0.99)
  await gm.check.reroll()
  assert.equal(gm.afterRerollCount, 0)
  assert.equal(gm.refreshCount, 0)
  await gm.check.submit()
  assert.equal(gm.refreshCount, 1)

  const player = createCheck()
  player.check.open(player.pending)
  player.check.roll()
  player.setRandom(0.99)
  await player.check.reroll()
  assert.equal(player.afterRerollCount, 1)
  assert.equal(player.refreshCount, 0)
  await player.check.submit()
  assert.equal(player.refreshCount, 1)
})

test('a reroll requires a failed check and available Inspiration', async () => {
  const fixture = createCheck()
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  fixture.participant.value.currentInspiration = 0
  await fixture.check.reroll()
  assert.equal(fixture.spending.length, 0)

  const success = createCheck()
  success.check.open(success.pending)
  success.setRandom(0.99)
  success.check.roll()
  await success.check.reroll()
  assert.equal(success.spending.length, 0)
})

test('the player shared Inspiration busy flag follows the full reroll request', async () => {
  const spend = deferred()
  const inspirationLoading = ref(false)
  const fixture = createCheck({ inspirationLoading, spendInspiration: () => spend.promise })
  fixture.check.open(fixture.pending)
  fixture.check.roll()
  const reroll = fixture.check.reroll()
  assert.equal(inspirationLoading.value, true)
  assert.equal(fixture.check.loading.value, true)
  spend.resolve(null)
  await reroll
  assert.equal(inspirationLoading.value, false)
  assert.equal(fixture.check.loading.value, false)
})

async function renderDialog(overrides = {}) {
  const props = {
    targetSpecies: 'Greymon', campaignLevel: 'standard', dc: 12, modifier: 5,
    rollResult: null, inspiration: 2, loading: false,
    warpAvailable: false, warpTargets: [], warpChoice: null,
    ...overrides,
  }
  const context = {}
  await renderToString(createSSRApp({ render: () => h(WillpowerDialog, props) }), context)
  const html = context.teleports?.body ?? ''
  assert.match(html, /role="dialog"/)
  const buttons = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((match) => ({
    disabled: /\bdisabled(?:\s|=|$)/.test(match[1]),
    label: match[2].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim(),
  }))
  return { html, buttons }
}

test('the shared dialog allows Cancel before rolling and requires a roll before confirmation', async () => {
  const { html, buttons } = await renderDialog()
  assert.match(html, /aria-modal="true"/)
  assert.match(html, /Digivolve to Greymon/)
  assert.deepEqual(buttons, [
    { disabled: false, label: 'Roll Willpower' },
    { disabled: false, label: 'Cancel' },
    { disabled: true, label: 'Accept Failure' },
  ])
})

test('the shared dialog removes Cancel after failure and offers Inspiration only when available', async () => {
  const rollResult = { rolls: [1, 1, 1], total: 8 }
  const failed = await renderDialog({ rollResult })
  assert.equal(failed.buttons.some((button) => button.label === 'Cancel'), false)
  assert.equal(failed.buttons.some((button) => button.label.includes('Spend Inspiration')), true)
  assert.deepEqual(failed.buttons.find((button) => button.label === 'Accept Failure'), {
    disabled: false, label: 'Accept Failure',
  })
  const depleted = await renderDialog({ rollResult, inspiration: 0 })
  assert.equal(depleted.buttons.some((button) => button.label.includes('Spend Inspiration')), false)
})

test('a busy shared dialog disables repeat rolls, Inspiration and confirmation', async () => {
  const { buttons } = await renderDialog({ rollResult: { rolls: [1, 1, 1], total: 8 }, loading: true })
  assert.equal(buttons.length, 3)
  assert.ok(buttons.every((button) => button.disabled))
  assert.equal(buttons.some((button) => button.label === 'Cancel'), false)
})

test('success renders GM context and the selected warp target through the shared dialog', async () => {
  const warpTarget = { chainIndex: 2, species: 'MetalGreymon' }
  const { html, buttons } = await renderDialog({
    tamerName: 'Tai',
    rollResult: { rolls: [4, 4, 4], total: 17 },
    warpAvailable: true, warpTargets: [warpTarget], warpChoice: warpTarget,
  })
  assert.match(html, /Tai/)
  assert.match(html, /SUCCESS/)
  assert.match(html, /Warp Evolution Available/)
  assert.equal(buttons.some((button) => button.label === 'Cancel'), false)
  assert.equal(buttons.some((button) => button.label.includes('Spend Inspiration')), false)
  assert.ok(buttons.some((button) => /Warp .*MetalGreymon!/.test(button.label) && !button.disabled))
})
