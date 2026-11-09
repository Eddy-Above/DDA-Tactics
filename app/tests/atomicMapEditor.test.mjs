import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, toRaw, watch } from 'vue'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { getMapGeometryRevision, getMapEditChange, recordMapEdit } = mapEdits
const { useMapEditor } = loadTypeScriptWithMocks('composables/useMapEditor.ts', { '~/utils/mapEdits': mapEdits })
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const clone = value => JSON.parse(JSON.stringify(value))
const fixture = (overrides = {}) => {
  const map = ref({ id: 'map', name: 'Large map', dimensions: { width: 100, depth: 100 },
    groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [], ...overrides })
  return { map, editor: useMapEditor(map) }
}

test('a thousand-cell stroke publishes once, creates one revision and leaves the previous root untouched', () => {
  const { map, editor } = fixture({ voxels: Array.from({ length: 10000 }, (_, x) => ({ x, y: 0, z: 1, materialId: 'void' })) })
  const previous = map.value
  const revision = getMapGeometryRevision(previous)
  let notifications = 0
  const stop = watch(map, () => { notifications++ }, { deep: true, flush: 'sync' })
  editor.drawMode.value = 'line'
  editor.rampDirection.value = 'west'
  assert.equal(editor.applyVoxelDraw(point(), point(999), 'ramp'), true)
  stop()
  assert.equal(notifications, 1)
  assert.equal(previous.voxels.length, 10000)
  assert.equal(map.value.voxels.length, 11000)
  assert.notEqual(map.value, previous)
  assert.equal(toRaw(map.value.groundTiles), toRaw(previous.groundTiles))
  const change = getMapEditChange(map.value)
  assert.equal(change.previousRevision, revision)
  assert.equal(change.revision, getMapGeometryRevision(map.value))
  assert.deepEqual(change.collections, ['voxels'])
  assert.equal(change.cells.length, 1000)
  assert.equal(editor.undo(), true)
  assert.deepEqual(clone(map.value.voxels), clone(previous.voxels))
  assert.equal(editor.undo(), false, 'one stroke creates one history command')
  assert.equal(editor.redo(), true)
  assert.equal(map.value.voxels.length, 11000)
})

test('no-op strokes do not publish, create history or discard redo', () => {
  const { map, editor } = fixture()
  const previous = map.value
  const revision = getMapGeometryRevision(previous)
  assert.equal(editor.applyPaintElement(point(), point()), false)
  assert.equal(editor.deleteAt(point(), point()), false)
  assert.equal(editor.applyDoor('missing'), false)
  assert.equal(map.value, previous)
  assert.equal(getMapGeometryRevision(map.value), revision)
  assert.equal(editor.canUndo.value, false)
  editor.applyGroundDraw(point(), point())
  const after = map.value
  assert.equal(editor.applyGroundDraw(point(), point()), false)
  assert.equal(map.value, after)
  editor.undo()
  assert.equal(editor.applyPaintElement(point(), point()), false)
  assert.equal(editor.canRedo.value, true)
})

test('painting, deletion and undo/redo preserve entry order and complete ramp metadata', () => {
  const voxels = Array.from({ length: 7 }, (_, x) => ({ x, y: 0, z: 0, materialId: 'earth', element: 'earth',
    shape: 'ramp', rampDirection: 'east', tags: ['terrain', `item-${x}`], opacity: 0.7, color: '#123456', isSpawnPoint: true }))
  const { map, editor } = fixture({ voxels })
  const original = clone(map.value)
  editor.elementBrush.value = 'ice'
  editor.applyPaintElement(point(2), point(4))
  const painted = clone(map.value)
  editor.deleteAt(point(1), point(5))
  const deleted = clone(map.value)
  assert.deepEqual(map.value.voxels.map(v => v.x), [0, 6])
  editor.undo()
  assert.deepEqual(clone(map.value), painted)
  editor.undo()
  assert.deepEqual(clone(map.value), original)
  editor.redo()
  assert.deepEqual(clone(map.value), painted)
  editor.redo()
  assert.deepEqual(clone(map.value), deleted)
  assert.deepEqual(original.voxels[2].tags, ['terrain', 'item-2'])
})

