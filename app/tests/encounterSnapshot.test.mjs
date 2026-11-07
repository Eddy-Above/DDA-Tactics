import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, mock, test } from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const snapshot = loadTypeScript('utils/encounterSnapshot.ts')
const records = loadTypeScript('utils/combatRecords.ts')
const {
  BATTLE_LOG_WINDOW, trimBattleLog, normalizeActionsRemaining, shapeActionResponse, newBattleLogEntries,
  battleLogTotal, createEncounterSnapshotGate, needsFullReload, isEncounterShownToTamer,
} = snapshot
const { planRecordRefresh, isEmptyPlan, mergeRecordsById, ACTION_RECORD_HINTS } = records
const PLAYER_PAGE = 'pages/campaigns/[campaignId]/player/[tamerId].vue'

const at = (ms) => new Date(Date.UTC(2026, 10, 7, 12, 0, 0, ms)).toISOString()
const entries = (from, to) => Array.from({ length: to - from }, (_, i) => ({ id: `log-${from + i}` }))

function encounter(overrides = {}) {
  return {
    id: 'enc-1', phase: 'combat', visibleToPlayers: true, updatedAt: at(0), round: 1,
    participants: [
      { id: 'tamer-p', type: 'tamer', entityId: 'tamer-1', currentInspiration: 2, actionsRemaining: { simple: 2 } },
      { id: 'mon-p', type: 'digimon', entityId: 'agumon', evolutionLineId: 'line-1', maxWounds: 10, totalHealth: 10, actionsRemaining: { simple: 2 } },
      { id: 'foe-p', type: 'digimon', entityId: 'foe', isEnemy: true, maxWounds: 12, actionsRemaining: { simple: 2 } },
    ],
    pendingRequests: [], requestResponses: [], battleLog: [], turnOrder: ['tamer-p'], currentTurnIndex: 0,
    participantPositions: { 'tamer-p': { x: 0, y: 0, z: 0 } }, destructibleStates: [], version: 3,
    ...overrides,
  }
}

// --- battle log ----------------------------------------------------------------------------------

test('payload log is trimmed to the window with its true length', () => {
  const trimmed = trimBattleLog(entries(0, 70))
  assert.equal(trimmed.entries.length, BATTLE_LOG_WINDOW)
  assert.equal(trimmed.entries[0].id, 'log-20')
  assert.equal(trimmed.total, 70)
  assert.equal(trimmed.wasTrimmed, true)
  assert.equal(trimBattleLog(entries(0, 5)).wasTrimmed, false)
})

test('new battle-log entries are counted from the true length, past the 50-entry window', () => {
  // The page holds a trimmed copy of a 60-entry log; the action response is the untrimmed 63.
  const held = shapeActionResponse(encounter({ battleLog: entries(0, 60) }))
  assert.equal(held.battleLog.length, 50)
  assert.equal(battleLogTotal(held), 60)

  const response = encounter({ battleLog: entries(0, 63) })
  const added = newBattleLogEntries(battleLogTotal(held), response)
  assert.deepEqual(added.map(e => e.id), ['log-60', 'log-61', 'log-62'])
  // The old page code sliced the response by the trimmed length and returned 13 old entries.
  assert.equal(response.battleLog.slice(held.battleLog.length).length, 13)

  assert.deepEqual(newBattleLogEntries(held, shapeActionResponse(response)).map(e => e.id), ['log-60', 'log-61', 'log-62'])
  assert.deepEqual(newBattleLogEntries(63, response), [])
})

test('an action response keeps the live room state the page already holds', () => {
  const current = encounter({ participantPositions: { a: { x: 9, y: 9, z: 0 } }, version: 12 })
  const raw = encounter({ participantPositions: { a: { x: 1, y: 1, z: 0 } }, version: 3, battleLog: entries(0, 4) })
  const shaped = shapeActionResponse(raw, current)
  assert.deepEqual(shaped.participantPositions, { a: { x: 9, y: 9, z: 0 } }, 'the row lags the room, so a move is not undone')
  assert.equal(shaped.version, 12)
  assert.equal(shaped._battleLogTotal, 4)
  assert.deepEqual(shapeActionResponse(raw, encounter({ id: 'other', version: 99 })).participantPositions, raw.participantPositions)
})

