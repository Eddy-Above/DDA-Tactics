import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { availableCombatAttacks } = loadTypeScript('utils/combatAttackOptions.ts')

function fixture(accepted = true) {
  const participant = { id: 'partner', entityId: 'form', type: 'digimon', usedAttackIds: ['one', 'two'], actionsRemaining: { simple: 1 }, battery: 2 }
  const encounter = ref({ id: 'encounter', participants: [participant] })
  const unlockingAttackId = ref(null), writes = []
  return { encounter, unlockingAttackId, writes, ...loadPageFunctions('pages/campaigns/[campaignId]/encounters/[id].vue', ['unlockUsedAttack'], {
    currentEncounter: encounter, unlockingAttackId,
    updateEncounter: async (_id, patch) => { writes.push(patch); return accepted ? { ...encounter.value, ...patch } : null },
    applyActionResult: async result => { encounter.value = result },
  }) }
}

test('GM unlock makes only the selected used attack available without resetting actions or battery', async () => {
  const f = fixture()
  const attacks = [{ id: 'one', tags: [] }, { id: 'two', tags: [] }]
  assert.deepEqual(availableCombatAttacks(f.encounter.value.participants[0], attacks, [], { round: 1 }), [])
  await f.unlockUsedAttack('partner', 'one')
  const participant = f.encounter.value.participants[0]
  assert.deepEqual(availableCombatAttacks(participant, attacks, [], { round: 1 }).map(attack => attack.id), ['one'])
  assert.deepEqual(participant.usedAttackIds, ['two'])
  assert.equal(participant.actionsRemaining.simple, 1)
  assert.equal(participant.battery, 2)
  assert.equal(f.unlockingAttackId.value, null)
})

test('failed or stale unlocks do not remove attack locks', async () => {
  const f = fixture(false)
  await f.unlockUsedAttack('missing', 'one')
  await f.unlockUsedAttack('partner', 'not-used')
  assert.equal(f.writes.length, 0)
  await f.unlockUsedAttack('partner', 'one')
  assert.deepEqual(f.encounter.value.participants[0].usedAttackIds, ['one', 'two'])
  assert.equal(f.unlockingAttackId.value, null)
})
