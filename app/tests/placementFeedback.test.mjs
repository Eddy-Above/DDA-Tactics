import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'
const { createSerialTaskQueue } = loadTypeScript('utils/serialTaskQueue.ts')
const point = (x, y = 0, z = 0) => ({ x, y, z })
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }

function fixture({ fetch } = {}) {
  const props = { tamerMap: {}, digimonMap: {}, encounter: { id: 'encounter', revision: 4, participants: ['actor', 'second', 'third'].map(id => ({ id, entityId: id, type: 'tamer' })) } }
  const positions = ref({ actor: point(0) }), placementPreviews = ref({}), pendingPlacementRequests = new Map()
  const selectedId = ref('actor'), gmMoveParticipantId = ref('actor'), calls = [], errors = [], updates = []
  let resolve, reject
  const response = new Promise((yes, no) => { resolve = yes; reject = no })
  const placementQueue = createSerialTaskQueue(), placementError = ref('')
  const placementPositions = computed(() => ({ ...positions.value, ...placementPreviews.value }))
  const placeableIds = computed(() => props.encounter.participants.map(p => p.id).filter(id => !placementPreviews.value[id]))
  const handlers = loadPageFunctions('components/EncounterMap.vue', ['postMove', 'onCanvasPlace', 'onGmMove', 'sameVec3', 'selectParticipant'], {
    props, positions, placementPreviews, pendingPlacementRequests, selectedId, gmMoveParticipantId, mapDisposed: false,
    placementQueue, placementError, placementPositions, placeableIds, lastMovementRevision: null,
    $fetch: (...args) => { calls.push(args); return fetch ? fetch(...args) : response }, alert: message => errors.push(message), emit: (...args) => updates.push(args),
  })
  return { ...handlers, props, positions, placementPreviews, selectedId, gmMoveParticipantId, pendingPlacementRequests, calls, errors, updates, resolve, reject, placementQueue, placementError,
    display: computed(() => ({ ...positions.value, ...placementPreviews.value })) }
}

for (const kind of ['placement', 'gm', 'normal', 'charge-after']) {
  test(`${kind} displays a pending destination immediately while retaining the committed origin for validation`, async () => {
    const f = fixture()
    const saving = kind === 'placement' ? f.onCanvasPlace('actor', point(3)) : kind === 'gm' ? f.onGmMove('actor', point(3)) : f.postMove('actor', point(3), [point(0), point(3)], kind)
    assert.deepEqual(f.display.value.actor, point(3))
    assert.deepEqual(f.positions.value.actor, point(0))
    if (kind === 'placement') assert.equal(f.selectedId.value, 'second', 'advance before the save completes')
    else if (kind === 'gm') assert.equal(f.gmMoveParticipantId.value, null)
    await settle()
    assert.deepEqual(f.calls[0][1].body.origin, point(0))
    assert.equal(f.calls[0][1].body.expectedRevision, 4)
    assert.equal(f.calls[0][1].body.kind, kind)
    f.resolve({ success: true, position: point(3), encounter: { id: 'encounter' } })
    await saving
    assert.deepEqual(f.positions.value.actor, point(3))
    assert.deepEqual(f.placementPreviews.value, {})
    if (kind === 'placement' || kind === 'gm') assert.equal((kind === 'placement' ? f.selectedId : f.gmMoveParticipantId).value, kind === 'placement' ? 'second' : null)
    assert.equal(f.errors.length, 0)
  })

  test(`${kind} rolls back its preview after rejection without stealing selection or blocking with an alert`, async () => {
    const f = fixture()
    const saving = kind === 'placement' ? f.onCanvasPlace('actor', point(3)) : kind === 'gm' ? f.onGmMove('actor', point(3)) : f.postMove('actor', point(3), [point(0), point(3)], kind)
    await settle()
    f.reject({ data: { message: 'The destination is occupied' } })
    await saving
    assert.deepEqual(f.display.value.actor, point(0))
    assert.deepEqual(f.placementPreviews.value, {})
    if (kind === 'placement' || kind === 'gm') assert.equal((kind === 'placement' ? f.selectedId : f.gmMoveParticipantId).value, kind === 'placement' ? 'second' : null)
    assert.match(f.placementError.value, /Token: The destination is occupied/)
    assert.deepEqual(f.errors, [])
  })
}

