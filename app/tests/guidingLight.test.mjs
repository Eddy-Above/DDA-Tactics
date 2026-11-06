import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { getEffectStatModifiers } = loadTypeScript('data/attackConstants.ts')
const position = (x, y = 0, z = 0) => ({ x, y, z })
const aura = (name = 'Guiding Light', potency = 1) => ({
  id: name, name, potency, type: 'buff', duration: 0, source: 'source', description: name,
})

function createAura() {
  const participants = []
  const positions = {}
  const digimonRows = new Map()
  const tamerRows = new Map([['owner', {
    id: 'owner', attributes: { charisma: 5 }, xpBonuses: null,
  }]])
  const digimon = { id: 'digimon.id' }
  const tamers = { id: 'tamers.id' }
  const encounters = { id: 'encounters.id' }
  const campaigns = { id: 'campaigns.id' }
  const metadata = { encounter: null, campaign: null }
  const room = { positions, reads: 0 }
  const reads = []
  const unexpected = () => { throw new Error('core aura must not use encounter persistence or broadcasting') }
  const sql = { eq: (column, id) => ({ column, id }) }
  const dbModule = {
    digimon, tamers, encounters, campaigns,
    db: { select: () => ({ from: (table) => ({ where: async ({ id }) => {
      reads.push({ table, id })
      const row = table === encounters ? metadata.encounter && { id, ...metadata.encounter }
        : table === campaigns ? metadata.campaign
        : (table === digimon ? digimonRows : tamerRows).get(id)
      return row ? [row] : []
    } }) }) },
  }
  const context = loadTypeScriptWithMocks('server/utils/combatContext.ts', {
    'drizzle-orm': sql, '../db': dbModule,
  })
  const { applyGuidingLightAuras, refreshGuidingLightForParticipants } = loadTypeScriptWithMocks('server/utils/guidingLight.ts', {
    'drizzle-orm': sql,
    '../db': dbModule,
    './combatContext': context,
    './resolveSupportAttack': { getDigimonDerivedStats: async (id) => {
      const row = digimonRows.get(id)
      return row ? { bit: row.bit } : null
    } },
    './encounterRoom': { getRoomPositions: async () => { room.reads++; return room.positions }, broadcast: unexpected },
    './encounterPayload': { buildEncounterPayload: unexpected },
  })
  return {
    participants, positions, digimonRows, tamerRows, reads, metadata, room,
    refresh: refreshGuidingLightForParticipants,
    add(id, pos, { type = 'digimon', entityId = id, row = {}, missingRow = false, ...flags } = {}) {
      const participant = { id, type, entityId, activeEffects: [], ...flags }
      participants.push(participant)
      if (pos) positions[id] = pos
      if (type === 'digimon' && !missingRow && !digimonRows.has(entityId)) {
        digimonRows.set(entityId, { id: entityId, partnerId: null, size: 'medium', bit: 1, ...row })
      }
      return participant
    },
    run(input = participants) { return applyGuidingLightAuras(input, positions, 'standard') },
  }
}

function stats(result, id) {
  const participant = result.participants.find((entry) => entry.id === id)
  assert.ok(participant, `missing participant ${id}`)
  return getEffectStatModifiers(participant.activeEffects ?? [])
}

test('Guiding Light buffs and counts only positioned allied Digimon, excluding its source, enemies and reserves', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner' } })
  fixture.add('ally', position(1))
  fixture.add('tamer', position(1), { type: 'tamer', activeEffects: [aura(), aura('Guiding Light (Focus)', 4)] })
  fixture.add('enemy', position(1), { isEnemy: true })
  fixture.add('reserve', position(1), { inReserve: true })
  fixture.add('unplaced', null)
  fixture.add('missing-record', position(1), { missingRow: true })
  const result = await fixture.run()
  assert.equal(stats(result, 'ally').accuracy, 2)
  assert.equal(stats(result, 'source').accuracy, 0)
  assert.equal(stats(result, 'source').dodge, 1)
  for (const id of ['tamer', 'enemy', 'reserve', 'unplaced', 'missing-record']) {
    assert.deepEqual(stats(result, id), { accuracy: 0, damage: 0, dodge: 0, armor: 0 })
  }
  assert.deepEqual(result.participants.find((entry) => entry.id === 'tamer').activeEffects, [])
})

