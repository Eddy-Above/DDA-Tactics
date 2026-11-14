import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, mock, test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'
import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'

const { playerCharacterRefreshPlan } = loadTypeScript('utils/characterUpdates.ts')
const scope = loadTypeScript('server/utils/databaseScope.ts')
const playerPath = 'pages/campaigns/[campaignId]/player/[tamerId].vue'
const gmPath = 'pages/campaigns/[campaignId]/encounters/[id].vue'
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
afterEach(() => mock.timers.reset())

function message(overrides = {}) {
  return { type: 'character-updated', campaignId: 'campaign', tamerIds: [], digimonIds: ['agu'],
    ownerTamerIds: ['tai'], partnerDigimon: false, evolutionLines: false, ...overrides }
}

function player() {
  const calls = { records: [], loads: [], rewards: [] }
  const activeEncounter = ref(null)
  const deps = {
    campaignId: ref('campaign'), tamer: ref({ id: 'tai' }), activeEncounter,
    ownedDigimonIds: () => new Set(['agu']), playerCharacterRefreshPlan,
    isEmptyPlan: plan => !plan.tamerIds.length && !plan.digimonIds.length && !plan.partnerDigimon && !plan.evolutionLines,
    refreshAffectedRecords: async plan => calls.records.push(plan),
    loadData: () => calls.loads.push('load'),
    handleCampaignRewardMessage: msg => calls.rewards.push(msg), encounterUpdateDebounce: null,
    currentEncounter: ref(null), myRequests: ref([]), encounterGate: { reset() {} },
  }
  return { calls, activeEncounter, deps, ...loadPageFunctions(playerPath, ['handleCampaignUpdateMessage'], deps) }
}

test('an owned quality edit refreshes just that Digimon, with no full-page reload', async () => {
  const f = player()
  f.handleCampaignUpdateMessage(message())
  await flush()
  assert.deepEqual(f.calls.records, [{ digimonIds: ['agu'], tamerIds: [], partnerDigimon: false, evolutionLines: false }])
  assert.deepEqual(f.calls.loads, [])
})

test('other players, opponents and other campaigns cause no player requests', () => {
  const f = player()
  f.handleCampaignUpdateMessage(message({ campaignId: 'other' }))
  f.handleCampaignUpdateMessage(message({ digimonIds: ['gabu'], ownerTamerIds: ['matt'], partnerDigimon: true, evolutionLines: true }))
  f.handleCampaignUpdateMessage(message({ digimonIds: ['foe'], ownerTamerIds: [] }))
  f.handleCampaignUpdateMessage(message({ digimonIds: [], tamerIds: ['matt'], ownerTamerIds: [] }))
  assert.deepEqual(f.calls, { records: [], loads: [], rewards: [] })
})

test('an explicit deletion clears the removed player character without fetching missing sheets', () => {
  const f = player()
  f.activeEncounter.value = { id: 'fight' }
  f.deps.currentEncounter.value = { id: 'fight' }
  f.deps.myRequests.value = [{ id: 'request' }]
  f.handleCampaignUpdateMessage(message({ tamerIds: ['tai'], deletedTamerIds: ['tai'] }))
  assert.equal(f.deps.tamer.value, null)
  assert.equal(f.activeEncounter.value, null)
  assert.equal(f.deps.currentEncounter.value, null)
  assert.deepEqual(f.deps.myRequests.value, [])
  assert.deepEqual(f.calls, { records: [], loads: [], rewards: [] })
})

test('owned tamer edits and new partner/evolution changes have targeted refresh plans', () => {
  const owned = new Set(['agu'])
  assert.deepEqual(playerCharacterRefreshPlan(message({ tamerIds: ['tai', 'matt'], digimonIds: [] }), 'tai', owned),
    { tamerIds: ['tai'], digimonIds: [], partnerDigimon: false, evolutionLines: false })
  assert.deepEqual(playerCharacterRefreshPlan(message({ digimonIds: ['new-partner'], partnerDigimon: true, evolutionLines: true }), 'tai', owned),
    { tamerIds: [], digimonIds: [], partnerDigimon: true, evolutionLines: true })
})

test('newly available owned encounters load without polling, while unrelated encounters do nothing', async () => {
  mock.timers.enable({ apis: ['setTimeout'] })
  const f = player()
  const available = { type: 'encounter-availability-changed', campaignId: 'campaign', encounterId: 'fight', tamerIds: ['tai'], digimonIds: [] }
  f.handleCampaignUpdateMessage({ ...available, tamerIds: ['matt'] })
  mock.timers.tick(1000)
  assert.deepEqual(f.calls.loads, [])
  f.handleCampaignUpdateMessage(available)
  mock.timers.tick(199)
  assert.deepEqual(f.calls.loads, [])
  mock.timers.tick(1)
  assert.deepEqual(f.calls.loads, ['load'])
  f.activeEncounter.value = { id: 'fight' }
  f.handleCampaignUpdateMessage(available)
  mock.timers.tick(1000)
  assert.equal(f.calls.loads.length, 1, 'current combat uses its existing encounter pushes')
  f.handleCampaignUpdateMessage({ ...available, deleted: true })
  mock.timers.tick(200)
  assert.equal(f.calls.loads.length, 2, 'deleting the current encounter discovers the next one')
})

