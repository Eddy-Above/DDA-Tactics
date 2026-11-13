// Render and hydrate both real editor pages, including EncounterMap, its scoped
// styles, toolbar and WebGL canvas. All API traffic stays on a local fixture.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { createRouter, createMemoryHistory, RouterView } from 'vue-router'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'
import postcss from 'postcss'
import tailwindcss from 'tailwindcss'
import { loadTypeScript, loadVueComponent } from '../tests/helpers/loadTypeScript.mjs'
assert.equal(process.env.DDA_OFFLINE_VERIFY, '1', 'Preload ./scripts/offline-env.mjs')
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspace = await mkdtemp(resolve(tmpdir(), 'dda-map-reload-'))
const artifacts = resolve(app, '.cache/map-reload-verification')
const pause = ms => new Promise(done => setTimeout(done, ms))
const paths = { campaign: '/campaigns/campaign/library/maps/map', workshop: '/workshop/maps/map' }
const files = { campaign: 'pages/campaigns/[campaignId]/library/maps/[mapId].vue', workshop: 'pages/workshop/maps/[mapId].vue' }
const sharedFiles = ['components/EncounterMap.vue', 'components/MapToolbar.vue', 'components/MapCanvas.vue']
const scopeIds = new Map(), errors = [], checks = []
const { updateMapContentBounds } = loadTypeScript('utils/mapContentBounds.ts')
const maps = Object.fromEntries(Object.keys(paths).map(source => {
  const map = {
    id: 'map', name: 'Kamo River', campaignId: source === 'campaign' ? 'campaign' : null, ownerId: source === 'workshop' ? 'owner' : null,
    dimensions: { width: 0, depth: 0 }, groundTiles: Array.from({ length: 36 }, (_, i) => ({ x: i % 6, y: 0, z: Math.floor(i / 6), materialId: 'wood', element: 'wood', terrain: 'normal' })),
    spaceTiles: [], voxels: [], walls: [], doors: [], windows: [], stairs: [], ceilings: [], updatedAt: '2026-11-13T00:00:00.000Z'
  }
  map.contentBounds = updateMapContentBounds(null, map)
  return [source, map]
}))
const owner = { id: 'owner', username: 'EddySoul' }
const copy = value => JSON.parse(JSON.stringify(value))
let browser, server, cdp
async function api(source, url, options = {}) {
  if (url === '/api/auth/me')
    return { user: owner }
  if (url === '/api/encounters/placement/actions/move') return { success: true, position: options.body.destination }
  assert.ok(url.startsWith('/api/maps/map'), `Unexpected fixture API ${url}`)
  if (options.method === 'PUT') {
    maps[source] = { ...maps[source], ...options.body, updatedAt: new Date().toISOString() }
    maps[source].contentBounds = updateMapContentBounds(null, maps[source])
    return { id: 'map', updatedAt: maps[source].updatedAt }
  }
  return copy(maps[source])
}
const clientOnly = { setup: (_props, { slots }) => { const mounted = Vue.ref(false); Vue.onMounted(() => { mounted.value = true }); return () => mounted.value ? slots.default?.() : Vue.h('span', '') } }
function register(app, components) {
  app.component('NuxtLink', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  app.component('ClientOnly', clientOnly)
  for (const name of ['MapPlayerHUD', 'MapBattleLog', 'MapPropertyPanel'])
    app.component(name, { render: () => null })
  for (const [name, component] of Object.entries(components))
    app.component(name, component)
  return app
}
function component(file) {
  const value = loadVueComponent(file, { isProd: true, templateOptions: { compilerOptions: { comments: false } } })
  if (scopeIds.has(file))
    value.__scopeId = scopeIds.get(file)
  return value
}
async function ssr(source) {
  const state = Vue.reactive({}), payload = {}, components = { EncounterMap: component(sharedFiles[0]), MapToolbar: component(sharedFiles[1]), MapCanvas: { render: () => null } }
  const route = paths[source], router = createRouter({ history: createMemoryHistory(), routes: [{ path: source === 'campaign' ? '/campaigns/:campaignId/library/maps/:mapId' : '/workshop/maps/:mapId', component: component(files[source]) }] })
  const globals = {
    ref: Vue.ref, computed: Vue.computed, watch: Vue.watch, onMounted: Vue.onMounted, onUnmounted: Vue.onUnmounted,
    definePageMeta: () => { }, useRoute: () => router.currentRoute.value,
    useState: (key, init) => {
      if (!(key in state))
        state[key] = init(); return Vue.toRef(state, key)
    },
    useRequestFetch: () => url => api(source, url),
    $fetch: () => { throw new Error('SSR fixture must forward the viewer request') },
    createError: value => Object.assign(new Error(value.message ?? 'Request failed'), value),
    useAuth: loadTypeScript('composables/useAuth.ts').useAuth,
    useAsyncData: async (key, load) => { key = typeof key === 'function' ? key() : key; const data = await load(); payload[key] = data; return { data: Vue.ref(data), error: Vue.ref(null) } },
  }
  const saved = new Map(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  try {
    const view = register(Vue.createSSRApp({ render: () => Vue.h(RouterView) }), components)
    view.use(router)
    await router.push(route)
    await router.isReady()
    const context = {}, html = await renderToString(view, context)
    return { html, teleports: context.teleports?.body ?? '', state: copy(state), data: copy(payload) }
  }
  finally {
    for (const [key, value] of saved)
      value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
}
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
        clearTimeout(p.timer)
        this.pending.delete(message.id)
        message.error ? p.reject(new Error(JSON.stringify(message.error))) : p.resolve(message.result)
      }
      else
        this.handlers.get(message.method)?.(message.params)
    })
  }
  send(method, params = {}) { return new Promise((resolve, reject) => { const id = ++this.id, timer = setTimeout(() => reject(new Error(`${method} timed out`)), 20000); this.pending.set(id, { resolve, reject, timer }); this.socket.send(JSON.stringify({ id, method, params })) }) }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails)
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text); return result.result.value
  }
}
async function poll(work, label) {
  const until = Date.now() + 20000; while (Date.now() < until) {
    try {
      const value = await work()
      if (value)
        return value
    }
    catch { }
    await pause(100)
  } throw new Error(`Timed out: ${label}`)
}
const evaluate = expression => cdp.evaluate(expression)
async function layout() { return evaluate(`(()=>{const root=document.querySelector('.encounter-map-root'),toolbar=root.querySelector('.map-toolbar'),status=root.querySelector('.map-save-status'),canvas=root.querySelector('.canvas-wrapper'),header=document.querySelector('h1').closest('.flex-shrink-0');const box=e=>{const b=e.getBoundingClientRect();return {x:b.x,y:b.y,width:b.width,height:b.height,bottom:b.bottom}};return {direction:getComputedStyle(root).flexDirection,root:box(root),toolbar:box(toolbar),status:box(status),canvas:box(canvas),header:box(header),drawing:box(canvas.querySelector('canvas'))}})()`) }
function assertLayout(value, width, height) {
  assert.equal(value.direction, 'column')
  assert.ok(Math.abs(value.root.width - width) < 2)
  assert.ok(Math.abs(value.root.bottom - height) < 2)
  assert.ok(value.toolbar.y >= value.header.bottom - 1)
  assert.ok(value.status.y >= value.toolbar.bottom - 1)
  assert.ok(value.canvas.y >= value.status.bottom - 1)
  assert.ok(value.canvas.height > height * .4)
  assert.ok(Math.abs(value.drawing.width - value.canvas.width) < 2)
  assert.ok(Math.abs(value.drawing.height - value.canvas.height) < 2)
}
try {
  const absolute = file => resolve(app, file).replaceAll('\\', '/')
  const source = await Promise.all([...Object.values(files), ...sharedFiles].map(file => readFile(resolve(app, file), 'utf8')))
  const config = loadTypeScript('tailwind.config.ts').default
  const css = await postcss([tailwindcss({ ...config, content: [{ raw: source.join('\n'), extension: 'vue' }] })]).process('@tailwind base;@tailwind components;@tailwind utilities;', { from: undefined })
  await writeFile(resolve(workspace, 'fixture.css'), css.css + '\nhtml,body,#app{margin:0;width:100%;height:100%;background:#050d17;color:white}')
  await writeFile(resolve(workspace, 'index.html'), '<html><head><meta charset="utf-8"></head><body><div id="app"></div><script type="module" src="/entry.mjs"></script></body></html>')
  await writeFile(resolve(workspace, 'entry.mjs'), `
    import './fixture.css';import * as Vue from '${absolute('node_modules/vue/dist/vue.esm-bundler.js')}';
    import {createRouter,createWebHistory,RouterView,RouterLink} from '${absolute('node_modules/vue-router/dist/vue-router.mjs')}';
    import Campaign from '${absolute(files.campaign)}';import Workshop from '${absolute(files.workshop)}';
    import EncounterMap from '${absolute(sharedFiles[0])}';import MapToolbar from '${absolute(sharedFiles[1])}';import MapCanvas from '${absolute(sharedFiles[2])}';
    import {useAuth} from '${absolute('composables/useAuth.ts')}';
    const placementEncounter={id:'placement',mapId:'map',phase:'setup',round:0,currentTurnIndex:0,revision:0,turnOrder:[],hazards:[],battleLog:[],destructibleStates:[],
      participants:[{id:'unit',entityId:'tamer',type:'tamer',currentWounds:0,maxWounds:5,actionsRemaining:{simple:2}}],participantPositions:{unit:{x:0,y:0,z:0}}};
    const placementRoot={render:()=>Vue.h('div',{style:'height:100vh'},[Vue.h(EncounterMap,{encounter:placementEncounter,initialMap:${JSON.stringify(maps.campaign)},isDm:true,editorMode:true,myTamerId:null,tamerMap:{tamer:{name:'Tai',woundBoxes:5}},digimonMap:{},selectedAttack:null})])};
    const router=createRouter({history:createWebHistory(),routes:[{path:'/start',component:{render:()=>Vue.h('div','Start')}},{path:'/placement',component:placementRoot},{path:'/campaigns/:campaignId/library/maps/:mapId',component:Campaign},{path:'/workshop/maps/:mapId',component:Workshop}]});
    const state=Vue.reactive(window.fixture?.state??{}),data=window.fixture?.data??{};window.apiReads=0;window.documentToken=crypto.randomUUID();
    const request=async(url,options={})=>{if(!options.method)window.apiReads++;if(!options.method&&url.startsWith('/api/maps/')&&window.mapRequestGate)await window.mapRequestGate;
      if(url==='/api/encounters/placement/actions/move'){window.placementRequestStarted=(window.placementRequestStarted??0)+1;if(window.placementGate)await window.placementGate;if(window.rejectPlacement){window.rejectPlacement=false;throw {data:{message:'The destination is occupied'}}}}
      const response=await fetch('/fixture-api?source='+ (router.currentRoute.value.path.startsWith('/workshop')?'workshop':'campaign')+'&url='+encodeURIComponent(url),{method:options.method??'GET',headers:{'Content-Type':'application/json'},...(options.body?{body:JSON.stringify(options.body)}:{})});return response.json()};
    Object.assign(globalThis,{ref:Vue.ref,computed:Vue.computed,watch:Vue.watch,onMounted:Vue.onMounted,onUnmounted:Vue.onUnmounted,
      definePageMeta:()=>{},useRoute:()=>router.currentRoute.value,useRequestFetch:()=>request,$fetch:request,useAuth,
      useState:(key,init)=>{if(!(key in state))state[key]=init();return Vue.toRef(state,key)},createError:value=>Object.assign(new Error(value.message??'Request failed'),value),
      useAsyncData:(key,load,options={})=>{
        key=typeof key==='function'?key():key;const cached=Object.hasOwn(data,key);
        const result={data:Vue.ref(cached?data[key]:null),error:Vue.ref(null),pending:Vue.ref(!cached)};
        result.refresh=async()=>{result.pending.value=true;result.error.value=null;try{result.data.value=await load()}catch(error){result.error.value=error;result.data.value=null}finally{result.pending.value=false}};
        if(cached)return Promise.resolve(result);
        if(options.lazy){Vue.onBeforeMount(()=>{void result.refresh()});return Promise.resolve(result)}
        return result.refresh().then(()=>result);
      }});
    const root={render:()=>Vue.h(RouterView,null,{default:({Component})=>Component?Vue.h(Vue.Suspense,null,{default:()=>Vue.h(Component)}):null})};
    const app=window.fixture?Vue.createSSRApp(root):Vue.createApp(root);app.use(router);app.component('NuxtLink',RouterLink);
    app.component('ClientOnly',{setup:(_,{slots})=>{const mounted=Vue.ref(false);Vue.onMounted(()=>mounted.value=true);return()=>mounted.value?slots.default?.():Vue.h('span','')}});
    for(const [name,value]of Object.entries({EncounterMap,MapToolbar,MapCanvas}))app.component(name,value);
    for(const name of ['MapPlayerHUD','MapBattleLog','MapPropertyPanel'])app.component(name,{render:()=>null});
    await router.isReady();app.mount('#app');window.navigateEditor=path=>router.push(path);
  `)
  await build({
    configFile: false, root: workspace, logLevel: 'warn', define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'true' }, esbuild: { tsconfigRaw: { compilerOptions: { target: 'ES2022' } } }, resolve: { alias: { '~': app, vue: absolute('node_modules/vue/dist/vue.runtime.esm-bundler.js') } }, plugins: [{
      name: 'editor-camera-probe', enforce: 'pre', transform(source, id) {
        if (id.replaceAll('\\', '/').endsWith('/components/EncounterMap.vue')) return source.replace('</script>', `onMounted(()=>{(window as any).placementProbe={arm:selectParticipant,gm:onGmMoveStart,state:()=>JSON.parse(JSON.stringify({positions:positions.value,display:displayPositions.value,pending:placementPreviews.value}))}});</script>`)
        if (!id.replaceAll('\\', '/').endsWith('/components/MapCanvas.vue'))
          return; return source.replace('defineExpose({ movingParticipantId, cameraAction })', `defineExpose({ movingParticipantId, cameraAction });onMounted(()=>{(window as any).renderedTokenPosition=(id:string)=>spriteGroups.get(id)?.position.toArray();(window as any).reloadProject=(x:number,y:number,z:number)=>{const p=new THREE.Vector3(x,y,z).project(camera),r=canvasRef.value!.getBoundingClientRect();return {x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2}}})`)
      }
    }, vue({ template: { compilerOptions: { comments: false } } }), {
      name: 'record-scoped-style-ids', enforce: 'post', transform(source, id) {
        for (const file of sharedFiles)
          if (id.replaceAll('\\', '/').endsWith('/' + file)) {
            const scope = source.match(/__scopeId[^\n]*?["'](data-v-[a-f0-9]+)["']/)?.[1]
            if (scope)
              scopeIds.set(file, scope)
          }
      }
    }], build: { target: 'es2022', outDir: resolve(workspace, 'site'), chunkSizeWarningLimit: 2000 }
  })
  assert.ok(scopeIds.has(sharedFiles[0]) && scopeIds.has(sharedFiles[1]), 'SSR must use the client build scoped style IDs')
  const shell = await readFile(resolve(workspace, 'site/index.html'), 'utf8')
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://fixture')
      if (url.pathname === '/favicon.ico') {
        res.writeHead(204).end()
        return
      }
      if (url.pathname === '/fixture-api') {
        let body = ''
        for await (const chunk of req)
          body += chunk
        const result = await api(url.searchParams.get('source'), url.searchParams.get('url'), { method: req.method, body: body ? JSON.parse(body) : undefined })
        res.setHeader('Content-Type', 'application/json')
        res.end(JSON.stringify(result))
        return
      }
      const kind = Object.keys(paths).find(source => paths[source] === url.pathname)
      if (kind) {
        const rendered = await ssr(kind)
        const serialized = JSON.stringify({ state: rendered.state, data: rendered.data }).replaceAll('<', '\\u003c')
        res.setHeader('Content-Type', 'text/html;charset=utf-8')
        res.end(shell.replace('<div id="app"></div>', `<div id="app">${rendered.html}</div>${rendered.teleports}<script>window.fixture=${serialized}</script>`))
        return
      }
      if (url.pathname === '/start' || url.pathname === '/placement') {
        res.setHeader('Content-Type', 'text/html;charset=utf-8')
        res.end(shell)
        return
      }
      const file = resolve(workspace, 'site', '.' + url.pathname), within = relative(resolve(workspace, 'site'), file)
      if (isAbsolute(within) || within.startsWith('..')) {
        res.writeHead(403).end()
        return
      }
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html')
      res.end(await readFile(file))
    }
    catch (error) {
      errors.push(error.stack)
      res.writeHead(500).end(error.message)
    }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  browser = spawn(process.env.SECURITY_SMOKE_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--remote-debugging-port=0', `--user-data-dir=${resolve(workspace, 'profile')}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  browser.stderr.on('data', value => { output += value.toString() })
  const endpoint = await poll(() => output.match(/DevTools listening on (ws:\/\/\S+)/)?.[1], 'Chrome startup'), port = new URL(endpoint).port
  const page = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find(value => value.type === 'page')
  const socket = new WebSocket(page.webSocketDebuggerUrl)
  await once(socket, 'open')
  cdp = new Cdp(socket)
  cdp.handlers.set('Runtime.exceptionThrown', value => errors.push(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text))
  cdp.handlers.set('Runtime.consoleAPICalled', value => {
    const message = value.args.map(arg => arg.value ?? arg.description).join(' '); if (value.type === 'error')
      errors.push(message); if (value.type === 'warning' && /Hydration/.test(message))
      console.log(message)
  })
  await cdp.send('Runtime.enable')
  await cdp.send('Page.enable')
  await mkdir(artifacts, { recursive: true })
  for (const source of Object.keys(paths))
    for (const [width, height] of [[1440, 900], [390, 844]]) {
      const editX = width === 1440 ? 2 : 3, editZ = 2
      await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false })
      await cdp.send('Page.navigate', { url: origin + '/start' })
      await poll(() => evaluate('!!window.navigateEditor'), 'navigation start')
      await evaluate(`window.mapRequestGate=new Promise(resolve=>window.releaseMapRequest=()=>{window.mapRequestGate=null;resolve()});window.navigateEditor(${JSON.stringify(paths[source])})`)
      await poll(() => evaluate(`location.pathname===${JSON.stringify(paths[source])}&&document.querySelector('[role="status"]')?.textContent.includes('Loading map editor')`), 'route and loading state before map data')
      assert.equal(await evaluate(`!!document.querySelector('.encounter-map-root')`),false,'the editor waits for its authorized map')
      await evaluate('window.releaseMapRequest()')
      await poll(() => evaluate(`!!document.querySelector('.encounter-map-root canvas')&&!!window.reloadProject`), 'full editor navigation')
      const navigated = await layout()
      assertLayout(navigated, width, height)
      await evaluate(`(()=>{[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='Block').click()})()`)
      await pause(100)
      const point = await evaluate(`window.reloadProject(${editX + .5},.12,${editZ + .5})`)
      for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
        await cdp.send('Input.dispatchMouseEvent', { type, x: point.x, y: point.y, button: type === 'mouseMoved' ? 'none' : 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: type === 'mouseMoved' ? 0 : 1 })
      await poll(() => maps[source].voxels.some(cell => cell.x === editX && cell.z === editZ), 'actual editor autosave')
      await poll(() => evaluate(`document.querySelector('.map-save-status')?.textContent.trim()==='Saved'`), 'save acknowledgement')
      const token = await evaluate('window.documentToken')
      await cdp.send('Page.reload', { ignoreCache: true })
      await poll(() => evaluate(`window.documentToken!==${JSON.stringify(token)}&&!!document.querySelector('.encounter-map-root canvas')&&!!window.reloadProject`), 'hydrated editor reload')
      await pause(100)
      const reloaded = await layout()
      assertLayout(reloaded, width, height)
      assert.deepEqual(reloaded, navigated, 'reload must keep the full-page toolbar/status/canvas layout')
      assert.equal(await evaluate('window.apiReads'), 0, 'hydration reuses map and auth payloads')
      const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(resolve(artifacts, `${source}-${width}.png`), Buffer.from(screenshot.data, 'base64'))
      checks.push({ source, width, height, navigated, reloaded, savedVoxel: copy(maps[source].voxels.find(cell => cell.x === editX && cell.z === editZ)) })
      console.log(`PASS ${source} editor navigation/edit/save/reload ${width}x${height}`)
    }
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false})
  await cdp.send('Page.navigate',{url:origin+'/placement'})
  await poll(()=>evaluate(`!!window.placementProbe&&!!window.renderedTokenPosition?.('unit')`),'placement canvas')
  await evaluate(`window.placementAlerts=[];window.alert=message=>window.placementAlerts.push(message)`)
  for(const [kind,x,z,reject] of [['placement',2,2,false],['gm',4,2,false],['gm',1,3,true]]) {
    const before=await evaluate(`placementProbe.state().positions.unit`)
    await evaluate(`window.rejectPlacement=${reject};window.placementGate=new Promise(resolve=>window.releasePlacement=()=>{window.placementGate=null;resolve()});placementProbe.${kind==='placement'?'arm':'gm'}('unit')`)
    const aim=await evaluate(`reloadProject(${x+.5},.12,${z+.5})`)
    for(const type of ['mouseMoved','mousePressed','mouseReleased'])await cdp.send('Input.dispatchMouseEvent',{type,x:aim.x,y:aim.y,button:type==='mouseMoved'?'none':'left',buttons:type==='mousePressed'?1:0,clickCount:type==='mouseMoved'?0:1})
    await poll(()=>evaluate(`document.querySelector('.placement-save-status')&&renderedTokenPosition('unit')?.[0]===${x+.5}`),'rendered preview before response')
    const pending=await evaluate('placementProbe.state()')
    assert.deepEqual(pending.positions.unit,before,'pending preview must not overwrite the authoritative origin')
    assert.deepEqual(pending.display.unit,{x,y:0,z})
    const screenshot=await cdp.send('Page.captureScreenshot',{format:'png'})
    await writeFile(resolve(artifacts,`${kind}-${reject?'rejected':'pending'}.png`),Buffer.from(screenshot.data,'base64'))
    await evaluate('window.releasePlacement()')
    await poll(()=>evaluate(`!document.querySelector('.placement-save-status')`),'placement save completion')
    assert.deepEqual(await evaluate('placementProbe.state().positions.unit'),reject?before:{x,y:0,z})
    await poll(()=>evaluate(`renderedTokenPosition('unit')?.[0]===${(reject?before.x:x)+.5}`),'final rendered token')
    checks.push({kind,pendingDestination:{x,y:0,z},rejected:reject,previewBeforeResponse:true})
    console.log(`PASS ${kind} rendered pending preview before acknowledgement${reject?' and rollback':''}`)
  }
  assert.deepEqual(await evaluate('window.placementAlerts'),['The destination is occupied'])
  assert.deepEqual(errors, [], 'full-page browser/hydration/shader errors')
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ scope: 'real page/EncounterMap/toolbar/WebGL with local APIs and Nuxt-style payload; no production services', checks, errors }, null, 2))
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
  assert.ok(!isAbsolute(within) && !within.startsWith('..') && within.startsWith('dda-map-reload-'))
  await rm(workspace, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
}
