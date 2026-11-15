import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { computed, ref } from 'vue'
import { loadPageComputed, loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { availableCombatStances, combatStanceError, clearHealedBraveStance } = loadTypeScript('utils/combatStances.ts')
const normal = ['neutral', 'defensive', 'offensive']
const sniper = { id: 'data-specialization', choiceId: 'sniper', ranks: 1 }
const braveheart = { id: 'braveheart', ranks: 1 }
const actor = (values = {}) => ({ id: 'actor', type: 'digimon', entityId: 'mon', currentStance: 'neutral', currentWounds: 12, maxWounds: 20, actionsRemaining: { simple: 2 }, ...values })
const keys = ['getRouterParam', 'readBody', 'createError']
const originals = new Map(keys.map(key => [key, globalThis[key]]))
afterEach(() => { for (const [key, value] of originals) value === undefined ? delete globalThis[key] : globalThis[key] = value })

test('special stances require their own active Digimon qualities', () => {
  assert.deepEqual(availableCombatStances(actor()), normal)
  assert.deepEqual(availableCombatStances(actor(), [{ id: 'data-optimization', choiceId: 'ranged-striker', ranks: 1 }]), normal)
  assert.deepEqual(availableCombatStances(actor(), [sniper]), [...normal, 'sniper'])
  assert.deepEqual(availableCombatStances(actor(), [{ id: 'sniper', ranks: 1 }]), [...normal, 'sniper'], 'legacy Sniper quality is supported')
  assert.deepEqual(availableCombatStances(actor(), [braveheart]), [...normal, 'brave'])
  assert.deepEqual(availableCombatStances(actor(), [{ ...sniper, ranks: 0 }, { ...braveheart, ranks: 0 }]), normal)
  assert.deepEqual(availableCombatStances(actor({ type: 'tamer' }), [sniper, braveheart]), normal)
})

test('Braveheart requires strictly less than half health to enter and a conscious Digimon', () => {
  for (const [currentWounds, canEnter] of [[0, false], [9, false], [10, false], [11, true], [19, true], [20, false]]) {
    assert.equal(availableCombatStances(actor({ currentWounds }), [braveheart]).includes('brave'), canEnter)
  }
  assert.equal(combatStanceError(actor({ maxWounds: 9, currentWounds: 5 }), 'brave', [braveheart]), null)
  assert.ok(availableCombatStances(actor({ currentStance: 'brave', currentWounds: 10 }), [braveheart]).includes('brave'), 'an existing stance remains at exactly half')
})

test('healing above half removes Brave without spending an action or mutating the input', () => {
  const healthy = actor({ currentStance: 'brave', currentWounds: 9 })
  const updated = clearHealedBraveStance(healthy)
  assert.equal(updated.currentStance, 'neutral')
  assert.equal(updated.actionsRemaining.simple, 2)
  assert.equal(healthy.currentStance, 'brave')
  const half = actor({ currentStance: 'brave', currentWounds: 10 })
  assert.equal(clearHealedBraveStance(half), half)
})

for (const [role, page] of [
  ['player', 'pages/campaigns/[campaignId]/player/[tamerId].vue'],
  ['GM', 'pages/campaigns/[campaignId]/encounters/[id].vue'],
]) test(`${role} stance choices and actual map radial menus react to qualities and health`, () => {
  const participant = ref(actor()), digimonMap = ref(new Map([['mon', { qualities: [] }]]))
  const currentEncounter = computed(() => ({ participants: [participant.value] }))
  const { getParticipantStances } = loadPageFunctions(page, ['getParticipantStances'], { availableCombatStances, digimonMap, currentEncounter })
  const options = loadPageComputed(page, 'mapRadialOptions', {
    computed, currentEncounter, myParticipants: computed(() => [participant.value]), getParticipantStances,
    getParticipantAttacks: () => [], getModeChangePairs: () => [], digimonMap,
    getParticipantEvolutionOptions: () => ({ evolveTargets: [] }),
  })
  const choices = () => options.value.actor.stances.map(item => item.id)
  assert.deepEqual(getParticipantStances(participant.value), normal)
  assert.deepEqual(choices(), normal)
  digimonMap.value.set('mon', { qualities: [sniper, braveheart] })
  assert.deepEqual(choices(), [...normal, 'sniper', 'brave'])
  participant.value.currentWounds = 10
  assert.deepEqual(choices(), [...normal, 'sniper'])
  participant.value.currentStance = 'brave'
  assert.ok(choices().includes('brave'))
  participant.value.currentWounds = 9
  assert.deepEqual(choices(), [...normal, 'sniper'])
})

function routeFixture(qualities = [], values = {}) {
  Object.assign(globalThis, { getRouterParam: () => 'enc', readBody: async event => event.body,
    createError: value => Object.assign(new Error(value.message), value) })
  const participant = actor(values), encounter = { id: 'enc', phase: 'combat', participants: [participant], battleLog: [] }
  const writes = []
  const route = loadTypeScriptWithMocks('server/api/encounters/[id]/actions/stance.post.ts', {
    '../../../../utils/encounterCommand': { defineEncounterCommand: work => work },
    '../../../../utils/encounterAuthorization': { authorizeEncounterIntent: async () => {} },
    '../../../../utils/intercedeClaims': { serializeIntercedeClaim: (_id, work) => work() },
    '../../../../utils/participantTurn': { canActOnEncounterTurn: async () => true },
    '../../../../utils/combatSpatial': { loadParticipantDigimon: async () => new Map([['mon', { qualities }]]) },
    '../../../../utils/participantActionLog': { createParticipantActionLog: async () => ({ action: 'stance' }) },
    '../../../../utils/encounterCommandReceipt': { includeEncounterCommandReceipt: (_id, rows) => rows, markEncounterCommandReceiptSaved: () => {} },
    '../../../../db': { encounters: { id: 'id' }, digimon: {}, db: { update: () => ({ set: patch => ({ where: () => ({ returning: async () => {
      writes.push(patch); return [{ ...encounter, ...patch }]
    } }) }) }) } },
  }).default
  return { participant, writes, change: stance => route({ body: { participantId: 'actor', stance, operationId: 'stance-op' } }, { encounter }) }
}

for (const stance of ['sniper', 'brave']) test(`the stance API rejects unqualified ${stance} before spending actions or writing`, async () => {
  const f = routeFixture()
  await assert.rejects(f.change(stance), { statusCode: 400 })
  assert.equal(f.writes.length, 0)
  assert.equal(f.participant.actionsRemaining.simple, 2)
})

test('the stance API enforces the Braveheart health threshold and accepts qualified stances', async () => {
  const invalid = routeFixture([braveheart], { currentWounds: 10 })
  await assert.rejects(invalid.change('brave'), { statusCode: 400 })
  for (const [stance, qualities] of [['brave', [braveheart]], ['sniper', [sniper]]]) {
    const f = routeFixture(qualities)
    const result = await f.change(stance)
    assert.equal(result.participants[0].currentStance, stance)
    assert.equal(result.participants[0].actionsRemaining.simple, 1)
    assert.equal(f.writes.length, 1)
  }
})

test('the health finalizer durably clears healed Brave stance in ordinary and wrapped command responses', async () => {
  for (const wrapped of [false, true]) {
    let writes = 0
    const encounter = { id: 'enc', phase: 'combat', participants: [actor({ currentStance: 'brave', currentWounds: 9 })] }
    const { finishBraveStanceHealthChange } = loadTypeScriptWithMocks('server/utils/braveStance.ts', {
      '../db': { encounters: { id: 'id' }, db: { update: () => ({ set: patch => ({ where: () => ({ returning: async () => {
        writes++; return [{ ...encounter, ...patch }]
      } }) }) }) } },
    })
    const result = wrapped ? { encounter } : encounter
    await finishBraveStanceHealthChange('enc', { participants: [actor({ currentStance: 'brave' })] }, result)
    assert.equal(encounter.participants[0].currentStance, 'neutral')
    assert.equal(encounter.participants[0].actionsRemaining.simple, 2)
    assert.equal(writes, 1)
  }
})

test('GM participant updates cannot bypass special stance prerequisites', async () => {
  globalThis.createError = value => Object.assign(new Error(value.message), value)
  const { updateEncounterState } = loadTypeScriptWithMocks('server/utils/encounterUpdate.ts', {
    './combatRecordCache': { withCombatRecords: work => work() },
    './encounterStateScope': { validateEncounterStateScope: async () => {} },
    './combatSpatial': { loadParticipantDigimon: async () => new Map([['mon', { qualities: [] }]]), loadTamersByIds: async () => new Map() },
  })
  const existing = { id: 'enc', phase: 'combat', participants: [actor()] }
  for (const currentStance of ['sniper', 'brave']) {
    await assert.rejects(updateEncounterState('enc', { participants: [actor({ currentStance })] }, existing), { statusCode: 400 })
    assert.equal(existing.participants[0].currentStance, 'neutral')
  }
})
