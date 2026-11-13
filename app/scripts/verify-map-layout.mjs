// Offline rendered/static layout fixture: compile real templates/scoped CSS,
// replacing WebGL and live services with presentational stubs. No Nuxt build or DB.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, sep } from 'node:path'
import { promisify } from 'node:util'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compileStyle, compileTemplate, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import ts from 'typescript'
import * as Vue from 'vue'
import { loadVueComponent, loadTypeScript } from '../tests/helpers/loadTypeScript.mjs'

assert.equal(process.env.DDA_OFFLINE_VERIFY, '1', 'Preload ./scripts/offline-env.mjs')
const appDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.env.SECURITY_SMOKE_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const sources = new Map()
let css = ''
async function source(filename) {
  if (!sources.has(filename)) sources.set(filename, await readFile(resolve(appDirectory, filename), 'utf8'))
  return sources.get(filename)
}
async function descriptor(filename) {
  const result = parse(await source(filename), { filename })
  assert.deepEqual(result.errors, [])
  return result.descriptor
}
async function component(filename, context, scope) {
  const { template, styles } = await descriptor(filename)
  for (const style of styles) {
    const compiled = compileStyle({ source: style.content, filename, id: scope, scoped: style.scoped })
    assert.deepEqual(compiled.errors, [])
    css += compiled.code
  }
  const compiled = compileTemplate({ source: template.content, filename, id: scope, scoped: true })
  assert.deepEqual(compiled.errors, [])
  const module = { exports: {} }
  const code = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'module', 'exports', code)(name => { assert.equal(name, 'vue'); return Vue }, module, module.exports)
  return { __scopeId: scope, render() { return module.exports.render(context(), []) } }
}
function mapContext(editorMode, isDm = true) {
  const encounter = { id: 'fixture', phase: 'setup', mapId: 'map', participants: [], battleLog: [], destructibleStates: [] }
  const map = { id: 'map', groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], windows: [], ceilings: [], stairs: [] }
  const editor = loadTypeScript('composables/useMapEditor.ts').useMapEditor(Vue.shallowRef(map))
  const value = {
    editorMode, props: { editorMode, encounter }, encounter, isDm, bottomOverlayOffset: null, $slots: {},
    map, liveParticipants: [],
    ws: { accessError: { value: 'Campaign access has changed. Verify access and reload to reconnect.' } },
    saveStatus: 'Saved', autosave: { status: { value: 'saved' }, error: { value: null } },
    editor,
    movement: { reachableCells: { value: [] }, activePath: { value: [] } },
    attackerStats: {}, selectedStructure: null,
  }
  return new Proxy(value, { get: (target, key) => target[key] })
}
function overlayHost(tree) {
  if (tree.type === 1 && tree.tag === 'div' && tree.children.some(child => child.type === 1 && child.tag === 'EncounterMap')) {
    const attrs = Object.fromEntries(tree.props.filter(prop => prop.type === 6).map(prop => [prop.name, prop.value?.content]))
    if (attrs.class?.includes('fixed')) return attrs
  }
  for (const child of tree.children ?? []) { const found = overlayHost(child); if (found) return found }
}

