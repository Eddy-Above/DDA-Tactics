import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, createSSRApp, ref, watch } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks, loadVueComponent } from './helpers/loadTypeScript.mjs'

const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { stairDirectionForFace } = loadTypeScript('utils/voxelGeometry.ts')
const { useMapEditor } = loadTypeScriptWithMocks('composables/useMapEditor.ts', { '~/utils/mapEdits': mapEdits })
const toolbar = loadVueComponent('components/MapToolbar.vue')
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const clone = value => JSON.parse(JSON.stringify(value))
const fixture = (stairs = []) => {
  const map = ref({ id: 'map', groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], ceilings: [], stairs })
  return { map, editor: useMapEditor(map) }
}

test('stair brush supports line, square and cube selections with one atomic edit', () => {
  for (const [mode, count] of [['line', 2], ['square', 4], ['cube', 8]]) {
    const { map, editor } = fixture()
    editor.drawMode.value = mode
    editor.rampDirection.value = 'east'
    let updates = 0
    const stop = watch(map, () => { updates++ }, { flush: 'sync', deep: true })
    assert.equal(editor.applyStairDraw(point(), point(1, 1, 1)), true)
    stop()
    assert.equal(updates, 1)
    assert.equal(map.value.stairs.length, count)
    assert.ok(map.value.stairs.every(stair => stairDirectionForFace(stair.face) === 'east' && stair.id))
    assert.equal(new Set(map.value.stairs.map(stair => stair.id)).size, count)
    assert.deepEqual(mapEdits.getMapEditChange(map.value).collections, ['stairs'])
    editor.undo()
    assert.deepEqual(map.value.stairs, [])
    assert.equal(editor.undo(), false)
    editor.redo()
    assert.equal(map.value.stairs.length, count)
  }
})

test('redrawing rotates existing stairs and retains their ids and metadata through undo/redo', () => {
  const original = [{ id: 'old-stair', ...point(), face: 'north', woundBoxes: 7, tags: ['custom'] }]
  const { map, editor } = fixture(original)
  editor.rampDirection.value = 'west'
  assert.equal(editor.applyStairDraw(point(), point()), true)
  assert.deepEqual(clone(map.value.stairs), [{ ...original[0], face: 'east' }])
  assert.equal(original[0].face, 'north', 'the prior map remains untouched')
  const rotated = map.value
  assert.equal(editor.applyStairDraw(point(), point()), false)
  assert.equal(map.value, rotated)
  editor.undo()
  assert.deepEqual(clone(map.value.stairs), original)
  editor.redo()
  assert.equal(stairDirectionForFace(map.value.stairs[0].face), 'west')
})

test('stairs and ramps share the uphill brush while the legacy explicit-face API still works', () => {
  const { map, editor } = fixture()
  editor.selectTool('stairs')
  for (const [x, direction] of ['east', 'south', 'west', 'north'].entries()) {
    editor.rotateRampDirection(1)
    editor.applyStairDraw(point(x), point(x))
    editor.applyVoxelDraw(point(x, 0, 1), point(x, 0, 1), 'ramp')
    assert.equal(stairDirectionForFace(map.value.stairs[x].face), direction)
    assert.equal(map.value.voxels[x].rampDirection, direction)
  }
  editor.applyStair(point(5), 'south')
  assert.equal(map.value.stairs[4].face, 'south')
  assert.equal(editor.applyStair(point(5), 'north'), false)
})

test('the encounter cell-draw handler saves a stair selection with the chosen uphill direction', async () => {
  const { map, editor } = fixture()
  editor.selectTool('stairs')
  editor.drawMode.value = 'line'
  editor.rampDirection.value = 'south'
  const saves = []
  const { onCellDraw } = loadPageFunctions('components/EncounterMap.vue', ['onCellDraw'], {
    map, editor, props: { encounter: { mapId: 'map' } }, persistMap: async tool => saves.push(tool),
  })
  await onCellDraw(point(), point(2))
  assert.deepEqual(saves, ['stairs'])
  assert.equal(map.value.stairs.length, 3)
  assert.ok(map.value.stairs.every(stair => stair.face === 'south'))
})

test('the cell eraser removes stairs and undo restores their identity and direction', () => {
  const { map, editor } = fixture()
  editor.rampDirection.value = 'east'
  editor.applyStairDraw(point(), point())
  const saved = clone(map.value.stairs)
  editor.deleteAt(point(), point())
  assert.deepEqual(map.value.stairs, [])
  editor.undo()
  assert.deepEqual(clone(map.value.stairs), saved)
  assert.equal(stairDirectionForFace(map.value.stairs[0].face), 'east')
  editor.redo()
  assert.deepEqual(map.value.stairs, [])
})

test('the stair toolbar shows drawing modes, selected uphill direction and scrolling hint', async () => {
  const previous = globalThis.computed
  globalThis.computed = computed
  try {
    const html = await renderToString(createSSRApp(toolbar, { activeTool: 'stairs', drawMode: 'square',
      elementBrush: 'earth', rampDirection: 'west', currentEditY: 0, canUndo: false, canRedo: false }))
    assert.match(html, /title="Stairs"/)
    assert.match(html, /title="Line"/)
    assert.match(html, /title="Square"/)
    assert.match(html, /title="Cube"/)
    assert.match(html, /Uphill/)
    assert.match(html, /<select[^>]*value="west"/)
    assert.match(html, /Scroll over map to rotate/)
    assert.doesNotMatch(html, /class="toolbar-section element-picker"/)
  } finally {
    if (previous === undefined) delete globalThis.computed
    else globalThis.computed = previous
  }
})
