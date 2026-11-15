import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions } from './helpers/loadTypeScript.mjs'

function fixture(isDm = false) {
  const props = { isDm, encounter: { participants: [
    { id: 'npc', pendingChargeMove: { castId: 'npc-cast' } },
    { id: 'another-player', pendingChargeMove: { castId: 'other-cast' } },
    { id: 'mine', pendingChargeMove: { castId: 'my-cast' } },
  ] } }
  const starts = [], chargeMoveParticipantId = ref(null), npcMoveParticipantId = ref(null)
  let clears = 0
  const methods = loadPageFunctions('components/EncounterMap.vue', ['canControlChargeMove', 'refreshPendingChargeMove', 'startChargeAfterMove'], {
    props, myParticipantIds: ref(['mine']), map: ref({}), chargeMoveParticipantId, npcMoveParticipantId,
    movement: { clearMovement: () => { clears++ }, computeReachable: pos => starts.push(pos) },
    npcMoveCaps: id => ({ pos: id, budget: 4, caps: {}, occupied: new Set() }), destroyedIds: () => new Set(),
  })
  return { ...methods, props, starts, chargeMoveParticipantId, npcMoveParticipantId, clears: () => clears }
}

test('players only enter Charge movement for their own character, even when an NPC allowance appears first', () => {
  const f = fixture()
  f.refreshPendingChargeMove()
  assert.deepEqual(f.starts, ['mine'])
  assert.equal(f.chargeMoveParticipantId.value, 'mine')
  f.startChargeAfterMove('npc')
  f.startChargeAfterMove('another-player')
  assert.deepEqual(f.starts, ['mine'])
  f.startChargeAfterMove('mine')
  assert.equal(f.npcMoveParticipantId.value, 'mine')
})

test('removing an owned allowance clears it without activating another character', () => {
  const f = fixture()
  f.refreshPendingChargeMove()
  delete f.props.encounter.participants[2].pendingChargeMove
  f.refreshPendingChargeMove()
  assert.equal(f.chargeMoveParticipantId.value, null)
  assert.equal(f.clears(), 1)
  assert.deepEqual(f.starts, ['mine'])
})

test('GM retains control of NPC Charge movement', () => {
  const f = fixture(true)
  f.refreshPendingChargeMove()
  assert.equal(f.chargeMoveParticipantId.value, 'npc')
  f.startChargeAfterMove('npc')
  assert.equal(f.npcMoveParticipantId.value, 'npc')
})
