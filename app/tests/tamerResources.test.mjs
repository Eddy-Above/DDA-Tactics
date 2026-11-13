import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { compileTemplate, parse } from '@vue/compiler-sfc'
import ts from 'typescript'
import { computed, ref, reactive, watch, isRef, h } from 'vue'
import * as Vue from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadTypeScript, loadTypeScriptWithMocks, loadPageFunctions, loadVueComponent } from './helpers/loadTypeScript.mjs'

const { tamerExperience, reconcileTamerExperience, validTotalXp } = loadTypeScript('utils/tamerExperience.ts')
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
  torments: [{ id: 'torment', markedBoxes: 3, cpMarkedBoxes: 1, gmMarkedBoxes: 0, xpBoxCosts: [2, 3] }] })

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
  const beforeAward = form.form.xp
  form.setTotalXp(210)
  assert.equal(form.form.totalXp, 210, 'a new XP award raises lifetime XP')
  assert.equal(form.form.xp, beforeAward + 10)
  const spent = form.minimumTotalXp.value
  form.setTotalXp(spent)
  assert.equal(form.form.xp, 0)
  assert.equal(form.form.totalXp, spent, 'the budget cannot discard XP already spent')
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

test('Total XP owns the budget while purchases, refunds and consumed Inspiration retain their accounting', () => {
  const record = { ...savedTamer(), totalXp: 120 }
  assert.deepEqual(reconcileTamerExperience(record, { totalXp: 130 }), { xp: 18, totalXp: 130 })
  assert.deepEqual(reconcileTamerExperience(record, { totalXp: 112 }), { xp: 0, totalXp: 112 })
  assert.deepEqual(reconcileTamerExperience(record, { xp: 22, xpBonuses: { ...record.xpBonuses, attributes: { willpower: 2 } } }), { xp: 22, totalXp: 120 })
  assert.deepEqual(reconcileTamerExperience(record, { notes: 'unrelated' }), { xp: 8, totalXp: 120 })
  const consumed = { ...record, inspiration: 0, grantedInspiration: 0, xpBonuses: { ...record.xpBonuses, inspiration: 0 } }
  assert.deepEqual(reconcileTamerExperience(consumed, { totalXp: 130 }), { xp: 18, totalXp: 130 }, 'consumed Inspiration never returns to the available balance')
  assert.throws(() => reconcileTamerExperience(record, { xp: 18 }), /adjust Total XP instead/)
  assert.throws(() => reconcileTamerExperience(record, { xp: 18, totalXp: 140 }), /adjust Total XP instead/)
  assert.throws(() => reconcileTamerExperience(record, { totalXp: 111 }), /already spent/)
  assert.throws(() => reconcileTamerExperience(record, { totalXp: null }), /cannot be cleared/)
  for (const invalid of [-1, 1.5, NaN, Infinity, '10']) assert.equal(validTotalXp(invalid), false)
})

test('setting an older character budget accounts for recorded purchases and cannot put them over budget', () => withVueGlobals(() => {
  const form = useTamerForm({ ...savedTamer(), totalXp: null })
  assert.equal(form.minimumTotalXp.value, 52)
  assert.equal(form.setTotalXp(51), false)
  assert.equal(form.form.totalXp, null)
  assert.equal(form.form.xp, 8)
  assert.equal(form.setTotalXp(60), true)
  assert.equal(form.form.totalXp, 60)
  assert.equal(form.form.xp, 8)
}))

test('editing the total recalculates available XP and rejects budgets below spent XP', () => withVueGlobals(() => {
  const form = useTamerForm({ xp: 20 })
  form.spendXPOnAttribute('willpower')
  assert.equal(form.form.xp, 14)
  assert.equal(form.form.totalXp, 20)
  form.setTotalXp(10)
  assert.equal(form.form.xp, 4)
  assert.equal(form.form.totalXp, 10)
  assert.equal(form.setTotalXp(5), false)
  assert.equal(form.form.xp, 4)
  assert.equal(form.form.totalXp, 10)
  assert.match(form.xpBudgetError.value, /6 XP already spent/)
  form.setTotalXp(20)
  assert.equal(form.xpBudgetError.value, null)
  assert.equal(form.form.xp, 14)
  assert.equal(form.form.totalXp, 20)
  form.refundXPFromAttribute('willpower')
  assert.equal(form.form.xp, 20)
  assert.equal(form.form.totalXp, 20)
  for (const invalid of [-1, 1.5, NaN, Infinity]) assert.equal(form.setTotalXp(invalid), false)
  assert.equal(form.form.xp, 20)
  assert.equal(form.form.totalXp, 20)
}))