test('lingering aura effects are removed when only Tamers remain, preserving unrelated effects', async () => {
  const fixture = createAura()
  const shield = { ...aura('Shield'), potency: 3 }
  fixture.add('tamer', position(0), {
    type: 'tamer', activeEffects: [aura(), aura('Guiding Light (Focus)', 3), shield],
  })
  const result = await fixture.run()
  assert.equal(result.changed, true)
  assert.deepEqual(result.participants[0].activeEffects, [shield])
  assert.equal(fixture.reads.length, 0)
  const repeat = await fixture.run(result.participants)
  assert.equal(repeat.changed, false)
  assert.equal(repeat.participants, result.participants)
})

test('BIT 1 uses the shared spherical Burst volume: distance 2 qualifies, distance 3 and outside diagonals do not', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner', bit: 1 } })
  fixture.add('axis-boundary', position(2))
  fixture.add('axis-outside', position(3))
  fixture.add('inside-diagonal', position(1, 1, 1))
  fixture.add('outside-diagonal', position(2, 2))
  fixture.add('vertical-boundary', position(0, 2))
  fixture.add('vertical-outside', position(0, 3))
  const result = await fixture.run()
  for (const id of ['axis-boundary', 'inside-diagonal', 'vertical-boundary']) {
    assert.equal(stats(result, id).accuracy, 2)
  }
  for (const id of ['axis-outside', 'outside-diagonal', 'vertical-outside']) {
    assert.equal(stats(result, id).accuracy, 0)
  }
  assert.equal(stats(result, 'source').dodge, 3)
})

test('a gigantic source emits Burst from its full width, height and depth rather than its anchor', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: {
    partnerId: 'owner', bit: 0, size: 'gigantic', giganticDimensions: { width: 4, height: 2, depth: 3 },
  } })
  fixture.add('width', position(4, 1, 2))
  fixture.add('height', position(3, 2, 2))
  fixture.add('depth', position(3, 1, 3))
  fixture.add('outside-corner', position(4, 2, 3))
  fixture.add('outside-width', position(5, 1, 2))
  const result = await fixture.run()
  for (const id of ['width', 'height', 'depth']) assert.equal(stats(result, id).accuracy, 2)
  for (const id of ['outside-corner', 'outside-width']) assert.equal(stats(result, id).accuracy, 0)
  assert.equal(stats(result, 'source').dodge, 3)
})

test('large and tall target volumes qualify when any occupied cell intersects Burst, counted once per Digimon', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner', bit: 0 } })
  fixture.add('large-target', position(-2), { row: { size: 'large' } })
  fixture.add('tall-target', position(0, -3), { row: {
    size: 'gigantic', giganticDimensions: { width: 1, height: 3, depth: 1 },
  } })
  fixture.add('outside-target', position(-3, -3), { row: { size: 'large' } })
  const result = await fixture.run()
  assert.equal(stats(result, 'large-target').accuracy, 2)
  assert.equal(stats(result, 'tall-target').accuracy, 2)
  assert.equal(stats(result, 'outside-target').accuracy, 0)
  assert.equal(stats(result, 'source').dodge, 2)
})

test('overlapping sources cap allied Accuracy at +2 while keeping each source own ally count', async () => {
  const fixture = createAura()
  fixture.add('source-a', position(0), { row: { partnerId: 'owner' } })
  fixture.add('source-b', position(1), { row: { partnerId: 'owner' } })
  fixture.add('ally', position(2))
  const result = await fixture.run()
  assert.equal(stats(result, 'source-a').accuracy, 2)
  assert.equal(stats(result, 'source-b').accuracy, 2)
  assert.equal(stats(result, 'source-a').dodge, 2)
  assert.equal(stats(result, 'source-b').dodge, 2)
  assert.equal(stats(result, 'ally').accuracy, 2)
  const allyEffects = result.participants.find((entry) => entry.id === 'ally').activeEffects
  assert.equal(allyEffects.filter((effect) => effect.name === 'Guiding Light').length, 1)
  const repeat = await fixture.run(result.participants)
  assert.equal(repeat.changed, false)
  assert.equal(repeat.participants, result.participants)
})

test('removing the source or its unlocked order clears existing Accuracy and Focus', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner' } })
  fixture.add('ally', position(1))
  const first = await fixture.run()
  const removed = await fixture.run(first.participants.filter((entry) => entry.id !== 'source'))
  assert.equal(removed.changed, true)
  assert.equal(stats(removed, 'ally').accuracy, 0)

  fixture.tamerRows.get('owner').attributes.charisma = 4
  const disabled = await fixture.run(first.participants)
  assert.equal(stats(disabled, 'source').dodge, 0)
  assert.equal(stats(disabled, 'ally').accuracy, 0)
})

