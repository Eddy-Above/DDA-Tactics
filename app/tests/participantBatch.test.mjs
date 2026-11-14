import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { ref } from 'vue'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const original = new Map(['ref', '$fetch'].map(key => [key, globalThis[key]]))
afterEach(() => { for (const [key, value] of original) value === undefined ? delete globalThis[key] : globalThis[key] = value })
const clone = value => JSON.parse(JSON.stringify(value))
function fixture(extra = {}) {
  globalThis.ref = ref
  const calls = []
  globalThis.$fetch = async (url, options) => {
    calls.push({ url, ...options })
    return { ...api.currentEncounter.value, ...options.body }
  }
  const api = loadTypeScript('composables/useEncounters.ts').useEncounters()
  api.currentEncounter.value = { id: 'encounter', phase: 'combat', round: 3, currentTurnIndex: 0,
    participants: [{ id: 'tamer-slot', type: 'tamer', entityId: 'sora', initiative: 12, isActive: true,
      actionsRemaining: { simple: 1 }, currentWounds: 2 }], turnOrder: ['tamer-slot'], ...extra }
  return { api, calls }
}

test('adding a partner after its Tamer joined solo groups it on that turn and preserves the current turn', async () => {
  const f = fixture()
  const partner = f.api.createParticipant('digimon', 'biyomon', 30, 15, 8)
  const result = await f.api.addParticipants('encounter', [partner], new Map([['biyomon', { partnerId: 'sora' }]]))
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0].method, 'PUT')
  assert.deepEqual(result.turnOrder, ['tamer-slot'])
  assert.equal(result.currentTurnIndex, 0)
  assert.equal(result.round, 3)
  assert.equal(result.participants[0].initiative, 12)
  assert.equal(result.participants[0].actionsRemaining.simple, 1)
  assert.equal(result.participants[1].entityId, 'biyomon')
})

test('twenty duplicates use one request, unique sequences and one active-turn-preserving reorder', async () => {
  const f = fixture()
  const additions = Array.from({ length: 20 }, () => f.api.createParticipant('digimon', 'enemy', 25, 15, 8, undefined, true))
  const result = await f.api.addParticipants('encounter', additions)
  assert.equal(f.calls.length, 1)
  assert.equal(new Set(result.participants.map(participant => participant.id)).size, 21)
  assert.deepEqual(result.participants.slice(1).map(participant => participant.seq), Array.from({ length: 20 }, (_, i) => i + 1))
  assert.equal(result.turnOrder[result.currentTurnIndex], 'tamer-slot')
})

test('a rejected batch leaves the cached roster and Lag metadata untouched', async () => {
  const f = fixture()
  const person = f.api.currentEncounter.value.participants[0]
  person.lagBaseOrder = 0; person.lagOrderRound = 3
  person.activeEffects = [{ name: 'Lag', potency: 1, appliesRound: 2 }]
  const before = clone(f.api.currentEncounter.value)
  globalThis.$fetch = async () => { throw new Error('Save rejected') }
  const result = await f.api.addParticipants('encounter', [f.api.createParticipant('digimon', 'enemy', 25, 15)])
  assert.equal(result, null)
  assert.deepEqual(clone(f.api.currentEncounter.value), before)
})

test('rapid additions queue without losing earlier additions or using a stale encounter list', async () => {
  const f = fixture(), gates = []
  f.api.encounters.value = [clone(f.api.currentEncounter.value)]
  globalThis.$fetch = (_url, { body }) => new Promise(resolve => gates.push(() => resolve({ ...f.api.currentEncounter.value, ...body })))
  const first = f.api.addParticipants('encounter', [f.api.createParticipant('digimon', 'enemy', 5, 3)])
  const second = f.api.addParticipants('encounter', [f.api.createParticipant('digimon', 'enemy', 7, 4)])
  await Promise.resolve(); await Promise.resolve()
  assert.equal(gates.length, 1)
  gates[0](); await first
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(gates.length, 2)
  gates[1](); await second
  assert.equal(f.api.currentEncounter.value.participants.length, 3)
  assert.deepEqual(f.api.currentEncounter.value.participants.slice(1).map(p => p.seq), [1, 2])
})

test('retrying an acknowledged-by-WebSocket batch does not duplicate participants or send another save', async () => {
  const f = fixture(), additions = [f.api.createParticipant('digimon', 'enemy', 5, 3)]
  await f.api.addParticipants('encounter', additions)
  await f.api.addParticipants('encounter', additions)
  assert.equal(f.calls.length, 1)
  assert.equal(f.api.currentEncounter.value.participants.length, 2)
})