test('player refreshes have no periodic interval and retain reconnect recovery', () => {
  const source = readFileSync(new URL(`../${playerPath}`, import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\bsetInterval\s*\(/)
  assert.match(source, /campaignWs\.onReconnect\(/)
  assert.match(source, /encounterWs\.onReconnect\(/)
})

test('GM views refresh edited records and ignore messages from another campaign', async () => {
  const plans = [], fetched = []
  const gm = loadPageFunctions(gmPath, ['handleCampaignCharacterMessage'], {
    campaignId: ref('campaign'), recordRefreshQueue: { run: task => task() },
    fetchDigimon: async filters => fetched.push(filters), refreshAffectedRecords: async plan => plans.push(plan),
  })
  await gm.handleCampaignCharacterMessage(message({ campaignId: 'other' }))
  assert.deepEqual(plans, [])
  await gm.handleCampaignCharacterMessage(message())
  assert.deepEqual(plans, [{ tamerIds: [], digimonIds: ['agu'], evolutionLines: false, partnerDigimon: false }])
  assert.deepEqual(fetched, [])
  await gm.handleCampaignCharacterMessage(message({ partnerDigimon: true }))
  assert.equal(fetched.length, 1)
})

function notifications() {
  const sent = []
  const subject = loadTypeScriptWithMocks('server/utils/characterUpdates.ts', {
    './encounterRoom': { broadcast: (room, message) => {
      const publish = () => { sent.push({ room, message }) }
      if (!scope.afterDatabaseCommit(publish)) publish()
    } },
  })
  return { ...subject, sent }
}

test('sheet notifications are published only after commit; rolled-back writes publish nothing', async () => {
  const f = notifications(), callbacks = []
  await scope.withDatabase({}, async () => {
    f.notifyCharacterUpdated('campaign', { digimonIds: ['agu'] })
    assert.equal(f.sent.length, 0)
  }, callbacks)
  for (const publish of callbacks) await publish()
  assert.equal(f.sent.length, 1)
  const rolledBack = []
  await assert.rejects(scope.withDatabase({}, async () => {
    f.notifyCharacterUpdated('campaign', { digimonIds: ['gabu'] })
    throw new Error('Save failed')
  }, rolledBack))
  assert.equal(f.sent.length, 1)
  f.notifyCharacterUpdated(null, { digimonIds: ['workshop'] })
  assert.equal(f.sent.length, 1)
})

test('encounter discovery signals include invitations and removals, without leaking staged encounter contents', () => {
  const f = notifications()
  const staged = { id: 'fight', campaignId: 'campaign', phase: 'setup', visibleToPlayers: false,
    participants: [{ type: 'tamer', entityId: 'tai' }, { type: 'digimon', entityId: 'agu' }], pendingRequests: [] }
  f.notifyEncounterAudienceChanged(staged, { ...staged, name: 'Still secret' })
  assert.equal(f.sent.length, 0)
  const published = { ...staged, visibleToPlayers: true }
  f.notifyEncounterAudienceChanged(staged, published)
  assert.deepEqual(f.sent[0], { room: 'campaign:campaign', message: {
    type: 'encounter-availability-changed', campaignId: 'campaign', encounterId: 'fight', deleted: false,
    tamerIds: ['tai'], digimonIds: ['agu'],
  } })
  f.notifyEncounterAudienceChanged(published, { ...published, round: 2, participants: published.participants.map(p => ({ ...p, actionsRemaining: { simple: 0 } })) })
  assert.equal(f.sent.length, 1, 'ordinary combat does not cause campaign-wide reloads')
  const invited = { ...published, pendingRequests: [{ targetTamerId: 'matt' }] }
  f.notifyEncounterAudienceChanged(published, invited)
  assert.deepEqual(f.sent[1].message.tamerIds, ['tai', 'matt'])
  f.notifyEncounterAudienceChanged(invited, null)
  assert.equal(f.sent[2].message.deleted, true)
  assert.deepEqual(f.sent[2].message.tamerIds, ['matt', 'tai'])
})

test('saving a quality through the real Digimon endpoint notifies its owner; failed saves do not', async () => {
  const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
  const originals = new Map(globals.map(name => [name, globalThis[name]]))
  let saved = { id: 'agu', partnerId: 'tai', campaignId: 'campaign', qualities: [], evolutionPathIds: ['greymon'] }
  let failWrite = false
  const sent = []
  const db = {
    select: () => ({ from: () => ({ where: async () => [structuredClone(saved)] }) }),
    update: () => ({ set: fields => ({ where: async () => {
      if (failWrite) throw new Error('Database unavailable')
      saved = { ...saved, ...fields }
    } }) }),
  }
  try {
    Object.assign(globalThis, {
      defineEventHandler: work => work, getRouterParam: () => 'agu', readBody: async event => event.body,
      createError: data => Object.assign(new Error(data.message), data),
    })
    const save = loadTrustedGameplayModule('server/api/digimon/[id].put.ts', {
      '../../db': { db, digimon: { id: 'id' } }, 'drizzle-orm': { eq: (_column, id) => id },
      '../../utils/characterUpdates': { notifyCharacterUpdated: (...args) => sent.push(args) },
    }).default
    const quality = { id: 'flight', ranks: 1 }
    const result = await save({ body: { qualities: [quality] } })
    assert.deepEqual(result.qualities, [quality])
    assert.deepEqual(sent, [['campaign', {
      digimonIds: ['agu'], ownerTamerIds: ['tai'], partnerDigimon: false, evolutionLines: false,
    }]])
    failWrite = true
    await assert.rejects(save({ body: { qualities: [] } }), /Database unavailable/)
    assert.equal(sent.length, 1)
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  }
})
