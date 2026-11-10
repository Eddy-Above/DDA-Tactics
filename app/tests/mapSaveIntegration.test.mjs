import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import { baseParse } from '@vue/compiler-dom'
import ts from 'typescript'
import { shallowRef } from 'vue'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const component = 'components/EncounterMap.vue'
const { useMapAutosave } = loadTypeScript('composables/useMapAutosave.ts')
const mapEdits = loadTypeScript('utils/mapEdits.ts')
const { useMapEditor } = loadTypeScriptWithMocks('composables/useMapEditor.ts', { '~/utils/mapEdits': mapEdits })
const point = (x = 0, y = 0, z = 0) => ({ x, y, z })
const makeMap = (extra = {}) => ({ id: 'map', updatedAt: 'old', groundTiles: [], spaceTiles: [], voxels: [], walls: [], windows: [], doors: [], ceilings: [], stairs: [], ...extra })
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function deferred() { let resolve; const promise = new Promise(yes => { resolve = yes }); return { promise, resolve } }

function script() {
  const filename = new URL(`../${component}`, import.meta.url)
  return ts.createSourceFile(component, parse(readFileSync(filename, 'utf8')).descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
}

function evaluate(expression, deps) {
  const { outputText } = ts.transpileModule(`const result = ${expression}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  return new Function(...Object.keys(deps), `${outputText}; return result`)(...Object.values(deps))
}

function initializer(name, deps) {
  const source = script()
  let expression
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(expression, `Missing ${name}`)
  return evaluate(expression, deps)
}

function fixture(t, initial = makeMap()) {
  const map = shallowRef(initial), props = { encounter: { id: 'encounter', mapId: 'map' } }
  const editor = useMapEditor(map), writes = [], messages = [], doorWrites = [], gate = deferred()
  const autosave = initializer('autosave', { props, useMapAutosave,
    editorClientId: 'editor-client',
    mapStore: { updateMapMinimal: async (mapId, patch, clientId) => { writes.push({ mapId, patch, clientId }); return await gate.promise } },
    ws: { send: message => messages.push(message) }, refreshAgain: false, mapDisposed: false, scheduleMapRefresh: () => {} })
  const deps = { map, props, editor, autosave, ...mapEdits, lastQueuedRevision: 0, selectedStructure: shallowRef({ id: 'wall' }),
    selectedId: shallowRef('hero'), activeParticipantId: shallowRef(null), positions: shallowRef({ hero: point() }),
    $fetch: async (url, options) => { doorWrites.push({ url, ...options }); return { doors: map.value.doors.map(door => options.body.doorIds.includes(door.id) ? { ...door, isOpen: options.body.isOpen } : door) } },
  }
  const handlers = loadPageFunctions(component, ['persistMap', 'onCellDraw', 'setDoorsOpen', 'onStructureSave', 'onUndo'], deps)
  t.after(() => autosave.dispose())
  return { map, props, editor, autosave, writes, messages, doorWrites, gate, ...handlers, selectedStructure: deps.selectedStructure }
}

test('real EncounterMap drawing enqueues only changed collections and lets the server publish committed changes', async t => {
  const h = fixture(t)
  h.editor.selectTool('ramp')
  h.editor.rampDirection.value = 'east'
  await h.onCellDraw(point(), point(2))
  assert.equal(h.map.value.voxels.length, 3)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.messages, [])
  const saving = h.autosave.flush()
  await settle()
  assert.equal(h.writes.length, 1)
  assert.deepEqual(Object.keys(h.writes[0].patch), ['voxels'])
  assert.ok(h.writes[0].patch.voxels.every(voxel => voxel.rampDirection === 'east'))
  assert.deepEqual(h.messages, [])
  h.gate.resolve({ id: 'map', updatedAt: 'ack' })
  assert.equal(await saving, true)
  assert.deepEqual(h.messages, [], 'the client must not send server-only map change notifications')
  assert.equal(h.writes[0].clientId, 'editor-client')
})

test('door toggles use a typed encounter action without granting map editing or changing the save queue', async t => {
  const initial = makeMap({ walls: [{ id: 'w', ...point(), face: 'north' }], doors: [{ id: 'd', wallId: 'w', isOpen: false }] })
  const h = fixture(t, initial)
  await h.setDoorsOpen(['d'], true)
  assert.notEqual(h.map.value, initial)
  assert.equal(initial.doors[0].isOpen, false)
  assert.equal(h.map.value.doors[0].isOpen, true)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.doorWrites, [{ url: '/api/encounters/encounter/actions/doors', method: 'POST', body: { participantId: 'hero', doorIds: ['d'], isOpen: true } }])
  assert.equal(h.autosave.hasUnsaved.value, false)
  assert.deepEqual(h.messages, [])
})

test('a no-op stroke on a freshly loaded map does not enqueue a complete-map save', async t => {
  const h = fixture(t, makeMap({ groundTiles: [{ ...point(), element: 'void', terrain: 'normal' }] }))
  h.editor.selectTool('add-ground')
  await h.onCellDraw(point(), point())
  assert.equal(h.autosave.hasUnsaved.value, false)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.messages, [])
})

test('structure properties share undo and queued persistence instead of broadcasting ahead of a write', async t => {
  const initial = makeMap({ walls: [{ id: 'w', ...point(), face: 'north', woundBoxes: 4 }] })
  const h = fixture(t, initial)
  h.onStructureSave('w', 'wall', 8)
  assert.equal(h.map.value.walls[0].woundBoxes, 8)
  assert.equal(initial.walls[0].woundBoxes, 4)
  assert.equal(h.selectedStructure.value, null)
  assert.equal(h.editor.canUndo.value, true)
  assert.equal(h.writes.length, 0)
  assert.deepEqual(h.messages, [])
  const saving = h.autosave.flush()
  await settle()
  assert.deepEqual(Object.keys(h.writes[0].patch), ['walls'])
  h.gate.resolve({ id: 'map', updatedAt: 'wall-saved' })
  await saving
  assert.equal(h.messages.length, 0, 'the committed server save owns map publication')
})

test('loadMap ignores out-of-order results, failed loads and responses overtaken by local edits', async () => {
  const map = shallowRef(makeMap()), props = { encounter: { mapId: 'map' } }
  const requests = []
  const autosave = { hasUnsaved: shallowRef(false) }
  const { loadMap } = loadPageFunctions(component, ['loadMap'], { map, props, autosave, mapLoadGeneration: 0, mapDisposed: false,
    ...mapEdits, mapStore: { fetchMap: () => { const request = deferred(); requests.push(request); return request.promise } } })
  const old = loadMap('map'), latest = loadMap('map')
  requests[1].resolve(makeMap({ updatedAt: 'new', name: 'Latest' }))
  await latest
  requests[0].resolve(makeMap({ updatedAt: 'older', name: 'Old' }))
  await old
  assert.equal(map.value.name, 'Latest')
  const failed = loadMap('map')
  requests[2].resolve(null)
  await failed
  assert.equal(map.value.name, 'Latest')
  const stale = loadMap('map')
  useMapEditor(map).applyVoxelDraw(point(), point())
  requests[3].resolve(makeMap({ updatedAt: 'stale', name: 'Wrong' }))
  await stale
  assert.equal(map.value.name, 'Latest')
  assert.equal(map.value.voxels.length, 1)
  const unsaved = loadMap('map')
  autosave.hasUnsaved.value = true
  requests[4].resolve(makeMap({ updatedAt: 'remote', name: 'Wrong' }))
  await unsaved
  assert.equal(map.value.name, 'Latest')
})

test('Retry preserves a failed previous map and finishes the requested map switch only after saving succeeds', async t => {
  const previous = makeMap({ voxels: [{ ...point(), materialId: 'earth' }] })
  const map = shallowRef(previous), props = { encounter: { mapId: 'next' } }
  const writes = [], downloads = []
  const autosave = useMapAutosave({ save: async (id, patch) => {
    writes.push({ id, patch })
    if (writes.length < 3) throw new Error('offline')
    return { id, updatedAt: 'saved-old-map' }
  } })
  t.after(() => autosave.dispose())
  autosave.enqueue(previous, ['voxels'])
  assert.equal(await autosave.flush(), false)
  const { loadMap, retryMapSaves } = loadPageFunctions(component, ['loadMap', 'retryMapSaves'], {
    map, props, autosave, mapLoadGeneration: 0, mapDisposed: false, ...mapEdits,
    mapStore: { fetchMap: async id => { downloads.push(id); return makeMap({ id, updatedAt: 'new-map' }) } },
  })
  await retryMapSaves()
  assert.equal(map.value, previous)
  assert.deepEqual(downloads, [])
  assert.equal(autosave.status.value, 'error')
  await retryMapSaves()
  assert.equal(autosave.status.value, 'saved')
  assert.deepEqual(writes.map(write => write.id), ['map', 'map', 'map'])
  assert.deepEqual(writes[2].patch, { voxels: previous.voxels })
  assert.deepEqual(downloads, ['next'])
  assert.equal(map.value.id, 'next')
})

test('repeated failed map switches retain the original unsaved map until every queue flushes', async t => {
  const previous = makeMap({ voxels: [{ ...point(), materialId: 'earth' }] })
  const map = shallowRef(previous), props = { encounter: { mapId: 'second' }, initialMap: null }
  const writes = [], downloads = []
  const autosave = useMapAutosave({ save: async id => { writes.push(id); throw new Error('offline') } })
  t.after(() => autosave.dispose())
  autosave.enqueue(previous, ['voxels'])
  const source = script()
  const watcher = source.statements.find(statement => ts.isExpressionStatement(statement)
    && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === 'watch'
    && statement.expression.arguments[0]?.getText(source) === '() => props.encounter.mapId')
  assert.ok(watcher)
  const onMapChanged = evaluate(watcher.expression.arguments[1].getText(source), {
    map, props, autosave, mapLoadGeneration: 0, loadMap: async id => { downloads.push(id) },
  })
  await onMapChanged('second', 'map')
  assert.equal(map.value, previous)
  props.encounter.mapId = 'third'
  await onMapChanged('third', 'second')
  assert.equal(map.value, previous)
  assert.deepEqual(writes, ['map', 'map'], 'both switches flush the original failed queue')
  assert.deepEqual(downloads, [])
  assert.equal(autosave.status.value, 'error')
})

test('a disposed EncounterMap ignores map fetch results', async () => {
  const previous = makeMap()
  const map = shallowRef(previous)
  const { loadMap } = loadPageFunctions(component, ['loadMap'], {
    map, props: { encounter: { mapId: 'map' } }, mapDisposed: true, mapLoadGeneration: 0, ...mapEdits,
    autosave: { hasUnsaved: shallowRef(false) }, mapStore: { fetchMap: async () => makeMap({ updatedAt: 'later' }) },
  })
  await loadMap('map')
  assert.equal(map.value, previous)
})

test('the library passes its preloaded map through and mounted EncounterMap does not download it again', () => {
  const page = parse(readFileSync(new URL('../pages/campaigns/[campaignId]/library/maps/[mapId].vue', import.meta.url), 'utf8')).descriptor
  const template = baseParse(page.template.content)
  let initialMapBinding
  const visit = node => {
    if (node.tag === 'EncounterMap') initialMapBinding = node.props.find(prop => prop.type === 7 && prop.name === 'bind' && prop.arg?.content === 'initial-map')?.exp?.content
    for (const child of node.children ?? []) visit(child)
  }
  visit(template)
  assert.equal(initialMapBinding, 'mapData')
  const initialMap = makeMap()
  const props = { initialMap, encounter: { mapId: 'map' } }
  const map = initializer('map', { shallowRef, props })
  let downloads = 0
  const source = script()
  const mounted = source.statements.find(statement => ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(source) === 'onMounted')
  assert.ok(mounted)
  const callback = evaluate(mounted.expression.arguments[0].getText(source), {
    props, map, loadMap: () => { downloads++ }, window: { addEventListener: () => {} }, beforeMapUnload: () => {},
  })
  callback()
  assert.equal(map.value, initialMap)
  assert.equal(downloads, 0)
})
