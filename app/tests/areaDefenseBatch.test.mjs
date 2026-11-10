import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { afterEach, test } from 'node:test'
import { computed, createSSRApp, h, nextTick, ref, watch } from 'vue'
import { renderToString } from '@vue/server-renderer'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks, loadVueComponent } from './helpers/loadTypeScript.mjs'

const globalNames = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originalGlobals = new Map(globalNames.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originalGlobals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

const copy = value => JSON.parse(JSON.stringify(value)) // the batch holds reactive objects, which structuredClone rejects
const unexpected = () => { throw new Error('unexpected side effect') }
const PLAYER_PAGE = 'pages/campaigns/[campaignId]/player/[tamerId].vue'

const { groupDodgeRequests, computeDodgeDefense, isDodgeBlocked, summarizeDodgeResult } = loadTypeScript('utils/areaDefense.ts')
const { useAreaDefenseBatch } = loadTypeScript('composables/useAreaDefenseBatch.ts')
const AreaDefensePanel = loadVueComponent('components/AreaDefensePanel.vue')

const dodge = (id, target, data = {}) => ({
  id, type: 'dodge-roll', targetTamerId: 'tamer-1', targetParticipantId: target, timestamp: 't',
  data: { intercedeGroupId: 'cast-1', attackerName: 'Foe', attackName: 'Blast', accuracySuccesses: 3, dodgePenalty: 0, ...data },
})

// --- grouping ---------------------------------------------------------------------------------------

test('dodge requests are grouped by the cast that made them, in server order', () => {
  const requests = [
    dodge('a', 'tamer-p'), dodge('x', 'other', { intercedeGroupId: 'cast-2' }), dodge('b', 'mon-p'),
    { id: 'offer', type: 'intercede-offer', data: { intercedeGroupId: 'cast-1' } },
    dodge('c', 'mon-q', { intercedeGroupId: 'cast-2' }),
  ]
  const groups = groupDodgeRequests(requests)
  assert.deepEqual(groups.map(g => [g.groupId, g.isCast, g.requests.map(r => r.id)]), [
    ['cast-1', true, ['a', 'b']],
    ['cast-2', true, ['x', 'c']],
  ])
})

test('unrelated attacks never share a group: no cast id means a group of one', () => {
  const single = dodge('s1', 'tamer-p', { intercedeGroupId: undefined })
  const counter = dodge('s2', 'tamer-p', { intercedeGroupId: undefined, halfDodge: true })
  const groups = groupDodgeRequests([single, counter, dodge('a', 'mon-p')])
  assert.deepEqual(groups.map(g => [g.isCast, g.requests.map(r => r.id)]), [[false, ['s1']], [false, ['s2']], [true, ['a']]])
})

// --- the Dodge pool ------------------------------------------------------------------------------------

function poolContext({ participants, digimon = [], tamers = [] }) {
  return {
    participants,
    findDigimon: id => digimon.find(d => d.id === id),
    findTamer: id => tamers.find(t => t.id === id),
    // the derived Dodge includes the Dark Evolution bonus, as the page's calcDigimonStats does
    digimonDodge: d => d.baseStats.dodge + (d.isDarkEvolution ? 2 : 0),
    tamerDodgePool: t => t.dodgePool,
  }
}
const monster = (id, extra = {}) => ({ id, type: 'digimon', entityId: id, currentStance: 'neutral', activeEffects: [], ...extra })
const monsterRecord = (id, dodge, extra = {}) => ({ id, baseStats: { accuracy: 0, damage: 0, dodge, armor: 0 }, bonusStats: {}, ...extra })

test('the pool matches the one-at-a-time modal: stance, penalty, effects, Directed, Black armor, swaps, dark evolution', () => {
  const ctx = poolContext({
    participants: [
      monster('plain'), monster('defensive', { currentStance: 'defensive' }), monster('offensive', { currentStance: 'offensive' }),
      monster('swapped', { statSwaps: { dodge: 'armor' } }), monster('black', { blackArmorRoundBonus: { armor: 1, dodge: 2 } }),
      monster('directed', { activeEffects: [{ name: 'Directed', value: 2 }] }), monster('dark'),
      { id: 'tamer-p', type: 'tamer', entityId: 'tamer-1', currentStance: 'neutral', activeEffects: [] },
      monster('unloaded'),
    ],
    digimon: [
      monsterRecord('plain', 4), monsterRecord('defensive', 4), monsterRecord('offensive', 5), monsterRecord('swapped', 6),
      monsterRecord('black', 3), monsterRecord('directed', 3), monsterRecord('dark', 3, { isDarkEvolution: true }),
    ],
    tamers: [{ id: 'tamer-1', dodgePool: 5 }],
  })
  const pool = (target, data = {}) => computeDodgeDefense(dodge('r', target, data), ctx).pool

  assert.equal(pool('plain'), 4)
  assert.equal(pool('defensive'), 6, 'Defensive stance x1.5, rounded down')
  assert.equal(pool('offensive'), 3, 'Offensive stance halves, rounded up')
  assert.equal(pool('plain', { dodgePenalty: 2 }), 2)
  assert.equal(pool('plain', { dodgePenalty: 9 }), 1, 'the successive attack penalty never goes below one die')
  assert.equal(pool('black'), 5, "Black Digizoid Armor's rolled bonus")
  assert.equal(pool('directed'), 5, 'Directed adds its value')
  assert.equal(pool('dark'), 5, 'Dark Evolution +2')
  assert.equal(pool('swapped'), 3, 'a Dodge swapped with a zero Armor falls back to three dice')
  assert.equal(pool('tamer-p'), 5, "the Tamer's derived Dodge pool")
  assert.equal(pool('plain', { halfDodge: true }), 2, 'a counterattack rolls half')
  assert.equal(pool('unloaded'), 3, 'a record that is not loaded falls back to three dice')
  assert.equal(computeDodgeDefense(dodge('r', 'ghost'), ctx).pool, 3, 'an unknown target falls back to three dice')
})

test('a clash block removes the pool; the breakdown names what moved it', () => {
  const ctx = poolContext({
    participants: [
      monster('target', { currentStance: 'defensive', clash: { clashId: 'c1' }, activeEffects: [{ name: 'Directed', value: 1 }] }),
      monster('attacker'), monster('inside', { clash: { clashId: 'c1' } }),
    ],
    digimon: [monsterRecord('target', 4)],
  })
  const outside = computeDodgeDefense(dodge('r', 'target', { attackerParticipantId: 'attacker' }), ctx)
  assert.deepEqual([outside.pool, outside.blocked], [0, true], 'attacked from outside the clash')
  assert.equal(isDodgeBlocked(dodge('r', 'target', { attackerParticipantId: 'inside' }), ctx.participants), false, 'from inside it')
  assert.equal(isDodgeBlocked(dodge('r', 'target', { cannotDodge: true }), ctx.participants), true, 'the flag')

  const open = computeDodgeDefense(dodge('r', 'target', { attackerParticipantId: 'inside', dodgePenalty: 1, halfDodge: true }), ctx)
  assert.equal(open.basePool, 4)
  assert.deepEqual(open.modifiers.map(m => [m.label, m.value]), [
    ['Stance', 2], ['Successive attack penalty', -1], ['Directed', 1], ['Counterattack (half)', -3],
  ])
  assert.equal(open.pool, 3)
})

test('the page asks the shared calculation for the single modal too', () => {
  const page = readFileSync(new URL(`../${PLAYER_PAGE}`, import.meta.url), 'utf8')
  assert.match(page, /return defenseFor\(currentDodgeRequest\.value\)\.pool/)
  assert.doesNotMatch(page, /applyStanceToDodge/, 'the stance maths lives in utils/areaDefense.ts now')
})

test('a dodge result is read from the log for the right target and attack kind', () => {
  const log = [
    { action: 'Dodge', actorId: 'mon-p', hit: false, finalDamage: 0, netSuccesses: 0 },
    { action: 'Dodge', actorId: 'tamer-p', hit: true, finalDamage: 4, netSuccesses: 2 },
    { action: 'Dodge', actorId: 'mon-p', hit: true, finalDamage: 3, netSuccesses: 1 },
    { action: 'Dodge (Support)', actorId: 'mon-p', hit: false },
  ]
  assert.deepEqual(summarizeDodgeResult(log, dodge('a', 'mon-p')), { hit: true, finalDamage: 3, netSuccesses: 1 }, 'the latest entry')
  assert.deepEqual(summarizeDodgeResult(log, dodge('a', 'tamer-p')), { hit: true, finalDamage: 4, netSuccesses: 2 })
  assert.equal(summarizeDodgeResult(log, dodge('a', 'mon-p', { isSupportAttack: true })).hit, false)
  assert.equal(summarizeDodgeResult(log, dodge('a', 'nobody')), null)
})

// --- the batch -------------------------------------------------------------------------------------------

function harness({ inspiration = 6, cost = 2, pools = {}, dice = [] } = {}) {
  const world = {
    inspiration, spends: [], submits: [], failSpend: () => false, failSubmit: new Set(), answered: new Set(),
    present: new Set(['tamer-p', 'mon-p', 'mon-q']), inFlight: 0, maxInFlight: 0, dice: [...dice],
  }
  const adapters = {
    defense: request => ({ pool: pools[request.id] ?? 3, blocked: false, half: false, basePool: pools[request.id] ?? 3, modifiers: [] }),
    currentInspiration: () => world.inspiration,
    actOfInspirationCost: () => cost,
    spend: async (kind, amount) => {
      world.inFlight++
      world.maxInFlight = Math.max(world.maxInFlight, world.inFlight)
      world.spends.push({ kind, amount })
      await new Promise(resolve => setImmediate(resolve))
      world.inFlight--
      if (world.failSpend(kind)) return false
      world.inspiration -= amount
      return true
    },
    submit: async (request, roll) => {
      world.submits.push({ id: request.id, roll: copy(roll) })
      await new Promise(resolve => setImmediate(resolve))
      if (world.failSubmit.has(request.id)) return { ok: false, message: 'network down' }
      return { ok: true, responseId: `resp-${request.id}`, summary: { hit: false, finalDamage: 0, netSuccesses: 0 } }
    },
    isAnswered: request => world.answered.has(request.id),
    isTargetPresent: request => world.present.has(request.targetParticipantId),
    rollDie: () => world.dice.shift() ?? 1,
  }
  const batch = useAreaDefenseBatch(adapters)
  const requests = [dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('c', 'mon-q')]
  batch.open('cast-1', requests)
  const entry = id => batch.entries.value.find(e => e.requestId === id)
  return { batch, world, entry, requests }
}

test('each target has its own pool, roll and status; rolling one leaves the others alone', async () => {
  const { batch, entry, world } = harness({ pools: { a: 2, b: 4, c: 1 }, dice: [6, 5, 4, 3, 2, 1, 6] })
  assert.deepEqual(batch.views.value.map(v => v.defense.pool), [2, 4, 1])
  await batch.rollOne('a')
  assert.deepEqual(entry('a').roll, { rolls: [6, 5], successes: 2, dicePool: 2 })
  assert.equal(entry('a').status, 'rolled')
  assert.equal(entry('b').status, 'idle')
  assert.equal(entry('b').roll, null)
  await batch.rollOne('b')
  assert.deepEqual(entry('b').roll.rolls, [4, 3, 2, 1])
  assert.deepEqual(world.spends, [])
})

test('a roll cannot be rolled again for free', async () => {
  const { batch, entry, world } = harness({ dice: [6, 6, 6, 1, 1, 1, 2, 2, 2] })
  assert.equal(await batch.rollOne('a'), true)
  const first = copy(entry('a').roll)
  assert.equal(await batch.rollOne('a'), false)
  assert.equal(world.dice.length, 6, 'asking again drew no dice')
  await batch.rollAllUnrolled()
  assert.deepEqual(entry('a').roll, first, 'rolling everything leaves a rolled target as it was')
  assert.deepEqual(entry('b').roll.rolls, [1, 1, 1], 'the next dice went to the targets that had not rolled')
  assert.deepEqual(entry('c').roll.rolls, [2, 2, 2])
})

test('Act of Inspiration is chosen and paid per target, once, and adds five dice', async () => {
  const { batch, entry, world } = harness({ inspiration: 6, pools: { a: 2, b: 2 } })
  batch.toggleAct('a')
  await batch.rollOne('a')
  await batch.rollOne('b')
  assert.deepEqual(world.spends, [{ kind: 'act-of-inspiration', amount: 2 }], 'only the target that chose it paid')
  assert.equal(entry('a').roll.dicePool, 7)
  assert.equal(entry('b').roll.dicePool, 2)
  assert.equal(world.inspiration, 4)
  batch.toggleAct('a') // too late: already rolled
  assert.equal(await batch.rollOne('a'), false)
  assert.equal(world.spends.length, 1, 'never charged twice')
})

test('a spend the server refuses grants nothing, and the retry is charged exactly once', async () => {
  const { batch, entry, world } = harness({ inspiration: 6, pools: { a: 2 } })
  batch.toggleAct('a')
  world.failSpend = () => true
  assert.equal(await batch.rollOne('a'), false)
  assert.equal(entry('a').status, 'idle')
  assert.equal(entry('a').roll, null, 'no roll, no dice')
  assert.equal(entry('a').actPaid, false)
  assert.match(entry('a').error, /Inspiration/)
  assert.equal(world.inspiration, 6)

  world.failSpend = () => false
  assert.equal(await batch.rollOne('a'), true)
  assert.equal(entry('a').roll.dicePool, 7)
  assert.equal(world.inspiration, 4, 'one charge in total')
  assert.equal(world.spends.length, 2, 'two attempts, one of them refused')
})

test('re-rolls and extra dice happen only after the spend succeeded', async () => {
  const { batch, entry, world } = harness({ inspiration: 3, pools: { a: 2 }, dice: [1, 1, 6, 6, 5] })
  await batch.rollOne('a')
  assert.deepEqual(entry('a').roll.rolls, [1, 1])

  world.failSpend = () => true
  assert.equal(await batch.rerollOne('a'), false)
  assert.equal(await batch.addDieOne('a'), false)
  assert.deepEqual(entry('a').roll, { rolls: [1, 1], successes: 0, dicePool: 2 }, 'refused spends changed nothing')
  assert.equal(world.dice.length, 3)

  world.failSpend = () => false
  assert.equal(await batch.rerollOne('a'), true)
  assert.deepEqual(entry('a').roll.rolls, [6, 6])
  assert.equal(await batch.addDieOne('a'), true)
  assert.deepEqual(entry('a').roll, { rolls: [6, 6, 5], successes: 3, dicePool: 3 })
  assert.deepEqual([entry('a').rerolls, entry('a').extraDice, world.inspiration], [1, 1, 1])
  assert.equal(await batch.rerollOne('b'), false, 'nothing to re-roll before a roll exists')
})

test('a double click spends once', async () => {
  const { batch, world } = harness({ inspiration: 6 })
  batch.toggleAct('a')
  const results = await Promise.all([batch.rollOne('a'), batch.rollOne('a')])
  assert.deepEqual(results.sort(), [false, true])
  assert.equal(world.spends.length, 1)
})

test('two targets cannot both claim the last Inspiration', async () => {
  const { batch, entry, world } = harness({ inspiration: 2, cost: 2, pools: { a: 1, b: 1 } })
  batch.toggleAct('a')
  batch.toggleAct('b')
  await Promise.all([batch.rollOne('a'), batch.rollOne('b')])
  assert.equal(world.maxInFlight, 1, 'spends are made one at a time')
  assert.deepEqual([entry('a').status, entry('b').status].sort(), ['idle', 'rolled'])
  assert.equal(world.inspiration, 0)
  assert.equal(world.spends.filter(s => s.kind === 'act-of-inspiration').length, 1, 'the second never reached the server')
})

test('Roll all unrolled leaves rolled, submitted and unavailable targets alone, in order', async () => {
  const { batch, entry, world } = harness({ pools: { a: 1, b: 1, c: 1, d: 1 }, dice: [6, 2, 3, 4] })
  batch.open('cast-1', [dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('c', 'mon-q'), dodge('d', 'tamer-p')])
  world.dice = [6, 2, 3, 4]
  await batch.rollOne('a')                 // rolled: 6
  await batch.submitOne('a')               // now submitted
  batch.reconcile([dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('c', 'mon-q'), dodge('d', 'tamer-p')].filter(r => r.id !== 'c'))
  assert.equal(entry('c').status, 'unavailable')
  await batch.rollOne('b')                 // rolled: 2
  const before = [copy(entry('a').roll), copy(entry('b').roll)]
  await batch.rollAllUnrolled()
  assert.deepEqual([entry('a').roll, entry('b').roll], before)
  assert.equal(entry('c').roll, null, 'an unavailable target is not rolled')
  assert.deepEqual(entry('d').roll.rolls, [3], 'only the unrolled target drew the next die')
  assert.equal(world.dice.length, 1)
})

test('Submit ready defenses sends in defense order; a failure keeps its roll and does not stop the rest', async () => {
  const { batch, entry, world } = harness({ pools: { a: 2, b: 2, c: 2 }, dice: [6, 5, 3, 2, 4, 4] })
  await batch.rollAllUnrolled()
  const rolls = Object.fromEntries(['a', 'b', 'c'].map(id => [id, copy(entry(id).roll)]))
  world.failSubmit.add('b')
  await batch.submitReady()

  assert.deepEqual(world.submits.map(s => s.id), ['a', 'b', 'c'], 'defense order')
  assert.deepEqual([entry('a').status, entry('b').status, entry('c').status], ['submitted', 'failed', 'submitted'])
  assert.deepEqual(entry('b').roll, rolls.b, 'the failed roll is intact')
  assert.equal(entry('b').error, 'network down')
  assert.equal(batch.isSettled.value, false)

  world.failSubmit.clear()
  await batch.submitReady()            // retry
  assert.deepEqual(world.submits.map(s => s.id), ['a', 'b', 'c', 'b'], 'only the failed one was sent again')
  assert.deepEqual(world.submits[3].roll, rolls.b, 'with the very same roll')
  assert.equal(world.spends.length, 0, 'a retry spends nothing')
  assert.equal(world.dice.length, 0, 'and rolls nothing')
  assert.equal(batch.isSettled.value, true)
  assert.deepEqual(batch.cleanupTargets(), [
    { requestId: 'a', responseId: 'resp-a' }, { requestId: 'b', responseId: 'resp-b' }, { requestId: 'c', responseId: 'resp-c' },
  ])
})

test('a submitted defense is immutable', async () => {
  const { batch, entry, world } = harness({ pools: { a: 2 }, dice: [5, 5, 1] })
  await batch.rollOne('a')
  await batch.submitOne('a')
  const after = copy(entry('a').roll)
  assert.equal(await batch.rerollOne('a'), false)
  assert.equal(await batch.addDieOne('a'), false)
  assert.equal(await batch.rollOne('a'), false)
  assert.equal(await batch.submitOne('a'), false)
  batch.toggleAct('a')
  assert.deepEqual(entry('a').roll, after)
  assert.equal(world.submits.length, 1)
  assert.equal(world.spends.length, 0)
})

test('a double submit sends once', async () => {
  const { batch, world } = harness({ pools: { a: 1 } })
  await batch.rollOne('a')
  await Promise.all([batch.submitOne('a'), batch.submitOne('a'), batch.submitReady()])
  assert.equal(world.submits.length, 1)
})

test('an update keeps rolls, refreshes request data and joins a late request of the same cast', async () => {
  const { batch, entry, world } = harness({ pools: { a: 2, b: 2, c: 2 }, dice: [6, 6, 3, 3] })
  await batch.rollOne('a')
  await batch.rollOne('b')
  const kept = copy(entry('a').roll)

  const updated = [dodge('a', 'tamer-p', { dodgePenalty: 1 }), dodge('b', 'mon-p'), dodge('c', 'mon-q'), dodge('d', 'mon-p')]
  world.present.add('mon-p')
  batch.reconcile(updated)
  assert.deepEqual(entry('a').roll, kept, 'the roll survives the update')
  assert.equal(entry('a').request.data.dodgePenalty, 1, 'the request data is the latest')
  assert.deepEqual(batch.entries.value.map(e => e.requestId), ['a', 'b', 'c', 'd'])
  assert.equal(entry('d').status, 'idle')
})

test('a protected or removed target is no longer asked for, and nothing is sent for it', async () => {
  const { batch, entry, world } = harness({ pools: { a: 1, b: 1, c: 1 }, dice: [6, 6, 6] })
  await batch.rollAllUnrolled()
  world.present.delete('mon-p')                                  // b's target left the encounter
  batch.reconcile([dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('c', 'mon-q')].filter(r => r.id !== 'c'))   // c's request is gone
  assert.deepEqual([entry('a').status, entry('b').status, entry('c').status], ['rolled', 'unavailable', 'unavailable'])
  assert.ok(entry('b').roll, 'its roll is still shown')
  await batch.submitReady()
  assert.deepEqual(world.submits.map(s => s.id), ['a'], 'only the live one is sent')
  assert.equal(batch.isSettled.value, true, 'unavailable counts as settled, so the panel can close')

  // A glitch that reverses itself is not permanent.
  world.present.add('mon-p')
  batch.reconcile([dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('c', 'mon-q')])
  assert.equal(entry('b').status, 'rolled')
  assert.equal(entry('c').status, 'rolled')
})

test('a request the server already answered counts as submitted and is never sent again', async () => {
  const { batch, entry, world } = harness({ pools: { a: 1, b: 1 }, dice: [5, 5] })
  await batch.rollOne('a')
  await batch.rollOne('b')
  world.answered.add('a')                // answered from another tab, or the reply to our send was lost
  batch.reconcile([dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('c', 'mon-q')])
  assert.equal(entry('a').status, 'submitted')
  assert.equal(entry('a').answeredElsewhere, true)
  await batch.submitReady()
  assert.deepEqual(world.submits.map(s => s.id), ['b'])
})

test('an update during a send does not disturb it, and a failed send then ends up failed, not lost', async () => {
  const { batch, entry, world } = harness({ pools: { a: 1 }, dice: [5] })
  await batch.rollOne('a')
  world.failSubmit.add('a')
  const sending = batch.submitOne('a')
  batch.reconcile([])                                            // the request vanishes mid-send
  await sending
  assert.equal(entry('a').status, 'failed')
  assert.deepEqual(entry('a').roll.rolls, [5])
  batch.reconcile([])
  assert.equal(entry('a').status, 'unavailable', 'and the next update settles it')
})

test('the batch owns its requests until it is closed', () => {
  const { batch } = harness()
  assert.equal(batch.ownsRequest('b'), true)
  assert.equal(batch.ownsRequest('zzz'), false)
  assert.equal(batch.active.value, true)
  batch.close()
  assert.equal(batch.active.value, false)
  assert.equal(batch.ownsRequest('b'), false)
  assert.equal(batch.isSettled.value, false)
})

// --- the server side of a cast ----------------------------------------------------------------------------

test('dodge requests made after the intercede window carry the cast, NPC targets still auto-resolve', async () => {
  const npcResolutions = []
  const area = loadTrustedGameplayModule('server/utils/resolveAreaIntercedeGroup.ts', {
    '../db': { db: { select: unexpected, update: unexpected }, digimon: {}, tamers: {}, evolutionLines: {} },
    'drizzle-orm': { eq: () => ({}) },
    './resolveNpcAttack': { resolveNpcAttack: async params => {
      npcResolutions.push(params.targetParticipantId)
      return { participants: params.participants, battleLog: [...params.battleLog, { id: 'npc-resolved' }], turnOrder: params.turnOrder }
    } },
    './enemyKnockouts': { knockedOutEnemyIds: () => [], resolveEnemyKnockouts: async state => ({ ...state, changed: false, logEntries: [] }) },
    '~/server/utils/resolveSupportAttack': {
      resolvePositiveAuto: unexpected, resolvePositiveHealth: unexpected, resolveNegativeSupportNpc: unexpected,
      getPositiveSupportResolutionType: () => null,
    },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
  })
  const groupState = {
    id: 'igs-cast-9', type: 'intercede-group-state', targetTamerId: 'GM',
    data: {
      intercedeGroupId: 'cast-9', originalTargetIds: ['tamer-p', 'mon-p', 'npc'], claims: [], npcTargetIds: ['npc'],
      playerTargetInfo: {
        'tamer-p': { type: 'tamer', entityId: 'tamer-1', name: 'Tamer' },
        'mon-p': { type: 'digimon', entityId: 'mon', partnerId: 'tamer-1', name: 'Mon' },
      },
      attackerId: 'foe', attackerName: 'Foe', attackId: 'blast', attackName: 'Blast', accuracySuccesses: 3, accuracyDice: [6, 6, 6],
    },
  }
  const participants = [
    { id: 'foe', type: 'digimon', entityId: 'foe', isEnemy: true, currentWounds: 0, maxWounds: 9 },
    { id: 'tamer-p', type: 'tamer', entityId: 'tamer-1', currentWounds: 0, maxWounds: 5 },
    { id: 'mon-p', type: 'digimon', entityId: 'mon', currentWounds: 0, maxWounds: 9 },
    { id: 'npc', type: 'digimon', entityId: 'npc', isEnemy: true, currentWounds: 0, maxWounds: 9 },
  ]
  // Resolving an NPC target reads its record for the log name: serve it from a tiny fake.
  const result = await area.resolveAreaIntercedeGroup({
    groupState, participants, battleLog: [], pendingRequests: [groupState], turnOrder: ['foe'], round: 1, currentTurnIndex: 0,
    encounterId: 'encounter',
    database: { select: () => ({ from: () => ({ where: async () => [{ name: 'Npc' }] }) }), update: unexpected },
  })
  const dodges = result.pendingRequests.filter(r => r.type === 'dodge-roll')
  assert.deepEqual(dodges.map(r => r.targetParticipantId), ['tamer-p', 'mon-p'], 'in the order the targets were listed')
  assert.deepEqual(dodges.map(r => r.data.intercedeGroupId), ['cast-9', 'cast-9'])
  assert.deepEqual(dodges.map(r => r.targetTamerId), ['tamer-1', 'tamer-1'])
  assert.deepEqual(npcResolutions, ['npc'], 'the NPC target is still resolved without a prompt')
  assert.equal(result.pendingRequests.some(r => r.type === 'intercede-group-state'), false)
  assert.equal(groupDodgeRequests(dodges)[0].requests.length, 2, 'and the player page batches them')

  const offer = readFileSync(new URL('../server/api/encounters/[id]/actions/intercede-offer.post.ts', import.meta.url), 'utf8')
  assert.match(offer, /totalTargetCount,\s*intercedeGroupId,/, 'the no-offer area path carries the cast id too')
})

function castServer(requests) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = event => event.encounterId
  globalThis.readBody = async event => event.body
  globalThis.createError = data => Object.assign(new Error(data.message), data)
  const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'campaigns', 'evolutionLines', 'maps'].map(name => [name, { name, id: name }]))
  let stored = {
    id: 'encounter', phase: 'combat', round: 1, participants: [], turnOrder: [], currentTurnIndex: 0,
    battleLog: [], pendingRequests: copy(requests), requestResponses: [], campaignId: null,
  }
  const writes = []
  const db = {
    select: () => ({ from: table => ({ where: async () => (table === tables.encounters ? [copy(stored)] : []) }) }),
    update: () => ({ set: fields => ({ where: async () => { writes.push(copy(fields)); stored = { ...stored, ...copy(fields) } } }) }),
  }
  const stub = new Proxy({}, { get: (_t, name) => () => { throw new Error(`unexpected ${String(name)}`) } })
  const queue = loadTrustedGameplayModule('server/utils/intercedeClaims.ts', {})
  const handler = loadTrustedGameplayModule('server/api/encounters/[id]/responses.post.ts', {
    '../../../db': { db, ...tables }, 'drizzle-orm': { eq: () => ({}), inArray: () => ({}) },
    '../../../utils/pushPull': stub, '../../../utils/applyEffect': stub, '../../../utils/resolveSupportAttack': stub,
    '../../../utils/triggerCounterattack': stub, '../../../utils/resolveNpcAttack': stub, '../../../utils/selectiveTargeting': stub,
    '../../../utils/digizoidArmor': stub, '../../../utils/clashArmor': stub, '../../../utils/damageOverTime': stub,
    '../../../utils/enemyKnockouts': stub, '../../../utils/guidingLight': stub, '../../../utils/intercedeClaims': queue,
  }).default
  return {
    writes, state: () => copy(stored),
    submit: id => handler({
      encounterId: 'encounter',
      body: { requestId: id, tamerId: 'tamer-1', response: { type: 'dodge-rolled', dodgeDicePool: 2, dodgeSuccesses: 1, dodgeDiceResults: [5, 1] } },
    }),
  }
}

