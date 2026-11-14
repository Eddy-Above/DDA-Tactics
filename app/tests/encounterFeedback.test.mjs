import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadPageFunctions } from './helpers/loadTypeScript.mjs'
import { ref } from 'vue'

const { createEncounterFeedback, previewEncounterActions } = loadTypeScript('utils/encounterFeedback.ts')
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
const encounter = () => ({ id: 'enc', phase: 'combat', mapId: 'old', participants: [{ id: 'actor', currentStance: 'neutral', actionsRemaining: { simple: 2 } }], pendingRequests: [{ id: 'request' }] })

for (const [path, method, body] of [
  ['actions/stance', 'POST', { participantId: 'actor', stance: 'offensive' }],
  ['actions/attack', 'POST', { participantId: 'actor', targetId: 'target' }],
  ['actions/special-order', 'POST', { participantId: 'actor' }],
  ['actions/end-turn', 'POST', { participantId: 'actor' }],
  ['actions/digivolve', 'POST', { participantId: 'actor' }],
  ['actions/intercede-claim', 'POST', { requestId: 'request' }],
  ['responses', 'POST', { requestId: 'request' }],
  ['requests/request', 'DELETE', undefined],
  ['', 'PUT', { mapId: 'new' }],
  ['', 'PUT', { participants: [...encounter().participants, { id: 'added' }] }],
]) test(`${method} ${path || 'setup'} acknowledges the choice before the network responds and clears on completion`, async () => {
  const gate = deferred(), f = createEncounterFeedback(() => gate.promise)
  const sending = f.fetch(`/api/encounters/enc${path ? '/' + path : ''}`, { method, body })
  assert.equal(f.pending.value.length, 1)
  const original = encounter(), shown = previewEncounterActions(original, f.pending.value)
  if (path === 'actions/stance') {
    assert.equal(shown.participants[0].currentStance, 'offensive')
    assert.equal(shown.participants[0].actionsRemaining.simple, 1)
    assert.equal(original.participants[0].currentStance, 'neutral', 'predictions must not mutate the confirmed snapshot')
    assert.equal(previewEncounterActions(shown, f.pending.value).participants[0].actionsRemaining.simple, 1, 'a nested map must not deduct twice')
  }
  if (body?.mapId) assert.equal(shown.mapId, 'new')
  if (body?.participants) assert.equal(shown.participants.length, 2)
  if (path.startsWith('responses') || method === 'DELETE') assert.equal(shown.pendingRequests.length, 0)
  assert.equal(previewEncounterActions({ ...original, id: 'other' }, f.pending.value).mapId, 'old')
  gate.resolve({ accepted: true }); assert.deepEqual(await sending, { accepted: true })
  assert.equal(f.pending.value.length, 0)
})

test('duplicate clicks join a pending intent; failures remove predictions and retain the server explanation for retry', async () => {
  const gate = deferred(); let calls = 0
  const f = createEncounterFeedback(() => { calls++; return gate.promise })
  const send = id => f.fetch('/api/encounters/enc/actions/stance', { method: 'POST', body: { participantId: 'actor', stance: 'brave', operationId: id } })
  const first = send('first'), duplicate = send('duplicate')
  assert.equal(first, duplicate); assert.equal(calls, 1)
  gate.reject({ data: { message: 'It is no longer your turn' } })
  await assert.rejects(first)
  assert.equal(f.pending.value.length, 0)
  assert.equal(previewEncounterActions(encounter(), f.pending.value).participants[0].currentStance, 'neutral')
  assert.equal(f.errors.value[0].message, 'It is no longer your turn')
  f.dismiss(f.errors.value[0].id); assert.equal(f.errors.value.length, 0)
})

for (const kind of ['charge-before', 'pass']) test(`${kind} preview survives target selection and clears after a rejected atomic attack`, async () => {
  const gate = deferred(), f = createEncounterFeedback(() => gate.promise)
  const destination = { x: 5, y: 0, z: 0 }
  f.previewMovement('enc', 'cast', 'actor', destination)
  assert.deepEqual(f.movementPreviews.value[0].position, destination)
  const sending = f.fetch('/api/encounters/enc/actions/attack', { method: 'POST', body: { operationId: 'cast', participantId: 'actor', movement: { kind, destination } } })
  f.cancelMovementPreview('enc')
  assert.equal(f.movementPreviews.value.length, 1, 'a submitted move remains visible when targeting closes')
  gate.reject(new Error('Encounter changed')); await assert.rejects(sending)
  assert.equal(f.movementPreviews.value.length, 0)
})