test('legacy actionsRemaining is migrated the same way for pushes and responses', () => {
  const [p] = normalizeActionsRemaining([{ id: 'a', actionsRemaining: { simple: 1, complex: 1 } }])
  assert.deepEqual(p.actionsRemaining, { simple: 1 })
  assert.deepEqual(normalizeActionsRemaining([{ id: 'b' }])[0].actionsRemaining, { simple: 2 })
})

// --- ordering ------------------------------------------------------------------------------------

test('a response that was overtaken by a newer push is dropped', () => {
  const gate = createEncounterSnapshotGate()
  assert.equal(gate.accept(encounter({ updatedAt: at(500) }), { source: 'ws', version: 10 }), true)
  assert.equal(gate.accept(encounter({ updatedAt: at(200) }), { source: 'action' }), false, 'older action response')
  assert.equal(gate.accept(encounter({ updatedAt: at(100) }), { source: 'fetch' }), false, 'older GET')
  assert.equal(gate.accept(encounter({ updatedAt: at(900) }), { source: 'action' }), true)
  assert.equal(gate.accept(encounter({ updatedAt: at(700) }), { source: 'ws', version: 11 }), false,
    'a push built before a newer response is applied is stale even with a newer version')
})

test('an equal timestamp passes: it cannot be proven stale', () => {
  const gate = createEncounterSnapshotGate()
  assert.equal(gate.accept(encounter({ updatedAt: at(300) }), { source: 'action' }), true)
  assert.equal(gate.accept(encounter({ updatedAt: at(300) }), { source: 'ws', version: 1 }), true)
})

test('the existing monotonic push version guard still applies', () => {
  const gate = createEncounterSnapshotGate()
  assert.equal(gate.accept(encounter({ updatedAt: at(100) }), { source: 'ws', version: 50 }), true)
  assert.equal(gate.accept(encounter({ updatedAt: at(200) }), { source: 'ws', version: 49 }), false)
  assert.equal(gate.accept(encounter({ updatedAt: at(300) }), { source: 'ws', version: 50 }), true)
})

test('switching encounters starts a fresh history; a snapshot without a stamp is accepted', () => {
  const gate = createEncounterSnapshotGate()
  assert.equal(gate.accept(encounter({ updatedAt: at(900) }), { source: 'ws', version: 99 }), true)
  assert.equal(gate.accept(encounter({ id: 'enc-2', updatedAt: at(1) }), { source: 'ws', version: 1 }), true)
  assert.equal(gate.accept(encounter({ id: 'enc-2', updatedAt: undefined }), { source: 'action' }), true)
  assert.equal(gate.accept(null, { source: 'fetch' }), false)
})

// --- which encounters belong on the dashboard ----------------------------------------------------

test('an unpublished, ended or unrelated encounter needs the full load', () => {
  const partners = new Set(['agumon'])
  assert.equal(needsFullReload(encounter(), 'tamer-1', partners), false)
  assert.equal(needsFullReload(encounter({ visibleToPlayers: false }), 'tamer-1', partners), true)
  assert.equal(needsFullReload(encounter({ phase: 'ended' }), 'tamer-1', partners), true)
  assert.equal(needsFullReload(encounter({ participants: [], pendingRequests: [] }), 'tamer-1', partners), true)
  assert.equal(isEncounterShownToTamer(encounter({ participants: [], pendingRequests: [{ targetTamerId: 'tamer-1' }] }), 'tamer-1', partners), true,
    'a prompt waiting on me keeps it shown')
})

// --- records -------------------------------------------------------------------------------------

const known = (...ids) => ({ tamerId: 'tamer-1', knownDigimonIds: new Set(ids) })