const toolbarDescriptor = await descriptor('components/MapToolbar.vue')
css += compileStyle({ source: toolbarDescriptor.styles[0].content, filename: 'MapToolbar.vue', id: 'data-v-toolbar-layout', scoped: true }).code
const previousComputed = globalThis.computed
globalThis.computed = Vue.computed
const toolbar = loadVueComponent('components/MapToolbar.vue')
toolbar.__scopeId = 'data-v-toolbar-layout'
const mapView = await component('components/EncounterMap.vue', () => mapContext(false), 'data-v-map-layout')
const playerView = await component('components/EncounterMap.vue', () => mapContext(false, false), 'data-v-map-layout')
const editorView = await component('components/EncounterMap.vue', () => mapContext(true), 'data-v-map-layout')
const canvasDescriptor = await descriptor('components/MapCanvas.vue')
css += compileStyle({ source: canvasDescriptor.styles[0].content, filename: 'MapCanvas.vue', id: 'data-v-canvas-layout', scoped: true }).code
const canvas = { __scopeId: 'data-v-canvas-layout', render: () => Vue.h('div', { class: 'map-canvas-container' }, Vue.h('canvas', { class: 'map-canvas' })) }
const editorPage = await component('pages/campaigns/[campaignId]/library/maps/[mapId].vue', () => ({
  campaignId: 'campaign', mapData: { name: 'Layout fixture', dimensions: { width: 10, depth: 10 } }, fakeEncounter: {},
}), 'data-v-editor-layout')
async function render(root, mapComponent) {
  const app = Vue.createSSRApp(root)
  app.component('EncounterMap', mapComponent)
  app.component('MapToolbar', toolbar)
  app.component('ClientOnly', { setup: (_props, { slots }) => () => slots.default?.() })
  app.component('MapCanvas', canvas)
  app.component('MapPlayerHUD', { render: () => Vue.h('div', { class: 'hud-fixture' }, 'All Participants') })
  app.component('MapBattleLog', { render: () => null })
  app.component('MapPropertyPanel', { render: () => null })
  app.component('NuxtLink', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  return renderToString(app)
}
let html = `<section id="editor">${await render(editorPage, editorView)}</section>`
for (const [name, filename] of [
  ['gm', 'pages/campaigns/[campaignId]/encounters/[id].vue'],
  ['player', 'pages/campaigns/[campaignId]/player/[tamerId].vue'],
]) {
  const host = overlayHost((await descriptor(filename)).template.ast)
  assert.ok(host, `Missing actual ${name} map overlay host`)
  const view = name === 'player' ? playerView : mapView
  const wrapper = { render: () => Vue.h('div', host, Vue.h(view)) }
  html += `<section id="${name}">${await render(wrapper, view)}</section>`
}
if (previousComputed === undefined) delete globalThis.computed
else globalThis.computed = previousComputed
const utilities = await postcss([tailwindcss({ content: [{ raw: [...sources.values()].join('\n'), extension: 'vue' }], corePlugins: { preflight: true } })])
  .process('@tailwind base;@tailwind utilities;', { from: undefined })
css = utilities.css + css
const probe = `
const close=(a,b)=>Math.abs(a-b)<1.5;
const checks=[];
for(const name of ['editor','gm','player']){
 const host=document.querySelector('#'+name+' > div');
 const root=host.matches('.encounter-map-root')?host:host.querySelector('.encounter-map-root');
 const alert=root.querySelector('[role="alert"]'),toolbar=root.querySelector('.map-toolbar'),status=root.querySelector('.map-save-status'),canvas=root.querySelector('.canvas-wrapper');
 const box=e=>{if(!e)return null;const b=e.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height}};
 const h=box(host),r=box(root),a=box(alert),t=box(toolbar),s=box(status),c=box(canvas);
 const parent=box(root.parentElement),drawing=box(canvas.querySelector('canvas'));
 const controls=[a,t,s,c].filter(Boolean);
 const ordered=controls.every((b,i)=>i===0||controls[i-1].bottom<=b.top+1);
 checks.push({name,pass:getComputedStyle(root).flexDirection==='column'&&ordered&&c.height>100&&close(r.width,parent.width)&&close(r.height,parent.height)&&close(c.bottom,r.bottom)&&close(h.bottom,innerHeight)&&close(drawing.width,c.width)&&close(drawing.height,c.height)&&(name!=='player'||close(r.top,56)&&!toolbar&&!status)&&(name!=='editor'||!root.querySelector('.hud-fixture')),host:h,root:r,alert:a,toolbar:t,status:s,canvas:c,drawing,parent});
}
document.getElementById('layout-results').textContent=JSON.stringify({viewport:{width:innerWidth,height:innerHeight},checks});
`
const workspace = await mkdtemp(resolve(tmpdir(), 'dda-map-layout-'))
try {
  const filename = resolve(workspace, 'fixture.html')
  await writeFile(filename, `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}<pre id="layout-results"></pre><script>${probe}</script></body></html>`)
  const results = []
  for (const width of [1280, 400]) {
    const { stdout } = await promisify(execFile)(chrome, ['--headless', '--disable-gpu', '--disable-background-networking', '--no-first-run',
      '--no-default-browser-check', '--hide-scrollbars', `--window-size=${width},900`, `--user-data-dir=${resolve(workspace, `profile-${width}`)}`, '--dump-dom', pathToFileURL(filename).href],
    { windowsHide: true, timeout: 30_000, maxBuffer: 4 * 1024 * 1024 })
    const encoded = stdout.match(/<pre id="layout-results">([^<]+)<\/pre>/)?.[1]
    assert.ok(encoded, 'Chrome did not return layout measurements')
    results.push(JSON.parse(encoded))
  }
  console.log(JSON.stringify({ scope: 'actual rendered/static templates and scoped CSS; Vue hydration/WebGL/network excluded',
    results: results.map(({ viewport, checks }) => ({ viewport, checks: checks.map(check => ({ name: check.name, pass: check.pass,
      rootTop: check.root.top, rootHeight: check.root.height, toolbarHeight: check.toolbar?.height ?? null,
      canvasWidth: check.canvas.width, canvasHeight: check.canvas.height })) })) }, null, 2))
  if (results.some(result => result.checks.some(check => !check.pass))) console.error(JSON.stringify(results, null, 2))
  assert.ok(results.every(result => result.checks.every(check => check.pass)), 'Map toolbar/status/canvas must stack and fill each actual host')
  assert.ok(results[1].checks.find(check => check.name === 'editor').toolbar.height > results[0].checks.find(check => check.name === 'editor').toolbar.height,
    'The narrow editor must exercise a wrapped toolbar')
} finally {
  assert.ok(workspace.startsWith(resolve(tmpdir()) + sep) && workspace.split(sep).at(-1).startsWith('dda-map-layout-'))
  await rm(workspace, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