test('each target of a cast is answered once: retries and overlapping sends cannot repeat one, or disturb another', async () => {
  const server = castServer([dodge('a', 'tamer-p'), dodge('b', 'mon-p')])
  await server.submit('a')
  await Promise.all([server.submit('a'), server.submit('b'), server.submit('b'), server.submit('a')])
  const state = server.state()
  assert.deepEqual(state.requestResponses.map(r => r.requestId).sort(), ['a', 'b'], 'one response per target')
  assert.deepEqual(state.pendingRequests.map(r => [r.id, !!r.answeredAt]), [['a', true], ['b', true]])
  assert.equal(server.writes.length, 2, 'two answers, two writes: the repeats wrote nothing')
})

// --- the panel ----------------------------------------------------------------------------------------------

async function render(props) {
  const defaults = {
    nameFor: request => ({ 'tamer-p': 'Tamer Tia', 'mon-p': 'Agumon', 'mon-q': 'Gabumon' })[request.targetParticipantId],
    inspiration: 4, maxInspiration: 6, actCost: 2, settled: false, running: false,
  }
  return renderToString(createSSRApp({ render: () => h(AreaDefensePanel, { ...defaults, ...props }) }))
}

function view(id, target, overrides = {}) {
  return {
    ...(() => {
      const request = dodge(id, target)
      return {
        requestId: id, request, status: 'idle', roll: null, actOfInspiration: false, actPaid: false, rerolls: 0, extraDice: 0,
        busy: false, error: null, responseId: null, summary: null, answeredElsewhere: false,
      }
    })(),
    defense: { pool: 4, blocked: false, half: false, basePool: 4, modifiers: [] },
    ...overrides,
  }
}