test('evolution refetches the new record, the partner list and the evolution lines only', () => {
  const before = encounter()
  const after = encounter({
    participants: before.participants.map(p => (p.id === 'mon-p' ? { ...p, entityId: 'greymon' } : p)),
  })
  const plan = planRecordRefresh(before, after, known('agumon', 'foe'))
  assert.deepEqual(plan.digimonIds, ['greymon'])
  assert.equal(plan.evolutionLines, true)
  assert.equal(plan.partnerDigimon, true)
  assert.deepEqual(plan.tamerIds, [])
})

test('devolving to a form the page already holds still refreshes that record', () => {
  const before = encounter({ participants: encounter().participants.map(p => (p.id === 'mon-p' ? { ...p, entityId: 'greymon' } : p)) })
  const after = encounter()
  const plan = planRecordRefresh(before, after, known('agumon', 'greymon', 'foe'))
  assert.deepEqual(plan.digimonIds, ['agumon'])
  assert.equal(plan.evolutionLines, true)
})

test('a stat edit that keeps the entity id refreshes that one record and nothing else', () => {
  const before = encounter()
  const after = encounter({ participants: before.participants.map(p => (p.id === 'mon-p' ? { ...p, maxWounds: 14 } : p)) })
  const plan = planRecordRefresh(before, after, known('agumon', 'foe'))
  assert.deepEqual(plan.digimonIds, ['agumon'])
  assert.equal(plan.evolutionLines, false)
  assert.equal(plan.partnerDigimon, false)
})

test('an unrelated update refreshes no records', () => {
  const before = encounter()
  const after = encounter({ round: 2, battleLog: entries(0, 3), updatedAt: at(50) })
  assert.equal(isEmptyPlan(planRecordRefresh(before, after, known('agumon', 'foe'))), true)
})

test('actions that rewrite the Tamer add it; live Inspiration changes add it too', () => {
  const same = encounter()
  assert.deepEqual(planRecordRefresh(same, same, known('agumon', 'foe'), ACTION_RECORD_HINTS['special-order']).tamerIds, ['tamer-1'])
  assert.deepEqual(planRecordRefresh(same, same, known('agumon', 'foe'), ACTION_RECORD_HINTS.digivolve).evolutionLines, true)
  const spent = encounter({ participants: same.participants.map(p => (p.id === 'tamer-p' ? { ...p, currentInspiration: 1 } : p)) })
  assert.deepEqual(planRecordRefresh(same, spent, known('agumon', 'foe')).tamerIds, ['tamer-1'])
  assert.equal(isEmptyPlan(planRecordRefresh(same, same, known('agumon', 'foe'), ACTION_RECORD_HINTS.attack)), true)
})

test('merging keeps unchanged records by identity and replaces edited ones', () => {
  const a = { id: 'a', updatedAt: '2026-01-01', name: 'A' }
  const b = { id: 'b', updatedAt: '2026-01-01', name: 'B' }
  const merged = mergeRecordsById([a, b], [{ id: 'a', updatedAt: '2026-01-01', name: 'A' }, { id: 'b', updatedAt: '2026-02-01', name: 'B2' }, { id: 'c', updatedAt: 'x', name: 'C' }])
  assert.equal(merged[0], a)
  assert.equal(merged[1].name, 'B2')
  assert.deepEqual(merged.map(r => r.id), ['a', 'b', 'c'])
})

// --- the player page's real handlers -------------------------------------------------------------

