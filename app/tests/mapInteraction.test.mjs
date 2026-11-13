import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import * as THREE from 'three'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import ts from 'typescript'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const rules = loadTypeScript('utils/movementRules.ts')
const voxels = loadTypeScript('utils/mapVoxels.ts')
const renderResources = loadTypeScript('utils/mapRenderResources.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const sprite = id => ({ object: { userData: { type: 'sprite', participantId: id } }, point: new THREE.Vector3(0.5, 0.5, 0.5) })
const ground = (x = 0, y = 0, z = 0) => ({ object: { userData: { type: 'ground', tile: point(x, y, z) } }, point: new THREE.Vector3(x + 0.5, y, z + 0.5) })

function harness(t, isDm = false) {
  const props = reactive({
    isDm, activeTool: 'select', activeParticipantId: 'partner', myParticipantIds: ['partner'],
    participants: [
      { id: 'partner', type: 'digimon', entityId: 'partner-record', currentWounds: 1, maxWounds: 10 },
      { id: 'ally', type: 'tamer', entityId: 'ally-record', currentWounds: 3, maxWounds: 10 },
      { id: 'enemy', type: 'digimon', entityId: 'enemy-record', currentWounds: 7, maxWounds: 10, isEnemy: true },
    ],
    participantPositions: { partner: point(), ally: point(), enemy: point() },
    digimonMap: { 'partner-record': { size: 'tiny', name: 'Partner' }, 'enemy-record': { size: 'tiny', name: 'Enemy' } },
    tamerMap: { 'ally-record': { name: 'Ally', currentWounds: 3, woundBoxes: 10 } },
    map: { groundTiles: [], voxels: [], spaceTiles: [], walls: [], doors: [], windows: [], stairs: [], ceilings: [] },
    gmMoveParticipantId: null, npcMoveParticipantId: null, chargeMoveParticipantId: null,
    chargeMode: null, selectedAttack: null, placingParticipantId: null,
    reachableCells: new Set(), activePath: [],
  })
  const refs = Object.fromEntries([
    'participantChoice', 'participantChoiceScreen', 'clickedHealthBar', 'movingParticipantId',
    'npcRadialId', 'playerRadialId', 'gmRadialId', 'npcRadialScreen', 'playerRadialScreen', 'gmRadialScreen',
    'hoveredMoveScreen', 'pendingMovePos', 'moveStartPos',
  ].map(name => [name, ref(null)]))
  const events = [], hovered = []
  const pointer = { useCamera: false }
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 500)
  camera.position.set(0, 18, 18)
  const controls = { enableZoom: true, target: new THREE.Vector3(), update: () => {
    camera.lookAt(controls.target)
    camera.updateMatrixWorld(true)
  } }
  let handlers
  const deps = {
    ...refs, props, THREE, ...rules, ...voxels, ...renderResources, watch,
    vec3Key: p => `${p.x},${p.y},${p.z}`, TILE_SIZE: 1, TILE_H: 0.1,
    participantDisplayNames: ref({ partner: 'Partner', ally: 'Ally', enemy: 'Enemy' }),
    participantChoiceItems: computed(() => handlers?.participantChoiceOptions() ?? []),
    radialParticipantId: computed(() => refs.npcRadialId.value ?? refs.playerRadialId.value ?? refs.gmRadialId.value),
    characterOverlays: ref(Object.fromEntries(['partner', 'ally', 'enemy'].map(id => [id, { x: 40, y: 40, h: 20 }]))),
    worldToScreen2D: p => ({ x: p.x * 10, y: p.z * 10 }),
    npcMoveY: ref(0), gmMoveY: ref(0), hoveredMoveDistance: ref(0),
    camera, controls, hoverGhostGroup: new THREE.Group(),
    movementGhost: ref(null), movementGhostOverlay: ref(null), movementGapLabel: ref(null),
    updateMovementGhostOverlay: () => {}, renderMovementGap: () => {},
    raycaster: new THREE.Raycaster(new THREE.Vector3(1000.2, 100, -500.2), new THREE.Vector3(0, -1, 0)),
    setMouseFromEvent: () => { if (pointer.useCamera) deps.raycaster.setFromCamera(new THREE.Vector2(), camera) },
    reticuleParticipantIds: ref([]),
    getIntersection: () => deps.hits,
    hits: [sprite('enemy'), ground()],
    isPlacementSurface: hit => ['ground', 'space', 'voxel'].includes(hit.object.userData.type),
    reticuleTargetFromHits: () => deps.reticuleParticipantIds.value[0] ?? null,
    evaluatePlacementAt: () => ({ valid: true, cell: point(2) }),
    highlightDoor: () => {}, setHoveredTarget: id => hovered.push(id), updateTargetHover: () => {},
    spacePanning: ref(false), panGesture: false, strokePoints: [], dragStartHit: null, editorHint: ref(null),
    rightDragActive: false, rightDragLastX: 0, suppressNextClick: false,
    tokenDrag: { isPressed: () => false, abort: () => false },
    areaHighlightCells: ref([]), getAreaShape: () => null, usesVerticalAim: ref(false),
    tryChargeMove: id => { events.push(['charge-target', id]) },
    emit: (...args) => {
      events.push(args)
      if (args[0] === 'movement-cancelled' || args[0] === 'gm-moved') props.gmMoveParticipantId = null
    },
  }
  handlers = loadPageFunctions('components/MapCanvas.vue', [
    'getParticipantSize', 'getParticipantFootprintDims', 'footprintIntersectsArea', 'footprintOccupied',
    'participantCandidatesAt', 'participantRegionFromHits', 'participantChoiceOptions',
    'closeRadial', 'onParticipantChoice', 'onParticipantChoiceHover', 'updateRadialScreen', 'canUseTurnRadial', 'selectMapParticipant',
    'tryReticuleTarget', 'getMoveAim', 'moveCellAt', 'validGmMoveCell', 'cancelMoveAim', 'movementPreviewCenter',
    'onCanvasClick', 'onMouseMove', 'onMouseDown', 'onWheel',
  ], deps)
  const source = readFileSync(new URL('../components/MapCanvas.vue', import.meta.url), 'utf8')
  const watches = source.slice(source.indexOf('// Enter NPC movement mode'), source.indexOf('watch(() => props.selectedAttack, (attack, prevAttack)'))
  const compiled = ts.transpileModule(watches, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const watchDeps = { ...deps, ...handlers }
  const scope = effectScope()
  scope.run(() => new Function(...Object.keys(watchDeps), compiled)(...Object.values(watchDeps)))
  t.after(() => scope.stop())
  return { ...deps, ...handlers, events, hovered, pointer, scope }
}

test('clicking overlapping tokens opens the chooser before health, actions or targeting', t => {
  const h = harness(t)
  h.reticuleParticipantIds.value = ['enemy']
  h.onCanvasClick({})
  assert.deepEqual(h.participantChoiceOptions().map(item => item.label), ['Partner', 'Ally', 'Enemy'])
  assert.deepEqual(h.events, [])
  assert.equal(h.clickedHealthBar.value, null)
  assert.equal(h.playerRadialId.value, null)
})

for (const [id, expectedHealth] of [['ally', 0.7], ['enemy', 0.3]]) {
  test(`a player can choose the overlapping ${id} to see its current health`, t => {
    const h = harness(t)
    h.onCanvasClick({})
    h.onParticipantChoice({ id: `participant:${id}` })
    assert.equal(h.clickedHealthBar.value.name.toLowerCase(), id)
    assert.ok(Math.abs(h.clickedHealthBar.value.pct - expectedHealth) < 1e-9)
    assert.equal(h.participantChoice.value, null)
    assert.equal(h.playerRadialId.value, null)
  })
}

test('a player can choose their own overlapping partner to open its actions', t => {
  const h = harness(t)
  h.onCanvasClick({})
  h.onParticipantChoice({ id: 'participant:partner' })
  assert.equal(h.playerRadialId.value, 'partner')
  assert.equal(h.clickedHealthBar.value, null)
  assert.equal(h.participantChoice.value, null)
})

test('a GM can choose which overlapping character to reposition or control', t => {
  const h = harness(t, true)
  h.onCanvasClick({})
  h.onParticipantChoice({ id: 'participant:ally' })
  assert.equal(h.gmRadialId.value, 'ally')
  h.props.activeParticipantId = 'enemy'
  h.onCanvasClick({})
  h.onParticipantChoice({ id: 'participant:enemy' })
  assert.equal(h.npcRadialId.value, 'enemy')
})

test('the chosen overlapping token is the exact attack or intercede target', t => {
  const h = harness(t, true)
  h.reticuleParticipantIds.value = ['ally', 'enemy']
  h.onCanvasClick({})
  h.onParticipantChoice({ id: 'participant:ally' })
  assert.deepEqual(h.events, [['target-selected', 'ally']])
  assert.equal(h.gmRadialId.value, null)
})

test('choosing a token that moved away or was removed cannot dispatch a stale selection', t => {
  const h = harness(t)
  h.reticuleParticipantIds.value = ['enemy']
  h.onCanvasClick({})
  h.props.participantPositions.enemy = point(8)
  h.onParticipantChoice({ id: 'participant:enemy' })
  h.props.participants = h.props.participants.filter(p => p.id !== 'ally')
  h.onParticipantChoice({ id: 'participant:ally' })
  assert.deepEqual(h.events, [])
  assert.equal(h.clickedHealthBar.value, null)
})

test('clicking a shared ground cell or a large footprint also offers its overlapping tokens', t => {
  const h = harness(t)
  h.hits.splice(0, h.hits.length, ground())
  h.onCanvasClick({})
  assert.equal(h.participantChoiceOptions().length, 3)
  h.props.digimonMap['enemy-record'].size = 'large'
  h.props.participantPositions.partner = point(1, 0, 1)
  h.props.participantPositions.ally = point(4)
  h.hits.splice(0, h.hits.length, sprite('enemy'))
  h.onCanvasClick({})
  assert.deepEqual(h.participantChoiceOptions().map(item => item.label), ['Partner', 'Enemy'])
})

test('a single token selects directly and placement keeps priority over the chooser', t => {
  const h = harness(t)
  h.props.participantPositions.ally = point(4)
  h.props.participantPositions.enemy = point(8)
  h.hits.splice(0, h.hits.length, sprite('partner'))
  h.onCanvasClick({})
  assert.equal(h.playerRadialId.value, 'partner')
  assert.equal(h.participantChoice.value, null)
  h.props.placingParticipantId = 'partner'
  h.hits.splice(0, h.hits.length, ground())
  h.onCanvasClick({})
  assert.deepEqual(h.events, [['unit-placed', 'partner', point(2)]])
})

test('GM Move initializes its height, disables zoom and immediately updates the ghost on wheel input', async t => {
  const h = harness(t, true)
  h.props.participantPositions.partner = point(0, 3)
  h.props.gmMoveParticipantId = 'partner'
  await nextTick()
  assert.equal(h.gmMoveY.value, 3)
  assert.equal(h.controls.enableZoom, false)
  h.onMouseMove({})
  assert.ok(Math.abs(h.hoverGhostGroup.children[0].position.y - 3.11) < 1e-9)
  h.onWheel({ deltaY: -1 })
  assert.equal(h.gmMoveY.value, 4)
  assert.ok(Math.abs(h.hoverGhostGroup.children[0].position.y - 4.11) < 1e-9)
  h.onWheel({ deltaY: 1 })
  assert.equal(h.gmMoveY.value, 3)
  assert.ok(Math.abs(h.hoverGhostGroup.children[0].position.y - 3.11) < 1e-9)
})

test('GM Move reaches distant open air and water or earth without capabilities or action-cost moves', async t => {
  const h = harness(t, true)
  h.props.gmMoveParticipantId = 'ally'
  await nextTick()
  h.gmMoveY.value = 45
  h.onMouseMove({})
  assert.equal(h.hoverGhostGroup.children[0].position.y, 45.11)
  assert.equal(h.hoverGhostGroup.children[0].material.color.getHex(), 0x2255ff)
  assert.equal(h.validGmMoveCell(point(99999, -50, -99999), 'ally'), true)
  for (const terrain of ['water', 'earth']) {
    h.props.map.groundTiles = [{ ...point(1000, 45, -501), terrain }]
    assert.equal(h.validGmMoveCell(point(1000, 45, -501), 'ally'), true)
  }
  h.onCanvasClick({})
  assert.deepEqual(h.events, [['gm-moved', 'ally', point(1000, 45, -501)]])
  await nextTick()
  assert.equal(h.controls.enableZoom, true)
  assert.equal(h.hoverGhostGroup.children.length, 0)
})

test('GM height scrolling keeps the ghost in front of the camera above its original height', async t => {
  const h = harness(t, true)
  // Point the real camera ray at the movement plane, rather than the fixed test ray.
  h.pointer.useCamera = true
  h.controls.update()
  h.props.gmMoveParticipantId = 'partner'
  await nextTick()
  const originalHeight = h.camera.position.y
  for (let i = 0; i < 30; i++) {
    h.onWheel({ deltaY: -1 })
    assert.equal(h.hoverGhostGroup.children.length, 1, `the ghost disappeared at Y=${h.gmMoveY.value}`)
  }
  assert.equal(h.gmMoveY.value, 30)
  assert.equal(h.camera.position.y, originalHeight + 30)
  assert.ok(Math.abs(h.hoverGhostGroup.children[0].position.y - 30.11) < 1e-9)
})

test('GM Move respects occupied-square exceptions and shows a red ghost for a blocked destination', async t => {
  const h = harness(t, true)
  h.props.gmMoveParticipantId = 'ally'
  h.props.participantPositions.enemy = point(1000, 0, -501)
  h.props.digimonMap['enemy-record'].size = 'medium'
  await nextTick()
  h.onMouseMove({})
  assert.equal(h.hoverGhostGroup.children[0].material.color.getHex(), 0xff3333)
  h.onCanvasClick({})
  assert.deepEqual(h.events, [])
  h.props.digimonMap['enemy-record'].size = 'tiny'
  h.onMouseMove({})
  assert.equal(h.hoverGhostGroup.children[0].material.color.getHex(), 0x2255ff)
  h.onCanvasClick({})
  assert.deepEqual(h.events, [['gm-moved', 'ally', point(1000, 0, -501)]])
})

test('switching normal Move to GM Move preserves GM mode; right-click cancels it and restores zoom', async t => {
  const h = harness(t, true)
  h.props.npcMoveParticipantId = 'partner'
  await nextTick()
  assert.equal(h.movingParticipantId.value, 'partner')
  h.props.npcMoveParticipantId = null
  h.props.gmMoveParticipantId = 'ally'
  await nextTick()
  assert.equal(h.props.gmMoveParticipantId, 'ally')
  assert.equal(h.getMoveAim().isGm, true)
  assert.ok(!h.events.some(event => event[0] === 'movement-cancelled'))
  h.onMouseDown({ button: 2 })
  await nextTick()
  assert.equal(h.getMoveAim(), null)
  assert.equal(h.controls.enableZoom, true)
  assert.equal(h.events.filter(event => event[0] === 'movement-cancelled').length, 1)
})
