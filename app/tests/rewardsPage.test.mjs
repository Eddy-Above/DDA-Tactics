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

test('the real reward page renders partner choices, shared Bonus DP and per-partner totals', async () => {
  const form = useRewardGrant({ load: async () => roster, send: async body => ({ ...body, tamerCount: 2, digimonCount: 2, untrackedTamerIds: ['matt'], replayed: false }), newId: () => 'grant' })
  await form.load(); form.selectAll()
  Object.assign(form.amounts, { tamerXp: 10, tamerInspiration: 2, digimonBonusDP: 3 })
  let page = component('pages/campaigns/[campaignId]/library/rewards.vue', form)
  let html = await renderToString(page.app)
  for (const value of ['Tai', 'Matt', 'Agumon', 'Gabumon', 'Select entire group', 'Tamer XP each', 'Tamer Inspiration each', 'Partner Digimon Bonus DP each', 'shared across all evolution stages', '20 XP total', '2 partners', '6 DP total']) assert.ok(html.includes(value), value)
  assert.equal(html.includes('Digimon forms receiving'), false)
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

test('a failed roster load offers a retry without claiming the campaign has no Tamers or allowing grants', async () => {
  let attempts = 0, sent = 0
  const form = useRewardGrant({ load: async () => {
    if (++attempts === 1) throw new Error('Server Error')
    return roster
  }, send: async () => { sent++; throw new Error('must not submit') } })
  assert.equal(await form.load(), false)
  let html = await renderToString(component('pages/campaigns/[campaignId]/library/rewards.vue', form).app)
  assert.ok(html.includes('Server Error'))
  assert.ok(html.includes('Retry loading players'))
  assert.equal(html.includes('No Tamers in this campaign'), false)
  assert.equal(html.includes('Tamer XP each'), false)
  assert.equal(await form.grant(), false)
  assert.equal(sent, 0)
  assert.equal(await form.load(), true)
  html = await renderToString(component('pages/campaigns/[campaignId]/library/rewards.vue', form).app)
  assert.ok(html.includes('Tai'))
  assert.ok(html.includes('Tamer XP each'))
  assert.equal(html.includes('Retry loading players'), false)
})

test('a successful grant remains visible if refreshing recipients fails, and retrying the load does not resubmit rewards', async () => {
  let attempts = 0, sent = 0
  const form = useRewardGrant({ load: async () => {
    if (++attempts === 2) throw new Error('Refresh failed')
    return roster
  }, send: async body => {
    sent++
    return { ...body, tamerCount: 2, digimonCount: 0, affectedDigimonIds: [], untrackedTamerIds: [], replayed: false }
  }, newId: () => 'successful-grant' })
  await form.load(); form.selectAll(); form.amounts.tamerXp = 10
  assert.equal(await form.grant(), true)
  let html = await renderToString(component('pages/campaigns/[campaignId]/library/rewards.vue', form).app)
  assert.ok(html.includes('Rewards granted.'))
  assert.ok(html.includes('Retry loading players'))
  assert.equal(await form.grant(), false)
  assert.equal(form.amounts.tamerXp, 0)
  await form.load()
  html = await renderToString(component('pages/campaigns/[campaignId]/library/rewards.vue', form).app)
  assert.ok(html.includes('Rewards granted.'))
  assert.equal(html.includes('Refresh failed'), false)
  assert.equal(sent, 1)
})
