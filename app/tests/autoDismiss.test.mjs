import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { computed, effectScope, nextTick, ref } from 'vue'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { useAutoDismiss, RESULT_AUTO_DISMISS_MS } = loadTypeScript('composables/useAutoDismiss.ts')
const { isRequestAnswered } = loadTypeScript('utils/requestState.ts')
const PLAYER_PAGE = 'pages/campaigns/[campaignId]/player/[tamerId].vue'

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
afterEach(() => { mock.timers.reset() })

const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

function setup(options) {
  const scope = effectScope()
  const dismissal = scope.run(() => useAutoDismiss(options))
  return { scope, ...dismissal }
}

test('a completed result dismisses itself five seconds after it becomes visible', async () => {
  const key = ref(null)
  const cleaned = []
  setup({ key: () => key.value, cleanup: () => { cleaned.push(key.value) } })
  assert.equal(RESULT_AUTO_DISMISS_MS, 5000)

  mock.timers.tick(10_000)
  assert.deepEqual(cleaned, [], 'nothing is visible, so nothing is scheduled')

  key.value = 'attack-1'
  mock.timers.tick(4999)
  await flush()
  assert.deepEqual(cleaned, [])
  mock.timers.tick(1)
  await flush()
  assert.deepEqual(cleaned, ['attack-1'])
})

test('a different result replaces the first and restarts the countdown', async () => {
  const key = ref('first')
  const cleaned = []
  setup({ key: () => key.value, cleanup: () => { cleaned.push(key.value) } })

  mock.timers.tick(4000)
  key.value = 'second'
  mock.timers.tick(4000)
  await flush()
  assert.deepEqual(cleaned, [], 'four seconds into the second result is not yet due')
  mock.timers.tick(1000)
  await flush()
  assert.deepEqual(cleaned, ['second'])
})

test('a dialog still awaiting a decision (no key) never times out', async () => {
  const key = ref('result')
  const cleaned = []
  const { isPending } = setup({ key: () => key.value, cleanup: () => { cleaned.push('x') } })
  assert.equal(isPending(), true)
  key.value = null
  assert.equal(isPending(), false, 'a result that goes away cancels its countdown')
  mock.timers.tick(60_000)
  await flush()
  assert.deepEqual(cleaned, [])
})

test('manual dismissal cancels the countdown and cleans up exactly once', async () => {
  const key = ref('result')
  const cleaned = []
  const { dismiss, isPending } = setup({ key: () => key.value, cleanup: () => { cleaned.push('x'); key.value = null } })

  await dismiss()
  assert.equal(isPending(), false)
  mock.timers.tick(60_000)
  await flush()
  assert.deepEqual(cleaned, ['x'], 'the cancelled timer does not clean up a second time')
})

test('a click racing the timer runs cleanup once', async () => {
  const key = ref('result')
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const cleaned = []
  const { dismiss } = setup({
    key: () => key.value,
    cleanup: async () => { cleaned.push('start'); await gate; cleaned.push('end'); key.value = null },
  })

  mock.timers.tick(5000)          // the timer fires and cleanup is now in flight
  const click = dismiss()         // the player clicks Close while it is still running
  release()
  await click
  await flush()
  assert.deepEqual(cleaned, ['start', 'end'])
})

test('disposing the owning scope cancels the countdown', async () => {
  const cleaned = []
  const { scope, isPending } = setup({ key: () => 'result', cleanup: () => { cleaned.push('x') } })
  assert.equal(isPending(), true)
  scope.stop()
  assert.equal(isPending(), false)
  mock.timers.tick(60_000)
  await flush()
  assert.deepEqual(cleaned, [])
})

test('a request that was answered stays answered after its response is deleted', () => {
  const request = { id: 'req-1' }
  const response = { requestId: 'req-1', tamerId: 'tamer-1' }
  assert.equal(isRequestAnswered(request, []), false)
  assert.equal(isRequestAnswered(request, [response]), true)
  assert.equal(isRequestAnswered(request, [response], 'someone-else'), false)
  assert.equal(isRequestAnswered({ ...request, answeredAt: '2026-11-07T00:00:00.000Z' }, []), true,
    'dismissing the result deletes the response; the stamp keeps the prompt closed')
})

// --- the player page's real cleanup functions -----------------------------------------------