function createPage({ tamerId = 'tamer-1', initial = encounter({ updatedAt: at(100) }), partnerDigimon = [{ id: 'agumon', partnerId: 'tamer-1' }] } = {}) {
  const calls = { loadData: 0, fetches: [], fetchDigimon: [], fetchTamer: [], fetchEvolutionLines: [], reconstruct: [], fetchEncounter: [] }
  const tamer = ref({ id: tamerId })
  const activeEncounter = ref(initial)
  const currentEncounter = ref(initial)
  const myRequests = ref([])
  const allDigimon = ref([{ id: 'agumon', updatedAt: 'a1' }, { id: 'foe', updatedAt: 'f1' }])
  const partners = ref(partnerDigimon)
  const allTamers = ref([{ id: tamerId, name: 'Old' }])
  const digimonList = ref([])
  const dependencies = {
    ...snapshot,
    ...records,
    tamer, activeEncounter, currentEncounter, myRequests, allDigimon, partnerDigimon: partners, allTamers, digimonList,
    campaignId: ref('campaign-1'),
    encounterGate: createEncounterSnapshotGate(),
    encounterUpdateDebounce: null,
    getMyPendingRequests: (e, id) => (e.pendingRequests || []).filter(r => r.targetTamerId === id),
    reconstructAttackResults: (e) => { calls.reconstruct.push(e) },
    loadData: async () => { calls.loadData++ },
    $fetch: async (url) => {
      calls.fetches.push(url)
      const ids = new URL(url, 'http://x').searchParams.get('ids')?.split(',') ?? []
      return { data: ids.map(id => ({ id, updatedAt: 'fresh' })) }
    },
    fetchDigimon: async (query) => { calls.fetchDigimon.push(query); digimonList.value = [{ id: 'agumon', partnerId: tamerId, updatedAt: 'fresh' }] },
    fetchTamer: async (id) => { calls.fetchTamer.push(id); return { id, name: 'Fresh' } },
    fetchEvolutionLines: async (...args) => { calls.fetchEvolutionLines.push(args) },
    fetchEncounter: async (id) => { calls.fetchEncounter.push(id); return dependencies.nextFetch },
    nextFetch: null,
    console: { error: () => {}, log: () => {} },
  }
  const page = loadPageFunctions(PLAYER_PAGE, [
    'ownedDigimonIds', 'refreshAffectedRecords', 'applyEncounterUpdate', 'resyncCombatState', 'applyActionResult', 'handleEncounterSocketMessage',
  ], dependencies)
  return { ...page, calls, tamer, activeEncounter, currentEncounter, myRequests, allDigimon, partners, allTamers, dependencies }
}

beforeEach(() => { mock.timers.enable({ apis: ['setTimeout'] }) })
afterEach(() => { mock.timers.reset() })

test('a slow action response cannot overwrite a newer pushed encounter', async () => {
  const page = createPage()
  const newer = encounter({ updatedAt: at(900), round: 3 })
  assert.equal(await page.applyEncounterUpdate(newer, 'ws', { version: 20 }), true)
  assert.equal(page.activeEncounter.value.round, 3)

  const stale = encounter({ updatedAt: at(400), round: 2 })
  page.currentEncounter.value = stale // the composable assigns each response before the page sees it
  assert.equal(await page.applyEncounterUpdate(stale, 'action', { action: 'attack' }), false)
  assert.equal(page.activeEncounter.value.round, 3)
  assert.equal(page.currentEncounter.value.round, 3, 'the composable base is restored too')
  assert.equal(page.calls.loadData, 0)
})

test('an older push cannot overwrite a newer action response', async () => {
  const page = createPage()
  assert.equal(await page.applyEncounterUpdate(encounter({ updatedAt: at(800), round: 4 }), 'action'), true)
  assert.equal(await page.applyEncounterUpdate(encounter({ updatedAt: at(500), round: 2 }), 'ws', { version: 99 }), false)
  assert.equal(page.activeEncounter.value.round, 4)
})

test('an applied response is shaped like a push and keeps live positions', async () => {
  const page = createPage()
  const raw = encounter({
    updatedAt: at(700), battleLog: entries(0, 65),
    participantPositions: { 'tamer-p': { x: 0, y: 0, z: 0 } },
  })
  page.activeEncounter.value = encounter({ updatedAt: at(100), participantPositions: { 'tamer-p': { x: 7, y: 7, z: 0 } }, version: 9 })
  await page.applyEncounterUpdate(raw, 'action')
  assert.equal(page.activeEncounter.value.battleLog.length, BATTLE_LOG_WINDOW)
  assert.equal(page.activeEncounter.value._battleLogTotal, 65)
  assert.deepEqual(page.activeEncounter.value.participantPositions['tamer-p'], { x: 7, y: 7, z: 0 })
  assert.equal(page.currentEncounter.value, page.activeEncounter.value)
})

