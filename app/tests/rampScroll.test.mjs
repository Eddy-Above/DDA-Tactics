import assert from 'node:assert/strict'
import test from 'node:test'
import * as THREE from 'three'
import { computed, effectScope, nextTick, reactive, ref, watch } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useMapEditor } = loadTypeScript('composables/useMapEditor.ts')
const { createVoxelGeometry, createStairGeometry, stairDirectionForFace } = loadTypeScript('utils/voxelGeometry.ts')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })

function wheel(deltaY) {
  return { deltaY, clientX: 100, clientY: 100, defaultPrevented: false, propagationStopped: false,
    preventDefault() { this.defaultPrevented = true },
    stopImmediatePropagation() { this.propagationStopped = true } }
}

function fixture({ direction = 'north', tool = 'ramp', isDm = true, dragging = false, moveAim = null, verticalAim = false } = {}) {
  const map = ref({ id: 'map', groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [] })
  const previous = { ref: globalThis.ref, computed: globalThis.computed }
  Object.assign(globalThis, { ref, computed })
  let editor
  try { editor = useMapEditor(map) } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
  editor.selectTool(tool)
  editor.drawMode.value = 'line'
  editor.rampDirection.value = direction
  const props = reactive({ map: map.value, activeTool: tool, isDm, currentEditY:0, rampDirection: direction, drawMode: 'line' })
  const scope = effectScope()
  // Parent refs update synchronously on emits; child props follow on Vue's next render flush.
  scope.run(() => watch(editor.rampDirection, value => { props.rampDirection = value }))
  const events = [], delegated = []
  const deps = { ...loadTypeScript('utils/mapBuilder.ts'), spacePanning:ref(false), editorHint:ref(null), containerRef:ref(null), strokePoints:[], editorCell:()=>dragging?point(2):point(), THREE, createVoxelGeometry, createStairGeometry, props, nextTick, TILE_SIZE: 1,
    hoverGhostGroup: new THREE.Group(), brushPreview: {cells:new Map(),bounds:null,invalid:false},
    dragStartHit: dragging ? { type: 'cell', cell: point() } : null,
    planeCell: () => dragging ? point(2) : point(),
    getMoveAim: () => moveAim,
    usesVerticalAim: ref(verticalAim),
    onWheel: event => delegated.push(event),
    emit: (...args) => {
      events.push(args)
      if (args[0] === 'rotate-ramp') editor.rotateRampDirection(args[1])
    },
  }
  const handlers = loadPageFunctions('components/MapCanvas.vue', [
    'tilesBetween', 'makeVoxelGhostMesh', 'makeStairGhostMesh', 'updateHoverGhost', 'onCanvasWheel', 'getHoveredHit',
  ], deps)
  return { map, editor, props, events, delegated, scope, ...deps, ...handlers }
}

function assertPreview(h, direction, count = 1) {
  const expected = createVoxelGeometry({ shape: 'ramp', rampDirection: direction })
  const positions = Array.from(expected.getAttribute('position').array)
  assert.equal(h.hoverGhostGroup.children.length, count)
  for (const mesh of h.hoverGhostGroup.children) assert.deepEqual(Array.from(mesh.geometry.getAttribute('position').array), positions)
  expected.dispose()
}

test('ramp direction cycles both ways without editing the map or creating undo entries', () => {
  const h = fixture()
  try {
    for (const direction of ['east', 'south', 'west', 'north']) {
      h.editor.rotateRampDirection(1)
      assert.equal(h.editor.rampDirection.value, direction)
    }
    for (const direction of ['west', 'south', 'east', 'north']) {
      h.editor.rotateRampDirection(-1)
      assert.equal(h.editor.rampDirection.value, direction)
    }
    assert.deepEqual(h.map.value.voxels, [])
    assert.equal(h.editor.canUndo.value, false)
  } finally { h.scope.stop() }
})