test('cancelling an unsubmitted attack restores its token without cancelling another encounter', () => {
  const f = createEncounterFeedback(async () => ({}))
  f.previewMovement('enc', 'cast', 'actor', { x: 4 }); f.previewMovement('other', 'other-cast', 'actor', { x: 2 })
  f.cancelMovementPreview('enc')
  assert.equal(f.movementPreviews.value.length, 1)
  assert.equal(f.movementPreviews.value[0].encounterId, 'other')
})

test('GETs and unrelated APIs do not enter encounter feedback', async () => {
  const f = createEncounterFeedback(async () => ({ ok: true }))
  await f.fetch('/api/encounters/enc'); await f.fetch('/api/maps/map', { method: 'PUT' })
  assert.deepEqual(f.pending.value, [])
})

test('attaching a map releases its picker while the save remains in flight', async () => {
  const gate = deferred(), showMapPicker = ref(true), currentEncounter = ref(encounter())
  const page = loadPageFunctions('pages/campaigns/[campaignId]/encounters/[id].vue', ['attachMap'], {
    showMapPicker, currentEncounter, updateEncounter: () => gate.promise,
  })
  const sending = page.attachMap('new')
  assert.equal(showMapPicker.value, false)
  gate.resolve({}); await sending
})

test('door changes preview immediately and rejection restores the confirmed door without a blocking alert', async () => {
  const gate = deferred(), map = ref({ id: 'map', doors: [{ id: 'door', isOpen: false }] }), doorPreviews = ref({}), placementError = ref('')
  const page = loadPageFunctions('components/EncounterMap.vue', ['setDoorsOpen'], {
    map, doorPreviews, placementError, props: { encounter: { id: 'enc' } }, selectedId: ref('actor'), activeParticipantId: ref('actor'),
    positions: ref({}), mapDisposed: false, $fetch: () => gate.promise,
  })
  const saving = page.setDoorsOpen(['door'], true)
  assert.equal(doorPreviews.value.door.isOpen, true)
  assert.equal(map.value.doors[0].isOpen, false)
  gate.reject({ data: { message: 'Stand beside the door' } }); await saving
  assert.deepEqual(doorPreviews.value, {})
  assert.equal(map.value.doors[0].isOpen, false)
  assert.equal(placementError.value, 'Stand beside the door')
})

test('special order target selection closes before sending and returns for a rejected order', async () => {
  const gate = deferred(), { useSpecialOrderTargets } = loadTypeScript('composables/useSpecialOrderTargets.ts')
  const actor = { id: 'actor', type: 'tamer' }
  const picker = useSpecialOrderTargets({ participants: () => [actor], digimon: () => [], nameFor: p => p.id, send: () => gate.promise })
  await picker.open(actor, 'Enemy Scan')
  const sending = picker.confirm({ targetId: 'target' })
  assert.equal(picker.selection.value, null)
  assert.equal(picker.busy.value, true)
  gate.resolve(false); await sending
  assert.equal(picker.selection.value.orderName, 'Enemy Scan')
  assert.equal(picker.busy.value, false)
})

test('late door acknowledgements preserve newer geometry and a later door choice', async () => {
  const first = deferred(), second = deferred(), map = ref({ id: 'map', doors: [{ id: 'door', label: 'original', isOpen: false }] })
  const doorPreviews = ref({}), props = { encounter: { id: 'enc' } }; let calls = 0
  const page = loadPageFunctions('components/EncounterMap.vue', ['setDoorsOpen'], {
    map, doorPreviews, props, placementError: ref(''), selectedId: ref('actor'), activeParticipantId: ref('actor'),
    positions: ref({}), mapDisposed: false, $fetch: () => ++calls === 1 ? first.promise : second.promise,
  })
  const opening = page.setDoorsOpen(['door'], true)
  map.value = { ...map.value, doors: [{ ...map.value.doors[0], label: 'new geometry' }] }
  const closing = page.setDoorsOpen(['door'], false)
  second.resolve({ doors: [{ id: 'door', label: 'stale geometry', isOpen: false }] }); await closing
  first.resolve({ doors: [{ id: 'door', label: 'original', isOpen: true }] }); await opening
  assert.deepEqual(map.value.doors[0], { id: 'door', label: 'new geometry', isOpen: false })
  assert.deepEqual(doorPreviews.value, {})
})