test('pending requests and grouped attack results are recomputed from the applied encounter', async () => {
  const page = createPage()
  const next = encounter({
    updatedAt: at(300),
    pendingRequests: [{ id: 'r1', targetTamerId: 'tamer-1', type: 'dodge-roll' }, { id: 'r2', targetTamerId: 'someone-else', type: 'dodge-roll' }],
    requestResponses: [{ id: 'resp-1', requestId: 'r0' }],
  })
  await page.applyEncounterUpdate(next, 'ws', { version: 1 })
  assert.deepEqual(page.myRequests.value.map(r => r.id), ['r1'])
  assert.equal(page.calls.reconstruct.length, 1, 'reconstructAttackResults sees the new responses')
  assert.equal(page.calls.reconstruct[0].requestResponses[0].id, 'resp-1')
})

test('an unpublished or ended encounter hands off to the full load instead of being applied', async () => {
  const page = createPage()
  const before = page.activeEncounter.value
  assert.equal(await page.applyEncounterUpdate(encounter({ updatedAt: at(400), visibleToPlayers: false }), 'ws', { version: 1 }), false)
  assert.equal(await page.applyEncounterUpdate(encounter({ updatedAt: at(500), phase: 'ended' }), 'ws', { version: 2 }), false)
  assert.equal(page.calls.loadData, 2)
  assert.equal(page.activeEncounter.value, before, 'nothing was applied')
})

test('nothing is applied while no encounter is shown; only a fetch may start one', async () => {
  const page = createPage()
  page.activeEncounter.value = null
  assert.equal(await page.applyEncounterUpdate(encounter({ updatedAt: at(400) }), 'ws', { version: 1 }), false)
  assert.equal(await page.applyEncounterUpdate(encounter({ updatedAt: at(400) }), 'action'), false)
  assert.equal(page.activeEncounter.value, null)
  const other = createPage()
  other.dependencies.nextFetch = null
  assert.equal(await other.applyEncounterUpdate(encounter({ id: 'enc-2' }), 'ws', { version: 1 }), false, 'another encounter is ignored')
})

test('evolution refetches only the affected records, not every list', async () => {
  const page = createPage()
  const evolved = encounter({
    updatedAt: at(400),
    participants: page.activeEncounter.value.participants.map(p => (p.id === 'mon-p' ? { ...p, entityId: 'greymon' } : p)),
  })
  await page.applyEncounterUpdate(evolved, 'action', { action: 'digivolve' })

  assert.deepEqual(page.calls.fetches, ['/api/digimon?ids=greymon'])
  assert.deepEqual(page.calls.fetchDigimon, [{ partnerId: 'tamer-1', campaignId: 'campaign-1' }])
  assert.deepEqual(page.calls.fetchEvolutionLines, [['tamer-1', 'campaign-1']])
  assert.deepEqual(page.calls.fetchTamer, ['tamer-1'], 'digivolving also rewrites the Tamer')
  assert.equal(page.calls.loadData, 0)
  assert.ok(page.allDigimon.value.some(d => d.id === 'greymon'))
})

test('a stat edit with an unchanged id refreshes only that digimon', async () => {
  const page = createPage()
  const edited = encounter({
    updatedAt: at(400),
    participants: page.activeEncounter.value.participants.map(p => (p.id === 'mon-p' ? { ...p, maxWounds: 14 } : p)),
  })
  await page.applyEncounterUpdate(edited, 'ws', { version: 5 })
  assert.deepEqual(page.calls.fetches, ['/api/digimon?ids=agumon'])
  assert.equal(page.allDigimon.value.find(d => d.id === 'agumon').updatedAt, 'fresh')
  assert.equal(page.allDigimon.value.find(d => d.id === 'foe').updatedAt, 'f1', 'unrelated records keep their identity')
  assert.deepEqual(page.calls.fetchEvolutionLines, [])
  assert.deepEqual(page.calls.fetchTamer, [])
})

