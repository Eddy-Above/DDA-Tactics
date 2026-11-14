import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const point = (x, y = 0) => ({ x, y, z: 0 })
function fixture() {
  const positions = ref({ actor: point(0) }), preview = ref(null), emitted = []
  const methods = loadPageFunctions('components/EncounterMap.vue', ['attackIntent', 'onChargeTargetSelected', 'onAreaAttackConfirmed'], {
    actionFeedback: { previewMovement() {} },
    positions, attackPreview: preview, pendingAttackIntent: null,
    props: { encounter: { revision: 8 }, selectedAttack: { attackerParticipantId: 'actor', chargeMode: 'before' } },
    chargeMode: ref('before'), activeParticipantId: ref('actor'), movement: { clearMovement() {} },
    movePathTo: (_actor, destination) => [point(0), point(1), destination],
    computePassLanding: loadTypeScript('utils/areaShapes.ts').computePassLanding,
    segmentCells: loadTypeScript('utils/lineOfSight.ts').segmentCells,
    emit: (...args) => emitted.push(args),
    ws: { send() { throw new Error('Previews must not write to the WebSocket') } },
    $fetch() { throw new Error('Previews must not send HTTP commands') },
  })
  return { ...methods, positions, preview, emitted }
}
test('Charge-before prepares a local preview and final attack intent without moving the authoritative token', () => {
  const f = fixture()
  f.onChargeTargetSelected('actor', point(2), 'target')
  assert.deepEqual(f.positions.value.actor, point(0))
  assert.deepEqual(f.preview.value.position, point(2))
  assert.equal(f.emitted[0][0], 'target-selected')
  const intent = f.emitted[0][2]
  assert.equal(intent.expectedRevision, 8)
  assert.equal(intent.chargeTiming, 'before')
  assert.deepEqual(intent.movement.path, [point(0), point(1), point(2)])
  assert.equal(f.attackIntent().operationId, intent.operationId)
})
test('Pass confirmation submits its origin, direction and destination with the final attack, without a separate movement write', () => {
  const f = fixture()
  f.onAreaAttackConfirmed(['target'], { shape: 'pass', attackerPos: point(0), dir: point(1), movement: 3, ram: 1 })
  assert.deepEqual(f.positions.value.actor, point(0))
  assert.equal(f.emitted[0][0], 'area-attack-confirmed')
  const intent = f.emitted[0][3]
  assert.equal(intent.movement.kind, 'pass')
  assert.deepEqual(intent.movement.destination, point(4))
  assert.deepEqual(intent.movement.origin, point(0))
})