test('the panel shows one card per target with its own pool, modifiers, controls and status', async () => {
  const html = await render({ views: [
    view('a', 'tamer-p', { defense: { pool: 3, blocked: false, half: false, basePool: 5, modifiers: [{ label: 'Stance', value: 1 }, { label: 'Successive attack penalty', value: -3 }] } }),
    view('b', 'mon-p', { status: 'rolled', roll: { rolls: [6, 2, 5], successes: 2, dicePool: 3 } }),
    view('c', 'mon-q', { status: 'failed', roll: { rolls: [1], successes: 0, dicePool: 1 }, error: 'network down' }),
  ] })
  assert.equal((html.match(/<li /g) || []).length, 3)
  for (const name of ['Tamer Tia', 'Agumon', 'Gabumon']) assert.ok(html.includes(name), name)
  assert.ok(html.includes('Roll all unrolled'))
  assert.ok(html.includes('Submit ready defenses'))
  assert.ok(html.includes('Dodge pool 3d6'))
  assert.ok(html.includes('Stance +1') && html.includes('Successive attack penalty -3'), 'modifier chips')
  assert.ok(html.includes('Act of Inspiration (spend 2)'), 'the idle target can choose Act of Inspiration')
  assert.ok(html.includes('Roll Dodge'))
  assert.ok(html.includes('Submit this defense'), 'a rolled target can be submitted on its own')
  assert.ok(html.includes('Re-roll (1 Inspiration)') && html.includes('+1 Die (1 Inspiration)'))
  assert.ok(html.includes('Retry submit (same roll)') && html.includes('network down'))
  assert.ok(html.includes('Not rolled') && html.includes('Rolled — ready to submit') && html.includes('Failed — roll kept'))
  assert.equal(html.includes('>Close<'), false, 'no Close while a defense is still open')
})

