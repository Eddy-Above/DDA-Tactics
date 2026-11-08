import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { compileScript, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useRewardGrant } = loadTypeScript('composables/useRewardGrant.ts')
const names = ['definePageMeta', 'useCampaignContext', 'ref', 'computed', 'onMounted']
const originals = new Map(names.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of originals) value === undefined ? delete globalThis[name] : globalThis[name] = value })

function component(path, form) {
  const metadata = []
  Object.assign(globalThis, { definePageMeta: value => metadata.push(value), useCampaignContext: () => ({ campaignId: Vue.ref('campaign') }),
    ref: Vue.ref, computed: Vue.computed, onMounted: () => {} })
  const { descriptor } = parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
  const compiled = compileScript(descriptor, { id: 'reward-page-test', inlineTemplate: true })
  const { outputText } = ts.transpileModule(compiled.content, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    if (name === 'vue') return Vue
    if (name === '~/composables/useRewardGrant') return { useRewardGrant: () => form }
    throw new Error(`Unexpected UI import: ${name}`)
  }, module, module.exports)
  const app = Vue.createSSRApp(module.exports.default)
  app.component('NuxtLink', { props: ['to'], setup: (props, { slots }) => () => Vue.h('a', { href: props.to }, slots.default?.()) })
  return { app, metadata }
}

const roster = { tamers: [
  { id: 'tai', name: 'Tai', xp: 3, totalXp: 10, inspiration: 2 }, { id: 'matt', name: 'Matt', xp: 5, totalXp: null, inspiration: 1 },
], digimon: [
  { id: 'agu', partnerId: 'tai', name: 'Agumon', stage: 'rookie', bonusDP: 2 },
  { id: 'gabu', partnerId: 'matt', name: 'Gabumon', stage: 'rookie', bonusDP: 3 },
] }

test('the DM Library renders Encounters and Grant Rewards links in the campaign alongside the existing tools', async () => {
  const page = component('pages/campaigns/[campaignId]/library/index.vue')
  const html = await renderToString(page.app)
  assert.match(html, /href="\/campaigns\/campaign\/encounters"/)
  assert.match(html, /href="\/campaigns\/campaign\/library\/rewards"/)
  for (const name of ['Tamers', 'Digimon', 'Evolution Lines', 'Maps', 'Encounters', 'Grant Rewards']) assert.ok(html.includes(name))
  assert.deepEqual(page.metadata[0].middleware, ['campaign-access', 'dm-access'])
})

test('the real reward page renders selected players, exact forms, per-person amounts and group totals', async () => {
  const form = useRewardGrant({ load: async () => roster, send: async body => ({ ...body, tamerCount: 2, digimonCount: 2, untrackedTamerIds: ['matt'], replayed: false }), newId: () => 'grant' })
  await form.load(); form.selectAll()
  Object.assign(form.amounts, { tamerXp: 10, tamerInspiration: 2, digimonBonusDP: 3 })
  let page = component('pages/campaigns/[campaignId]/library/rewards.vue', form)
  let html = await renderToString(page.app)
  for (const value of ['Tai', 'Matt', 'Agumon', 'Gabumon', 'Select entire group', 'Tamer XP each', 'Tamer Inspiration each', 'Bonus DP per selected Digimon form', '20 XP total', '6 DP total']) assert.ok(html.includes(value), value)
  assert.equal((html.match(/type="checkbox" checked/g) ?? []).length, 4)
  assert.deepEqual(page.metadata[0].middleware, ['campaign-access', 'dm-access'])
  await form.grant()
  page = component('pages/campaigns/[campaignId]/library/rewards.vue', form)
  html = await renderToString(page.app)
  assert.match(html, /role="status"/)
  assert.ok(html.includes('Rewards granted.'))
  assert.ok(html.includes('Their available XP was granted'))
})

test('a GM-password session can verify access on the reward page instead of exposing reward controls to an unverified session', async () => {
  const form = useRewardGrant({ load: async () => { throw Object.assign(new Error('GM access required'), { statusCode: 403 }) }, send: async () => { throw new Error('must not submit') } })
  await form.load()
  const html = await renderToString(component('pages/campaigns/[campaignId]/library/rewards.vue', form).app)
  assert.match(html, /type="password"/)
  assert.ok(html.includes('Verify GM access'))
  assert.equal(html.includes('Tamer XP each'), false)
})