test('the real sheet lets GMs edit Total XP, hides the editor for players, and shows the derived balance', () => withVueGlobals(async () => {
  const { descriptor } = parse(readFileSync(new URL('../components/TamerFormPage.vue', import.meta.url), 'utf8'))
  function accounting(node) {
    if (node.props?.some(prop => prop.name === 'data-testid' && prop.value?.content === 'xp-accounting')) return node
    for (const child of node.children ?? []) { const found = accounting(child); if (found) return found }
  }
  const block = accounting(descriptor.template.ast)
  assert.ok(block)
  const compiled = compileTemplate({ source: block.loc.source, filename: 'TamerFormPage.vue', id: 'xp-accounting' })
  assert.deepEqual(compiled.errors, [])
  const { outputText } = ts.transpileModule(compiled.code, { compilerOptions: { module: ts.ModuleKind.CommonJS } })
  const module = { exports: {} }
  new Function('require', 'module', 'exports', outputText)(name => {
    assert.equal(name, 'vue')
    return Vue
  }, module, module.exports)
  const form = useTamerForm({ xp: 20 })
  const render = (isLibrary = true) => renderToString(h({ render: module.exports.render, setup: () => ({
    form: form.form, isLibrary, xpLabel: 'Total XP earned:', xpHint: '', minimumTotalXp: form.minimumTotalXp,
    xpBudgetError: form.xpBudgetError, setTotalXp: form.setTotalXp,
  }) }))
  let html = await render()
  assert.match(html, /20 Total XP = 20 available \+ 0 spent/)
  assert.equal((html.match(/<input/g) ?? []).length, 1, 'the GM edits only Total XP')
  assert.ok(html.includes('id="total-xp"'))
  assert.equal((await render(false)).includes('<input'), false, 'players see the balance without an XP editor')
  form.spendXPOnAttribute('willpower')
  assert.match(await render(), /20 Total XP = 14 available \+ 6 spent/)
  form.setTotalXp(30)
  assert.match(await render(), /30 Total XP = 24 available \+ 6 spent/)
  form.refundXPFromAttribute('willpower')
  assert.match(await render(), /30 Total XP = 30 available \+ 0 spent/)
  form.form.totalXp = null
  html = await render()
  assert.ok(html.includes('lifetime XP was not recorded'))
  assert.equal(html.includes('Total XP ='), false)
}))

async function withTamerApi(method, body, run, { gm: isGm = true, campaignId = 'campaign', beforeLock } = {}) {
  const globals = { defineEventHandler: handler => handler, getRouterParam: () => 'tamer', readBody: async () => body,
    createError: data => Object.assign(new Error(data.message), data) }
  const previous = new Map(Object.keys(globals).map(key => [key, globalThis[key]]))
  Object.assign(globalThis, globals)
  let stored = { id: 'tamer', campaignId, ...savedTamer(), totalXp: 120 }
  const table = { id: 'id' }
  let locked = false
  const db = { select: () => {
    const query = { from: () => query, where: () => query, for: mode => {
      assert.equal(mode, 'update')
      if (beforeLock) { stored = beforeLock(stored); beforeLock = undefined }
      locked = true
      return query
    },
      then: (resolve, reject) => Promise.resolve([stored]).then(resolve, reject) }
    return query
  },
    transaction: async work => work(db),
    update: () => ({ set: patch => ({ where: async () => { assert.ok(locked, 'XP validation and saving hold the Tamer row lock'); stored = { ...stored, ...patch } } }) }),
    insert: () => ({ values: row => { stored = row; return { returning: async () => [stored] } } }) }
  try {
    const gmSecurity = { requireCampaignDm: async (_event, id) => {
      assert.equal(id, campaignId)
      if (!isGm) throw Object.assign(new Error('GM access required'), { statusCode: 403 })
    } }
    const gmFields = loadTypeScriptWithMocks('server/utils/libraryGmFields.ts', { './campaignSecurity': gmSecurity })
    const handler = loadTrustedGameplayModule(method === 'PUT' ? 'server/api/tamers/[id].put.ts' : 'server/api/tamers/index.post.ts', {
      '../../db': { db, tamers: table }, '../../utils/ownership': { assertCanModifySandboxCharacter: async () => {} },
      '../../utils/session': { getSessionUser: async () => null }, '../../utils/id': { generateId: () => 'new-tamer' },
      '../../utils/campaignDm': gmSecurity, '../../utils/libraryGmFields': gmFields,
    }).default
    await run(handler, () => stored)
  } finally { for (const [key, value] of previous) value === undefined ? delete globalThis[key] : globalThis[key] = value }
}

