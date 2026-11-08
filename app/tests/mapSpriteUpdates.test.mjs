import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'
import { loadPageFunctions } from './helpers/loadTypeScript.mjs'

const canvas = 'components/MapCanvas.vue'
const clone = value => JSON.parse(JSON.stringify(value))

function harness() {
  const props = reactive({
    participants: [
      { id: 'tamer', type: 'tamer', entityId: 'tai', currentStance: 'neutral', actionsRemaining: { simple: 2 } },
      { id: 'partner', type: 'digimon', entityId: 'agumon', currentStance: 'neutral', actionsRemaining: { simple: 2 } },
      { id: 'enemy', type: 'digimon', entityId: 'goblimon', currentStance: 'neutral', actionsRemaining: { simple: 2 } },
      { id: 'plain', type: 'digimon', entityId: 'patamon', currentStance: 'neutral', actionsRemaining: { simple: 2 } },
      { id: 'unplaced', type: 'digimon', entityId: 'gabumon' },
    ],
    participantPositions: {
      tamer: { x: 0, y: 0, z: 0 }, partner: { x: 1, y: 0, z: 0 },
      enemy: { x: 4, y: 0, z: 0 }, plain: { x: 5, y: 0, z: 0 },
    },
    tamerMap: { tai: { name: 'Tai', spriteUrl: null, currentWounds: 0, woundBoxes: 6 } },
    digimonMap: Object.fromEntries(['agumon', 'goblimon', 'patamon', 'gabumon'].map(id => [id, {
      name: id, size: 'medium', giganticDimensions: null, spriteUrl: null, currentWounds: 0, woundBoxes: 6,
    }])),
    activeParticipantId: 'tamer', secondaryActiveParticipantId: 'partner',
    selectedAttack: null, attackerEffectiveLimit: 10,
  })
  const calls = { builds: 0, highlights: 0, closes: 0, reticules: 0 }
  const reticuleParticipantIds = ref([])
  const borderMaterials = new Map(props.participants.filter(p => props.participantPositions[p.id]).map(p => [p.id, {
    color: { value: null, setHex(value) { this.value = value } },
  }]))
  const colors = loadPageFunctions(canvas, ['participantBorderColor', 'refreshBorderColors', 'setHoveredTarget'], {
    props, reticuleParticipantIds, borderMaterials, hoveredTargetId: null,
  })
  colors.refreshBorderColors()
  const handlers = loadPageFunctions(canvas, [
    'getSizeParams', 'spriteGeometrySignature', 'watchParticipantSprites', 'updateReticules',
  ], {
    props, watch, scene: {}, lastAttackKey: '', lastAoeKey: '',
    buildSprites: () => calls.builds++,
    refreshBorderColors: () => { calls.highlights++; colors.refreshBorderColors() },
    closeRadial: () => calls.closes++,
    areaHighlightCells: ref([]), effectiveAttackerId: ref('tamer'), isAreaTargeting: ref(false),
    reticuleGroup: { clear: () => calls.reticules++ }, reticuleParticipantIds,
  })
  const scope = effectScope()
  scope.run(() => handlers.watchParticipantSprites())
  return { props, calls, scope, borderMaterials, reticuleParticipantIds, ...colors, ...handlers }
}

test('fresh equal entity maps, positions and participant arrays do not rebuild token geometry', async () => {
  const h = harness()
  try {
    h.props.digimonMap = clone(h.props.digimonMap)
    h.props.tamerMap = clone(h.props.tamerMap)
    h.props.participantPositions = clone(h.props.participantPositions)
    h.props.participants = clone(h.props.participants)
    await nextTick()
    assert.deepEqual(h.calls, { builds: 0, highlights: 0, closes: 0, reticules: 0 })
    h.props.participants.reverse()
    await nextTick()
    assert.equal(h.calls.builds, 0, 'roster order alone does not change a token mesh')
  } finally { h.scope.stop() }
})

test('a whole turn snapshot updates highlighting and closes the menu without rebuilding tokens', async () => {
  const h = harness()
  try {
    const materials = new Map(h.borderMaterials)
    h.props.participants = clone(h.props.participants).map(p => ({ ...p, hasActed: true, actionsRemaining: { simple: 1 } }))
    h.props.digimonMap = clone(h.props.digimonMap)
    h.props.tamerMap = clone(h.props.tamerMap)
    h.props.participantPositions = clone(h.props.participantPositions)
    h.props.activeParticipantId = 'enemy'
    h.props.secondaryActiveParticipantId = null
    await nextTick()
    assert.equal(h.calls.builds, 0)
    assert.equal(h.calls.highlights, 1)
    assert.equal(h.calls.closes, 1)
    assert.equal(h.borderMaterials.get('enemy').color.value, 0xff8800)
    assert.equal(h.borderMaterials.get('tamer').color.value, 0x334466)
    assert.equal(h.borderMaterials.get('partner').color.value, 0x334466)
    for (const [id, material] of materials) assert.equal(h.borderMaterials.get(id), material)
  } finally { h.scope.stop() }
})

