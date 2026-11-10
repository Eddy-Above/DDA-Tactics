import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ref } from 'vue'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { cleanseLimit, cleanseChoices, applyCleanseSelections } = loadTypeScript('utils/cleanse.ts')
const { startCleanseCast, recordCleanseOutcome } = loadTypeScript('server/utils/cleanse.ts')
const { useCleanseSelection } = loadTypeScript('composables/useCleanseSelection.ts')
const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })
const effect = (id, name, duration = 5, type = 'debuff') => ({ id, name, type, duration, potency: 2, source: 'source' })

function fixture() {
  const participants = [
    { id: 'ally', isEnemy: false, activeEffects: [effect('poison', 'Poison'), effect('buff', 'Fury', 5, 'buff')] },
    { id: 'enemy', isEnemy: true, activeEffects: [effect('poison', 'Poison'), effect('buff', 'Fury', 5, 'buff')] },
    { id: 'other', isEnemy: true, activeEffects: [effect('custom', 'Custom status', 1, 'status')] },
  ]
  const pendingRequests = []
  const id = startCleanseCast(pendingRequests, { attackerId: 'caster', attackerName: 'Caster', attackName: 'Cleanse Wave',
    attackerIsEnemy: false, potency: 2, isArea: true, selectiveTargeting: true,
    targetIds: participants.map(participant => participant.id), ownerId: 'owner' })
  const request = pendingRequests[0]
  const record = (index, leftover = 3 - index, eligible = true) =>
    recordCleanseOutcome(pendingRequests, id, participants[index].id, participants[index], leftover, eligible)
  return { participants, pendingRequests, id, request, cast: request.data, record }
}

test('area Cleanse waits for all defenses and uses the highest leftover Accuracy, not their sum', () => {
  const f = fixture()
  f.record(0, 3)
  f.record(1, 2)
  assert.equal(f.cast.ready, false)
  assert.throws(() => applyCleanseSelections(f.cast, f.participants, 'cleanse', []), /Wait for every target/)
  f.record(2, 1)
  assert.equal(f.cast.ready, true)
  assert.equal(cleanseLimit(f.cast), 3)
  assert.equal(cleanseChoices(f.cast, f.participants).length, 5)
  assert.throws(() => applyCleanseSelections(f.cast, f.participants, 'cleanse', [
    { participantId: 'ally', effectId: 'poison' }, { participantId: 'ally', effectId: 'buff' },
    { participantId: 'enemy', effectId: 'poison' }, { participantId: 'enemy', effectId: 'buff' },
  ]), /Too many effects/)
})

test('Cleanse reduces each selected instance by BIT and removes effects that reach zero', () => {
  const f = fixture()
  f.participants.forEach((_, index) => f.record(index))
  const before = structuredClone(f.participants)
  const result = applyCleanseSelections(f.cast, f.participants, 'cleanse', [
    { participantId: 'ally', effectId: 'poison' }, { participantId: 'enemy', effectId: 'poison' },
    { participantId: 'other', effectId: 'custom' },
  ])
  assert.deepEqual(result.map(participant => participant.activeEffects.map(effect => [effect.id, effect.duration])), [
    [['poison', 3], ['buff', 5]], [['poison', 3], ['buff', 5]], [],
  ])
  assert.deepEqual(f.participants, before)
})

test('Dispel and Purify cannot mix enemy buffs and ally debuffs in the same cast', () => {
  const f = fixture()
  f.participants.forEach((_, index) => f.record(index))
  assert.deepEqual(cleanseChoices(f.cast, f.participants, 'dispel').map(choice => [choice.participantId, choice.effectId]), [['enemy', 'buff']])
  assert.deepEqual(cleanseChoices(f.cast, f.participants, 'purify').map(choice => [choice.participantId, choice.effectId]), [['ally', 'poison']])
  assert.throws(() => applyCleanseSelections(f.cast, f.participants, 'dispel', [{ participantId: 'ally', effectId: 'poison' }]), /no longer available/)
  assert.throws(() => applyCleanseSelections({ ...f.cast, selectiveTargeting: false }, f.participants, 'dispel', []), /not available/)
})

