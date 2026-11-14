import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildMapAttackDescriptor } = loadTypeScript('utils/mapAttackDescriptor.ts')
const { getAreaShape, computePassLanding } = loadTypeScript('utils/areaShapes.ts')
const { chebyshev } = loadTypeScript('utils/pathfinding.ts')
const mapFile = new URL('../components/EncounterMap.vue', import.meta.url)
const { descriptor } = parse(readFileSync(mapFile, 'utf8'))
const source = ts.createSourceFile('EncounterMap.vue', descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)

function chargeHarness(t, { saveMove = async () => ({}) } = {}) {
  const props = Vue.reactive({ selectedAttack: null, encounter: { id: 'encounter', revision: 8, participants: [] } })
  const positions = Vue.ref({ partner: { x: 0, y: 0, z: 0 }, tamer: { x: 5, y: 0, z: 5 } })
  const calls = { reach: [], clear: 0, emitted: [], moved: [], movers: [] }
  const caps = { pos: positions.value.partner, budget: 4, caps: {}, occupied: new Map(), dInfo: { size: 'small' } }
  const dependencies = {
    actionFeedback: { previewMovement() {}, cancelMovementPreview() {} },
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, props, positions, pendingAttackIntent: null,
    map: Vue.ref({ id: 'map' }), activeParticipantId: Vue.ref('tamer'),
    getAreaShape, computePassLanding, chebyshev,
    npcMoveCaps: id => { calls.movers.push(id); return caps },
    movement: { computeReachable: (...args) => calls.reach.push(args), clearMovement: () => calls.clear++ },
    destroyedIds: () => new Set(),
    movePathTo: (id, destination) => [positions.value[id], destination],
    moveDistance: (_id, _destination, path) => path.length - 1,
    openDoorsAlong: () => {}, segmentCells: () => [],
    ws: { send: message => calls.moved.push(message) }, postMove: saveMove,
    emit: (...args) => calls.emitted.push(args),
  }
  const names = ['chargeMode', 'chargeAfterAttackerId', 'chargeMoveParticipantId', 'isChargeAttack', 'attackPreview']
  const declarations = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
  const variables = names.map(name => {
    const declaration = declarations.find(node => node.name.getText(source) === name)
    assert.ok(declaration, name)
    return `const ${declaration.getText(source)};`
  })
  const handlers = ['attackIntent', 'sameVec3', 'startChargeBefore', 'onChargeTargetSelected', 'onTargetSelected', 'onAreaAttackConfirmed']
  const functions = handlers.map(name => {
    const node = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(node, name)
    return node.getText(source)
  })
  const watcher = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)
    && node.expression.expression.getText(source) === 'watch'
    && node.expression.arguments[0]?.getText(source) === '() => props.selectedAttack')
  assert.ok(watcher)
  const allowanceWatcher = source.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(source) === 'watch' && node.expression.arguments[0]?.getText(source).includes('pendingChargeMove'))
  const { outputText } = ts.transpileModule([...variables, ...functions, watcher.getText(source), allowanceWatcher.getText(source)].join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  })
  const scope = Vue.effectScope()
  const state = scope.run(() => new Function(...Object.keys(dependencies), `${outputText}\nreturn { ${[...names, ...handlers].join(', ')} }`)(...Object.values(dependencies)))
  t.after(() => scope.stop())
  async function select(chargeMode = null, tags = ['Charge Attack'], id = 'charge') {
    props.selectedAttack = buildMapAttackDescriptor({ participant: { id: 'partner' },
      attack: { id, range: 'melee', tags }, radialOptions: { chargeMode } })
    await Vue.nextTick()
  }
  return { ...state, calls, props, positions, select }
}

test('a Charge attack without a movement option targets normally and never starts movement', async t => {
  const h = chargeHarness(t)
  await h.select()
  assert.equal(h.chargeMode.value, null)
  assert.equal(h.calls.reach.length, 0)
  h.onTargetSelected('enemy')
  assert.deepEqual(h.calls.emitted[0].slice(0, 2), ['target-selected', 'enemy'])
  h.props.selectedAttack = null
  await Vue.nextTick()
  assert.equal(h.chargeMoveParticipantId.value, null)
  assert.equal(h.calls.reach.length, 0)
})

test('Move Before uses the partner context and keeps movement local until the final attack', async t => {
  const h = chargeHarness(t)
  await h.select('before')
  assert.equal(h.chargeMode.value, 'before')
  assert.deepEqual(h.calls.movers, ['partner'])
  assert.equal(h.calls.reach.length, 1)
  h.onChargeTargetSelected('partner', { x: 1, y: 0, z: 0 }, 'enemy')
  assert.equal(h.chargeMode.value, null)
  assert.deepEqual(h.calls.moved, [])
  assert.deepEqual(h.calls.emitted[0].slice(0, 2), ['target-selected', 'enemy'])
  assert.equal(h.calls.emitted[0][2].movement.kind, 'charge-before')
  assert.deepEqual(h.positions.value.partner, { x: 0, y: 0, z: 0 })
  assert.deepEqual(h.attackPreview.value.position, { x: 1, y: 0, z: 0 })
})