test('portrait, health, stance and action updates leave mesh geometry to its existing instances', async () => {
  const h = harness()
  try {
    h.props.digimonMap.agumon.name = 'Agumon'
    h.props.digimonMap.agumon.spriteUrl = '/agumon.png'
    h.props.digimonMap.agumon.currentWounds = 2
    h.props.digimonMap.agumon.woundBoxes = 8
    h.props.tamerMap.tai.name = 'Taichi'
    h.props.tamerMap.tai.spriteUrl = '/tai.png'
    h.props.tamerMap.tai.currentWounds = 1
    h.props.participants[1].currentStance = 'defensive'
    h.props.participants[1].actionsRemaining.simple = 0
    await nextTick()
    assert.equal(h.calls.builds, 0)
    assert.equal(h.calls.highlights, 0)
    h.props.digimonMap.agumon.size = 'small'
    await nextTick()
    assert.equal(h.calls.builds, 0, 'small/medium portraits differ while their hitbox geometry remains one tile')
  } finally { h.scope.stop() }
})

test('placement, movement, unplacement and removal of a placed participant each rebuild once', async () => {
  const h = harness()
  try {
    h.props.participantPositions.unplaced = { x: 2, y: 0, z: 0 }
    await nextTick()
    assert.equal(h.calls.builds, 1)
    h.props.participantPositions.unplaced.x = 3
    h.props.participantPositions.unplaced.y = 1
    h.props.participantPositions.unplaced.z = 1
    await nextTick()
    assert.equal(h.calls.builds, 2, 'coordinate changes within one update are batched')
    delete h.props.participantPositions.unplaced
    await nextTick()
    assert.equal(h.calls.builds, 3)
    h.props.participants = h.props.participants.filter(p => p.id !== 'enemy')
    await nextTick()
    assert.equal(h.calls.builds, 4, 'a stale position cannot retain a removed participant mesh')
  } finally { h.scope.stop() }
})

test('size, Gigantic width and an evolution entity swap retain geometry rebuilds', async () => {
  const h = harness()
  try {
    h.props.digimonMap.agumon.size = 'large'
    await nextTick()
    assert.equal(h.calls.builds, 1)
    h.props.digimonMap.agumon.size = 'gigantic'
    h.props.digimonMap.agumon.giganticDimensions = { width: 4, height: 5, depth: 3 }
    await nextTick()
    assert.equal(h.calls.builds, 2)
    h.props.digimonMap.agumon.giganticDimensions.width = 6
    await nextTick()
    assert.equal(h.calls.builds, 3)
    h.props.digimonMap.greymon = { ...h.props.digimonMap.agumon }
    h.props.participants[1].entityId = 'greymon'
    await nextTick()
    assert.equal(h.calls.builds, 4, 'same-sized evolution still replaces the entity-specific group')
  } finally { h.scope.stop() }
})

test('combined layout changes are rebuilt once and unplaced-only edits do not rebuild', async () => {
  const h = harness()
  try {
    h.props.participants.push({ id: 'new', type: 'digimon', entityId: 'new-form' })
    h.props.digimonMap['new-form'] = { size: 'huge' }
    h.props.participantPositions.new = { x: 8, y: 0, z: 2 }
    h.props.digimonMap.agumon.size = 'large'
    h.props.participantPositions.partner.x = 2
    h.props.activeParticipantId = 'new'
    h.props.secondaryActiveParticipantId = null
    await nextTick()
    assert.equal(h.calls.builds, 1)
    assert.equal(h.calls.highlights, 1)
    h.props.digimonMap.gabumon.size = 'huge'
    h.props.participants = h.props.participants.filter(p => p.id !== 'unplaced')
    await nextTick()
    assert.equal(h.calls.builds, 1)
  } finally { h.scope.stop() }
})

test('target movement invalidates the existing reticule cache even when its attacker key is unchanged', async () => {
  const h = harness()
  try {
    h.updateReticules()
    h.updateReticules()
    assert.equal(h.calls.reticules, 1)
    h.props.participantPositions.enemy.x++
    await nextTick()
    h.updateReticules()
    assert.equal(h.calls.reticules, 2)
    h.updateReticules()
    assert.equal(h.calls.reticules, 2, 'the cache remains useful after that refresh')
  } finally { h.scope.stop() }
})

test('turn highlighting preserves hover over target over active over default color priority', async () => {
  const h = harness()
  try {
    h.setHoveredTarget('tamer')
    h.reticuleParticipantIds.value = ['tamer', 'partner', 'enemy']
    h.props.activeParticipantId = 'enemy'
    h.props.secondaryActiveParticipantId = 'plain'
    await nextTick()
    assert.deepEqual([...h.borderMaterials.values()].map(material => material.color.value), [
      0x33ff66, 0xff2222, 0xff2222, 0xff8800,
    ])
    assert.equal(h.calls.builds, 0)
    h.setHoveredTarget(null)
    h.reticuleParticipantIds.value = []
    h.props.activeParticipantId = 'tamer'
    h.props.secondaryActiveParticipantId = null
    await nextTick()
    assert.deepEqual([...h.borderMaterials.values()].map(material => material.color.value), [
      0xff8800, 0x334466, 0x334466, 0x334466,
    ])
  } finally { h.scope.stop() }
})

test('component scope disposal stops both mesh and highlight watchers', async () => {
  const h = harness()
  h.scope.stop()
  h.props.participantPositions.partner.x++
  h.props.activeParticipantId = 'enemy'
  await nextTick()
  assert.equal(h.calls.builds, 0)
  assert.equal(h.calls.highlights, 0)
  assert.equal(h.calls.closes, 0)
})
