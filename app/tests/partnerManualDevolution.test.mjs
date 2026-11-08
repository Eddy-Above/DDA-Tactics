import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const originals = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => {
  for (const [name, value] of originals) {
    if (value === undefined) delete globalThis[name]
    else globalThis[name] = value
  }
})

const copy = value => structuredClone(value)

function harness({ withTamer = true, actor = {}, currentRecord = {}, parentRecord = {}, line = {}, currentTurnId, rules = {} } = {}) {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'encounter'
  globalThis.readBody = async body => body
  globalThis.createError = data => Object.assign(new Error(data.message), data)

  const tables = Object.fromEntries(['encounters', 'digimon', 'evolutionLines', 'tamers']
    .map(name => [name, { name, id: name }]))
  const actorState = {
    id: 'partner', type: 'digimon', entityId: 'champion', evolutionLineId: 'line',
    currentWounds: 12, maxWounds: 25, totalHealth: 20, activeEffects: [],
    actionsRemaining: { simple: 2 }, combatMonsterBonus: 14,
    ...actor,
  }
  const tamerState = { id: 'owner', type: 'tamer', entityId: 'tai', actionsRemaining: { simple: 2 }, activeEffects: [] }
  let encounter = {
    id: 'encounter', campaignId: 'campaign', phase: 'combat', round: 3,
    participants: withTamer ? [tamerState, actorState] : [actorState],
    turnOrder: [currentTurnId ?? (withTamer ? 'owner' : 'partner')], currentTurnIndex: 0, battleLog: [],
  }
  const records = {
    champion: {
      id: 'champion', name: 'Greymon', partnerId: 'tai', isEnemy: false, stage: 'champion',
      baseStats: { health: 15 }, bonusStats: {}, qualities: [], currentWounds: 9,
      ...currentRecord,
    },
    rookie: {
      id: 'rookie', name: 'Agumon', partnerId: 'tai', isEnemy: false, stage: 'rookie',
      baseStats: { health: 5 }, bonusStats: { health: 2 },
      qualities: [{ id: 'digizoid-armor', choiceId: 'red' }, { id: 'combat-monster' }], currentWounds: 4,
      ...parentRecord,
    },
  }
  let evolutionLine = {
    id: 'line', currentStageIndex: 1,
    chain: [
      { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: null, isUnlocked: false },
      { digimonId: 'champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
      { digimonId: 'sibling', species: 'Tyrannomon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
    ],
    ...line,
  }
  const writes = []
  const reads = []
  const auraRosters = []
  const db = {
    select: () => ({ from: table => ({ where: async ({ value }) => {
      reads.push({ table: table.name, id: value })
      if (table === tables.encounters) return encounter.id === value ? [copy(encounter)] : []
      if (table === tables.evolutionLines) return evolutionLine.id === value ? [copy(evolutionLine)] : []
      if (table === tables.digimon) return records[value] ? [copy(records[value])] : []
      throw new Error(`Unexpected read from ${table.name}`)
    } }) }),
    update: table => ({ set: fields => ({ where: async ({ value }) => {
      writes.push({ table: table.name, id: value, fields: copy(fields) })
      if (table === tables.encounters) encounter = { ...encounter, ...copy(fields) }
      else if (table === tables.evolutionLines) evolutionLine = { ...evolutionLine, ...copy(fields) }
      else throw new Error(`Unexpected write to ${table.name}`)
    } }) }),
  }
  const dbModule = { db, ...tables }
  const drizzle = { eq: (_column, value) => ({ value }) }
  const partnerDevolution = loadTypeScriptWithMocks('server/utils/partnerDevolution.ts', {
    '../db': dbModule,
    'drizzle-orm': drizzle,
  })
  const handler = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/digivolve.post.ts', {
    '../../../../db': dbModule,
    'drizzle-orm': drizzle,
    '../../../../utils/partnerDevolution': partnerDevolution,
    '../../../../utils/combatContext': { loadCampaignCombatContext: async () => ({ campaignLevel: 'standard', eddySoulRules: rules, houseRules: {} }) },
    '../../../../utils/encounterRoom': { getRoomPositions: async () => ({ partner: { x: 1, y: 0, z: 1 } }) },
    '../../../../utils/guidingLight': { applyGuidingLightAuras: async participants => {
      auraRosters.push(copy(participants))
      return { participants, changed: false }
    } },
  }).default
  return {
    handler, records, writes, reads, auraRosters,
    encounter: () => encounter,
    line: () => evolutionLine,
    devolve: (overrides = {}) => handler({ participantId: 'partner', targetChainIndex: 0, ...overrides }),
  }
}

