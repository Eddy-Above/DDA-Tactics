import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { computed, reactive } from 'vue'
import { loadPageFunctions, loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const naturewalk = loadTypeScript('utils/naturewalk.ts')
const globals = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
const original = new Map(globals.map(name => [name, globalThis[name]]))
afterEach(() => { for (const [name, value] of original) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value } })
const environment = (elements, useMapTerrain = false) => [{ id: naturewalk.NATUREWALK_ENVIRONMENT_ID, naturewalkEnvironment: { elements, useMapTerrain } }]

function fixture() {
  globalThis.defineEventHandler = handler => handler
  globalThis.getRouterParam = () => 'enc'
  globalThis.readBody = async event => event.body
  globalThis.createError = options => Object.assign(new Error(options.message), options)
  let encounter = { id: 'enc', campaignId: 'campaign', mapId: null, phase: 'combat', round: 1,
    currentTurnIndex: 0, turnOrder: ['unit'], hazards: [],
    participants: [{ id: 'unit', type: 'digimon', entityId: 'mon', currentWounds: 0, maxWounds: 10, currentTempWounds: 0, activeEffects: [] }] }
  const records = new Map([['mon', { id: 'mon', qualities: [{ id: 'naturewalk', choiceId: 'water' }, { id: 'advanced-mobility', choiceId: 'adv-swimmer' }] }]])
  const control = { writes: 0, gmChecks: 0, isGm: true }
  const db = {
    select: () => ({ from: () => ({ where: async () => [structuredClone(encounter)] }) }),
    update: () => ({ set: fields => ({ where: async () => { control.writes++; encounter = { ...encounter, ...structuredClone(fields) } } }) }),
  }
  const spatial = { loadParticipantDigimon: async () => records, loadTamersByIds: async () => new Map(), loadEncounterMap: async () => null }
  const room = { getRoomSnapshot: async () => ({ participantPositions: {}, destructibleStates: [] }), getRoomPositions: async () => ({}) }
  const helper = loadTypeScriptWithMocks('server/utils/naturewalk.ts', { './combatSpatial': spatial, './encounterRoom': room })
  const handler = loadTypeScriptWithMocks('server/api/encounters/[id].put.ts', {
    '../../db': { db, encounters: { id: 'id' } }, 'drizzle-orm': { eq: () => null },
    '../../utils/combatSpatial': spatial, '../../utils/naturewalk': helper,
    '../../utils/encounterRoom': room,
    '../../utils/guidingLight': { applyGuidingLightAuras: async participants => ({ participants, changed: false }) },
    '../../utils/encounterStartTriggers': { applyEncounterStartTriggers: async participants => participants },
    '../../utils/combatContext': { loadCampaignCombatContext: async () => ({ campaignLevel: 'standard', houseRules: {} }) },
    '../../utils/enemyKnockouts': { knockedOutEnemyIds: () => [] },
    '../../utils/campaignDm': { requireCampaignDm: async () => { control.gmChecks++; if (!control.isGm) throw Object.assign(new Error('GM required'), { statusCode: 403 }) } },
  }).default
  return { control, records, state: () => encounter, save: body => handler({ body }) }
}

test('only the GM changes Naturewalk environments, which immediately refresh the current roster', async () => {
  const f = fixture()
  f.control.isGm = false
  await assert.rejects(f.save({ hazards: environment(['water']) }), { statusCode: 403 })
  assert.equal(f.control.writes, 0)
  f.control.isGm = true
  await f.save({ hazards: environment(['water']) })
  assert.deepEqual(f.state().participants[0].naturewalkActiveElements, ['water'])
  assert.equal(f.state().participants[0].currentTempWounds, 2)
  assert.equal(f.state().participants[0].naturewalkWaterGranted, true)
  await f.save({ hazards: environment([]) })
  assert.deepEqual(f.state().participants[0].naturewalkActiveElements, [])
  await f.save({ hazards: environment(['water']) })
  assert.equal(f.state().participants[0].currentTempWounds, 2, 're-entering the environment cannot replenish wounds')
})

test('a stale roster cannot erase the Water grant marker or inject active environments', async () => {
  const f = fixture()
  await f.save({ hazards: environment(['water']) })
  const stale = { ...f.state().participants[0], currentTempWounds: 0, naturewalkWaterGranted: false, naturewalkActiveElements: ['fire'] }
  await f.save({ participants: [stale] })
  assert.equal(f.state().participants[0].currentTempWounds, 0)
  assert.equal(f.state().participants[0].naturewalkWaterGranted, true)
  assert.deepEqual(f.state().participants[0].naturewalkActiveElements, ['water'])
})

test('ending and restarting combat clears temporary wounds and grants the next combat allowance', async () => {
  const f = fixture()
  await f.save({ hazards: environment(['water']) })
  await f.save({ phase: 'ended' })
  assert.equal(f.state().participants[0].currentTempWounds, 0)
  await f.save({ phase: 'combat' })
  assert.equal(f.state().participants[0].currentTempWounds, 2)
})

test('the GM environment controls create and update the persisted hazard settings', () => {
  const props = reactive({ hazards: [] })
  const emissions = []
  const handlers = loadPageFunctions('components/HazardManager.vue', ['setNaturewalkEnvironment'], {
    props, NATUREWALK_ENVIRONMENT_ID: naturewalk.NATUREWALK_ENVIRONMENT_ID,
    naturewalkEnvironment: computed(() => naturewalk.getNaturewalkEnvironmentSettings(props.hazards)),
    emit: (event, hazard) => { emissions.push(event); props.hazards = [hazard] },
  })
  handlers.setNaturewalkEnvironment('wind', true)
  handlers.setNaturewalkEnvironment(null, false)
  assert.deepEqual(emissions, ['add', 'update'])
  assert.deepEqual(props.hazards[0].naturewalkEnvironment, { elements: ['wind'], useMapTerrain: false })
  handlers.setNaturewalkEnvironment('wind', false)
  assert.equal(props.hazards[0].effect, 'No qualifying environments.')
})
