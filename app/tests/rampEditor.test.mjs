import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, createSSRApp, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks, loadVueComponent } from './helpers/loadTypeScript.mjs'

const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { useMapEditor } = loadTypeScriptWithMocks('composables/useMapEditor.ts', { '~/utils/mapEdits': mapEdits })
const { canPassThrough, canLandOn, settleFootprintY } = loadTypeScript('utils/movementRules.ts')
const { makeSpawnCellChecker, placementCellFromHit } = loadTypeScript('utils/placementRules.ts')
const { useMapMovement } = loadTypeScript('composables/useMapMovement.ts')
const toolbar = loadVueComponent('components/MapToolbar.vue')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })

function fixture(voxels = []) {
  const map = ref({ id: 'map', dimensions: { width: 5, depth: 5, height: 5 },
    groundTiles: [{ ...point(0, 0, 1), element: 'void', terrain: 'normal' }],
    spaceTiles: [], voxels, walls: [], windows: [], doors: [], ceilings: [], stairs: [] })
  const previous = { ref: globalThis.ref, computed: globalThis.computed }
  Object.assign(globalThis, { ref, computed })
  try {
    return { map, editor: useMapEditor(map) }
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
}

test('ramp drawing applies direction and element over line, square and cube selections', () => {
  for (const [mode, count] of [['line', 2], ['square', 4], ['cube', 8]]) {
    const { map, editor } = fixture()
    editor.drawMode.value = mode
    editor.elementBrush.value = 'earth'
    editor.rampDirection.value = 'east'
    editor.applyVoxelDraw(point(), point(1, 1, 1), 'ramp')
    assert.equal(map.value.voxels.length, count)
    assert.ok(map.value.voxels.every(v => v.shape === 'ramp' && v.rampDirection === 'east' && v.materialId === 'earth'))
    assert.equal(new Set(map.value.voxels.map(v => `${v.x},${v.y},${v.z}`)).size, count)
  }
})

test('drawing replaces blocks with ramps, rotates existing ramps and clears direction when restoring blocks', () => {
  const { map, editor } = fixture([{ ...point(), materialId: 'void', isSpawnPoint: true }])
  for (const direction of ['north', 'east', 'south', 'west']) {
    editor.rampDirection.value = direction
    editor.applyVoxelDraw(point(), point(), 'ramp')
    assert.equal(map.value.voxels.length, 1)
    assert.equal(map.value.voxels[0].shape, 'ramp')
    assert.equal(map.value.voxels[0].rampDirection, direction)
    assert.equal(map.value.voxels[0].isSpawnPoint, true)
  }
  editor.applyVoxelDraw(point(), point())
  assert.equal(map.value.voxels[0].shape, 'block')
  assert.equal(map.value.voxels[0].rampDirection, undefined)
})

test('painting preserves ramp shape, and undo/redo restores orientation, spawn state and deletion', () => {
  const { map, editor } = fixture()
  editor.rampDirection.value = 'west'
  editor.applyVoxelDraw(point(), point(), 'ramp')
  editor.elementBrush.value = 'ice'
  editor.applyPaintElement(point(), point())
  editor.applySpawnToggle(point(), point())
  const saved = JSON.parse(JSON.stringify(map.value.voxels))
  assert.equal(saved[0].shape, 'ramp')
  assert.equal(saved[0].rampDirection, 'west')
  assert.equal(saved[0].element, 'ice')
  assert.equal(saved[0].isSpawnPoint, true)
  editor.deleteAt(point(), point())
  assert.deepEqual(map.value.voxels, [])
  editor.undo()
  assert.deepEqual(JSON.parse(JSON.stringify(map.value.voxels)), saved)
  editor.undo()
  assert.equal(map.value.voxels[0].isSpawnPoint, undefined)
  editor.redo()
  assert.deepEqual(JSON.parse(JSON.stringify(map.value.voxels)), saved)
  editor.redo()
  assert.deepEqual(map.value.voxels, [])
})

test('the encounter draw handler queues ramp geometry with its complete direction metadata', async () => {
  const { map, editor } = fixture()
  editor.selectTool('ramp')
  editor.rampDirection.value = 'south'
  const saved = []
  const deps = { map, editor, ...mapEdits, lastQueuedRevision: 0, props: { encounter: { id: 'encounter', mapId: 'map' } },
    autosave: { enqueue: (value, collections, tool) => saved.push({ id: value.id, tool,
      body: JSON.parse(JSON.stringify(Object.fromEntries(collections.map(key => [key, value[key]])))) }) } }
  const { persistMap } = loadPageFunctions('components/EncounterMap.vue', ['persistMap'], deps)
  const { onCellDraw } = loadPageFunctions('components/EncounterMap.vue', ['onCellDraw'], { ...deps, persistMap })
  await onCellDraw(point(), point())
  assert.equal(saved.length, 1)
  assert.equal(saved[0].id, 'map')
  assert.deepEqual(Object.keys(saved[0].body), ['voxels'])
  assert.deepEqual(saved[0].body.voxels[0], { ...point(), shape: 'ramp', rampDirection: 'south', materialId: 'void', element: 'void' })
  assert.equal(saved[0].tool, 'ramp')
  const reloaded = fixture(saved[0].body.voxels)
  assert.equal(reloaded.map.value.voxels[0].rampDirection, 'south')
})

test('solid ramps retain grid walking, landing, fall support and spawn placement', () => {
  const caps = { canFly: false, canJump: false, jumpRange: 0, jumpHeight: 0, canClimb: false, canSwim: false, canDig: false }
  const { map, editor } = fixture()
  editor.applyVoxelDraw(point(), point(), 'ramp')
  editor.applySpawnToggle(point(), point())
  const top = point(0, 1, 0)
  assert.equal(canPassThrough(point(0, 0, 1), point(), caps, map.value), false)
  assert.equal(canPassThrough(point(0, 0, 1), top, caps, map.value), true)
  assert.equal(canLandOn(top, caps, map.value, new Set()), true)
  assert.equal(settleFootprintY(point(0, 4, 0), { width: 1, height: 1, depth: 1 }, map.value), 1)
  assert.deepEqual(placementCellFromHit({ type: 'voxel', voxel: map.value.voxels[0] }), top)
  assert.equal(makeSpawnCellChecker(map.value.groundTiles, map.value.voxels)(top), true)
  assert.ok(useMapMovement().computeReachable(point(0, 0, 1), 1, caps, map.value).has('0,1,0'))
})

test('the Ramp toolbar exposes draw modes, elements and a selected uphill direction', async () => {
  const original = globalThis.computed
  globalThis.computed = computed
  try {
    const html = await renderToString(createSSRApp(toolbar, { activeTool: 'ramp', drawMode: 'square',
      elementBrush: 'earth', rampDirection: 'west', currentEditY: 0, canUndo: false, canRedo: false }))
    assert.match(html, /title="Ramp"/)
    assert.match(html, /title="Line"/)
    assert.match(html, /title="Earth"/)
    assert.match(html, /title="Sand"/)
    assert.match(html, /title="Snow"/)
    assert.match(html, /title="Soft Metal"/)
    assert.match(html, /Uphill/)
    assert.match(html, /<select[^>]*value="west"/)
  } finally {
    if (original === undefined) delete globalThis.computed
    else globalThis.computed = original
  }
})

for (const [material, element] of [['sand', 'earth'], ['snow', 'ice'], ['soft-metal', 'steel']]) {
  test(`${material} block/ramp drawing and repainting preserve material identity through undo and saved JSON`, () => {
    const { map, editor } = fixture()
    editor.elementBrush.value = material
    editor.applyVoxelDraw(point(), point(), 'ramp')
    assert.equal(map.value.voxels[0].materialId, material)
    assert.equal(map.value.voxels[0].element, element)
    assert.equal(map.value.voxels[0].shape, 'ramp')
    const saved = JSON.parse(JSON.stringify(map.value.voxels))
    editor.undo()
    assert.deepEqual(map.value.voxels, [])
    editor.redo()
    assert.deepEqual(JSON.parse(JSON.stringify(map.value.voxels)), saved)
    editor.elementBrush.value = 'void'
    editor.applyPaintElement(point(), point())
    assert.equal(map.value.voxels[0].materialId, 'void')
    editor.elementBrush.value = material
    editor.applyPaintElement(point(), point())
    assert.deepEqual(JSON.parse(JSON.stringify(map.value.voxels)), saved)
    editor.applyVoxelDraw(point(1), point(1))
    assert.equal(map.value.voxels[1].materialId, material)
    assert.equal(map.value.voxels[1].element, element)
    assert.equal(map.value.voxels[1].shape, 'block')
  })
}