test('manual partner devolution without combat history restores the locked parent sheet wounds and totals', async () => {
  const h = harness()
  const updated = await h.devolve()
  const actor = updated.participants.find(p => p.id === 'partner')
  assert.deepEqual([actor.entityId, actor.currentWounds, actor.maxWounds, actor.totalHealth], ['rookie', 4, 11, 9])
  assert.deepEqual(actor.woundsHistory, [])
  assert.equal(actor.combatMonsterBonus, 9)
  assert.equal(actor.actionsRemaining.simple, 2)
  assert.equal(updated.participants.find(p => p.id === 'owner').actionsRemaining.simple, 1)
  assert.equal(h.line().currentStageIndex, 0)
  assert.equal(updated.battleLog.at(-1).result, 'Wounds restored to 4')
  assert.equal(h.auraRosters[0].find(p => p.id === 'partner').currentWounds, 4)
  assert.ok(h.writes.every(write => write.table !== 'digimon'), 'combat changes must not overwrite character sheets')
  assert.equal(h.records.rookie.currentWounds, 4)
  assert.deepEqual(h.reads.filter(read => read.table === 'digimon').map(read => read.id), ['champion', 'rookie'], 'the loaded parent record supplies the fallback without duplicate queries')
})

test('a true partner can restore its parent without its Tamer in the roster, paying its existing own-action fallback', async () => {
  const h = harness({ withTamer: false, actor: { hasAttemptedDigivolve: true } })
  const updated = await h.devolve()
  assert.equal(updated.participants[0].currentWounds, 4)
  assert.equal(updated.participants[0].actionsRemaining.simple, 1)
  assert.equal(updated.participants[0].hasAttemptedDigivolve, true, 'a prior evolution attempt must not prevent devolution')
  assert.equal(updated.participants[0].npcStageIndex, undefined)
  assert.equal(h.line().currentStageIndex, 0, 'an absent Tamer must not make a partner use NPC form tracking')
})

test('manual devolution consumes the saved combat snapshot before considering parent sheet values', async () => {
  const history = [{ stageIndex: 0, entityId: 'rookie', wounds: 1, maxWounds: 8, totalHealth: 6 }]
  const h = harness({ actor: { woundsHistory: history }, line: { currentStageIndex: 0 } })
  const updated = await h.devolve()
  const actor = updated.participants.find(p => p.id === 'partner')
  assert.deepEqual([actor.entityId, actor.currentWounds, actor.maxWounds, actor.totalHealth], ['rookie', 1, 8, 6])
  assert.deepEqual(actor.woundsHistory, [])
  assert.equal(actor.combatMonsterBonus, 6)
  assert.equal(h.records.rookie.currentWounds, 4)
})

test('a root form cannot devolve to itself and unrelated or out-of-range targets are rejected without writes', async () => {
  for (const { options, target, message } of [
    { options: { actor: { entityId: 'rookie' }, line: { currentStageIndex: 0 } }, target: 0, message: /direct child.*parent/ },
    { options: {}, target: 2, message: /direct child.*parent/ },
    { options: {}, target: -1, message: /out of range/ },
    { options: {}, target: 9, message: /out of range/ },
  ]) {
    const h = harness(options)
    await assert.rejects(h.devolve({ targetChainIndex: target }), error => error.statusCode === 400 && message.test(error.message))
    assert.deepEqual(h.writes, [])
    assert.equal(h.encounter().participants.find(p => p.id === 'partner').entityId, options.actor?.entityId ?? 'champion')
  }
})

test('manual devolution retains action affordability and current-turn validation', async () => {
  for (const { options, message } of [
    { options: { withTamer: false, actor: { actionsRemaining: { simple: 0 } } }, message: /Not enough actions/ },
    { options: { withTamer: false, currentTurnId: 'somebody-else' }, message: /cannot act right now/ },
  ]) {
    const h = harness(options)
    await assert.rejects(h.devolve(), error => error.statusCode === 400 && message.test(error.message))
    assert.deepEqual(h.writes, [])
  }
})