test('an ordinary action fetches no records at all', async () => {
  const page = createPage()
  await page.applyEncounterUpdate(encounter({ updatedAt: at(400), round: 2, battleLog: entries(0, 3) }), 'action', { action: 'attack' })
  assert.deepEqual(page.calls.fetches, [])
  assert.deepEqual(page.calls.fetchTamer, [])
  assert.equal(page.calls.loadData, 0)
})

test('applyActionResult falls back to a targeted resync, never the full load, when nothing came back', async () => {
  const page = createPage()
  page.dependencies.nextFetch = encounter({ updatedAt: at(600), round: 5 })
  await page.applyActionResult(null, 'attack')
  assert.deepEqual(page.calls.fetchEncounter, ['enc-1'])
  assert.equal(page.activeEncounter.value.round, 5)
  assert.equal(page.calls.loadData, 0)
})

test('recovery resyncs one encounter; with nothing shown, the full load decides', async () => {
  const page = createPage()
  page.dependencies.nextFetch = encounter({ updatedAt: at(650), round: 6 })
  await page.resyncCombatState()
  assert.equal(page.activeEncounter.value.round, 6)
  assert.equal(page.calls.loadData, 0)

  const empty = createPage()
  empty.activeEncounter.value = null
  await empty.resyncCombatState()
  assert.equal(empty.calls.loadData, 1)
  assert.deepEqual(empty.calls.fetchEncounter, [])
})

test('socket messages: pushes go through the gate; the update fallback still reloads after its debounce', async () => {
  const page = createPage()
  page.handleEncounterSocketMessage({ type: 'encounter-state', encounterId: 'enc-1', version: 7, encounter: encounter({ updatedAt: at(900), round: 8 }) })
  await Promise.resolve()
  assert.equal(page.activeEncounter.value.round, 8)
  page.handleEncounterSocketMessage({ type: 'encounter-state', encounterId: 'enc-1', version: 6, encounter: encounter({ updatedAt: at(950), round: 9 }) })
  await Promise.resolve()
  assert.equal(page.activeEncounter.value.round, 8, 'an older push version is ignored')

  page.handleEncounterSocketMessage({ type: 'encounter-updated', encounterId: 'enc-1' })
  assert.equal(page.calls.loadData, 0)
  mock.timers.tick(200)
  assert.equal(page.calls.loadData, 1)
})