function createPage({ failing = [] } = {}) {
  const calls = []
  const activeEncounter = ref({ id: 'encounter-1' })
  const attackResultQueue = ref([])
  const attackResultGroupTotals = ref({})
  const showAttackResultModal = ref(false)
  const attackResultGroup = computed(() => {
    if (attackResultQueue.value.length === 0) return []
    const groupId = attackResultQueue.value[0].groupId
    return attackResultQueue.value.filter(r => r.groupId === groupId)
  })
  const dodgeRequestId = ref(null)
  const dodgeResponseId = ref(null)
  const dodgeResultData = ref(null)
  const showDodgeResultModal = ref(false)
  const hasRolledDodge = ref(true)
  const dismissedResponseIds = new Set()
  const record = (name, failure) => async (...args) => {
    calls.push([name, ...args.slice(1)])
    if (failing.includes(`${name}:${args[1]}`)) throw new Error(`${name} failed`)
    return {}
  }
  const page = loadPageFunctions(
    PLAYER_PAGE,
    ['isServerResponseId', 'cleanupDodgeExchange', 'cleanupAttackResultGroup', 'cleanupDodgeResult'],
    {
      activeEncounter, attackResultQueue, attackResultGroupTotals, showAttackResultModal, attackResultGroup,
      dodgeRequestId, dodgeResponseId, dodgeResultData, showDodgeResultModal, hasRolledDodge, dismissedResponseIds,
      cancelRequest: record('cancelRequest'), deleteResponse: record('deleteResponse'),
      console: { error: () => {}, log: () => {} },
    },
  )
  return {
    ...page, calls, activeEncounter, attackResultQueue, attackResultGroupTotals, showAttackResultModal, attackResultGroup,
    dodgeRequestId, dodgeResponseId, dodgeResultData, showDodgeResultModal, hasRolledDodge, dismissedResponseIds,
  }
}

const result = (groupId, n, extra = {}) => ({ responseId: `resp-${groupId}-${n}`, requestId: `req-${groupId}-${n}`, groupId, ...extra })

test('closing an attack result group clears every request and response behind it, never the log', async () => {
  const page = createPage()
  page.attackResultQueue.value = [result('g1', 1), result('g1', 2), result('g2', 1)]
  page.attackResultGroupTotals.value = { g1: 2, g2: 1 }
  page.showAttackResultModal.value = true

  await page.cleanupAttackResultGroup()

  assert.deepEqual(page.calls, [
    ['cancelRequest', 'req-g1-1'], ['deleteResponse', 'resp-g1-1'],
    ['cancelRequest', 'req-g1-2'], ['deleteResponse', 'resp-g1-2'],
  ], 'request cancelled before its response is deleted, and no battle-log call is made')
  assert.deepEqual(page.attackResultQueue.value.map(r => r.groupId), ['g2'])
  assert.deepEqual(page.attackResultGroupTotals.value, { g2: 1 })
  assert.equal(page.showAttackResultModal.value, true, 'the next group is still waiting to be shown')
  assert.deepEqual([...page.dismissedResponseIds], ['resp-g1-1', 'resp-g1-2'])
})

test('results built from the battle log or a miss have nothing on the server to clear', async () => {
  const page = createPage()
  page.attackResultQueue.value = [
    { responseId: 'log-entry-1', groupId: 'log-entry-1' },
    { responseId: 'miss-1', groupId: 'miss-1' },
  ]
  await page.cleanupAttackResultGroup()
  assert.deepEqual(page.calls, [])
  assert.equal(page.attackResultQueue.value.length, 1)
})

test('a failed cancel or delete never blocks closing, and the other step still runs', async () => {
  const page = createPage({ failing: ['cancelRequest:req-g1-1'] })
  page.attackResultQueue.value = [result('g1', 1)]
  page.showAttackResultModal.value = true

  await page.cleanupAttackResultGroup()

  assert.deepEqual(page.calls, [['cancelRequest', 'req-g1-1'], ['deleteResponse', 'resp-g1-1']])
  assert.equal(page.attackResultQueue.value.length, 0)
  assert.equal(page.showAttackResultModal.value, false)
})

test('dismissing a dodge result uses the same exchange cleanup and resets the dialog', async () => {
  const page = createPage()
  page.dodgeRequestId.value = 'req-d'
  page.dodgeResponseId.value = 'resp-d'
  page.dodgeResultData.value = { hit: true }
  page.showDodgeResultModal.value = true

  await page.cleanupDodgeResult()

  assert.deepEqual(page.calls, [['cancelRequest', 'req-d'], ['deleteResponse', 'resp-d']])
  assert.equal(page.showDodgeResultModal.value, false)
  assert.equal(page.dodgeResultData.value, null)
  assert.equal(page.hasRolledDodge.value, false)
  assert.equal(page.dodgeRequestId.value, null)
  assert.ok(page.dismissedResponseIds.has('resp-d'))
})

test('timer and Close button share one cleanup that runs once for an attack result group', async () => {
  const page = createPage()
  page.attackResultQueue.value = [result('g1', 1), result('g1', 2)]
  page.showAttackResultModal.value = true

  const { dismiss } = setup({
    key: () => {
      const first = page.attackResultQueue.value[0]
      return page.showAttackResultModal.value && first ? `${first.groupId}:${page.attackResultGroup.value.length}` : null
    },
    cleanup: () => page.cleanupAttackResultGroup(),
  })

  mock.timers.tick(4000)
  const click = dismiss()                  // Close pressed one second before the timer
  mock.timers.tick(10_000)                 // the cancelled timer must not run a second cleanup
  await click
  await flush()
  await nextTick()

  assert.equal(page.calls.filter(([name]) => name === 'cancelRequest').length, 2)
  assert.equal(page.calls.filter(([name]) => name === 'deleteResponse').length, 2)
  assert.equal(page.attackResultQueue.value.length, 0)
})

