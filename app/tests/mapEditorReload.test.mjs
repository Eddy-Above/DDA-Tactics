import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import { renderToString } from '@vue/server-renderer'
import * as Vue from 'vue'
import ts from 'typescript'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'
const names = ['definePageMeta', 'useRoute', 'useRequestFetch', 'useAsyncData', 'useState', 'useAuth', 'createError', '$fetch']
const original = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of original)
    value === undefined ? delete globalThis[name] : globalThis[name] = value
})
const makeMap = (workshop = false) => ({
  id: 'map', name: 'Kamo River', campaignId: workshop ? null : 'campaign', ownerId: workshop ? 'owner' : null,
  dimensions: { width: 0, depth: 0 }, groundTiles: [], spaceTiles: [], voxels: [], walls: [], doors: [], windows: [], stairs: [], ceilings: []
})
function page(workshop, payload, { failure = null, owner = 'owner' } = {}) {
  const calls = [], map = makeMap(workshop), state = new Map()
  const useState = (key, init) => {
    if (!state.has(key))
      state.set(key, Vue.ref(init())); return state.get(key)
  }
  Object.assign(globalThis, {
    definePageMeta: () => { }, useRoute: () => ({ params: { campaignId: 'campaign', mapId: 'map' } }), useState,
    createError: value => Object.assign(new Error(value.message ?? 'Map request failed'), value),
    $fetch: () => { throw new Error('SSR must retain the viewer session') },
    useRequestFetch: () => async (url) => {
      calls.push(url)
      if (url === '/api/auth/me')
        return { user: { id: owner, username: 'EddySoul' } }
      if (failure)
        throw Object.assign(new Error('Access denied'), { statusCode: failure })
      assert.equal(url, '/api/maps/map')
      return map
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
      const result = payload.get(key)
      return { data: Vue.ref(result.data), error: Vue.ref(result.error) }
    },
  })
  globalThis.useAuth = loadTypeScriptWithMocks('composables/useAuth.ts', {}).useAuth
  const file = workshop ? 'pages/workshop/maps/[mapId].vue' : 'pages/campaigns/[campaignId]/library/maps/[mapId].vue'
  const { descriptor } = parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'editor-reload', inlineTemplate: true })
  const code = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.equal(name, 'vue'); return Vue }, module, module.exports)
  const app = Vue.createSSRApp(module.exports.default)
  app.config.warnHandler = () => { }
  app.component('NuxtLink', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  app.component('EncounterMap', { props: ['initialMap', 'encounter'], setup: props => () => Vue.h('section', { 'data-editor-map': props.initialMap.id, 'data-encounter-map': props.encounter.mapId }) })
  return { app, calls, state }
}
for (const workshop of [false, true]) {
  test(`${workshop ? 'Workshop' : 'campaign'} map editor SSR and hydrated data agree on the editor branch`, async () => {
    const payload = new Map(), ssr = page(workshop, payload)
    const html = await renderToString(ssr.app)
    assert.match(html, /data-editor-map="map" data-encounter-map="map"/)
    assert.doesNotMatch(html, /Loading map editor/)
    assert.match(html, /Kamo River/)
    assert.equal(ssr.calls.filter(url => url === '/api/maps/map').length, 1)
    const hydrate = page(workshop, payload)
    assert.equal(await renderToString(hydrate.app), html)
    assert.equal(hydrate.calls.filter(url => url === '/api/maps/map').length, 0, 'map data comes from the SSR payload')
    const navigation = page(workshop, new Map())
    assert.equal(await renderToString(navigation.app), html)
  })
  test(`${workshop ? 'Workshop' : 'campaign'} map editor keeps access errors out of the loading/editor hydration branches`, async () => {
    const result = page(workshop, new Map(), { failure: 403 })
    await assert.rejects(() => renderToString(result.app), error => error.statusCode === 403)
  })
}
test('Workshop map owner verification remains enforced after request-aware loading', async () => {
  const result = page(true, new Map(), { owner: 'different-owner' })
  await assert.rejects(() => renderToString(result.app), error => error.statusCode === 403)
})
test('auth state is shared within a Nuxt app, isolated between SSR requests and retained in the hydration payload', async () => {
  const contexts = [new Map(), new Map()], requests = []
  let active = 0
  globalThis.useState = (key, init) => {
    const context = contexts[active]
    if (!context.has(key))
      context.set(key, Vue.ref(init()))
    return context.get(key)
  }
  globalThis.useRequestFetch = () => {
    const request = active
    return async (url) => { requests.push([request, url]); return { user: request === 0 ? { id: 'owner', username: 'EddySoul' } : null } }
  }
  globalThis.$fetch = () => { throw new Error('Plain SSR fetch loses cookies') }
  const { useAuth } = loadTypeScriptWithMocks('composables/useAuth.ts', {})
  const owner = useAuth()
  await owner.fetchMe()
  assert.equal(useAuth().user.value.id, 'owner')
  assert.equal(useAuth().initialized.value, true)
  active = 1
  const anonymous = useAuth()
  assert.equal(anonymous.user.value, null)
  assert.equal(anonymous.initialized.value, false)
  await anonymous.fetchMe()
  assert.equal(anonymous.user.value, null)
  assert.equal(owner.user.value.id, 'owner', 'the other request cannot overwrite this request')
  active = 0
  const serialized = JSON.parse(JSON.stringify(Object.fromEntries([...contexts[0]].map(([key, value]) => [key, value.value]))))
  contexts[0] = new Map(Object.entries(serialized).map(([key, value]) => [key, Vue.ref(value)]))
  assert.equal(useAuth().user.value.id, 'owner')
  assert.equal(useAuth().initialized.value, true)
  assert.deepEqual(requests, [[0, '/api/auth/me'], [1, '/api/auth/me']])
})