test('the panel closes only once settled, and reports each outcome', async () => {
  const html = await render({ settled: true, views: [
    view('a', 'tamer-p', { status: 'submitted', roll: { rolls: [5, 5], successes: 2, dicePool: 2 }, summary: { hit: false, finalDamage: 0, netSuccesses: 0 } }),
    view('b', 'mon-p', { status: 'submitted', roll: { rolls: [1], successes: 0, dicePool: 1 }, summary: { hit: true, finalDamage: 3, netSuccesses: 1 } }),
    view('c', 'mon-q', { status: 'unavailable', error: 'This defense is no longer needed.' }),
  ] })
  assert.ok(html.includes('Dodged — no damage.'))
  assert.ok(html.includes('Hit — 3 damage.'))
  assert.ok(html.includes('No longer needed'))
  assert.ok(html.includes('>Close<'))
  assert.equal(html.includes('Re-roll'), false, 'a submitted defense offers no more spending')
  assert.equal(html.includes('Roll Dodge'), false)
})

test('a blocked target says so and offers no Act of Inspiration', async () => {
  const html = await render({ views: [view('a', 'tamer-p', { defense: { pool: 0, blocked: true, half: false, basePool: 4, modifiers: [] } })] })
  assert.ok(html.includes('Cannot dodge'))
  assert.ok(html.includes('Locked in a clash'))
  assert.equal(html.includes('Act of Inspiration (spend'), false)
})