test('the real Tamer endpoints persist imports and recalculate balances when the GM edits Total XP', async () => {
  const body = { name: 'Tai', age: 14, campaignId: 'campaign', ...savedTamer() }
  await withTamerApi('POST', body, async handler => assert.equal((await handler({})).totalXp, 60))
  await withTamerApi('POST', { ...body, totalXp: null }, async handler => assert.equal((await handler({})).totalXp, null))
  await withTamerApi('POST', { ...body, totalXp: 150 }, async handler => assert.equal((await handler({})).totalXp, 150))
  const { xp, ...withoutWallet } = body
  await withTamerApi('POST', { ...withoutWallet, totalXp: 150 }, async handler => {
    assert.equal((await handler({})).xp, 98, 'a starting budget calculates the unspent balance when no imported wallet is supplied')
  })
  await withTamerApi('PUT', { totalXp: 130 }, async handler => {
    const result = await handler({})
    assert.equal(result.totalXp, 130)
    assert.equal(result.xp, 18)
  })
  await withTamerApi('PUT', { xp: 22, xpBonuses: { ...body.xpBonuses, attributes: { willpower: 2 } } }, async handler => assert.equal((await handler({})).totalXp, 120))
  await withTamerApi('PUT', { totalXp: -1 }, async handler => assert.rejects(handler({}), /Total XP/))
})

test('the Tamer API rejects independent wallet edits, overspending and invalid balances without writing character data', async () => {
  for (const body of [{ xp: 500 }, { totalXp: null }, { totalXp: 111 }, { xp: 18, totalXp: 500 },
    { xp: -1 }, { xp: 1.5 }, { xp: null }, { xp: '18' }]) {
    await withTamerApi('PUT', body, async (handler, stored) => {
      const before = structuredClone(stored())
      await assert.rejects(handler({}), error => error.statusCode === 400)
      assert.deepEqual(stored(), before)
    })
  }
  await withTamerApi('PUT', { xp: 18, totalXp: 130 }, async handler => assert.equal((await handler({})).totalXp, 130))
  await withTamerApi('PUT', { xp: 0, totalXp: 112 }, async handler => assert.equal((await handler({})).totalXp, 112))
  await withTamerApi('POST', { name: 'Tai', age: 14, campaignId: 'campaign', ...savedTamer(), totalXp: 59 }, async handler => {
    await assert.rejects(handler({}), error => error.statusCode === 400 && /cannot exceed Total XP/.test(error.message))
  })
})

test('players can buy and refund upgrades but cannot change the XP budget through either Tamer endpoint', async () => {
  for (const body of [{ totalXp: 130 }, { totalXp: 130, xp: 18 }, { totalXp: 112, xp: 0 }]) {
    await withTamerApi('PUT', body, async (handler, stored) => {
      const before = structuredClone(stored())
      await assert.rejects(handler({}), error => error.statusCode === 403)
      assert.deepEqual(stored(), before)
    }, { gm: false })
  }
  const record = savedTamer()
  await withTamerApi('PUT', { totalXp: 120, xp: 22, xpBonuses: { ...record.xpBonuses, attributes: { willpower: 2 } } }, async handler => {
    assert.equal((await handler({})).xp, 22, 'refunds need no GM permission')
  }, { gm: false })
  await withTamerApi('PUT', { totalXp: 120, xp: 7, xpBonuses: { ...record.xpBonuses, skills: { dodge: 2, computer: 1 } } }, async handler => {
    assert.equal((await handler({})).xp, 7, 'purchases need no GM permission')
  }, { gm: false })
  await withTamerApi('POST', { name: 'Tai', age: 14, campaignId: 'campaign', ...record }, async handler => {
    await assert.rejects(handler({}), error => error.statusCode === 403)
  }, { gm: false })
  await withTamerApi('POST', { name: 'New player', age: 14, attributes: record.attributes, skills: record.skills, xp: 0, totalXp: 0 }, async handler => {
    assert.equal((await handler({})).totalXp, 0, 'players can still create a starting character')
  }, { gm: false })
  await withTamerApi('PUT', { totalXp: 130 }, async handler => {
    await assert.rejects(handler({}), error => error.statusCode === 403)
  }, { campaignId: null })
})

test('Workshop can import campaign XP and grants without campaign GM access', async () => {
  const body = { name: 'Sora', age: 14, ...savedTamer(), campaignId: null, totalXp: 150,
    grantedInspiration: 3, torments: [{ id: 'fear', gmMarkedBoxes: 2, markedBoxes: 2 }] }
  await withTamerApi('POST', body, async handler => {
    const imported = await handler({})
    for (const field of ['totalXp', 'xp', 'xpBonuses', 'grantedInspiration']) assert.deepEqual(imported[field], body[field])
    assert.equal(imported.campaignId, null)
    assert.equal(imported.torments[0].gmMarkedBoxes, 2)
  }, { campaignId: null, gm: false })
})

test('a stale player save cannot erase a GM reward committed before the row lock is acquired', async () => {
  const record = savedTamer()
  await withTamerApi('PUT', { totalXp: 120, xp: 7, xpBonuses: { ...record.xpBonuses, skills: { dodge: 2, computer: 1 } } }, async (handler, stored) => {
    await assert.rejects(handler({}), error => error.statusCode === 403)
    assert.equal(stored().totalXp, 130)
    assert.equal(stored().xp, 18)
    assert.equal(stored().xpBonuses.skills.computer, undefined)
  }, { gm: false, beforeLock: row => ({ ...row, totalXp: row.totalXp + 10, xp: row.xp + 10 }) })
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
