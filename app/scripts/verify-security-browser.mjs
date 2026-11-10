// Run with Node 24 after a production build. This smoke harness never starts Nuxt's
// builder and cannot connect to a real database. Login responses and HTTPS images
// are explicit local fixtures; authenticated staging gameplay remains a separate check.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { generateKeyPairSync, createHash, randomBytes, sign } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile, access } from 'node:fs/promises'
import { createServer as httpsServer } from 'node:https'
import { createServer as tcpServer } from 'node:net'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

assert.ok(Number(process.versions.node.split('.')[0]) >= 24, 'Use Node 24 for the built runtime and native CDP WebSocket client')
const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.env.SECURITY_SMOKE_CHROME ?? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const reportPath = resolve(app, '.security-browser-smoke.log')
const pause = ms => new Promise(done => setTimeout(done, ms))
const gifBase64 = 'R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=='
const imageBytes = Buffer.from(gifBase64, 'base64')
const header = (headers, name) => Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]

async function freePort() {
  const server = tcpServer()
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const port = server.address().port
  await new Promise(done => server.close(done))
  return port
}

// A short-lived self-signed fixture certificate avoids external network access or
// changes to the user's certificate store. Chrome trusts only its pinned SPKI.
function tlsFixture() {
  const der = (tag, content) => {
    const value = Buffer.isBuffer(content) ? content : Buffer.concat(content)
    let length = value.length < 128 ? Buffer.from([value.length]) : Buffer.from(value.length.toString(16).padStart(value.length > 255 ? 4 : 2, '0'), 'hex')
    if (value.length >= 128) length = Buffer.concat([Buffer.from([0x80 | length.length]), length])
    return Buffer.concat([Buffer.from([tag]), length, value])
  }
  const seq = (...parts) => der(0x30, parts)
  const oid = hex => der(0x06, Buffer.from(hex, 'hex'))
  const integer = bytes => der(0x02, bytes[0] & 0x80 ? Buffer.concat([Buffer.from([0]), bytes]) : bytes)
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const spki = publicKey.export({ type: 'spki', format: 'der' })
  const algorithm = seq(oid('2a864886f70d01010b'), der(0x05, Buffer.alloc(0)))
  const name = seq(der(0x31, seq(oid('550403'), der(0x0c, Buffer.from('Offline CSP image fixture')))))
  const utc = milliseconds => der(0x17, Buffer.from(new Date(milliseconds).toISOString().replace(/\D/g, '').slice(2, 14) + 'Z'))
  const alternativeNames = seq(der(0x87, Buffer.from([127, 0, 0, 1])))
  const extensions = der(0xa3, seq(seq(oid('551d11'), der(0x04, alternativeNames))))
  const tbs = seq(der(0xa0, integer(Buffer.from([2]))), integer(randomBytes(16)), algorithm, name,
    seq(utc(Date.now() - 3_600_000), utc(Date.now() + 86_400_000)), name, spki, extensions)
  const certificate = seq(tbs, algorithm, der(0x03, Buffer.concat([Buffer.from([0]), sign('sha256', tbs, privateKey)])))
  return {
    key: privateKey.export({ format: 'pem', type: 'pkcs8' }),
    cert: `-----BEGIN CERTIFICATE-----\n${certificate.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`,
    pin: createHash('sha256').update(spki).digest('base64'),
  }
}

class Cdp {
  constructor(socket) {
    this.socket = socket
    this.sequence = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.listenerErrors = []
    socket.addEventListener('message', event => {
      const message = JSON.parse(event.data)
      if (message.id) {
        const pending = this.pending.get(message.id)
        if (!pending) return
        this.pending.delete(message.id)
        clearTimeout(pending.timer)
        message.error ? pending.reject(new Error(JSON.stringify(message.error))) : pending.resolve(message.result)
      } else for (const handler of this.handlers.get(message.method) ?? []) {
        Promise.resolve().then(() => handler(message.params)).catch(error => this.listenerErrors.push(error.message))
      }
    })
  }
  static async connect(url) {
    const socket = new WebSocket(url)
    await once(socket, 'open')
    return new Cdp(socket)
  }
  on(event, handler) { this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]) }
  send(method, params = {}) {
    const id = ++this.sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new Error(`CDP ${method} timed out`)) }, 15_000)
      this.pending.set(id, { resolve, reject, timer })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }
  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
}

async function poll(work, description, timeout = 20_000) {
  const until = Date.now() + timeout
  let last
  while (Date.now() < until) {
    try { const result = await work(); if (result) return result } catch (error) { last = error.message }
    await pause(100)
  }
  throw new Error(`Timed out: ${description}${last ? ` (${last})` : ''}`)
}
function launch(file, args, env = process.env) {
  const child = spawn(file, args, { cwd: app, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  child.output = ''
  child.on('error', error => { child.launchError = error })
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { child.output = (child.output + chunk.toString()).slice(-12_000) })
  return child
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.launchError) return
  child.kill()
  await Promise.race([once(child, 'exit'), pause(3_000)])
}