test('an unresolved partner parent is rejected instead of falling through to the NPC full-heal fallback', async () => {
  const h = harness({ line: { chain: [
    { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: null, isUnlocked: false },
    { digimonId: 'different-champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
  ] } })
  await assert.rejects(h.devolve(), error => error.statusCode === 400 && /not linked/.test(error.message))
  assert.deepEqual(h.writes, [])
  const target = h.encounter().participants.find(p => p.id === 'partner')
  assert.equal(target.entityId, 'champion')
  assert.equal(target.currentWounds, 12)
})

test('force still bypasses turn and action requirements while restoring saved parent wounds', async () => {
  const h = harness({ withTamer: false, currentTurnId: 'somebody-else', actor: { actionsRemaining: { simple: 0 } }, line: { currentStageIndex: 0 } })
  const updated = await h.devolve({ force: true })
  assert.equal(updated.participants[0].currentWounds, 4)
  assert.equal(updated.participants[0].actionsRemaining.simple, 0)
  assert.equal(h.line().currentStageIndex, 0)
})

test('NPC devolution without combat history retains its prior full-heal and per-participant stage behavior', async () => {
  for (const currentRecord of [{ partnerId: null, isEnemy: true }, { partnerId: 'tai', isEnemy: true }]) {
    const h = harness({ withTamer: false, actor: { isEnemy: true, npcStageIndex: 1 }, currentRecord, line: { currentStageIndex: 0 } })
    const updated = await h.devolve()
    assert.equal(updated.participants[0].entityId, 'rookie')
    assert.equal(updated.participants[0].currentWounds, 0)
    assert.equal(updated.participants[0].actionsRemaining.simple, 1)
    assert.equal(updated.participants[0].npcStageIndex, 0)
    assert.equal(h.line().currentStageIndex, 0)
    assert.ok(h.writes.every(write => write.table === 'encounters'))
  }
})

test('ordinary forward evolution keeps its full heal, history snapshot, attempt flag and Tamer cost', async () => {
  const h = harness({ actor: { entityId: 'rookie', currentWounds: 3, maxWounds: 11, totalHealth: 9 }, line: { currentStageIndex: 1 } })
  const updated = await h.devolve({ targetChainIndex: 1 })
  const actor = updated.participants.find(p => p.id === 'partner')
  const owner = updated.participants.find(p => p.id === 'owner')
  assert.equal(actor.entityId, 'champion')
  assert.equal(actor.currentWounds, 0)
  assert.deepEqual(actor.woundsHistory, [{ stageIndex: 0, entityId: 'rookie', wounds: 3, maxWounds: 11, totalHealth: 9 }])
  assert.equal(owner.actionsRemaining.simple, 1)
  assert.equal(owner.hasAttemptedDigivolve, true)
  assert.equal(h.line().currentStageIndex, 1)
})

test('Tamer requests are rejected before any Digimon-table lookup', async () => {
  const h = harness()
  await assert.rejects(h.handler({ participantId: 'owner', targetChainIndex: 0, force: true }), error => error.statusCode === 400 && /Only digimon/.test(error.message))
  assert.deepEqual(h.reads, [{ table: 'encounters', id: 'encounter' }])
  assert.deepEqual(h.writes, [])
})

test('a stale stored root index cannot classify an actual partner parent as forward evolution', async () => {
  const h = harness({ line: {
    currentStageIndex: 0,
    chain: [
      { digimonId: 'fresh', species: 'Botamon', stage: 'fresh', evolvesFromIndex: null, isUnlocked: true },
      { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: 0, isUnlocked: false },
      { digimonId: 'champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 1, isUnlocked: true },
    ],
  } })
  const updated = await h.devolve({ targetChainIndex: 1 })
  const actor = updated.participants.find(p => p.id === 'partner')
  const owner = updated.participants.find(p => p.id === 'owner')
  assert.equal(actor.entityId, 'rookie')
  assert.equal(actor.currentWounds, 4)
  assert.deepEqual(actor.woundsHistory, [])
  assert.equal(owner.hasAttemptedDigivolve, undefined)
  assert.equal(owner.actionsRemaining.simple, 1)
  assert.equal(h.line().currentStageIndex, 1)
})

test('a stale stored line index and stale NPC index cannot reject the actual partner parent', async () => {
  const h = harness({ actor: { npcStageIndex: 8 }, line: { currentStageIndex: 0 } })
  const updated = await h.devolve()
  const actor = updated.participants.find(p => p.id === 'partner')
  assert.equal(actor.entityId, 'rookie')
  assert.equal(actor.currentWounds, 4)
  assert.equal(actor.npcStageIndex, undefined)
  assert.equal(h.line().currentStageIndex, 0)
})

test('legacy JSON chains resolve the actual partner stage before devolution', async () => {
  const chain = [
    { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: null, isUnlocked: false },
    { digimonId: 'champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
  ]
  const h = harness({ line: { currentStageIndex: 0, chain: JSON.stringify(chain) } })
  const updated = await h.devolve()
  assert.equal(updated.participants.find(p => p.id === 'partner').currentWounds, 4)
  assert.equal(h.line().currentStageIndex, 0)
})

function warpLine() {
  return [
    { digimonId: 'rookie', species: 'Agumon', stage: 'rookie', evolvesFromIndex: null, isUnlocked: false },
    { digimonId: 'champion', species: 'Greymon', stage: 'champion', evolvesFromIndex: 0, isUnlocked: true },
    { digimonId: 'ultimate', species: 'MetalGreymon', stage: 'ultimate', evolvesFromIndex: 1, isUnlocked: true },
    { digimonId: 'mega', species: 'WarGreymon', stage: 'mega', evolvesFromIndex: 2, isUnlocked: true },
  ]
}

test('warp checks and its saved history start from the actual partner stage', async () => {
  const h = harness({ rules: { warpEvolution: true }, line: { currentStageIndex: 0, chain: warpLine() } })
  h.records.mega = { id: 'mega', stage: 'mega', baseStats: { health: 20 }, qualities: [] }
  const updated = await h.devolve({ targetChainIndex: 3, rollTotal: 17 })
  const actor = updated.participants.find(p => p.id === 'partner')
  assert.equal(actor.entityId, 'mega')
  assert.equal(actor.currentWounds, 0)
  assert.deepEqual(actor.woundsHistory, [{ stageIndex: 1, entityId: 'champion', wounds: 12, maxWounds: 25, totalHealth: 20 }])
  assert.equal(updated.participants.find(p => p.id === 'owner').actionsRemaining.simple, 1)
  assert.equal(h.line().currentStageIndex, 3)
})

test('a stale child index cannot bypass the actual partner warp roll requirement', async () => {
  for (const rollTotal of [undefined, 16]) {
    const h = harness({ actor: { entityId: 'rookie' }, rules: { warpEvolution: true }, line: { currentStageIndex: 1, chain: warpLine() } })
    await assert.rejects(h.devolve({ targetChainIndex: 2, rollTotal }), error => error.statusCode === 400 && /Warp evolution/.test(error.message))
    assert.deepEqual(h.writes, [])
  }
})

test('the pure stage resolver prefers a matching node and otherwise finds the actual entity without mutating the chain', () => {
  const { resolveCombatEvolutionIndex } = loadTypeScriptWithMocks('utils/combatEvolutionOptions.ts', {})
  const chain = Object.freeze([Object.freeze({ digimonId: 'rookie' }), Object.freeze({ digimonId: 'champion' }), Object.freeze({ digimonId: 'rookie' })])
  assert.equal(resolveCombatEvolutionIndex(chain, 'rookie', 2), 2)
  assert.equal(resolveCombatEvolutionIndex(chain, 'rookie', 1), 0)
  for (const preferred of [-1, 20, 1.5, Number.NaN]) assert.equal(resolveCombatEvolutionIndex(chain, 'champion', preferred), 1)
  assert.equal(resolveCombatEvolutionIndex(chain, 'missing', 1), -1)
  assert.equal(resolveCombatEvolutionIndex([], 'missing', 0), -1)
  assert.equal(resolveCombatEvolutionIndex([undefined, { digimonId: 'champion' }], 'champion', 0), 1)
})