test('Act of Inspiration is unavailable without enough Inspiration', async () => {
  const html = await render({ inspiration: 1, views: [view('a', 'tamer-p')] })
  assert.match(html, /<input[^>]*type="checkbox"[^>]*disabled/)
})

// --- the page -----------------------------------------------------------------------------------------------

test('the page opens the panel for a cast of two or more, keeps one-request attacks on the modal, and syncs updates', () => {
  const opened = []
  const reconciled = []
  const active = ref(false)
  const groupId = ref(null)
  const pending = ref(null)
  const myRequests = ref([dodge('a', 'tamer-p'), dodge('b', 'mon-p'), dodge('z', 'tamer-p', { intercedeGroupId: undefined })])
  const { syncAreaDefenseBatch } = loadPageFunctions(PLAYER_PAGE, ['syncAreaDefenseBatch'], {
    areaDefenseBatch: {
      active, groupId,
      open: (id, requests) => { opened.push([id, requests.map(r => r.id)]); active.value = true; groupId.value = id },
      reconcile: requests => reconciled.push(requests.map(r => r.id)),
    },
    pendingAreaDefenseGroup: pending, myRequests,
  })
  syncAreaDefenseBatch()
  assert.deepEqual(opened, [], 'nothing to open until a cast with two or more of my targets exists')

  pending.value = groupDodgeRequests(myRequests.value).find(g => g.isCast && g.requests.length >= 2)
  syncAreaDefenseBatch()
  assert.deepEqual(opened, [['cast-1', ['a', 'b']]])

  syncAreaDefenseBatch()
  assert.deepEqual(reconciled, [['a', 'b']], 'while open, updates are reconciled with only that cast, not the single-target request')
  assert.equal(opened.length, 1)
})