test('the page only auto-dismisses finished results, wired through one dismissal per dialog', () => {
  const source = readFileSync(new URL(`../${PLAYER_PAGE}`, import.meta.url), 'utf8')
  const dismissals = [...source.matchAll(/const (\w+Dismissal) = useAutoDismiss\(\{\s*(?:\/\/[^\n]*\s*)*key: ([\s\S]*?)\n  cleanup:/g)]
  assert.deepEqual(dismissals.map(match => match[1]).sort(),
    ['attackResultDismissal', 'clashCheckResultDismissal', 'dodgeResultDismissal', 'intercedeResultDismissal'])

  for (const [, name, key] of dismissals) {
    assert.doesNotMatch(key, /has\w*Request|currentDodgeRequest|showAccuracyReview|myRequests/,
      `${name} must not be driven by a prompt that is awaiting a decision`)
  }
  const clashKey = dismissals.find(([, name]) => name === 'clashCheckResultDismissal')[2]
  assert.match(clashKey, /!clashCheckResultData\.value\.waiting/, 'a PENDING clash result is not finished')

  for (const name of ['attackResultDismissal', 'dodgeResultDismissal', 'intercedeResultDismissal', 'clashCheckResultDismissal']) {
    assert.ok(source.includes(`@click="${name}.dismiss()"`), `${name} backs the dialog's Close button`)
  }
})

// --- the server: a dodge is answered once -----------------------------------------------------

function responsesHandler({ request, responses = [] }) {
  const names = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
  const saved = new Map(names.map(name => [name, globalThis[name]]))
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.encounterId
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'evolutionLines', 'maps']
    .map(name => [name, { name, id: name }]))
  let stored = {
    id: 'encounter', phase: 'combat', round: 1, participants: [], turnOrder: [], currentTurnIndex: 0,
    battleLog: [], pendingRequests: [request], requestResponses: responses, campaignId: null,
  }
  const writes = []
  const db = {
    select: () => ({ from: table => ({ where: async () => (table === tables.encounters ? [structuredClone(stored)] : []) }) }),
    update: () => ({ set: fields => ({ where: async () => { writes.push(structuredClone(fields)); stored = { ...stored, ...structuredClone(fields) } } }) }),
  }
  const unexpected = new Proxy({}, { get: (_t, name) => () => { throw new Error(`unexpected ${String(name)}`) } })
  const queue = loadTypeScriptWithMocks('server/utils/intercedeClaims.ts', {})
  const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/responses.post.ts', {
    '../../../db': { db, ...tables },
    'drizzle-orm': { eq: () => ({}), inArray: () => ({}) },
    '../../../utils/pushPull': unexpected,
    '../../../utils/applyEffect': unexpected,
    '../../../utils/resolveSupportAttack': unexpected,
    '../../../utils/triggerCounterattack': unexpected,
    '../../../utils/resolveNpcAttack': unexpected,
    '../../../utils/selectiveTargeting': unexpected,
    '../../../utils/digizoidArmor': unexpected,
    '../../../utils/clashArmor': unexpected,
    '../../../utils/damageOverTime': unexpected,
    '../../../utils/enemyKnockouts': unexpected,
    '../../../utils/guidingLight': unexpected,
    '../../../utils/intercedeClaims': queue,
  }).default

  const submit = () => handler({
    encounterId: 'encounter',
    body: {
      requestId: request.id, tamerId: 'tamer-1',
      response: { type: 'dodge-rolled', dodgeDicePool: 3, dodgeSuccesses: 1, dodgeDiceResults: [5, 2, 1] },
    },
  })
  return {
    submit, writes, state: () => structuredClone(stored),
    deleteResponses: () => { stored = { ...stored, requestResponses: [] } },
    restore: () => { for (const [name, value] of saved) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value } },
  }
}

const dodgeRequest = { id: 'req-1', type: 'dodge-roll', targetTamerId: 'tamer-1', targetParticipantId: 'target', timestamp: 't', data: {} }

test('a repeated dodge submission is a no-op, even after the result was dismissed', async () => {
  const server = responsesHandler({ request: dodgeRequest })
  try {
    await server.submit()
    assert.equal(server.state().requestResponses.length, 1)
    assert.ok(server.state().pendingRequests[0].answeredAt, 'the request is stamped when first answered')
    const writesAfterFirst = server.writes.length

    await server.submit()                      // double click / retry after a lost reply
    assert.equal(server.state().requestResponses.length, 1)
    assert.equal(server.writes.length, writesAfterFirst, 'the repeat writes nothing')

    server.deleteResponses()                   // the result is dismissed: its response is deleted
    await server.submit()
    assert.equal(server.state().requestResponses.length, 0, 'the stamp keeps the request answered')
    assert.equal(server.writes.length, writesAfterFirst)
  } finally {
    server.restore()
  }
})

test('overlapping submissions for one dodge are answered once', async () => {
  const server = responsesHandler({ request: dodgeRequest })
  try {
    await Promise.all([server.submit(), server.submit(), server.submit()])
    assert.equal(server.state().requestResponses.length, 1)
    assert.equal(server.writes.length, 1)
  } finally {
    server.restore()
  }
})