function checkSsr(response, html, mode) {
  assert.equal(response.status, 200)
  const policy = response.headers.get(mode === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy')
  assert.ok(policy, `Missing ${mode} CSP header`)
  assert.equal(response.headers.get(mode === 'report-only' ? 'content-security-policy' : 'content-security-policy-report-only'), null)
  const nonce = policy.match(/'nonce-([^']+)'/)?.[1]
  assert.ok(nonce && nonce !== '{{nonce}}', 'SSR must use an actual generated nonce')
  const scripts = [...html.matchAll(/<script\b([^>]*)>/gi)].map(match => match[1])
  const executable = scripts.filter(attributes => !/type=["'](?:application\/(?:json|ld\+json)|text\/plain)["']/i.test(attributes))
  assert.ok(executable.length > 0, 'No executable SSR scripts were found')
  for (const attributes of executable) assert.equal(attributes.match(/\bnonce=["']([^"']+)["']/i)?.[1], nonce, 'SSR executable scripts must share the response nonce')
  return { nonce, scriptCount: executable.length, policy }
}

async function verifyMode(mode, tls) {
  const port = await freePort(), debugPort = await freePort()
  const origin = `http://127.0.0.1:${port}`
  const profile = await mkdtemp(resolve(tmpdir(), 'dda-security-browser-'))
  let server, browser, cdp
  try {
    server = launch(process.execPath, ['--import', pathToFileURL(resolve(app, 'scripts/offline-env.mjs')).href, resolve(app, '.output/server/index.mjs')], {
      ...process.env, NODE_ENV: 'production', HOST: '127.0.0.1', NITRO_HOST: '127.0.0.1', PORT: String(port), NITRO_PORT: String(port),
      APP_ALLOWED_ORIGINS: origin, DDA_CSP_REPORT_ONLY: mode === 'report-only' ? 'true' : 'false',
      DATABASE_URL: 'postgresql://offline:offline@127.0.0.1:9/dda_offline', DDA_OFFLINE_VERIFY: '1',
    })
    await poll(async () => {
      if (server.launchError || server.exitCode !== null) throw new Error(server.launchError?.message ?? server.output)
      return (await fetch(`${origin}/auth/login`, { signal: AbortSignal.timeout(1_000) })).status === 200
    }, `${mode} built server startup`)
    const firstResponse = await fetch(`${origin}/auth/login`), first = checkSsr(firstResponse, await firstResponse.text(), mode)
    const secondResponse = await fetch(`${origin}/auth/login`), second = checkSsr(secondResponse, await secondResponse.text(), mode)
    assert.notEqual(first.nonce, second.nonce, 'Separate SSR responses must have unique nonces')
    browser = launch(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
      '--disable-component-update', '--disable-default-apps', '--disable-sync', '--metrics-recording-only',
      `--ignore-certificate-errors-spki-list=${tls.pin}`, '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
      '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profile}`, 'about:blank'])
    const target = await poll(async () => {
      if (browser.launchError || browser.exitCode !== null) throw new Error(browser.launchError?.message ?? browser.output)
      return (await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json()).find(target => target.type === 'page')
    }, 'isolated headless Chrome startup')
    cdp = await Cdp.connect(target.webSocketDebuggerUrl)
    const exceptions = [], consoleErrors = [], loginRequests = [], socketHandshakes = [], browserLogs = []
    let probeStarted = false
    let documentHeaders
    cdp.on('Runtime.exceptionThrown', value => exceptions.push(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text))
    cdp.on('Runtime.consoleAPICalled', value => { if (['error', 'warning'].includes(value.type)) consoleErrors.push(value.args.map(arg => arg.value ?? arg.description ?? '').join(' ')) })
    cdp.on('Log.entryAdded', ({ entry }) => browserLogs.push({ source: entry.source, level: entry.level, text: entry.text, url: entry.url, probe: probeStarted }))
    cdp.on('Network.responseReceived', value => { if (value.type === 'Document' && value.response.url === `${origin}/auth/login`) documentHeaders = value.response.headers })
    cdp.on('Network.webSocketWillSendHandshakeRequest', value => socketHandshakes.push(value))
    cdp.on('Fetch.requestPaused', async value => {
      if (value.request.url === `${origin}/auth/login?cspProbe=1`) {
        const original = await cdp.send('Fetch.getResponseBody', { requestId: value.requestId })
        const source = original.base64Encoded ? Buffer.from(original.body, 'base64').toString('utf8') : original.body
        const injected = source.replace('</body>', '<script id="csp-smoke-inline-probe">window.__unauthorizedInline=true</script></body>')
        assert.notEqual(injected, source, 'The parser probe must be injected into the actual SSR document')
        await cdp.send('Fetch.fulfillRequest', { requestId: value.requestId, responseCode: value.responseStatusCode,
          responseHeaders: value.responseHeaders.filter(item => !['content-encoding', 'content-length', 'transfer-encoding'].includes(item.name.toLowerCase())),
          body: Buffer.from(injected).toString('base64') })
        return
      }
      loginRequests.push(value.request)
      await cdp.send('Fetch.fulfillRequest', { requestId: value.requestId, responseCode: 401,
        responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
        body: Buffer.from(JSON.stringify({ statusCode: 401, message: 'Offline smoke login fixture' })).toString('base64') })
    })
    await cdp.send('Runtime.enable')
    await cdp.send('Network.enable')
    await cdp.send('Page.enable')
    await cdp.send('Log.enable')
    await cdp.send('Fetch.enable', { patterns: [{ urlPattern: `${origin}/api/auth/login`, requestStage: 'Request' }, { urlPattern: `${origin}/auth/login?cspProbe=1`, requestStage: 'Response' }] })
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `window.__unauthorizedInline=false;window.__cspSmoke={violations:[],probe:location.search.includes('cspProbe=1')}; document.addEventListener('securitypolicyviolation',e=>window.__cspSmoke.violations.push({directive:e.effectiveDirective,blocked:e.blockedURI,disposition:e.disposition,probe:window.__cspSmoke.probe}));` })
    await cdp.send('Page.navigate', { url: `${origin}/auth/login` })
    await poll(() => cdp.evaluate(`Boolean(document.querySelector('form button[type="submit"]') && window.__NUXT__)`), 'SSR login page scripts')
    const browserNonce = (header(documentHeaders, mode === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy') ?? '').match(/'nonce-([^']+)'/)?.[1]
    assert.ok(browserNonce, 'Browser navigation did not receive a nonce CSP')
    const scriptNonces = await cdp.evaluate(`Array.from(document.scripts).filter(s=>!['application/json','application/ld+json','text/plain'].includes(s.type)).map(s=>s.nonce)`)
    assert.ok(scriptNonces.length && scriptNonces.every(nonce => nonce === browserNonce))
    await poll(() => cdp.evaluate(`(() => { const b=Array.from(document.querySelectorAll('button')).find(b=>!b.closest('form')&&b.textContent.trim()==='Register'); b?.click(); return document.querySelectorAll('form input').length===3; })()`), 'hydrated Register tab')
    await cdp.evaluate(`(() => { const values=['browser_smoke_user','offline-browser-only','mismatch']; document.querySelectorAll('form input').forEach((input,i)=>{input.value=values[i];input.dispatchEvent(new Event('input',{bubbles:true}));}); })()`)
    await pause(50)
    await cdp.evaluate(`document.querySelector('form').requestSubmit()`)
    await poll(() => cdp.evaluate(`document.body.innerText.includes('Passwords do not match')`), 'hydrated form validation')
    await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>!b.closest('form')&&b.textContent.trim()==='Log In').click()`)
    await pause(50)
    await cdp.evaluate(`document.querySelector('form').requestSubmit()`)
    await poll(() => cdp.evaluate(`document.body.innerText.includes('Offline smoke login fixture')`), 'same-origin login POST and reactive error display')
    assert.equal(loginRequests.length, 1)
    assert.equal(loginRequests[0].method, 'POST')
    assert.deepEqual(Object.keys(JSON.parse(loginRequests[0].postData)).sort(), ['password', 'username'])
    const images = await cdp.evaluate(`(async()=>{const data='data:image/gif;base64,${gifBase64}';const blob=URL.createObjectURL(new Blob([Uint8Array.from(atob('${gifBase64}'),c=>c.charCodeAt(0))],{type:'image/gif'})); const sources=['https://127.0.0.1:${tls.port}/sprite.gif',data,blob];const result=await Promise.all(sources.map(src=>new Promise(resolve=>{const image=new Image();image.onload=()=>resolve(image.naturalWidth===1);image.onerror=()=>resolve(false);image.src=src;document.body.append(image);})));URL.revokeObjectURL(blob);return result;})()`)
    assert.deepEqual(images, [true, true, true], 'HTTPS, data and blob images must load under the policy')
    await cdp.evaluate(`new Promise(resolve=>{const socket=new WebSocket('ws://127.0.0.1:${port}/api/encounters/offline-smoke/ws');socket.onopen=()=>{socket.close();resolve('open')};socket.onerror=()=>resolve('auth-or-network-denied');socket.onclose=()=>resolve('closed');setTimeout(()=>{socket.close();resolve('timeout')},3000);})`)
    await poll(() => socketHandshakes.length > 0, 'same-origin WebSocket handshake allowed by CSP')
    await pause(100)
    const beforeProbe = await cdp.evaluate('window.__cspSmoke.violations')
    const applicationSecurityLogs = browserLogs.filter(entry => entry.source === 'security' && /content security policy|content-security-policy|violat.*(?:script|connect|img)-src/i.test(entry.text))
    assert.deepEqual(beforeProbe, [], `Unexpected application CSP violations: ${JSON.stringify(beforeProbe)}`)
    assert.deepEqual(applicationSecurityLogs, [], `Unexpected browser CSP messages: ${JSON.stringify(applicationSecurityLogs)}`)
    assert.deepEqual(exceptions, [], 'Application scripts must hydrate without uncaught JavaScript exceptions')
    assert.ok(!consoleErrors.some(text => /hydration.*(?:mismatch|error)/i.test(text)), 'Hydration mismatch reported')
    probeStarted = true
    // Parser insertion exercises browser CSP; DevTools-created scripts can bypass it.
    await cdp.send('Page.navigate', { url: `${origin}/auth/login?cspProbe=1` })
    try {
      await poll(() => cdp.evaluate('window.__cspSmoke.violations.some(v=>v.probe)'), 'intentional inline CSP probe', 3_000)
    } catch (error) {
      const state = await cdp.evaluate(`({inlineRan:window.__unauthorizedInline,violations:window.__cspSmoke.violations,probeNonce:document.querySelector('#csp-smoke-inline-probe')?.nonce,probeHtml:document.querySelector('#csp-smoke-inline-probe')?.outerHTML})`)
      const diagnostics = { mode, ...state, responsePolicy: header(documentHeaders, mode === 'report-only' ? 'content-security-policy-report-only' : 'content-security-policy'), browserLogs }
      process.stdout.write(`CSP probe diagnostics: ${JSON.stringify(diagnostics)}\n`)
      error.diagnostics = diagnostics
      throw error
    }
    const inlineRan = await cdp.evaluate('window.__unauthorizedInline')
    assert.equal(inlineRan, mode === 'report-only', 'The report-only/enforced browser behavior must match the selected policy')
    assert.deepEqual(cdp.listenerErrors, [])
    return { mode, uniqueSsrNonces: true, executableSsrScripts: first.scriptCount, browserNonceMatched: true,
      hydrationAndForms: true, loginBackend: 'intercepted local rejection fixture; no credentials verified',
      externalHttpsSprite: true, dataAndBlobPreviews: true, sameOriginWebSocketHandshake: true,
      unexpectedCspViolations: beforeProbe.length, unauthorizedInlineBlocked: !inlineRan,
      database: 'offline guard enabled; authenticated staging gameplay not exercised' }
  } finally {
    if (cdp) { await cdp.send('Browser.close').catch(() => {}); cdp.socket.close() }
    await stop(browser)
    await stop(server)
    const insideTemporary = relative(tmpdir(), profile)
    assert.ok(insideTemporary && !isAbsolute(insideTemporary) && !insideTemporary.startsWith('..') && insideTemporary.startsWith('dda-security-browser-'))
    await rm(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

await access(resolve(app, '.output/server/index.mjs'))
await access(chrome)
const certificate = tlsFixture()
const images = httpsServer(certificate, (_request, response) => { response.writeHead(200, { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' }); response.end(imageBytes) })
images.listen(0, '127.0.0.1')
await once(images, 'listening')
certificate.port = images.address().port
const report = { runtime: process.version, browser: chrome, scope: 'local built-output browser smoke; no production database or staging verification', checks: [] }
try {
  const failures = []
  for (const mode of ['report-only', 'enforced']) {
    try {
      report.checks.push(await verifyMode(mode, certificate))
      process.stdout.write(`${JSON.stringify(report.checks.at(-1))}\n`)
    } catch (error) {
      failures.push({ mode, error: error.stack ?? String(error), diagnostics: error.diagnostics })
      process.stderr.write(`${mode}: ${error.stack ?? String(error)}\n`)
    }
  }
  report.passed = failures.length === 0
  if (failures.length) { report.failures = failures; process.exitCode = 1 }
} catch (error) {
  report.passed = false
  report.error = error.stack ?? String(error)
  process.stderr.write(`${report.error}\n`)
  process.exitCode = 1
} finally {
  images.closeAllConnections()
  await new Promise(done => images.close(done))
  await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n')
  process.stdout.write(`Browser smoke report: ${reportPath}\n`)
}
