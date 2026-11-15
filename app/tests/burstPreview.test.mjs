import assert from 'node:assert/strict'
import test from 'node:test'
import { effectScope, nextTick, reactive, ref, watch } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

function fixture(t) {
  const point = (x, y = 0, z = 0) => ({ x, y, z })
  const props = reactive({ isDm: false, activeTool: 'select', selectedAttack: null,
    participants: [{ id: 'actor' }, { id: 'target' }], participantPositions: { actor: point(0), target: point(2) } })
  const areaHighlightCells = ref([]), lastAreaShapeData = ref(null), events = []
  const dims = { width: 2, height: 2, depth: 2 }
  const handlers = loadPageFunctions('components/MapCanvas.vue', ['renderBurstPreview', 'watchBurstPreview', 'footprintIntersectsArea', 'onCanvasClick'], {
    props, watch, ...loadTypeScript('utils/areaShapes.ts'), ...loadTypeScript('utils/movementRules.ts'),
    effectiveAttackerId: ref('actor'), getParticipantFootprintDims: id => id === 'actor' ? dims : { width: 1, height: 1, depth: 1 },
    lastAreaShapeData, areaHighlightCells, classifyCellsByLos: cells => ({ hitCells: cells, blockedCells: [] }),
    updateAoeHighlight: cells => { areaHighlightCells.value = cells },
    spacePanning: ref(false), panGesture: false, suppressNextClick: false, getMoveAim: () => null, getIntersection: () => [],
    clearAoeState: () => { areaHighlightCells.value = []; lastAreaShapeData.value = null },
    emit: (...args) => events.push(args),
  })
  const scope = effectScope()
  scope.run(handlers.watchBurstPreview)
  t.after(() => scope.stop())
  return { ...handlers, props, areaHighlightCells, lastAreaShapeData, events, point }
}

test('melee Burst can confirm immediately with aiming data without a mouse-move event', async t => {
  const f = fixture(t)
  f.props.selectedAttack = { tags: ['Area Attack: Burst'], range: 'melee', bit: 2, ram: 0, movement: 6 }
  await nextTick()
  assert.equal(f.lastAreaShapeData.value.shape, 'burst')
  assert.ok(f.areaHighlightCells.value.length > 0)
  f.onCanvasClick({})
  assert.equal(f.events[0][0], 'area-attack-confirmed')
  assert.ok(f.events[0][1].includes('target'))
  assert.equal(f.events[0][2].shape, 'burst')
  assert.deepEqual(f.events[0][2].attackerPos, f.point(0))
})

test('Burst follows a chosen Charge position even when the selected attack descriptor stays unchanged', async t => {
  const f = fixture(t)
  f.props.selectedAttack = { tags: ['Charge Attack', 'Area Attack: Burst'], range: 'melee', bit: 2, ram: 0, movement: 6 }
  await nextTick()
  const previousCells = new Set(f.areaHighlightCells.value.map(p => `${p.x},${p.y},${p.z}`))
  f.props.participantPositions.actor = f.point(8, 3)
  await nextTick()
  assert.deepEqual(f.lastAreaShapeData.value.attackerPos, f.point(8, 3))
  assert.ok(f.areaHighlightCells.value.some(p => !previousCells.has(`${p.x},${p.y},${p.z}`)))
})
