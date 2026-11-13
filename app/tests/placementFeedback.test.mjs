import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { loadPageFunctions } from './helpers/loadTypeScript.mjs'
const point = (x, y = 0, z = 0) => ({ x, y, z })

function fixture() {
  const props = { encounter: { id: 'encounter', revision: 4 } }
  const positions = ref({ actor: point(0) }), placementPreviews = ref({}), pendingPlacementRequests = new Map()
  const selectedId = ref('actor'), gmMoveParticipantId = ref('actor'), calls = [], errors = [], updates = []
  let resolve, reject
  const response = new Promise((yes, no) => { resolve = yes; reject = no })
  const handlers = loadPageFunctions('components/EncounterMap.vue', ['postMove', 'onCanvasPlace', 'onGmMove', 'sameVec3', 'selectParticipant'], {
    props, positions, placementPreviews, pendingPlacementRequests, selectedId, gmMoveParticipantId, mapDisposed: false,
    $fetch: (...args) => { calls.push(args); return response }, alert: message => errors.push(message), emit: (...args) => updates.push(args),
  })
  return { ...handlers, props, positions, placementPreviews, selectedId, gmMoveParticipantId, pendingPlacementRequests, calls, errors, updates, resolve, reject,
    display: computed(() => ({ ...positions.value, ...placementPreviews.value })) }
}

for (const kind of ['placement', 'gm']) {
  test(`${kind} displays a pending destination immediately while retaining the committed origin for validation`, async () => {
    const f = fixture()
    const saving = kind === 'placement' ? f.onCanvasPlace('actor', point(3)) : f.onGmMove('actor', point(3))
    assert.deepEqual(f.display.value.actor, point(3))
    assert.deepEqual(f.positions.value.actor, point(0))
    assert.deepEqual(f.calls[0][1].body.origin, point(0))
    assert.equal(f.calls[0][1].body.expectedRevision, 4)
    assert.equal(f.calls[0][1].body.kind, kind)
    f.resolve({ success: true, position: point(3), encounter: { id: 'encounter' } })
    await saving
    assert.deepEqual(f.positions.value.actor, point(3))
    assert.deepEqual(f.placementPreviews.value, {})
    assert.equal((kind === 'placement' ? f.selectedId : f.gmMoveParticipantId).value, null)
    assert.equal(f.errors.length, 0)
  })

  test(`${kind} rolls back its preview after rejection and preserves the selected token for retry`, async () => {
    const f = fixture()
    const saving = kind === 'placement' ? f.onCanvasPlace('actor', point(3)) : f.onGmMove('actor', point(3))
    f.reject({ data: { message: 'The destination is occupied' } })
    await saving
    assert.deepEqual(f.display.value.actor, point(0))
    assert.deepEqual(f.placementPreviews.value, {})
    assert.equal((kind === 'placement' ? f.selectedId : f.gmMoveParticipantId).value, 'actor')
    assert.deepEqual(f.errors, ['The destination is occupied'])
  })
}

test('repeated clicks while a placement is pending do not create duplicate HTTP commands', async () => {
  const f = fixture(), first = f.onCanvasPlace('actor', point(3))
  await f.onCanvasPlace('actor', point(4))
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