test('the page no longer reloads everything after combat actions', () => {
  const source = readFileSync(new URL(`../${PLAYER_PAGE}`, import.meta.url), 'utf8')
  // The explicit Refresh button and the periodic poll remain full loads.
  assert.match(source, /@click="loadData"/)
  assert.match(source, /setInterval\(loadData/)
  const actionHandlers = ['submitDodgeRoll', 'handleIntercedeClaim', 'handleIntercedeSkip', 'handleSpendInspiration', 'handleUseSpecialOrder', 'confirmAccuracyReview']
  for (const name of actionHandlers) {
    const start = source.indexOf(`async function ${name}`)
    assert.notEqual(start, -1, `${name} should exist`)
    const body = source.slice(start, start + 6000).split(/\n(?:async )?function /)[0]
    assert.doesNotMatch(body, /await loadData\(\)/, `${name} must apply its result instead of reloading`)
  }
})

// --- reconnect recovery --------------------------------------------------------------------------

test('the socket tells the page when it reopens after a drop, not on the first connection or an encounter switch', async () => {
  const names = ['ref', 'watch', 'onMounted', 'onUnmounted', 'window', 'WebSocket']
  const saved = new Map(names.map(name => [name, globalThis[name]]))
  const sockets = []
  const watchers = []
  class FakeSocket {
    static OPEN = 1
    constructor(url) { this.url = url; this.readyState = 1; sockets.push(this) }
    send() {}
    close() { this.onclose?.() }
  }
  globalThis.ref = value => ({ value })
  globalThis.watch = (_source, callback) => { watchers.push(callback) }
  globalThis.onMounted = callback => callback()
  globalThis.onUnmounted = () => {}
  globalThis.window = { location: { protocol: 'http:', host: 'localhost' } }
  globalThis.WebSocket = FakeSocket
  try {
    const { useMapWebSocket } = loadTypeScript('composables/useMapWebSocket.ts')
    const id = { value: 'enc-1' }
    const socket = useMapWebSocket(id)
    let reconnects = 0
    socket.onReconnect(() => { reconnects++ })

    sockets[0].onopen()
    assert.equal(reconnects, 0, 'the first connection is not a reconnect')

    sockets[0].onclose()                 // the connection drops
    mock.timers.tick(1000)               // backoff elapses and the composable reconnects
    assert.equal(sockets.length, 2)
    sockets[1].onopen()
    assert.equal(reconnects, 1, 'pushes sent during the gap are lost, so the page is told to resync')

    id.value = 'enc-2'
    watchers[0]('enc-2')                 // the page moves to another encounter
    sockets.at(-1).onopen()
    assert.equal(reconnects, 1, 'a new encounter is not a reconnect')
  } finally {
    for (const [name, value] of saved) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value }
  }
})

// --- the server side of the ordering token ----------------------------------------------------------

test('every encounter write stamps updatedAt, since it is what orders snapshots', () => {
  const root = new URL('../server/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')
  const files = []
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (statSync(full).isDirectory()) walk(full)
      else if (name.endsWith('.ts')) files.push(full)
    }
  }
  walk(decodeURIComponent(root))

  const offenders = []
  let writes = 0
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    for (const match of source.matchAll(/\w+\.update\(\s*encounters\s*\)\s*\.set\(/g)) {
      writes++
      let depth = 1
      let i = match.index + match[0].length
      while (i < source.length && depth > 0) { if (source[i] === '(') depth++; else if (source[i] === ')') depth--; i++ }
      const argument = source.slice(match.index + match[0].length, i - 1)
      const stamped = /updatedAt/.test(argument) || (/^\s*\w+\s*$/.test(argument) && /updatedAt:\s*new Date\(\)/.test(source))
      if (!stamped) offenders.push(`${file}: ${argument.replace(/\s+/g, ' ').slice(0, 80)}`)
    }
  }
  assert.ok(writes > 20, `expected to scan the encounter writes, found ${writes}`)
  assert.deepEqual(offenders, [])
})

test('the encounter payload shares its log trimming and action migration with the pages', async () => {
  const stored = encounter({ battleLog: entries(0, 70), participants: [{ id: 'a', actionsRemaining: { simple: 1, complex: 1 } }] })
  const { buildEncounterPayload } = loadTypeScriptWithMocks('server/utils/encounterPayload.ts', {
    '../db': { db: { select: () => ({ from: () => ({ where: async () => [stored] }) }) }, encounters: { id: 'id' } },
    'drizzle-orm': { eq: () => ({}) },
    './encounterRoom': { getRoomSnapshot: async () => ({ participantPositions: { room: true }, destructibleStates: [], version: 4 }) },
  })
  const payload = await buildEncounterPayload('enc-1')
  assert.equal(payload.battleLog.length, BATTLE_LOG_WINDOW)
  assert.equal(payload._battleLogTotal, 70)
  assert.equal(payload._battleLogWasTrimmed, true)
  assert.deepEqual(payload.participants[0].actionsRemaining, { simple: 1 })
  assert.deepEqual(payload.participantPositions, { room: true })
  assert.equal(payload.version, 4)
})