for (const area of [false, true]) {
  test(`Move After preserves the selected partner for ${area ? 'area' : 'single-target'} attacks`, async t => {
    const h = chargeHarness(t)
    await h.select('after', area ? ['Charge Attack', 'Area Attack: Burst'] : ['Charge Attack'])
    assert.equal(h.chargeMode.value, 'after')
    assert.equal(h.calls.reach.length, 0)
    if (area) await h.onAreaAttackConfirmed(['enemy'], { shape: 'burst' })
    else h.onTargetSelected('enemy')
    const metadata = h.calls.emitted[0].at(-1)
    assert.equal(metadata.chargeTiming, 'after')
    assert.equal(h.chargeAfterAttackerId.value, null)
    h.props.selectedAttack = null
    await Vue.nextTick()
    assert.equal(h.chargeMoveParticipantId.value, null, 'clearing targeting does not grant movement')
    h.props.encounter.participants = [{ id: 'partner', pendingChargeMove: { castId: 'server-cast' } }]
    await Vue.nextTick()
    assert.equal(h.chargeMoveParticipantId.value, 'partner')
    assert.deepEqual(h.calls.movers, ['partner'])
    assert.equal(h.calls.reach.length, 1)
    assert.equal(h.chargeMode.value, null)
  })
}

test('equivalent polling snapshots do not restart the completed Move Before step of an area attack', async t => {
  const h = chargeHarness(t)
  await h.select('before', ['Charge Attack', 'Area Attack: Burst'])
  await h.onChargeTargetSelected('partner', { x: 1, y: 0, z: 0 }, null)
  assert.equal(h.chargeMode.value, null)
  h.props.selectedAttack = { ...h.props.selectedAttack, bit: 3 }
  await Vue.nextTick()
  assert.equal(h.chargeMode.value, null)
  assert.equal(h.calls.reach.length, 1)
  assert.deepEqual(h.calls.emitted, [])
})

test('cancelling either timing clears it; an ordinary or Pass attack cannot start separate Charge movement', async t => {
  const h = chargeHarness(t)
  for (const mode of ['before', 'after']) {
    await h.select(mode)
    h.props.selectedAttack = null
    await Vue.nextTick()
    assert.equal(h.chargeMode.value, null)
    assert.equal(h.chargeMoveParticipantId.value, null)
  }
  const moves = h.calls.reach.length
  for (const tags of [[], ['Charge Attack', 'Area Attack: Pass']]) {
    await h.select('before', tags, tags.length ? 'pass' : 'ordinary')
    assert.equal(h.chargeMode.value, null)
    assert.equal(h.calls.reach.length, moves)
  }
  await h.select(null)
  assert.equal(h.chargeMode.value, null)
})

for (const role of ['encounters/[id]', 'player/[tamerId]']) {
  test(`${role} map targeting shows only its hint and Cancel, keeping rider controls in the card dialog`, async () => {
    const { descriptor } = parse(readFileSync(new URL(`../pages/campaigns/[campaignId]/${role}.vue`, import.meta.url), 'utf8'))
    const elements = []
    function walk(node, ancestors = []) {
      if (node.type === 1) elements.push({ node, ancestors })
      for (const child of node.children ?? []) walk(child, [...ancestors, node])
    }
    walk(descriptor.template.ast)
    const hint = elements.find(({ node }) => node.props?.some(prop => prop.name === 'style' && prop.value?.content.includes('bottom: 120px; left: 16px;'))
      && node.props.some(prop => prop.name === 'if' && prop.exp?.content === 'selectedAttack'))?.node
    assert.ok(hint)
    const compiled = compileTemplate({ source: hint.loc.source, filename: 'page.vue', id: 'map-target-hint' })
    assert.deepEqual(compiled.errors, [])
    const { outputText } = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
    const module = { exports: {} }
    new Function('require', 'module', 'exports', outputText)(name => { assert.equal(name, 'vue'); return Vue }, module, module.exports)
    const html = await renderToString(Vue.h({ render: module.exports.render, setup: () => ({
      selectedAttack: { attack: { name: 'Baby Claw' } }, onMapAttackCancelled: () => {},
    }) }))
    assert.ok(html.includes('Baby Claw'))
    assert.ok(html.includes('Cancel'))
    assert.equal(html.includes('<input'), false)
    assert.equal(elements.filter(({ node }) => node.tag === 'AttackRiderOptions').length, 1, 'the non-map dialog retains its existing controls')
  })
}
