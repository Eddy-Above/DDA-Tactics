import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

function fixture() {
  const campaigns = { id: 'campaign.id' }
  const encounters = { id: 'encounter.id' }
  const campaignRows = new Map()
  const encounterRows = new Map()
  const reads = []
  const context = loadTypeScriptWithMocks('server/utils/combatContext.ts', {
    'drizzle-orm': { eq: (column, id) => ({ column, id }) },
    '../db': {
      campaigns, encounters,
      db: { select: () => ({ from: table => ({ where: async ({ id }) => {
        reads.push({ table, id })
        const row = (table === campaigns ? campaignRows : encounterRows).get(id)
        return row ? [row] : []
      } }) }) },
    },
  })
  return { ...context, campaigns, encounters, campaignRows, encounterRows, reads }
}

const defaults = { campaignLevel: 'standard', rulesSettings: undefined, eddySoulRules: {}, houseRules: undefined }

test('an encounter without a campaign gets standard defaults without a campaign lookup', async () => {
  const f = fixture()
  for (const id of [undefined, null, '']) {
    assert.deepEqual(await f.loadCampaignCombatContext(id), defaults)
  }
  assert.deepEqual(f.reads, [])
})

test('a missing campaign uses the same defaults', async () => {
  const f = fixture()
  assert.deepEqual(await f.loadCampaignCombatContext('missing'), defaults)
  assert.deepEqual(f.reads, [{ table: f.campaigns, id: 'missing' }])
})

test('campaign context returns one consistent set of level, house and EddySoul rules', async () => {
  const f = fixture()
  const rulesSettings = {
    houseRules: { stunMaxDuration1: true, burnStationaryIgnoresArmor: true },
    eddySoulRules: { warpEvolution: true, poisonTicksAtTurnEnd: true },
  }
  f.campaignRows.set('campaign', { level: 'extreme', rulesSettings })
  assert.deepEqual(await f.loadCampaignCombatContext('campaign'), {
    campaignLevel: 'extreme', rulesSettings,
    houseRules: rulesSettings.houseRules, eddySoulRules: rulesSettings.eddySoulRules,
  })
  assert.equal(f.reads.length, 1)
})

test('a campaign with no stored settings is distinct from a missing campaign', async () => {
  const f = fixture()
  f.campaignRows.set('campaign', { level: 'enhanced', rulesSettings: null })
  assert.deepEqual(await f.loadCampaignCombatContext('campaign'), {
    ...defaults, campaignLevel: 'enhanced', rulesSettings: {},
  })
})

test('missing and inactive encounters do not load campaign rules', async () => {
  const f = fixture()
  assert.equal(await f.loadEncounterCombatContext(undefined), null)
  assert.deepEqual(f.reads, [])
  assert.equal(await f.loadEncounterCombatContext('missing'), null)
  for (const phase of ['setup', 'initiative', 'ended']) {
    f.encounterRows.set(phase, { phase, campaignId: 'campaign' })
    assert.equal(await f.loadEncounterCombatContext(phase), null)
  }
  assert.ok(f.reads.every(read => read.table === f.encounters))
})

test('an active combat loads its encounter and campaign exactly once', async () => {
  const f = fixture()
  const encounter = { id: 'encounter', phase: 'combat', campaignId: 'campaign', participants: [] }
  f.encounterRows.set('encounter', encounter)
  f.campaignRows.set('campaign', { level: 'enhanced', rulesSettings: { houseRules: { stunMaxDuration1: true } } })
  const result = await f.loadEncounterCombatContext('encounter')
  assert.equal(result.encounter, encounter)
  assert.equal(result.campaignLevel, 'enhanced')
  assert.deepEqual(result.houseRules, { stunMaxDuration1: true })
  assert.deepEqual(f.reads, [
    { table: f.encounters, id: 'encounter' }, { table: f.campaigns, id: 'campaign' },
  ])
})

test('active combat without a campaign retains its encounter and uses defaults', async () => {
  const f = fixture()
  const encounter = { id: 'encounter', phase: 'combat', campaignId: null }
  f.encounterRows.set('encounter', encounter)
  assert.deepEqual(await f.loadEncounterCombatContext('encounter'), { encounter, ...defaults })
  assert.deepEqual(f.reads, [{ table: f.encounters, id: 'encounter' }])
})