test('closing the panel cancels every request and deletes every response once, then clears it', async () => {
  const calls = []
  const dismissedResponseIds = new Set()
  const groupId = ref('cast-1')
  const { cleanupAreaDefense } = loadPageFunctions(PLAYER_PAGE, ['cleanupAreaDefense', 'cleanupDodgeExchange', 'isServerResponseId'], {
    activeEncounter: ref({ id: 'encounter' }),
    cancelRequest: async (_encounter, id) => { calls.push(['cancel', id]) },
    deleteResponse: async (_encounter, id) => { calls.push(['delete', id]) },
    dismissedResponseIds,
    areaDefenseBatch: {
      groupId,
      cleanupTargets: () => [
        { requestId: 'a', responseId: 'resp-a' }, { requestId: 'b', responseId: 'resp-b' }, { requestId: 'c', responseId: null },
      ],
      close: () => { groupId.value = null; calls.push(['close']) },
    },
    syncAreaDefenseBatch: () => calls.push(['sync']),
    console,
  })
  await cleanupAreaDefense()
  assert.deepEqual(calls, [
    ['cancel', 'a'], ['delete', 'resp-a'], ['cancel', 'b'], ['delete', 'resp-b'], ['cancel', 'c'], ['close'], ['sync'],
  ])
  assert.deepEqual([...dismissedResponseIds], ['resp-a', 'resp-b'])
})

