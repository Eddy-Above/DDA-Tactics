import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { loadPageFunctions } from './helpers/loadTypeScript.mjs'

test('focusing a turn-order character pans to its full footprint without changing zoom or angle', () => {
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(10, 20, 30)
  const controls = { target: new THREE.Vector3(1, 2, 3), update() {} }
  const offset = camera.position.clone().sub(controls.target)
  let rendered = 0
  const { focusParticipant } = loadPageFunctions('components/MapCanvas.vue', ['focusParticipant'], {
    props: { participantPositions: { actor: { x: 40, y: 8, z: -10 } } },
    camera, controls, THREE, TILE_SIZE: 1, TILE_H: 0.1, azimuthTween: null,
    getParticipantFootprintDims: () => ({ width: 4, height: 5, depth: 6 }),
    invalidateFrame: () => rendered++,
  })
  focusParticipant('actor')
  assert.deepEqual(controls.target.toArray(), [42, 10.6, -7])
  assert.ok(camera.position.clone().sub(controls.target).distanceTo(offset) < 1e-9)
  assert.equal(rendered, 1)
  const before = camera.position.clone()
  focusParticipant('unplaced')
  assert.ok(camera.position.equals(before))
  assert.equal(rendered, 1)
})

test('EncounterMap forwards name focus to its live canvas', () => {
  const focused = []
  const { focusParticipant } = loadPageFunctions('components/EncounterMap.vue', ['focusParticipant'], {
    builderCanvas: { value: { focusParticipant: id => focused.push(id) } },
  })
  focusParticipant('actor')
  assert.deepEqual(focused, ['actor'])
})
