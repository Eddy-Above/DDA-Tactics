// Actual MapCanvas/WebGL comparison. Optional first argument: a pre-change MapCanvas.vue snapshot.
// Uses isolated local fixtures; never connects to the live app or database.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'
import vue from '@vitejs/plugin-vue'

assert.equal(process.env.DDA_OFFLINE_VERIFY, '1', 'Preload ./scripts/offline-env.mjs')
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const artifacts = resolve(app, '.cache/flicker-verification')
await mkdir(artifacts, { recursive: true })
const workspace = await mkdtemp(resolve(artifacts, 'run-'))
const absolute = path => path.replaceAll('\\', '/')
const chrome = process.env.SECURITY_SMOKE_CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const pause = ms => new Promise(done => setTimeout(done, ms))
const baseline = process.argv[2] ? await readFile(resolve(process.argv[2]), 'utf8') : null
const errors = [], results = []
let browser, server, socket, nextId = 0
const pending = new Map()
async function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++nextId
    const timer = setTimeout(() => { pending.delete(id); reject(Error(`Timeout: ${method}`)) }, 20000)
    pending.set(id, { resolve, reject, timer })
    socket.send(JSON.stringify({ id, method, params }))
  })
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
  return result.result.value
}
async function poll(work) {
  for (let i = 0; i < 200; i++) {
    const value = await work()
    if (value) return value
    await pause(100)
  }
  throw Error(`Timed out waiting for browser fixture: ${errors.join('; ')}`)
}
const metrics = async () => Object.fromEntries((await send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]))
async function measure(label, ms = 3000) {
  await evaluate('mapEditor.canvas.probe().resetStats()')
  const before = await metrics()
  await pause(ms)
  const after = await metrics(), stats = await evaluate('mapEditor.canvas.probe().stats()')
  const seconds = after.Timestamp - before.Timestamp
  return { label, seconds: +seconds.toFixed(3), renders: stats.frames, framesPerSecond: +(stats.frames / seconds).toFixed(2),
    shadowPasses: stats.shadowPasses, rendererSubmitMs: +stats.renderMs.toFixed(2),
    mainThreadTaskCpuPercent: +((after.TaskDuration - before.TaskDuration) / seconds * 100).toFixed(2),
    gpuRenderer: stats.gpuRenderer }
}

