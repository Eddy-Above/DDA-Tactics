import assert from 'node:assert/strict'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { effectScope, ref } from 'vue'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useAutoEndTurn, AUTO_END_TURN_MS } = loadTypeScript('composables/useAutoEndTurn.ts')
const { exhaustedPlayerTurnKey, hasUnresolvedTurnRequests } = loadTypeScript('utils/autoEndTurn.ts')
const scopes = []
beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }))
afterEach(() => {
  scopes.splice(0).forEach(scope => scope.stop())
  mock.timers.reset()
})

function setup() {
  const key = ref('encounter:1:0:tamer')
  const blocked = ref(false)
  const calls = []
  const scope = effectScope()
  scopes.push(scope)
  scope.run(() => useAutoEndTurn({
    key: () => key.value,
    blocked: () => blocked.value,
    endTurn: async () => { calls.push(key.value) },
  }))
  return { key, blocked, calls, scope }
}

test('ends an exhausted turn once after exactly ten seconds', () => {
  const { calls } = setup()
  assert.equal(AUTO_END_TURN_MS, 10_000)
  mock.timers.tick(9999)
  assert.deepEqual(calls, [])
  mock.timers.tick(1)
  assert.equal(calls.length, 1)
  mock.timers.tick(20_000)
  assert.equal(calls.length, 1)
})

test('manual turn end or restored actions cancels the timer; exhaustion starts a fresh one', () => {
  const { key, calls } = setup()
  mock.timers.tick(9000)
  key.value = null
  mock.timers.tick(20_000)
  assert.equal(calls.length, 0)
  key.value = 'encounter:1:0:tamer'
  mock.timers.tick(9999)
  assert.equal(calls.length, 0)
  mock.timers.tick(1)
  assert.equal(calls.length, 1)
})

test('an exhausted next turn gets its own full countdown', () => {
  const { key, calls } = setup()
  mock.timers.tick(9000)
  key.value = 'encounter:1:1:other'
  mock.timers.tick(1000)
  assert.equal(calls.length, 0)
  mock.timers.tick(9000)
  assert.deepEqual(calls, ['encounter:1:1:other'])
})

test('request resolution before the deadline does not restart the countdown', () => {
  const { blocked, calls } = setup()
  blocked.value = true
  mock.timers.tick(7000)
  blocked.value = false
  mock.timers.tick(3000)
  assert.equal(calls.length, 1)
})

test('waits for unresolved requests past the deadline, then ends immediately', () => {
  const { blocked, calls } = setup()
  blocked.value = true
  mock.timers.tick(15_000)
  assert.equal(calls.length, 0)
  blocked.value = false
  assert.equal(calls.length, 1)
  blocked.value = true
  blocked.value = false
  assert.equal(calls.length, 1)
})

test('leaving the page cancels pending auto-end', () => {
  const { scope, calls } = setup()
  scope.stop()
  mock.timers.tick(20_000)
  assert.equal(calls.length, 0)
})

function encounter() {
  return {
    id: 'encounter', phase: 'combat', round: 1, currentTurnIndex: 0, turnOrder: ['tamer', 'enemy'],
    participants: [
      { id: 'tamer', type: 'tamer', entityId: 'owner', actionsRemaining: { simple: 0 } },
      { id: 'partner', type: 'digimon', entityId: 'agumon', actionsRemaining: { simple: 1 } },
      { id: 'reserve', type: 'digimon', entityId: 'gabumon', inReserve: true, actionsRemaining: { simple: 2 } },
      { id: 'enemy', type: 'digimon', entityId: 'ogremon', isEnemy: true, actionsRemaining: { simple: 0 } },
    ],
  }
}
const digimon = new Map([
  ['agumon', { partnerId: 'owner' }],
  ['gabumon', { partnerId: 'owner' }],
  ['ogremon', { isEnemy: true }],
])

test('waits for both tamer and deployed partners, excluding reserves and other turns', () => {
  const enc = encounter()
  assert.equal(exhaustedPlayerTurnKey(enc, digimon), null)
  enc.participants[1].actionsRemaining.simple = 0
  assert.equal(exhaustedPlayerTurnKey(enc, digimon), 'encounter:1:0:tamer')
  enc.participants[0].actionsRemaining.simple = 1
  assert.equal(exhaustedPlayerTurnKey(enc, digimon), null)
  enc.currentTurnIndex = 1
  assert.equal(exhaustedPlayerTurnKey(enc, digimon), null)
  enc.currentTurnIndex = 0
  enc.phase = 'ended'
  assert.equal(exhaustedPlayerTurnKey(enc, digimon), null)
})

test('an independent player Digimon can exhaust its own turn', () => {
  const enc = encounter()
  enc.turnOrder[0] = 'partner'
  enc.participants[1].actionsRemaining.simple = 0
  assert.equal(exhaustedPlayerTurnKey(enc, digimon), 'encounter:1:0:partner')
})

test('answered requests do not block, but unresolved combat requests and intercede groups do', () => {
  const enc = {
    pendingRequests: [{ id: 'dodge', type: 'dodge-roll' }],
    requestResponses: [],
  }
  assert.equal(hasUnresolvedTurnRequests(enc), true)
  enc.requestResponses.push({ requestId: 'dodge' })
  assert.equal(hasUnresolvedTurnRequests(enc), false)
  enc.requestResponses = []
  enc.pendingRequests[0].answeredAt = '2026-11-14T12:00:00Z'
  assert.equal(hasUnresolvedTurnRequests(enc), false)
  enc.pendingRequests.push({ id: 'group', type: 'intercede-group-state', answeredAt: 'now' })
  assert.equal(hasUnresolvedTurnRequests(enc), true)
})
