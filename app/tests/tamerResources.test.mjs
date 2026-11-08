import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref, reactive, watch, isRef, h } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadTypeScript, loadTypeScriptWithMocks, loadPageFunctions, loadVueComponent } from './helpers/loadTypeScript.mjs'

const { tamerExperience, nextTotalXp, validTotalXp } = loadTypeScript('utils/tamerExperience.ts')
const { useTamers } = loadTypeScript('composables/useTamers.ts')
const { useTamerForm } = loadTypeScript('composables/useTamerForm.ts')
const player = 'pages/campaigns/[campaignId]/player/[tamerId].vue'
const gm = 'pages/campaigns/[campaignId]/encounters/[id].vue'

async function withVueGlobals(fn) {
  const methods = { ref, computed, reactive, watch, isRef }
  const previous = new Map(Object.keys(methods).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, methods)
  try { return await fn() } finally {
    for (const [key, value] of previous) value === undefined ? delete globalThis[key] : globalThis[key] = value
  }
}

function initializer(path, name, deps) {
  const { descriptor } = parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
  const source = ts.createSourceFile(path, descriptor.scriptSetup.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const declaration = source.statements.filter(ts.isVariableStatement).flatMap(statement => [...statement.declarationList.declarations])
    .find(node => node.name.getText(source) === name)
  assert.ok(declaration?.initializer, `Missing ${name}`)
  const { outputText } = ts.transpileModule(`const value = ${declaration.initializer.getText(source)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
  return new Function(...Object.keys(deps), `${outputText}; return value`)(...Object.values(deps))
}

const savedTamer = () => ({ xp: 8, inspiration: 1, grantedInspiration: 4,
  attributes: { willpower: 4 }, skills: { dodge: 1 },
  xpBonuses: { attributes: { willpower: 3 }, skills: { dodge: 2 }, inspiration: 2 },
  torments: [{ markedBoxes: 3, cpMarkedBoxes: 1, gmMarkedBoxes: 0, xpBoxCosts: [2, 3] }] })

test('XP budget reconciliation excludes starting CP and GM grants when distinguishing awards from refunds', () => {
  const record = savedTamer()
  // Attributes: 10+12+14; skills: 2+3; Inspiration: 2+4; Torment boxes: 2+3.
  assert.deepEqual(tamerExperience(record), { available: 8, spent: 52, total: 60 })
  record.grantedInspiration = 100
  assert.equal(tamerExperience(record).total, 60)
  assert.deepEqual(tamerExperience({ xp: 10, inspiration: 1, attributes: { willpower: 7 }, skills: { dodge: 5 },
    torments: [{ cpMarkedBoxes: 3, markedBoxes: 3 }, { gmMarkedBoxes: 5, markedBoxes: 5 }] }), { available: 10, spent: 0, total: 10 })
})

test('Torment XP uses receipts even after GM marks change, and reconstructs older records without receipts', () => {
  assert.equal(tamerExperience({ torments: [{ markedBoxes: 5, cpMarkedBoxes: 2, gmMarkedBoxes: 4, xpBoxCosts: [3, 4] }] }).spent, 7)
  assert.equal(tamerExperience({ torments: [{ markedBoxes: 5, cpMarkedBoxes: 2, gmMarkedBoxes: 3 }] }).spent, 9)
  assert.equal(tamerExperience({ torments: [{ markedBoxes: 5, gmMarkedBoxes: 3, xpBoxCosts: [] }] }).spent, 0)
})

test('missing records and sparse old XP maps produce finite totals', () => {
  assert.deepEqual(tamerExperience(null), { available: 0, spent: 0, total: 0 })
  assert.deepEqual(tamerExperience({ xpBonuses: { inspiration: 2 } }), { available: 0, spent: 6, total: 6 })
  assert.deepEqual(tamerExperience({ xp: NaN, xpBonuses: { attributes: { willpower: NaN }, skills: null } }), { available: 0, spent: 0, total: 0 })
})

test('real form spending and refunds preserve Total XP and free grants leave it unchanged', () => withVueGlobals(() => {
  const form = useTamerForm({ xp: 200 })
  const total = () => assert.equal(form.form.totalXp, 200)
  total()
  form.spendXPOnAttribute('willpower'); total()
  form.spendXPOnAttribute('willpower'); total()
  form.spendXPOnSkill('computer'); total()
  form.spendXPOnSkill('computer'); total()
  form.spendXPOnInspiration(); total()
  form.grantInspiration(); total()
  form.refundXPFromInspiration(); total()
  form.refundXPFromSkill('computer'); total()
  form.refundXPFromAttribute('willpower'); total()
  form.torments.value = [{ markedBoxes: 0, originalMarkedBoxes: 0, cpMarkedBoxes: 0, gmMarkedBoxes: 0, totalBoxes: 5, xpBoxCosts: [] }]
  const handlers = loadPageFunctions('components/TamerFormPage.vue', ['toggleTormentBox'], { form: form.form, getTormentBoxCost: form.getTormentBoxCost })
  handlers.toggleTormentBox(form.torments.value[0], 1); total()
  handlers.toggleTormentBox(form.torments.value[0], 2); total()
  handlers.toggleTormentBox(form.torments.value[0], 2); total()
  form.form.inspiration = 0
  form.xpBonuses.inspiration = 0
  total()
  form.setAvailableXp(form.form.xp + 10)
  assert.equal(form.form.totalXp, 210, 'a new XP award raises lifetime XP')
  form.setAvailableXp(0)
  assert.equal(form.form.totalXp, 210, 'reducing available XP never erases earned XP')
}))

test('the real player Inspiration values show XP-enhanced Willpower and retain the live encounter balance', () => withVueGlobals(async () => {
  const record = ref(savedTamer()), participant = ref({ currentInspiration: 7 }), rules = ref({})
  const calcTamerStats = useTamers().calculateDerivedStats
  const deps = { computed, tamer: record, myTamerParticipant: participant, eddySoulRules: rules, calcTamerStats }
  deps.tamerStats = initializer(player, 'tamerStats', deps)
  const current = initializer(player, 'currentCombatInspiration', deps)
  const maximum = initializer(player, 'maxCombatInspiration', deps)
  const totalXp = initializer(player, 'totalXp', deps)
  assert.equal(current.value, 7)
  assert.equal(maximum.value, 7, 'base Willpower 4 plus 3 XP ranks gives 7, not 4')
  assert.equal(totalXp.value, null, 'older characters do not get a fabricated lifetime total')
  record.value.totalXp = 120
  assert.equal(totalXp.value, 120)
  const Panel = loadVueComponent('components/InspirationPanel.vue')
  let html = await renderToString(h(Panel, { currentInspiration: current.value, maxInspiration: maximum.value, actOfInspirationCost: 4, fatefulInterventionCost: 7, loading: false }))
  assert.match(html, /7\/7/)
  participant.value.currentInspiration = 0
  assert.equal(current.value, 0, 'zero Inspiration must not fall back to the stored sheet pool')
  html = await renderToString(h(Panel, { currentInspiration: current.value, maxInspiration: maximum.value, actOfInspirationCost: 4, fatefulInterventionCost: 7, loading: false }))
  assert.match(html, /0\/7/)
  assert.equal((html.match(/disabled/g) ?? []).length >= 2, true)
  record.value.xpBonuses.attributes.willpower = 2
  assert.equal(maximum.value, 6, 'sheet updates recompute the cap')
  participant.value = null
  assert.equal(current.value, 7, 'outside an encounter, base, purchased and granted Inspiration form the pool')
  record.value = null
  assert.equal(current.value, 0)
  assert.equal(maximum.value, 1)
}))

test('lifetime totals survive consumed Inspiration and do not count refunds or unrelated edits as awards', () => {
  const record = { ...savedTamer(), totalXp: 120 }
  assert.equal(nextTotalXp(record, { inspiration: 0, grantedInspiration: 0, xpBonuses: { ...record.xpBonuses, inspiration: 0 } }), 120)
  assert.equal(nextTotalXp(record, { xp: 18 }), 130)
  assert.equal(nextTotalXp(record, { xp: 0 }), 120)
  assert.equal(nextTotalXp(record, { xp: 22, xpBonuses: { ...record.xpBonuses, attributes: { willpower: 2 } } }), 120)
  assert.equal(nextTotalXp(record, { notes: 'unrelated' }), 120)
  assert.equal(nextTotalXp(record, { totalXp: 140 }), 140)
  assert.equal(nextTotalXp({ ...record, totalXp: null }, { xp: 50 }), null)
  assert.equal(nextTotalXp(record, { totalXp: 0 }), 0)
  for (const invalid of [-1, 1.5, NaN, Infinity, '10']) assert.equal(validTotalXp(invalid), false)
})

test('legacy form totals remain unknown until entered, then future XP awards are tracked', () => withVueGlobals(() => {
  const form = useTamerForm({ xp: 8, totalXp: null })
  form.setAvailableXp(18)
  assert.equal(form.form.totalXp, null)
  form.form.totalXp = 150
  form.setAvailableXp(28)
  assert.equal(form.form.totalXp, 160)
  form.spendXPOnSkill('computer')
  assert.equal(form.form.totalXp, 160)
}))

async function withTamerApi(method, body, run) {
  const globals = { defineEventHandler: handler => handler, getRouterParam: () => 'tamer', readBody: async () => body,
    createError: data => Object.assign(new Error(data.message), data) }
  const previous = new Map(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  let stored = { id: 'tamer', ...savedTamer(), totalXp: 120 }
  const table = { id: 'id' }
  const db = { select: () => ({ from: () => ({ where: async () => [stored] }) }),
    update: () => ({ set: patch => ({ where: async () => { stored = { ...stored, ...patch } } }) }),
    insert: () => ({ values: row => { stored = row; return { returning: async () => [stored] } } }) }
  try {
    const handler = loadTypeScriptWithMocks(method === 'PUT' ? 'server/api/tamers/[id].put.ts' : 'server/api/tamers/index.post.ts', {
      '../../db': { db, tamers: table }, '../../utils/ownership': { assertCanModifySandboxCharacter: async () => {} },
      '../../utils/session': { getSessionUser: async () => null }, '../../utils/id': { generateId: () => 'new-tamer' },
    }).default
    await run(handler, () => stored)
  } finally { for (const [key, value] of previous) value === undefined ? delete globalThis[key] : globalThis[key] = value }
}

test('the real Tamer endpoints persist starting totals, preserve legacy unknown totals, and track later awards', async () => {
  const body = { name: 'Tai', age: 14, ...savedTamer() }
  await withTamerApi('POST', body, async handler => assert.equal((await handler({})).totalXp, 60))
  await withTamerApi('POST', { ...body, totalXp: null }, async handler => assert.equal((await handler({})).totalXp, null))
  await withTamerApi('POST', { ...body, totalXp: 150 }, async handler => assert.equal((await handler({})).totalXp, 150))
  await withTamerApi('PUT', { xp: 18 }, async handler => assert.equal((await handler({})).totalXp, 130))
  await withTamerApi('PUT', { xp: 22, xpBonuses: { ...body.xpBonuses, attributes: { willpower: 2 } } }, async handler => assert.equal((await handler({})).totalXp, 120))
  await withTamerApi('PUT', { totalXp: -1 }, async handler => assert.rejects(handler({}), /Total XP/))
})

test('character bundle export/import preserves lifetime XP and older bundles retain an unknown total', async () => {
  const created = []
  const methods = { useTamers: () => ({ createTamer: async data => { created.push(data); return { id: 'imported' } } }),
    useDigimon: () => ({}), useEvolution: () => ({}), $fetch: async url => url === '/api/digimon' ? { data: [] } : [] }
  const previous = new Map(Object.keys(methods).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, methods)
  try {
    const api = loadTypeScript('composables/useCharacterBundle.ts').useCharacterBundle()
    const bundle = await api.buildCharacterBundle({ id: 'tai', name: 'Tai', age: 14, ...savedTamer(), totalXp: 150 })
    assert.equal(bundle.tamer.totalXp, 150)
    assert.deepEqual((await api.importBundle(bundle, { sandbox: true })).errors, [])
    assert.equal(created[0].totalXp, 150)
    delete bundle.tamer.totalXp
    await api.importBundle(bundle, { sandbox: true })
    assert.equal(created[1].totalXp, null)
  } finally { for (const [key, value] of previous) value === undefined ? delete globalThis[key] : globalThis[key] = value }
})

test('GM participant cards use the same XP-enhanced Inspiration maximum', () => withVueGlobals(() => {
  const record = ref(savedTamer())
  const { getTamerMaxInspiration } = loadPageFunctions(gm, ['getTamerMaxInspiration'], {
    tamerMap: computed(() => new Map([['tamer', record.value]])), eddySoulRules: ref({}), calcTamerStats: useTamers().calculateDerivedStats,
  })
  assert.equal(getTamerMaxInspiration({ entityId: 'tamer' }), 7)
  assert.equal(getTamerMaxInspiration({ entityId: 'missing' }), 1)
}))
