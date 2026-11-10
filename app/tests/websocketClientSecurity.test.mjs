import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { markRaw, nextTick, ref, watch } from 'vue'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const names = ['ref', 'watch', 'onMounted', 'onUnmounted', 'WebSocket', 'window']
const saved = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of saved) value === undefined ? delete globalThis[name] : globalThis[name] = value })

test('1008 stops retries and discards queued writes, while ordinary reconnects still resync', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const sockets = [], mounted = [], unmounted = []
  class FakeSocket {
    static OPEN = 1
    constructor(url) { markRaw(this); this.url = url; this.readyState = 0; this.sent = []; sockets.push(this) }
    send(raw) { this.sent.push(JSON.parse(raw)) }
    close() { this.readyState = 3; this.onclose?.({ code: 1000 }) }
    open() { this.readyState = 1; this.onopen() }
    serverClose(code) { this.readyState = 3; this.onclose({ code }) }
  }
  Object.assign(globalThis, { ref, watch, onMounted: fn => mounted.push(fn), onUnmounted: fn => unmounted.push(fn), WebSocket: FakeSocket, window: { location: { protocol: 'https:', host: 'game.example' } } })
  const module = loadTypeScriptWithMocks('composables/useMapWebSocket.ts', {})
  const id = ref('enc')
  const client = module.useMapWebSocket(id)
  mounted.forEach(fn => fn())
  let resynced = 0
  client.onReconnect(() => { resynced++ })
  sockets[0].open()
  sockets[0].serverClose(1006)
  client.send({ type: 'map-edited', encounterId: 'enc' })
  t.mock.timers.tick(1000)
  sockets[1].open()
  assert.equal(resynced, 1)
  sockets[1].serverClose(1008)
  client.send({ type: 'map-edited', encounterId: 'enc' })
  assert.equal(client.accessRequired.value, true)
  assert.match(client.accessError.value, /Verify access/)
  t.mock.timers.tick(100_000)
  assert.equal(sockets.length, 2)
  id.value = 'another'
  await nextTick()
  assert.equal(client.accessRequired.value, false)
  sockets[2].open()
  assert.equal(sockets[2].sent.length, 0, 'writes from the rejected connection cannot replay after navigation')
  unmounted.forEach(fn => fn())
})