test('changing the source current entity form recomputes its footprint and removes stale coverage when it shrinks', async () => {
  const fixture = createAura()
  const source = fixture.add('source', position(0), { row: { partnerId: 'owner', bit: 0 } })
  fixture.add('ally', position(4))
  const base = await fixture.run()
  assert.equal(stats(base, 'ally').accuracy, 0)

  fixture.digimonRows.set('evolved', {
    id: 'evolved', partnerId: 'owner', bit: 0, size: 'gigantic',
    giganticDimensions: { width: 4, height: 1, depth: 1 },
  })
  source.entityId = 'evolved'
  const evolved = await fixture.run()
  assert.equal(stats(evolved, 'ally').accuracy, 2)
  assert.equal(stats(evolved, 'source').dodge, 1)

  const shrinking = evolved.participants.map((entry) => entry.id === 'source' ? { ...entry, entityId: 'source' } : entry)
  const devolved = await fixture.run(shrinking)
  assert.equal(stats(devolved, 'ally').accuracy, 0)
  assert.equal(stats(devolved, 'source').dodge, 0)
})

test('different participant instances sharing one Digimon entity retain independent positions and each count once', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner' } })
  fixture.add('instance-a', position(1), { entityId: 'shared-entity' })
  fixture.add('instance-b', position(2), { entityId: 'shared-entity' })
  fixture.add('instance-outside', position(5), { entityId: 'shared-entity' })
  const result = await fixture.run()
  assert.equal(stats(result, 'instance-a').accuracy, 2)
  assert.equal(stats(result, 'instance-b').accuracy, 2)
  assert.equal(stats(result, 'instance-outside').accuracy, 0)
  assert.equal(stats(result, 'source').dodge, 2)
  assert.equal(fixture.reads.filter((read) => read.id === 'shared-entity').length, 1)
})

test('participants without activeEffects stay unchanged when no source is active', async () => {
  const fixture = createAura()
  fixture.add('ordinary-digimon', position(0), { activeEffects: undefined })
  fixture.add('tamer', position(1), { type: 'tamer', activeEffects: undefined })
  const result = await fixture.run()
  assert.equal(result.changed, false)
  assert.equal(result.participants, fixture.participants)
  assert.equal(result.participants[0].activeEffects, undefined)
})

test('action refresh uses its supplied roster and explicit positions instead of stale persisted state', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner' } })
  const ally = fixture.add('ally', position(1))
  const first = await fixture.run()
  fixture.metadata.encounter = { phase: 'combat', participants: first.participants }
  fixture.room.positions = { source: position(0), ally: position(1) }

  const removed = first.participants.filter(participant => participant.id !== 'source')
  const result = await fixture.refresh('encounter', removed, { ally: position(1) })
  assert.deepEqual(result.map(participant => participant.id), [ally.id])
  assert.equal(getEffectStatModifiers(result[0].activeEffects).accuracy, 0)
  assert.equal(fixture.room.reads, 0)

  const distant = await fixture.refresh('encounter', first.participants, { source: position(0), ally: position(9) })
  assert.equal(getEffectStatModifiers(distant.find(participant => participant.id === 'ally').activeEffects).accuracy, 0)
  assert.equal(getEffectStatModifiers(distant.find(participant => participant.id === 'source').activeEffects).dodge, 0)
  assert.equal(fixture.room.reads, 0)
})

test('action refresh reads live room positions and respects the campaign unlock threshold', async () => {
  const fixture = createAura()
  fixture.add('source', position(0), { row: { partnerId: 'owner' } })
  fixture.add('ally', position(1))
  fixture.metadata.encounter = { phase: 'combat', campaignId: 'campaign' }
  fixture.metadata.campaign = { level: 'enhanced', rulesSettings: {} }

  const locked = await fixture.refresh('encounter', fixture.participants)
  assert.equal(getEffectStatModifiers(locked[1].activeEffects).accuracy, 0)
  fixture.tamerRows.get('owner').attributes.charisma = 7
  const unlocked = await fixture.refresh('encounter', fixture.participants)
  assert.equal(getEffectStatModifiers(unlocked[1].activeEffects).accuracy, 2)
  assert.equal(fixture.room.reads, 2)
})

test('action refresh leaves missing or non-combat encounters alone without loading room state', async () => {
  const fixture = createAura()
  fixture.add('ally', position(1))
  assert.equal(await fixture.refresh(undefined, fixture.participants), fixture.participants)
  assert.equal(await fixture.refresh('missing', fixture.participants), fixture.participants)
  for (const phase of ['setup', 'initiative', 'ended']) {
    fixture.metadata.encounter = { phase }
    assert.equal(await fixture.refresh('encounter', fixture.participants), fixture.participants)
  }
  assert.equal(fixture.room.reads, 0)
})