test('misses add no eligible effects, and an intercepted target refers to the actual interceptor', () => {
  const f = fixture()
  f.record(0, -1, false)
  const interceptor = { id: 'interceptor', activeEffects: [effect('fear', 'Fear')] }
  recordCleanseOutcome(f.pendingRequests, f.id, 'enemy', interceptor, 3, true)
  f.record(2, 1)
  assert.deepEqual(cleanseChoices(f.cast, [...f.participants, interceptor]).map(choice => choice.participantId), ['interceptor', 'other'])
  f.record(1, 99)
  assert.equal(cleanseLimit(f.cast), 3, 'a retry does not replace a resolved target')
})

test('stale, newly added, duplicate and permanent effects cannot be selected', () => {
  const f = fixture()
  f.participants[0].activeEffects.push(effect('shield', 'Shield', 0, 'buff'))
  f.participants.forEach((_, index) => f.record(index))
  f.participants[0].activeEffects.push(effect('late', 'Stun'))
  f.participants[1].activeEffects = []
  for (const choice of [{ participantId: 'ally', effectId: 'shield' }, { participantId: 'ally', effectId: 'late' },
    { participantId: 'enemy', effectId: 'poison' }, { participantId: 'missing', effectId: 'poison' }]) {
    assert.throws(() => applyCleanseSelections(f.cast, f.participants, 'cleanse', [choice]), /no longer available/)
  }
  const choice = { participantId: 'ally', effectId: 'poison' }
  assert.throws(() => applyCleanseSelections(f.cast, f.participants, 'cleanse', [choice, choice]), /only be selected once/)
})

test('a fully missed or zero-BIT cast does not prompt for a selection', () => {
  const f = fixture()
  f.participants.forEach((_, index) => f.record(index, -1, false))
  assert.equal(f.pendingRequests.length, 0)
  const zero = fixture()
  zero.cast.potency = 0
  zero.participants.forEach((_, index) => zero.record(index))
  assert.equal(zero.pendingRequests.length, 0)
})

test('the Cleanse endpoint validates owner and selections, persists once, and prevents replay', async () => {
  const f = fixture()
  f.participants.forEach((_, index) => f.record(index))
  const encounter = { id: 'encounter', participants: f.participants, pendingRequests: f.pendingRequests, battleLog: [], round: 1 }
  const tables = { encounters: { id: 'id' } }
  const writes = []
  const db = { select: () => ({ from: () => ({ where: async () => [encounter] }) }),
    update: () => ({ set: patch => ({ where: async () => { writes.push(patch); Object.assign(encounter, patch) } }) }) }
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async body => body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const handler = loadTrustedGameplayModule('server/api/encounters/[id]/actions/cleanse.post.ts', {
    '../../../../db': { db, ...tables }, 'drizzle-orm': { eq: () => ({}) },
  }).default
  const body = { requestId: f.id, ownerId: 'owner', mode: 'purify', selections: [{ participantId: 'ally', effectId: 'poison' }] }
  await assert.rejects(() => handler({ ...body, ownerId: 'other' }), { statusCode: 403 })
  await assert.rejects(() => handler({ ...body, selections: [{ participantId: 'enemy', effectId: 'buff' }] }), { statusCode: 400 })
  assert.equal(writes.length, 0)
  const result = await handler(body)
  assert.equal(result.participants[0].activeEffects[0].duration, 3)
  assert.equal(result.pendingRequests.length, 0)
  assert.equal(result.battleLog[0].action, 'Purify')
  await assert.rejects(() => handler(body), { statusCode: 404 })
  assert.equal(writes.length, 1)
})

test('selection UI adapter waits for readiness, preserves failed choices, and suppresses double submission', async () => {
  const f = fixture()
  const encounter = ref({ id: 'encounter', pendingRequests: f.pendingRequests, participants: f.participants })
  let finish, calls = 0, applied = 0
  const selection = useCleanseSelection({ encounter: () => encounter.value, ownerId: () => 'owner',
    send: async () => { calls++; return new Promise(resolve => { finish = resolve }) }, apply: async () => { applied++ } })
  assert.equal(selection.request.value, undefined)
  f.participants.forEach((_, index) => f.record(index))
  encounter.value = { ...encounter.value, pendingRequests: [...f.pendingRequests] }
  assert.equal(selection.request.value.id, f.id)
  const pending = selection.submit('cleanse', [])
  await selection.submit('cleanse', [])
  assert.equal(calls, 1)
  finish(null)
  await pending
  assert.equal(applied, 0)
  assert.match(selection.error.value, /could not be saved/)
  assert.equal(selection.request.value.id, f.id)
})