test('closing a settled batch immediately opens the next cast after all cleanup updates arrived', async () => {
  const requests = [dodge('a', 'tamer-p'), dodge('b', 'mon-p'),
    dodge('c', 'tamer-p', { intercedeGroupId: 'cast-2' }), dodge('d', 'mon-p', { intercedeGroupId: 'cast-2' })]
  const { batch } = harness()
  batch.open('cast-1', requests.slice(0, 2))
  for (const entry of batch.entries.value) entry.status = 'submitted'
  const myRequests = ref(requests)
  const pending = computed(() => groupDodgeRequests(myRequests.value).find(g => g.isCast && g.requests.length >= 2))
  const { syncAreaDefenseBatch, cleanupAreaDefense } = loadPageFunctions(PLAYER_PAGE,
    ['syncAreaDefenseBatch', 'cleanupAreaDefense'], {
      activeEncounter: ref({ id: 'encounter' }), areaDefenseBatch: batch, myRequests,
      pendingAreaDefenseGroup: pending, dismissedResponseIds: new Set(),
      cleanupDodgeExchange: async (requestId, _responseId, encounterId) => {
        assert.equal(encounterId, 'encounter')
        myRequests.value = myRequests.value.filter(request => request.id !== requestId)
        await nextTick()
      },
    })
  const stop = watch(myRequests, syncAreaDefenseBatch)
  try {
    await cleanupAreaDefense()
    await nextTick()
    assert.equal(batch.active.value, true)
    assert.equal(batch.groupId.value, 'cast-2')
    assert.deepEqual(batch.entries.value.map(entry => [entry.requestId, entry.status]), [['c', 'idle'], ['d', 'idle']])
  } finally {
    stop()
  }
})