test('repeated clicks while a placement is pending do not create duplicate HTTP commands', async () => {
  const f = fixture(), first = f.onCanvasPlace('actor', point(3))
  await f.onCanvasPlace('actor', point(4))
  await settle()
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.display.value.actor, point(3))
  f.resolve({ success: true, position: point(3) }); await first
})

test('an older acknowledgement cannot overwrite a newer authoritative position or clear another selected token', async () => {
  const f = fixture(), saving = f.onCanvasPlace('actor', point(3))
  f.positions.value = { actor: point(5) }
  f.selectedId.value = 'other'
  f.resolve({ success: true, position: point(3) }); await saving
  assert.deepEqual(f.positions.value.actor, point(5))
  assert.equal(f.selectedId.value, 'other')
})

test('a late response from a previous encounter cannot update the new encounter', async () => {
  const f = fixture(), saving = f.onGmMove('actor', point(3))
  f.props.encounter.id = 'new-encounter'
  f.pendingPlacementRequests.clear(); f.placementPreviews.value = {}
  f.positions.value = { actor: point(9) }
  f.resolve({ success: true, position: point(3), encounter: { id: 'encounter' } }); await saving
  assert.deepEqual(f.positions.value.actor, point(9))
  assert.deepEqual(f.updates, [])
})

test('arming setup re-placement keeps the real origin instead of removing the committed token', () => {
  const f = fixture()
  f.selectedId.value = null
  f.selectParticipant('actor')
  assert.deepEqual(f.positions.value.actor, point(0))
  assert.equal(f.selectedId.value, 'actor')
})

test('three tokens can be placed before the first save completes, with serialized saves using each acknowledged revision', async () => {
  const gates = []
  const f = fixture({ fetch: () => new Promise(resolve => gates.push(resolve)) })
  const first = f.onCanvasPlace('actor', point(1))
  const second = f.onCanvasPlace('second', point(2))
  const third = f.onCanvasPlace('third', point(3))
  assert.equal(f.selectedId.value, null)
  assert.deepEqual(f.display.value, { actor: point(1), second: point(2), third: point(3) })
  await settle()
  assert.equal(f.calls.length, 1, 'one HTTP request at a time, without blocking token placement')
  gates[0]({ success: true, position: point(1), encounter: { id: 'encounter', revision: 5 } })
  await first; await settle()
  assert.equal(f.calls.length, 2)
  assert.equal(f.calls[1][1].body.expectedRevision, 5, 'do not reuse the first token revision')
  assert.deepEqual(f.display.value.third, point(3), 'other previews survive acknowledgements')
  gates[1]({ success: true, position: point(2), encounter: { id: 'encounter', revision: 6 } })
  await second; await settle()
  assert.equal(f.calls[2][1].body.expectedRevision, 6)
  gates[2]({ success: true, position: point(3) })
  await third; await f.placementQueue.flush()
  assert.deepEqual(f.placementPreviews.value, {})
  assert.deepEqual(f.positions.value, { actor: point(1), second: point(2), third: point(3) })
})

test('one rejected placement does not block later tokens in the queue', async () => {
  const f = fixture({ fetch: async (_url, { body }) => {
    if (body.participantId === 'actor') throw { data: { message: 'Occupied' } }
    return { success: true, position: body.destination }
  } })
  await Promise.all([f.onCanvasPlace('actor', point(1)), f.onCanvasPlace('second', point(2))])
  assert.deepEqual(f.positions.value.actor, point(0))
  assert.deepEqual(f.positions.value.second, point(2))
  assert.deepEqual(f.placementPreviews.value, {})
  assert.match(f.placementError.value, /Occupied/)
})

test('queued placements from an abandoned encounter are never sent', async () => {
  const f = fixture(), first = f.onCanvasPlace('actor', point(1)), second = f.onCanvasPlace('second', point(2))
  await settle()
  f.props.encounter.id = 'new-encounter'; f.pendingPlacementRequests.clear(); f.placementPreviews.value = {}
  f.resolve({ success: true, position: point(1) })
  await Promise.all([first, second])
  assert.equal(f.calls.length, 1)
  assert.deepEqual(f.updates, [])
})