test('wall removal and history restore linked windows, doors and stairs in their original order', () => {
  const { map, editor } = fixture({
    walls: [{ id: 'w0', ...point(0), face: 'north' }, { id: 'w1', ...point(1), face: 'north', woundBoxes: 3 }, { id: 'w2', ...point(2), face: 'east' }],
    windows: [{ id: 'pane0', wallId: 'w0' }, { id: 'pane1', wallId: 'w1', woundBoxes: 2 }],
    doors: [{ id: 'door1', wallId: 'w1', isOpen: true }, { id: 'door2', wallId: 'w2', isOpen: false }],
    stairs: [{ id: 's1', ...point(1), face: 'south' }],
  })
  const original = clone(map.value)
  editor.deleteWallAt(point(1), 'north')
  const change = getMapEditChange(map.value)
  assert.deepEqual(new Set(change.collections), new Set(['walls', 'windows', 'doors', 'stairs']))
  assert.deepEqual(change.cells, [point(1)])
  assert.deepEqual(map.value.walls.map(w => w.id), ['w0', 'w2'])
  assert.deepEqual(map.value.doors.map(d => d.id), ['door2'])
  editor.undo()
  assert.deepEqual(clone(map.value), original)
  editor.redo()
  assert.equal(map.value.stairs.length, 0)
})

test('door and structure updates publish atomic change metadata and support undo', () => {
  const { map, editor } = fixture({
    walls: [{ id: 'wall', ...point(10, 2, -3), face: 'north', woundBoxes: 4 }],
    doors: [{ id: 'door', wallId: 'wall', isOpen: false }],
  })
  assert.equal(editor.setDoorsOpen(['door', 'door'], true), true)
  assert.deepEqual(getMapEditChange(map.value).collections, ['doors'])
  assert.deepEqual(getMapEditChange(map.value).cells, [point(10, 2, -3)])
  assert.equal(editor.setDoorsOpen(['door'], true), false)
  assert.equal(editor.updateStructure('wall', 'wall', null, 'west'), true)
  assert.equal(map.value.walls[0].face, 'west')
  assert.equal(map.value.walls[0].woundBoxes, undefined)
  editor.undo()
  assert.equal(map.value.walls[0].woundBoxes, 4)
  editor.undo()
  assert.equal(map.value.doors[0].isOpen, false)
})

test('history is limited to fifty strokes and cannot apply to an externally replaced map', () => {
  const { map, editor } = fixture()
  for (let x = 0; x < 55; x++) editor.applyGroundDraw(point(x), point(x))
  let undos = 0
  while (editor.undo()) undos++
  assert.equal(undos, 50)
  assert.equal(map.value.groundTiles.length, 5)
  assert.equal(editor.canRedo.value, true)
  map.value = { ...toRaw(map.value), groundTiles: [] }
  assert.equal(editor.canRedo.value, false)
  assert.equal(editor.redo(), false)
  editor.applyGroundDraw(point(100), point(100))
  assert.equal(editor.canRedo.value, false)
  editor.undo()
  assert.deepEqual(map.value.groundTiles, [])
})

test('revision metadata is raw/proxy stable, deduplicated and absent from saved JSON', () => {
  const { map } = fixture()
  assert.equal(getMapGeometryRevision(map.value), getMapGeometryRevision(toRaw(map.value)))
  const next = recordMapEdit(map.value, { ...toRaw(map.value) }, ['doors', 'doors'], [point(), point()])
  assert.ok(getMapGeometryRevision(next) > getMapGeometryRevision(map.value))
  assert.deepEqual(getMapEditChange(next).collections, ['doors'])
  assert.deepEqual(getMapEditChange(next).cells, [point()])
  assert.equal(JSON.stringify(next), JSON.stringify(map.value))
})