test('wheel rotation consumes the event and refreshes a stationary preview after the updated prop arrives', async () => {
  const h = fixture()
  try {
    h.updateHoverGhost(wheel(1))
    assertPreview(h, 'north')
    const event = wheel(100)
    h.onCanvasWheel(event)
    assert.equal(event.defaultPrevented, true)
    assert.equal(event.propagationStopped, true)
    assert.deepEqual(h.events, [['rotate-ramp', 1]])
    assert.equal(h.editor.rampDirection.value, 'east')
    assert.equal(h.props.rampDirection, 'north', 'child props are still from the previous render')
    await nextTick()
    assert.equal(h.props.rampDirection, 'east')
    assertPreview(h, 'east')
    h.onCanvasWheel(wheel(-100))
    await nextTick()
    assertPreview(h, 'north')
    assert.deepEqual(h.delegated, [])
  } finally { h.scope.stop() }
})

test('scrolling while dragging rotates every preview and the direction saved on placement', async () => {
  const h = fixture({ direction: 'west', dragging: true })
  try {
    h.updateHoverGhost(wheel(1))
    assertPreview(h, 'west', 3)
    h.onCanvasWheel(wheel(100))
    await nextTick()
    assertPreview(h, 'north', 3)
    const { onCellDraw } = loadPageFunctions('components/EncounterMap.vue', ['onCellDraw'], {
      map: h.map, editor: h.editor, props: { encounter: { mapId: 'map' } }, persistMap: async () => {},
    })
    await onCellDraw(point(), point(2))
    assert.equal(h.map.value.voxels.length, 3)
    assert.ok(h.map.value.voxels.every(voxel => voxel.shape === 'ramp' && voxel.rampDirection === 'north'))
  } finally { h.scope.stop() }
})

test('players, other tools and zero vertical scroll cannot rotate ramps', async () => {
  for (const options of [{ isDm: false }, { tool: 'select' }, { tool: 'voxel' }, {}]) {
    const h = fixture(options)
    try {
      const event = wheel(Object.keys(options).length ? 100 : 0)
      h.onCanvasWheel(event)
      await nextTick()
      assert.deepEqual(h.events, [])
      assert.equal(h.editor.rampDirection.value, 'north')
      assert.equal(h.hoverGhostGroup.children.length, 0)
      if (Object.keys(options).length) {
        assert.equal(event.defaultPrevented, false)
        assert.equal(event.propagationStopped, false)
      }
    } finally { h.scope.stop() }
  }
})

test('movement and area elevation aiming retain wheel priority over the ramp tool', async () => {
  for (const options of [{ moveAim: { participantId: 'unit' } }, { verticalAim: true }]) {
    const h = fixture(options)
    try {
      const event = wheel(100)
      h.onCanvasWheel(event)
      await nextTick()
      assert.equal(event.defaultPrevented, true)
      assert.equal(event.propagationStopped, true)
      assert.deepEqual(h.delegated, [event])
      assert.deepEqual(h.events, [])
      assert.equal(h.editor.rampDirection.value, 'north')
    } finally { h.scope.stop() }
  }
})

test('stairs place on cells with a scroll-rotated ghost and preserve the visible direction on save', async () => {
  const h = fixture({ tool: 'stairs', direction: 'north', dragging: true })
  try {
    assert.deepEqual(h.getHoveredHit(wheel(1)), { type: 'cell', cell: point(2) })
    h.updateHoverGhost(wheel(1))
    assert.equal(h.hoverGhostGroup.children.length, 3)
    h.onCanvasWheel(wheel(100))
    await nextTick()
    assert.equal(h.editor.rampDirection.value, 'east')
    const expected = createStairGeometry('east')
    for (const mesh of h.hoverGhostGroup.children) {
      assert.deepEqual(Array.from(mesh.geometry.attributes.position.array), Array.from(expected.attributes.position.array))
    }
    expected.dispose()
    const { onCellDraw } = loadPageFunctions('components/EncounterMap.vue', ['onCellDraw'], {
      map: h.map, editor: h.editor, props: { encounter: { mapId: 'map' } }, persistMap: async () => {},
    })
    await onCellDraw(point(), point(2))
    assert.equal(h.map.value.stairs.length, 3)
    assert.ok(h.map.value.stairs.every(stair => stairDirectionForFace(stair.face) === 'east'))
    assert.deepEqual(h.map.value.voxels, [])
  } finally { h.scope.stop() }
})
