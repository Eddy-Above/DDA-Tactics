import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'
const globals = ['definePageMeta', 'useRoute', 'useRequestFetch', 'useAsyncData', '$fetch']
const originals = new Map(globals.map(key => [key, globalThis[key]]))
afterEach(() => {
  for (const [key, value] of originals)
    value === undefined ? delete globalThis[key] : globalThis[key] = value
})
const maps = [{ id: 'crossing', name: 'Crossing', description: '', groundTiles: [], walls: [{ id: 'wall' }] },
{ id: 'town', name: 'Town', description: '', groundTiles: [{ x: 0, y: 0, z: 0 }], walls: [] }]
function page(payload, { failure = false } = {}) {
  const calls = []
  Object.assign(globalThis, {
    definePageMeta: () => { }, useRoute: () => ({ params: { campaignId: 'campaign' } }),
    $fetch: () => { throw new Error('Plain SSR fetch drops the session cookie') },
    useRequestFetch: () => async (url, options) => {
      calls.push({ url, options, requestCookie: 'signed-viewer-session' })
      if (failure)
        throw new Error('Access denied')
      return maps
    },
    useAsyncData: async (key, load) => {
      key = typeof key === 'function' ? key() : key
      if (!payload.has(key)) {
        try {
          payload.set(key, { data: await load(), error: null })
        }
        catch (error) {
          payload.set(key, { data: null, error })
        }
      }
      const cached = payload.get(key)
      return { data: Vue.ref(cached.data), error: Vue.ref(cached.error) }
    },
  })
  const filename = 'pages/campaigns/[campaignId]/library/maps/index.vue'
  const { descriptor } = parse(readFileSync(new URL(`../${filename}`, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'campaign-map-hydration', inlineTemplate: true })
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => {
    if (name === 'vue')
      return Vue
    if (name === '~/utils/mapContentBounds')
      return loadTypeScript('utils/mapContentBounds.ts')
    if (name === '~/composables/useMap')
      return loadTypeScript('composables/useMap.ts')
    if (name === '~/composables/useLibraryImportExport')
      return { useLibraryImportExport: () => ({}) }
    throw new Error(`Unexpected import: ${name}`)
  }, module, module.exports)
  const app = Vue.createSSRApp(module.exports.default)
  app.component('NuxtLink', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  return { app, calls }
}
test('campaign maps use request-aware SSR data, reuse the payload on reload and match client navigation', async () => {
  const payload = new Map(), ssr = page(payload)
  const serverHtml = await renderToString(ssr.app)
  assert.deepEqual(ssr.calls, [{ url: '/api/maps', options: { query: { campaignId: 'campaign' } }, requestCookie: 'signed-viewer-session' }])
  assert.match(serverHtml, /class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4"/)
  for (const name of ['Crossing', 'Town'])
    assert.ok(serverHtml.includes(name))
  assert.doesNotMatch(serverHtml, /Loading maps|No maps yet/)
  const hydrate = page(payload)
  assert.equal(await renderToString(hydrate.app), serverHtml)
  assert.equal(hydrate.calls.length, 0, 'hydration reuses the server payload')
  const navigate = page(new Map())
  assert.equal(await renderToString(navigate.app), serverHtml)
  assert.equal(navigate.calls.length, 1)
})
test('a failed initial map request renders an error instead of a different empty-state layout', async () => {
  const result = page(new Map(), { failure: true })
  const html = await renderToString(result.app)
  assert.match(html, /role="alert"/)
  assert.doesNotMatch(html, /No maps yet|grid-cols-3/)
})
