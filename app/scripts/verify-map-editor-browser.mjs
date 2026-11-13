// Offline browser coverage of the actual toolbar, canvas, operations and WebGL
// shaders. Services are replaced by local map data; no credentials or DB are used.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import { createSSRApp, h, ref } from 'vue'
import { renderToString } from '@vue/server-renderer'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { loadTypeScript, loadVueComponent } from '../tests/helpers/loadTypeScript.mjs'
assert.equal(process.env.DDA_OFFLINE_VERIFY, '1', 'Preload ./scripts/offline-env.mjs')
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = await mkdtemp(resolve(tmpdir(), 'dda-map-editor-'))
const artifacts = resolve(app, '.cache/map-editor-verification', process.env.DDA_MAP_NO_MULTI_DRAW === '1' ? 'fallback' : 'native')
const pause = ms => new Promise(done => setTimeout(done, ms))
const chrome = process.env.SECURITY_SMOKE_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const noMultiDraw = process.env.DDA_MAP_NO_MULTI_DRAW === '1'
let browser, server, cdp
const errors = []
const report = { checks: [], scope: 'offline actual-component browser and WebGL verification; no authenticated server' }
class Cdp {
  constructor(socket) {
    this.socket = socket
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const p = this.pending.get(message.id)
        if (!p)
          return
        this.pending.delete(message.id)
        clearTimeout(p.timer)
        message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result)
      }
      else
        this.handlers.get(message.method)?.(message.params)
    })
  }
  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id, timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timeout`)) }, 20000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const r = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails)
      throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text)
    return r.result.value
  }
}
async function poll(work, label) {
  const until = Date.now() + 20000
  while (Date.now() < until) {
    try {
      const value = await work()
      if (value)
        return value
    }
    catch { }
    await pause(100)
  }
  throw new Error(`Timeout: ${label}`)
}
const evaluate = expression => cdp.evaluate(expression)
const settle = () => evaluate('mapEditor.nextTick().then(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))))')
async function configure(tool, values = {}) {
  await evaluate(`mapEditor.editor.selectTool(${JSON.stringify(tool)});${Object.entries(values).map(([key, value]) => `mapEditor.editor.${key}.value=${JSON.stringify(value)}`).join(';')}`)
  await settle()
}
async function point(x = 0, y = 0, z = 0) { return evaluate(`mapEditor.canvas.probe().project(${x},${y},${z})`) }
async function mouse(type, p, button = 'left', buttons = 0) { await cdp.send('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons, clickCount: type === 'mouseMoved' ? 0 : 1 }) }
async function drag(a, b = a, release = true) {
  await mouse('mouseMoved', a)
  await mouse('mousePressed', a, 'left', 1)
  for (let i = 1; i <= 4; i++)
    await mouse('mouseMoved', { x: a.x + (b.x - a.x) * i / 4, y: a.y + (b.y - a.y) * i / 4 }, 'left', 1)
  if (release)
    await mouse('mouseReleased', b)
  await settle()
}
async function key(type, key, code) { await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode: code === 'Space' ? 32 : 27 }) }
async function choose(label, value) {
  await evaluate(`(()=>{const label=[...document.querySelectorAll('.map-toolbar label')].find(e=>e.textContent.trim().startsWith(${JSON.stringify(label)}));const el=label.querySelector('select,input');if(el.type==='checkbox')el.checked=${JSON.stringify(value)};else el.value=${JSON.stringify(String(value))};el.dispatchEvent(new Event(el.tagName==='SELECT'||el.type==='checkbox'?'change':'input',{bubbles:true}));})()`)
  await settle()
}
async function click(text) { await evaluate(`(()=>{const el=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(text)});if(!el)throw Error('Missing button');el.click()})()`); await settle() }
async function reset(content = {}) { await evaluate(`mapEditor.reset(${JSON.stringify(content)})`) }
const state = () => evaluate('mapEditor.state()')
const check = label => { report.checks.push(label); console.log(`PASS ${label}`) }
try {
  const absolute = path => path.replaceAll('\\', '/')
  const mapListFile = 'pages/campaigns/[campaignId]/library/maps/index.vue'
  const mapListData = [{ id: 'crossing', name: 'Crossing', description: '', groundTiles: [], walls: [] }, { id: 'town', name: 'Town', description: '', groundTiles: [], walls: [] }]
  const savedGlobals = new Map(['definePageMeta', 'useRoute', 'useRequestFetch', 'useAsyncData', 'useTamers', 'useDigimon', 'useMap'].map(key => [key, globalThis[key]]))
  let mapListHtml, mapListTeleports = ''
  try {
    Object.assign(globalThis, {
      definePageMeta: () => { }, useRoute: () => ({ params: { campaignId: 'campaign' } }), useRequestFetch: () => async () => mapListData,
      useTamers: () => ({}), useDigimon: () => ({}), useMap: loadTypeScript('composables/useMap.ts').useMap,
      useAsyncData: async (_key, load) => ({ data: ref(await load()), error: ref(null) })
    })
    const component = loadVueComponent(mapListFile, { isProd: true, templateOptions: { compilerOptions: { comments: false } } })
    const ssr = createSSRApp(component)
    ssr.component('NuxtLink', { props: ['to'], setup: (props, { slots }) => () => h('a', { href: props.to }, slots.default?.()) })
    const context = {}
    mapListHtml = await renderToString(ssr, context)
    mapListTeleports = context.teleports?.body ?? ''
  }
  finally {
    for (const [key, value] of savedGlobals)
      value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
  const theme = loadTypeScript('tailwind.config.ts').default
  const css = await postcss([tailwindcss({ ...theme, content: [{ raw: await readFile(resolve(app, mapListFile), 'utf8'), extension: 'vue' }] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })
  await writeFile(resolve(workspace, 'map-list.css'), css.css)
  await writeFile(resolve(workspace, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="/entry.mjs"></script></body></html>')
  await writeFile(resolve(workspace, 'entry.mjs'), `
    import './map-list.css';
    import {createApp,createSSRApp,h,ref,Suspense} from '${absolute(resolve(app, 'node_modules/vue/dist/vue.esm-bundler.js'))}';
    import App from '${absolute(resolve(app, 'tests/fixtures/MapEditorBrowser.vue'))}';
    import Maps from '${absolute(resolve(app, mapListFile))}';
    import {useMap} from '${absolute(resolve(app, 'composables/useMap.ts'))}';
    if(${noMultiDraw}){
      const getExtension=WebGL2RenderingContext.prototype.getExtension;
      WebGL2RenderingContext.prototype.getExtension=function(name){return name==='WEBGL_multi_draw'?null:getExtension.call(this,name)};
    }
    globalThis.definePageMeta=()=>{};globalThis.useRoute=()=>({params:{campaignId:'campaign'}});
    globalThis.useTamers=()=>({});globalThis.useDigimon=()=>({});globalThis.useMap=useMap;
    globalThis.mapListRequests=0;
    globalThis.useRequestFetch=()=>async()=>{globalThis.mapListRequests++;return ${JSON.stringify(mapListData)}};
    globalThis.useAsyncData=async(_key,load)=>({data:ref(window.__mapPayload??await load()),error:ref(null)});
    const mapsRoot={render:()=>h(Suspense,null,{default:()=>h(Maps)})};
    const register=app=>{app.component('NuxtLink',{props:['to'],setup:(props,{slots})=>()=>h('a',{href:props.to},slots.default?.())});return app};
    let application=register(location.pathname==='/maps'?createSSRApp(mapsRoot):createApp(App));application.mount('#app');
    window.openMapList=()=>{application.unmount();history.pushState({},'','/maps');application=register(createApp(mapsRoot));application.mount('#app')};
  `)
  await build({
    esbuild: { tsconfigRaw: { compilerOptions: { target: 'ES2022', useDefineForClassFields: true } } },
    configFile: false, root: workspace, logLevel: 'warn', define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true' }, resolve: { alias: { '~': app, 'vue': resolve(app, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') } }, plugins: [{
      name: 'map-editor-probe', enforce: 'pre', transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/components/MapCanvas.vue'))
          return
        // Diagnostics exist only in this fixture build, never in the application.
        return source.replace('defineExpose({ movingParticipantId, cameraAction })', `defineExpose({ movingParticipantId, cameraAction, probe:()=>({
        project:(x:number,y:number,z:number)=>{const v=new THREE.Vector3(x,y,z).project(camera),r=canvasRef.value!.getBoundingClientRect();return {x:r.left+(v.x+1)*r.width/2,y:r.top+(1-v.y)*r.height/2}},
        camera:camera.position.toArray(),target:controls.target.toArray(),fog:(scene.fog as THREE.FogExp2)?.density,
        renderer:{...renderer.info.memory,calls:renderer.info.render.calls},terrain:terrain?.stats(),
        ghostCells:hoverGhostGroup.children.length,selectionGhosts:selectionPreviewGroup?.children.length??0,
        pan:spacePanning.value,gesture:panGesture,drag:!!dragStartHit,stroke:strokePoints.length,
        multiDraw:renderer.extensions.has('WEBGL_multi_draw'),
        profileFrames:()=>{const times:number[]=[];for(let i=0;i<5;i++){const start=performance.now();renderer.render(scene,camera);renderer.getContext().finish();times.push(performance.now()-start)}return times},
      }) })`)
      },
    }, vue()], build: { outDir: resolve(workspace, 'site'), emptyOutDir: true, chunkSizeWarningLimit: 2000 }
  })
  const builtHtml = await readFile(resolve(workspace, 'site/index.html'), 'utf8')
  await writeFile(resolve(workspace, 'site/maps.html'), builtHtml.replace('<div id="app"></div>', `<div id="app">${mapListHtml}</div>${mapListTeleports}<script>window.__mapPayload=${JSON.stringify(mapListData)}</script>`))
  server = createServer(async (req, res) => {
    try {
      const path = resolve(workspace, 'site', '.' + new URL(req.url, 'http://fixture').pathname)
      const within = relative(resolve(workspace, 'site'), path)
      if (isAbsolute(within) || within.startsWith('..')) {
        res.writeHead(403).end()
        return
      }
      const file = path.endsWith('site') ? resolve(path, 'index.html') : path.endsWith('maps') ? resolve(workspace, 'site/maps.html') : path
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
      res.end(await readFile(file))
    }
    catch {
      res.writeHead(404).end()
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...(noMultiDraw ? ['--disable-webgl-extensions=WEBGL_multi_draw'] : []), '--remote-debugging-port=0', `--user-data-dir=${resolve(workspace, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  browser.on('error', e => errors.push(e.message))
  browser.stderr.on('data', b => { output += b.toString() })
  const endpoint = await poll(() => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1], 'Chrome startup')
  const port = new URL(endpoint).port
  const target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(t => t.type === 'page')
  const socket = new WebSocket(target.webSocketDebuggerUrl)
  await once(socket, 'open')
  cdp = new Cdp(socket)
  cdp.handlers.set('Runtime.exceptionThrown', e => errors.push(e.exceptionDetails.exception?.description ?? e.exceptionDetails.text))
  cdp.handlers.set('Runtime.consoleAPICalled', e => {
    const message = e.args.map(a => a.value ?? a.description).join(' ')
    if (e.type === 'error')
      errors.push(message)
    if (e.type === 'warning' && message.includes('Hydration'))
      console.log(message)
  })
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  await cdp.send('Page.navigate', { url: origin })
  await poll(() => evaluate('!!window.mapEditor'), 'actual editor mount')
  await settle()
  await configure('stairs', { rampDirection: 'west' })
  assert.equal(await evaluate(`[...document.querySelectorAll('label')].find(l=>l.textContent.startsWith('Uphill')).querySelector('select').value`), 'west')
  await choose('Uphill', 'east')
  assert.equal(await evaluate('mapEditor.editor.rampDirection.value'), 'east')
  await choose('Shape', 'cube')
  assert.equal(await evaluate('mapEditor.editor.drawMode.value'), 'cube')
  await choose('Level Y', 3)
  await choose('Lock to Y plane', true)
  assert.equal(await evaluate('mapEditor.editor.currentEditY.value'), 3)
  assert.equal(await evaluate('mapEditor.editor.planeLock.value'), true)
  check('contextual ref controls bind in both directions in Chrome')
  await reset()
  await configure('add-ground', { elementBrush: 'sand' })
  await drag(await point(-2.5, .12, -2.5), await point(2.5, .12, 2.5))
  assert.equal((await state()).groundTiles.length, 36)
  assert.ok((await state()).groundTiles.every(t => t.materialId === 'sand'))
  await click('Undo')
  assert.equal((await state()).groundTiles.length, 0)
  await click('Redo')
  assert.equal((await state()).groundTiles.length, 36)
  await configure('paint-element', { elementBrush: 'snow' })
  await drag(await point(.5, .12, .5))
  assert.ok((await state()).groundTiles.some(t => t.materialId === 'snow'))
  await configure('eyedropper')
  await drag(await point(-1.5, .12, -1.5))
  assert.equal(await evaluate('mapEditor.editor.elementBrush.value'), 'sand')
  check('material floors, paint, eyedropper and toolbar undo/redo')
  await reset()
  await configure('voxel', { drawMode: 'circle', planeLock: true })
  await drag(await point(-2.5, .12, -2.5), await point(2.5, .12, 2.5))
  assert.ok((await state()).voxels.length < 36 && (await state()).voxels.length > 16)
  await reset()
  await configure('ramp', { rampDirection: 'west' })
  await drag(await point(.5, .12, .5))
  assert.equal((await state()).voxels[0].rampDirection, 'west')
  await reset()
  await configure('stairs', { rampDirection: 'east' })
  await drag(await point(.5, .12, .5))
  assert.equal((await state()).stairs[0].face, 'west')
  await reset()
  await configure('ceiling')
  await drag(await point(.5, .12, .5))
  assert.equal((await state()).ceilings.length, 1)
  await reset()
  await configure('add-space', { spaceType: 'water' })
  await drag(await point(.5, .12, .5))
  assert.equal((await state()).spaceTiles[0].spaceType, 'water')
  await reset(); await configure('wall')
  await drag(await point(-1.5, .12, .01), await point(1.5, .12, .01))
  assert.equal((await state()).walls.length, 4)
  await click('Undo'); assert.equal((await state()).walls.length, 0)
  check('circle blocks, ramps, stairs, ceilings and advanced volumes')
  await reset()
  await configure('voxel', { drawMode: 'brush', brushSize: 3, planeLock: true })
  const a = await point(-3.5, .12, -3.5), bend = await point(3.5, .12, -3.5), b = await point(3.5, .12, 3.5)
  await mouse('mousePressed', a, 'left', 1)
  await mouse('mouseMoved', bend, 'left', 1)
  await mouse('mouseMoved', b, 'left', 1)
  await mouse('mouseReleased', b)
  await settle()
  assert.ok((await state()).voxels.some(t => t.x === 3 && t.z === -4), 'fast stroke retains its bend')
  await click('Undo')
  assert.equal((await state()).voxels.length, 0)
  await drag(a, b, false)
  await key('keyDown', 'Escape', 'Escape')
  await key('keyUp', 'Escape', 'Escape')
  await mouse('mouseReleased', b)
  assert.equal((await state()).voxels.length, 0)
  await drag(a, b, false)
  await mouse('mouseReleased', { x: 1, y: 1 })
  await settle()
  assert.equal((await state()).voxels.length, 0)
  check('fast brush bends, one undo, Escape and release outside canvas')
  await reset()
  await configure('voxel')
  const center = await point(.5, .12, .5), away = { x: center.x + 80, y: center.y + 40 }
  const before = await evaluate('mapEditor.canvas.probe().target')
  await key('keyDown', ' ', 'Space')
  await drag(center, away)
  await key('keyUp', ' ', 'Space')
  await settle()
  assert.equal((await state()).voxels.length, 0)
  assert.notDeepEqual(await evaluate('mapEditor.canvas.probe().target'), before)
  assert.equal(await evaluate('mapEditor.editor.activeTool.value'), 'voxel')
  await key('keyDown', ' ', 'Space')
  await drag(center, away, false)
  await key('keyUp', ' ', 'Space')
  await mouse('mouseReleased', away)
  assert.equal((await state()).voxels.length, 0)
  await key('keyDown', ' ', 'Space')
  await evaluate(`window.dispatchEvent(new Event('blur'))`)
  assert.equal(await evaluate('mapEditor.canvas.probe().pan'), false)
  await evaluate(`document.querySelector('input[type=number]').focus()`)
  await key('keyDown', ' ', 'Space')
  assert.equal(await evaluate('mapEditor.canvas.probe().pan'), false)
  await key('keyUp', ' ', 'Space')
  await evaluate('document.activeElement.blur()')
  check('Space pan moves camera, preserves tool and ignores focused inputs')
  await reset()
  await configure('room', { roomHeight: 3, roomFloor: true, elementBrush: 'wood' })
  await drag(await point(-1.5, .12, -1.5), await point(1.5, .12, 1.5))
  assert.equal((await state()).groundTiles.length, 16)
  assert.equal((await state()).walls.length, 48)
  await configure('door')
  await drag(await point(1.99, 2.5, .5))
  assert.equal((await state()).doors.length, 1)
  const room = await state()
  assert.equal(room.walls.find(w => w.id === room.doors[0].wallId)?.y, 2)
  await configure('window')
  await drag(await point(1.99, 1.5, .5))
  assert.equal((await state()).windows.length, 1)
  check('rooms with material floors and doors/windows on upper wall edges')
  await reset({ voxels: [{ x: 0, y: 0, z: 0, materialId: 'wood' }] })
  await configure('area-select')
  await drag(await point(.1, .12, .1), await point(.9, .12, .9))
  assert.ok(await evaluate('!!mapEditor.editor.selection.value'))
  await choose('Move X', 4)
  await choose('Rotate', 1)
  assert.ok(await evaluate('mapEditor.canvas.probe().selectionGhosts>0'))
  await click('Duplicate')
  assert.equal((await state()).voxels.length, 2)
  await choose('Move Z', 2); await click('Move / rotate')
  assert.ok((await state()).voxels.some(cell => cell.x === 4 && cell.z === 2))
  await click('Focus')
  assert.deepEqual(await evaluate('mapEditor.canvas.probe().target'), [4.5, .5, 2.5])
  await choose('Stamp name', 'Browser tree')
  await click('Save stamp')
  await configure('stamp')
  await choose('Rotation', 2)
  await drag(await point(-3.5, .12, -3.5))
  assert.equal((await state()).voxels.length, 3)
  await configure('spawn')
  await drag(await point(.5, 1, .5))
  assert.ok((await state()).voxels.some(v => v.isSpawnPoint))
  await configure('delete')
  await drag(await point(.5, 1, .5))
  assert.equal((await state()).voxels.length, 2)
  await click('Delete selection'); assert.equal((await state()).voxels.length, 1)
  await click('Undo'); assert.equal((await state()).voxels.length, 2)
  check('selection preview, duplication, stamp save/place, spawn and eraser')
  const voxels = [], groundTiles = []
  for (let x = -9; x <= 9; x++)
    for (let z = -9; z <= 9; z++) {
      groundTiles.push({ x, y: 0, z, materialId: x < 0 ? 'sand' : 'wood', element: 'earth', terrain: 'normal' })
      if (z >= -2 && z <= 2)
        voxels.push({ x, y: 1, z, materialId: x < 0 ? 'sand' : 'snow', shape: z === 2 ? 'ramp' : 'block', rampDirection: 'north' })
      if (z >= 5)
        voxels.push({ x, y: 0, z, materialId: x < 0 ? 'water' : 'ice' })
    }
  await reset({ groundTiles, voxels })
  await configure('select')
  await mkdir(artifacts, { recursive: true })
  for (const action of ['fit', 'top', 'corner-0', 'corner-1', 'corner-2', 'corner-3']) {
    await evaluate(`mapEditor.canvas.cameraAction('${action}')`)
    await settle()
    assert.ok(await evaluate('mapEditor.canvas.probe().fog>0'))
  }
  await evaluate(`mapEditor.canvas.cameraAction('corner-0')`)
  await settle()
  const desktop = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(artifacts, 'desktop.png'), Buffer.from(desktop.data, 'base64'))
  report.desktop = await evaluate('mapEditor.canvas.probe()')
  if (noMultiDraw)
    assert.equal(report.desktop.multiDraw, false)
  for (let i = 0; i < 10; i++) {
    await configure('paint-element', { elementBrush: i % 2 ? 'wood' : 'sand' })
    await drag(await point(.5, 2, .5))
    await click('Undo')
    await click('Redo')
  }
  await reset({ groundTiles, voxels })
  report.resourcesAfterSwitch = await evaluate('mapEditor.canvas.probe().renderer')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false })
  await settle()
  const layout = await evaluate(`(()=>{const t=document.querySelector('.map-toolbar').getBoundingClientRect(),c=document.querySelector('canvas').getBoundingClientRect();return {toolbar:t.height,canvas:c.height,overflow:document.documentElement.scrollWidth>innerWidth}})()`)
  assert.equal(layout.overflow, false)
  assert.ok(layout.canvas > 350)
  assert.ok(layout.toolbar <= 844 * .38 + 2)
  const mobile = await cdp.send('Page.captureScreenshot', { format: 'png' })
  await writeFile(resolve(artifacts, 'narrow.png'), Buffer.from(mobile.data, 'base64'))
  check('lit floor/voxel/ramp/translucent shaders, fog in every camera view, narrow layout and map switches')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false })
  const largeGround = Array.from({ length: 10000 }, (_, i) => ({ x: i % 100, y: 0, z: Math.floor(i / 100), terrain: 'normal', element: 'earth', materialId: ['sand', 'wood', 'snow'][i % 3] }))
  const largeVoxels = largeGround.filter((_, i) => i % 4 === 0).map((p, i) => ({ ...p, y: 1, materialId: ['sand', 'wood', 'water', 'ice', 'glass'][i % 5], shape: i % 7 === 0 ? 'ramp' : 'block', rampDirection: 'east' }))
  await reset({ groundTiles: largeGround, voxels: largeVoxels })
  report.largeMap = { cells: 12500, renderer: await evaluate('mapEditor.canvas.probe().renderer'), frameMs: await evaluate('mapEditor.canvas.probe().profileFrames()'), gpu: 'Chrome SwiftShader software renderer' }
  assert.ok(report.largeMap.renderer.calls < 15000, 'mixed map retains chunk batching')
  check('12,500-cell mixed-map WebGL profile and shader compilation')
  await evaluate('window.openMapList()')
  await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Maps'`), 'map list client navigation')
  const mapListSnapshot = () => evaluate(`(()=>{const grid=document.querySelector('.grid');return {html:document.querySelector('.container').outerHTML.replace(/<!--[^]*?-->/g,''),display:getComputedStyle(grid).display,columns:getComputedStyle(grid).gridTemplateColumns,width:grid.getBoundingClientRect().width}})()`)
  const navigated = await mapListSnapshot()
  assert.equal(navigated.display, 'grid')
  assert.equal(navigated.columns.split(' ').length, 3)
  await cdp.send('Page.reload', { ignoreCache: true })
  await poll(() => evaluate(`document.querySelector('h1')?.textContent==='Maps'&&window.openMapList&&window.mapListRequests===0`), 'map list hydrated reload')
  await pause(200)
  assert.deepEqual(await mapListSnapshot(), navigated)
  check('actual campaign map page has identical DOM and grid after navigation and SSR hydration')
  assert.deepEqual(errors, [], 'browser and shader errors')
  report.errors = errors
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`Browser evidence: ${artifacts}`)
}
finally {
  if (cdp) {
    await cdp.send('Browser.close').catch(() => { })
    cdp.socket.close()
  }
  if (browser && browser.exitCode === null) {
    browser.kill()
    await Promise.race([once(browser, 'exit'), pause(3000)])
  }
  if (server)
    await new Promise(done => server.close(done))
  const within = relative(tmpdir(), workspace)
  assert.ok(!isAbsolute(within) && !within.startsWith('..') && within.startsWith('dda-map-editor-'))
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