try {
  for (const mode of baseline ? ['baseline', 'optimized'] : ['optimized']) {
    const root = resolve(workspace, mode)
    await mkdir(root)
    await writeFile(resolve(root, 'index.html'), '<html><body><div id="app"></div><script type="module" src="/entry.mjs"></script></body></html>')
    await writeFile(resolve(root, 'entry.mjs'), `
      import {createApp} from '${absolute(resolve(app, 'node_modules/vue/dist/vue.esm-bundler.js'))}';
      import App from '${absolute(resolve(app, 'tests/fixtures/MapEditorBrowser.vue'))}';
      const application=createApp(App);application.mount('#app');window.unmountMap=()=>application.unmount();
    `)
    await build({ configFile: false, root, base: './', logLevel: 'warn',
      resolve: { alias: { '~': app, vue: resolve(app, 'node_modules/vue/dist/vue.runtime.esm-bundler.js') } },
      define: { __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
      plugins: [{ name: 'flicker-diagnostics', enforce: 'pre', transform(source, id) {
        if (!id.replaceAll('\\', '/').endsWith('/components/MapCanvas.vue')) return
        if (mode === 'baseline') source = baseline
        assert.ok(source.includes('defineExpose({ movingParticipantId, cameraAction, focusParticipant })'))
        source = source.replace('function initScene() {', `
          const perfStats={frames:0,shadowPasses:0,renderMs:0};
          function initScene() {`)
        source = source.replace('renderer.setPixelRatio(window.devicePixelRatio)', `
          const originalRender=renderer.render.bind(renderer);
          renderer.render=(scene,camera)=>{const start=performance.now();perfStats.frames++;originalRender(scene,camera);perfStats.renderMs+=performance.now()-start};
          const originalShadowRender=renderer.shadowMap.render.bind(renderer.shadowMap);
          renderer.shadowMap.render=(lights,scene,camera)=>{if(renderer.shadowMap.enabled&&(renderer.shadowMap.autoUpdate||renderer.shadowMap.needsUpdate)&&lights.length)perfStats.shadowPasses++;originalShadowRender(lights,scene,camera)};
          renderer.setPixelRatio(window.devicePixelRatio)`)
        return source.replace('defineExpose({ movingParticipantId, cameraAction, focusParticipant })', `
          defineExpose({movingParticipantId,cameraAction,focusParticipant,probe:()=>({
            resetStats:()=>{perfStats.frames=0;perfStats.shadowPasses=0;perfStats.renderMs=0},
            stats:()=>{const gl=renderer.getContext(),ext=gl.getExtension('WEBGL_debug_renderer_info');return {...perfStats,gpuRenderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)}},
            setClip:(y:number)=>{clipY.value=y},
            setHidden:(hidden:boolean)=>{Object.defineProperty(document,'hidden',{configurable:true,value:hidden});onMapVisibilityChange()},
          })})`)
      } }, vue()], build: { outDir: resolve(root, 'site'), emptyOutDir: true, chunkSizeWarningLimit: 2000 } })
  }
  server = createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://fixture').pathname
      const [mode, ...parts] = pathname.slice(1).split('/')
      const root = resolve(workspace, mode, 'site')
      const path = resolve(root, parts.join('/') || 'index.html')
      const within = relative(root, path)
      if (isAbsolute(within) || within.startsWith('..')) { res.writeHead(403).end(); return }
      res.setHeader('Content-Type', path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/html')
      res.end(await readFile(path))
    } catch { res.writeHead(404).end() }
  }).listen(0, '127.0.0.1')
  await once(server, 'listening')
  browser = spawn(chrome, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', `--user-data-dir=${resolve(workspace, 'profile')}`, 'about:blank'],
  { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  let output = ''
  browser.on('error', error => errors.push(error.message))
  browser.stderr.on('data', data => { output += data.toString() })
  const endpoint = await poll(() => output.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1])
  const tabs = await (await fetch(`http://127.0.0.1:${new URL(endpoint).port}/json/list`)).json()
  socket = new WebSocket(tabs.find(t => t.type === 'page').webSocketDebuggerUrl)
  await once(socket, 'open')
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    if (message.id && pending.has(message.id)) {
      const p = pending.get(message.id); pending.delete(message.id); clearTimeout(p.timer)
      message.error ? p.reject(Error(JSON.stringify(message.error))) : p.resolve(message.result)
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text)
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description).join(' '))
  })
  await send('Runtime.enable'); await send('Page.enable'); await send('Performance.enable')
  await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1.5, mobile: false })
  for (const mode of baseline ? ['baseline', 'optimized'] : ['optimized']) {
    await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/${mode}/` })
    await poll(() => evaluate('!!window.mapEditor?.canvas?.probe').catch(() => false))
    await evaluate(`mapEditor.reset({groundTiles:Array.from({length:1600},(_,i)=>({x:i%40,y:0,z:Math.floor(i/40),element:'void',terrain:'normal'})),
      voxels:[...Array.from({length:100},(_,i)=>({x:i%20*2,y:1,z:Math.floor(i/20)*3,materialId:'earth'})),
      ...[4,12,20,28].map(x=>({x,y:2,z:15,materialId:'flickering-light'}))]})`)
    await pause(500)
    const idle = await measure(`${mode}: stationary flickering map`)
    results.push(idle); console.log(JSON.stringify(idle))
    if (mode === 'optimized') {
      assert.ok(idle.framesPerSecond <= 21 && idle.framesPerSecond >= 5, 'flicker stays active within its frame budget')
      assert.equal(idle.shadowPasses, 0, 'idle flicker reuses the existing shadows')
      await evaluate('mapEditor.canvas.probe().resetStats();mapEditor.editor.applyVoxelDraw({x:0,y:1,z:0},{x:0,y:1,z:0});mapEditor.nextTick()')
      await pause(200)
      assert.equal((await evaluate('mapEditor.canvas.probe().stats()')).shadowPasses, 1, 'geometry edits refresh shadows once')
      await evaluate('mapEditor.canvas.probe().setClip(1);mapEditor.nextTick()'); await pause(200)
      const clipped = await measure('optimized: last flickering source clipped', 500)
      assert.equal(clipped.renders, 0); results.push(clipped)
      await evaluate('mapEditor.canvas.probe().setClip(20);mapEditor.nextTick()'); await pause(100)
      const restored = await measure('optimized: lights revealed', 500)
      assert.ok(restored.renders > 0); assert.equal(restored.shadowPasses, 0); results.push(restored)
      await evaluate('mapEditor.canvas.probe().setHidden(true)')
      const hidden = await measure('optimized: hidden tab', 500)
      assert.equal(hidden.renders, 0); results.push(hidden)
      await evaluate('mapEditor.canvas.probe().setHidden(false)'); await pause(100)
      const visible = await measure('optimized: visible again', 500)
      assert.ok(visible.renders > 0); results.push(visible)
    }
  }
  assert.deepEqual(errors, [])
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ scope: 'Actual MapCanvas and WebGL; isolated fixture, not the user campaign; CPU is profiled renderer task time, not hardware GPU utilisation.', results, errors }, null, 2))
  console.log(`PASS flicker browser comparison; report: ${resolve(artifacts, 'report.json')}`)
} finally {
  socket?.close()
  browser?.kill()
  server?.close()
  for (const p of pending.values()) { clearTimeout(p.timer); p.reject(Error('Browser closed')) }
}