test('an old batch cleanup cannot close a batch from a newly selected encounter', async () => {
  const { batch } = harness()
  const activeEncounter = ref({ id: 'old' })
  const cleaned = []
  const { cleanupAreaDefense } = loadPageFunctions(PLAYER_PAGE, ['cleanupAreaDefense'], {
    activeEncounter, areaDefenseBatch: batch, dismissedResponseIds: new Set(),
    cleanupDodgeExchange: async (requestId, _responseId, encounterId) => {
      cleaned.push([requestId, encounterId])
      activeEncounter.value = { id: 'new' }
      batch.open('new-cast', [dodge('new', 'mon-p')])
    },
    syncAreaDefenseBatch: unexpected,
  })
  await cleanupAreaDefense()
  assert.equal(batch.groupId.value, 'new-cast')
  assert.deepEqual(cleaned, [['a', 'old'], ['b', 'old'], ['c', 'old']])
})

test('sending a defense reports failure instead of throwing, keeps the roll out of it, and returns the response id and result', async () => {
  const applied = []
  const respond = async (_encounter, _request, _tamer, response) => ({
    id: 'encounter',
    requestResponses: [{ id: 'resp-9', requestId: 'a', tamerId: 'tamer-1', response }],
    battleLog: [{ action: 'Dodge', actorId: 'tamer-p', hit: true, finalDamage: 2, netSuccesses: 1 }],
  })
  const deps = {
    activeEncounter: ref({ id: 'encounter' }), tamer: ref({ id: 'tamer-1' }), applyActionResult: async (...args) => { applied.push(args) },
    summarizeDodgeResult, console,
  }
  const roll = { rolls: [5, 1], successes: 1, dicePool: 2 }
  const ok = loadPageFunctions(PLAYER_PAGE, ['submitAreaDefense'], { ...deps, respondToRequest: respond }).submitAreaDefense
  const outcome = await ok(dodge('a', 'tamer-p'), roll)
  assert.deepEqual(outcome, { ok: true, responseId: 'resp-9', summary: { hit: true, finalDamage: 2, netSuccesses: 1 } })
  assert.equal(applied[0][1], 'dodge')
  assert.equal(applied[0][0].requestResponses[0].response.dodgeDiceResults.join(), '5,1', 'the roll goes out exactly as held')

  const refused = loadPageFunctions(PLAYER_PAGE, ['submitAreaDefense'], { ...deps, respondToRequest: async () => null }).submitAreaDefense
  assert.equal((await refused(dodge('a', 'tamer-p'), roll)).ok, false)
  const broken = loadPageFunctions(PLAYER_PAGE, ['submitAreaDefense'], { ...deps, respondToRequest: async () => { throw Object.assign(new Error('x'), { data: { message: 'offline' } }) } }).submitAreaDefense
  assert.deepEqual(await broken(dodge('a', 'tamer-p'), roll), { ok: false, message: 'offline' })
  assert.equal(applied.length, 1, 'nothing is applied for a failed send')
})

test('page wiring: the modal skips requests the panel owns; the panel dismisses through the shared cleanup', () => {
  const page = readFileSync(new URL(`../${PLAYER_PAGE}`, import.meta.url), 'utf8')
  assert.match(page, /r\.type === 'dodge-roll' && !areaDefenseRequestIds\.value\.has\(r\.id\)/)
  assert.match(page, /<AreaDefensePanel[\s\S]*?:settled="areaDefenseBatch\.isSettled\.value"/)
  for (const handler of ['toggle-act', 'roll', 'reroll', 'add-die', 'submit', 'roll-all', 'submit-ready', 'close']) {
    assert.match(page, new RegExp(`@${handler}="areaDefense`), `${handler} is wired`)
  }
  const spend = page.slice(page.indexOf('async function handleSpendInspiration'), page.indexOf('async function handleSpendInspiration') + 900)
  assert.match(spend, /Promise<boolean>/, 'the spend reports whether it went through')
  const key = page.match(/const areaDefenseDismissal = useAutoDismiss\(\{\s*key: ([\s\S]*?)\n  cleanup:/)[1]
  assert.match(key, /isSettled/, 'only a finished panel times out')
  assert.doesNotMatch(key, /has\w*Request|myRequests/)
})

test('the composable takes nothing from the page it does not need', async () => {
  // No page import: it is driven entirely through adapters, so it can be tested and reused.
  const source = readFileSync(new URL('../composables/useAreaDefenseBatch.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /pages\/|useEncounters|\$fetch/)
  await nextTick()
})
