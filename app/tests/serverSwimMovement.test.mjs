import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { resolveFall } = loadTypeScript('utils/movementRules.ts')
const { isValidLandingPosition } = loadTypeScript('server/utils/mapMovement.ts')

const point = (x, y = 0, z = 0) => ({ x, y, z })
const swimmer = { id: 'extra-movement', choiceId: 'swimmer' }
const advancedSwimmer = { id: 'advanced-mobility', choiceId: 'adv-swimmer' }
const record = (id, overrides = {}) => ({
  id, stage: 'rookie', size: 'medium', qualities: [],
  baseStats: { accuracy: 6, damage: 6, dodge: 6, armor: 6, health: 6 }, ...overrides,
})
const participant = (id, overrides = {}) => ({
  id, entityId: id, type: 'digimon', currentWounds: 0, maxWounds: 30, activeEffects: [], ...overrides,
})
const unexpected = () => assert.fail('pure mobility computation must not access persistence')

function fixture(records) {
  const digimonById = new Map(records.map(row => [row.id, row]))
  const spatial = loadTypeScriptWithMocks('server/utils/combatSpatial.ts', {
    'drizzle-orm': {}, '../db': {}, './combatRecordCache': { readCombatRecords: unexpected },
    './resolveSupportAttack': { getDigimonDerivedStats: async id => digimonById.has(id) ? { ram: 1, cpu: 1 } : null },
  })
  const gravity = loadTypeScriptWithMocks('server/utils/endOfTurnGravity.ts', {
    './combatSpatial': spatial,
    './encounterRoom': { getRoomPositions: unexpected, broadcastPositionPatch: unexpected },
    './guidingLight': { applyGuidingLightAuras: unexpected },
  })
  return {
    spatial, gravity, digimonById,
    profile: (id, overrides = {}, tamers = new Map()) => spatial.getMovementProfile(participant(id, overrides), digimonById, tamers),
    drops: (positions, participants, map, destroyed) => gravity.computeGravityDrops(positions, participants, map, digimonById, 1, destroyed),
  }
}

test('ordinary Digimon swim at half Basic Movement before Speedy, while Swimmer uses full Movement', () => {
  const f = fixture([
    record('ordinary', { qualities: [{ id: 'speedy', ranks: 5 }] }),
    record('swimmer', { qualities: [{ id: 'speedy', ranks: 5 }, swimmer] }),
    record('bulky', { qualities: [{ id: 'bulky', ranks: 1 }, { id: 'speedy', ranks: 5 }] }),
  ])
  assert.equal(f.profile('ordinary').budget, 16)
  assert.equal(f.profile('ordinary').caps.swimSpeed, 3)
  assert.equal(f.profile('ordinary').caps.canSwim, true)
  assert.equal(f.profile('swimmer').caps.swimSpeed, 16)
  assert.equal(f.profile('bulky').budget, 9)
  assert.equal(f.profile('bulky').caps.swimSpeed, 1)
})

test('Advanced Swimmer adds actual allocated and quality-enhanced RAM', () => {
  const f = fixture([record('advanced', {
    baseStats: { accuracy: 12, damage: 6, dodge: 12, armor: 6, health: 6 },
    bonusStats: { accuracy: 8, damage: 0, dodge: 8, armor: 0, health: 0 },
    qualities: [swimmer, advancedSwimmer, { id: 'speedy', ranks: 2 },
      { id: 'improved-derived-stat', choiceId: 'agility', ranks: 10 },
      { id: 'data-optimization', choiceId: 'effect-warrior' },
      { id: 'system-boost', choiceId: 'ram', ranks: 2 }],
  })])
  const profile = f.profile('advanced')
  assert.equal(profile.budget, 10)
  assert.equal(profile.caps.swimSpeed, 17, 'RAM is seven after bonus stats, Improved Agility, Effect Warrior and System Boost')
  assert.equal(profile.bodyStat, 6, 'mobility corrections preserve the existing Body output')
})

test('Advanced Jumper uses the allocated and quality-enhanced CPU for innate jumping', () => {
  const f = fixture([record('advanced', {
    bonusStats: { accuracy: 0, damage: 8, dodge: 0, armor: 8, health: 8 },
    qualities: [{ id: 'advanced-mobility', choiceId: 'adv-jumper' },
      { id: 'improved-derived-stat', choiceId: 'body', ranks: 16 },
      { id: 'system-boost', choiceId: 'cpu', ranks: 2 }],
  })])
  const { caps, bodyStat } = f.profile('advanced')
  assert.equal(caps.jumpHeight, 33, 'half Basic Movement plus six CPU times five')
  assert.equal(caps.jumpRange, 9)
  assert.equal(bodyStat, 6)
})

test('negative effect-adjusted spec values do not lower innate Advanced mobility allowances', () => {
  const f = fixture([record('advanced', { stage: 'mega', qualities: [advancedSwimmer,
    { id: 'advanced-mobility', choiceId: 'adv-jumper' }] })])
  const { caps } = f.profile('advanced', { activeEffects: [{ name: 'Debilitate', potency: 5 }] })
  assert.equal(caps.swimSpeed, 3, 'negative RAM clamps to zero before the Advanced bonus')
  assert.equal(caps.jumpHeight, 3, 'negative CPU clamps to zero before the Advanced bonus')
  assert.equal(caps.jumpRange, 3)
})

test('Brave stance and all-stat effects modify Basic and full Movement before swimming', () => {
  const f = fixture([record('ordinary', { qualities: [{ id: 'speedy', ranks: 2 }] }),
    record('swimmer', { qualities: [swimmer, { id: 'speedy', ranks: 2 }] })])
  const state = { currentStance: 'brave', activeEffects: [{ name: 'Debilitate', potency: 1 }] }
  assert.equal(f.profile('ordinary', state).budget, 8)
  assert.equal(f.profile('ordinary', state).caps.swimSpeed, 2)
  assert.equal(f.profile('swimmer', state).caps.swimSpeed, 8)

  const low = fixture([record('low', { stage: 'champion', qualities: [swimmer, { id: 'bulky', ranks: 3 }] })])
  const profile = low.profile('low', { currentStance: 'brave', activeEffects: [{ name: 'Bastion', potency: 1 }] })
  assert.equal(profile.budget, 0, 'effects apply before Brave clamps movement')
  assert.equal(profile.caps.swimSpeed, 0)
})

test('zero swim speed, missing records and Tamers retain non-swimming capabilities', async () => {
  const f = fixture([record('slow', { qualities: [{ id: 'bulky', ranks: 2 }] })])
  assert.equal(f.profile('slow').caps.swimSpeed, 0)
  assert.equal(f.profile('slow').caps.canSwim, false)
  assert.equal(f.profile('missing').caps.canSwim, false)
  const tamers = new Map([['owner', { attributes: { agility: 4, body: 3 }, skills: { survival: 2 } }]])
  const tamer = f.profile('owner', { type: 'tamer' }, tamers)
  assert.equal(tamer.budget, 6)
  assert.equal(tamer.caps.canSwim, false)
  assert.equal(tamer.caps.swimSpeed, 0)
  assert.equal((await f.spatial.getFallerProfile(participant('owner', { type: 'tamer' }), new Map())).floatsOnWater, false)
})

const waterMap = {
  groundTiles: [0, 1, 2, 3, 4].map(x => ({ ...point(x), terrain: 'grass' })),
  spaceTiles: [0, 1, 2, 3, 4].flatMap(x => [1, 2, 3].map(y => ({ ...point(x, y), spaceType: 'water' }))),
  voxels: [], walls: [], doors: [], ceilings: [], stairs: [],
}

test('ordinary and Advanced-only swimmers sink while Extra Swimmer remains at its water depth', async () => {
  const f = fixture([record('ordinary'), record('advanced', { qualities: [advancedSwimmer] }),
    record('floating', { qualities: [swimmer] })])
  const participants = [participant('ordinary'), participant('advanced'), participant('floating')]
  assert.equal(f.profile('ordinary').caps.canSwim, true)
  assert.equal(f.profile('advanced').caps.canSwim, true)
  const result = await f.drops({ ordinary: point(0, 2), advanced: point(1, 2), floating: point(2, 2) }, participants, waterMap)
  assert.deepEqual(result.patch, { ordinary: point(0), advanced: point(1) })
  assert.equal(result.logEntries.length, 2)
  assert.equal(participants[2].currentWounds, 0)
})

test('falling Extra Swimmer stops at the first water surface and takes damage for the air drop', async () => {
  const row = record('floating', { qualities: [swimmer] })
  const f = fixture([row])
  const unit = participant('floating')
  const start = point(0, 12)
  const result = await f.drops({ floating: start }, [unit], waterMap)
  assert.deepEqual(result.patch, { floating: point(0, 4) })
  assert.equal(unit.currentWounds, 2)
  assert.equal(result.logEntries[0].result, 'Fell 8 tiles (2 wounds)')
  const forcedProfile = await f.spatial.getFallerProfile(participant('floating'), new Map([[row.id, row]]))
  assert.equal(resolveFall(start, { width: 1, height: 1, depth: 1 }, waterMap, forcedProfile).damage, 2)
})

test('gravity keeps non-swimmer, flight and jumping behavior while recognizing water support', async () => {
  const f = fixture([
    record('slow', { qualities: [{ id: 'bulky', ranks: 2 }] }),
    record('flyer', { qualities: [{ id: 'extra-movement', choiceId: 'flight' }] }),
    record('jumper', { qualities: [{ id: 'extra-movement', choiceId: 'jumper' }] }),
  ])
  const participants = [participant('slow'), participant('tamer', { type: 'tamer' }), participant('flyer'),
    participant('jumper', { airborneByJump: true })]
  const result = await f.drops({ slow: point(0, 2), tamer: point(1, 2), flyer: point(2, 6), jumper: point(3, 10) }, participants, waterMap)
  assert.deepEqual(result.patch, { slow: point(0), tamer: point(1), jumper: point(3) })
  assert.equal(participants[3].currentWounds, 0)
  assert.equal(participants[3].airborneByJump, false)
})

test('innate jumps within their height land safely while higher and forced falls retain damage', async () => {
  const row = record('ordinary', { stage: 'mega' })
  const f = fixture([row])
  const unit = participant('ordinary')
  const start = point(0, 6)
  const floor = { ...waterMap, spaceTiles: [] }
  const forcedProfile = await f.spatial.getFallerProfile(unit, new Map([[row.id, row]]))
  assert.equal(forcedProfile.airborneByJump, false)
  assert.equal(resolveFall(start, { width: 1, height: 1, depth: 1 }, floor, forcedProfile).damage, 1)
  const result = await f.drops({ ordinary: start }, [unit], floor)
  assert.deepEqual(result.patch, { ordinary: point(0) })
  assert.equal(unit.currentWounds, 0)
  assert.equal(result.logEntries[0].result, 'Fell 6 tiles (no damage)')
  const highUnit = participant('ordinary')
  const highFall = await f.drops({ ordinary: point(0, 10) }, [highUnit], floor)
  assert.deepEqual(highFall.patch, { ordinary: point(0) })
  assert.equal(highUnit.currentWounds, 4)
  assert.equal(highFall.logEntries[0].result, 'Fell 10 tiles (4 wounds)')
})

test('server mobility profiles include actual RAM in Advanced digging, climbing and flight', () => {
  const f = fixture([record('advanced', { qualities: [
    { id: 'speedy', ranks: 2 },
    { id: 'extra-movement', choiceId: 'digger' }, { id: 'advanced-mobility', choiceId: 'adv-digger' },
    { id: 'extra-movement', choiceId: 'wallclimber' }, { id: 'advanced-mobility', choiceId: 'adv-wallclimber' },
    { id: 'extra-movement', choiceId: 'flight' }, { id: 'advanced-mobility', choiceId: 'adv-flight' },
    { id: 'system-boost', choiceId: 'ram', ranks: 1 },
  ] })])
  const { caps } = f.profile('advanced')
  assert.equal(caps.digSpeed, 12)
  assert.equal(caps.climbSpeed, 12)
  assert.equal(caps.flySpeed, 12)
  assert.equal(caps.canDigHardSurfaces, true)
  assert.equal(caps.canClimbCeilings, true)
})

test('wall support and Advanced ceiling support hold climbers while unsupported units still fall', async () => {
  const wallclimber = { id: 'extra-movement', choiceId: 'wallclimber' }
  const f = fixture([
    record('wall', { qualities: [wallclimber] }), record('ceiling', { qualities: [wallclimber] }),
    record('advanced', { qualities: [wallclimber, { id: 'advanced-mobility', choiceId: 'adv-wallclimber' }] }),
    record('unsupported', { qualities: [wallclimber] }), record('ordinary'),
  ])
  const map = { ...waterMap, spaceTiles: [],
    walls: [{ id: 'wall', ...point(0, 8), face: 'west' }, { id: 'ordinary-wall', ...point(4, 8), face: 'east' }],
    ceilings: [{ id: 'ceiling', ...point(1, 8) }, { id: 'advanced-ceiling', ...point(2, 8) }],
  }
  const participants = ['wall', 'ceiling', 'advanced', 'unsupported', 'ordinary'].map(id => participant(id))
  const positions = Object.fromEntries(participants.map((unit, x) => [unit.id, point(x, 8)]))
  const result = await f.drops(positions, participants, map)
  assert.deepEqual(result.patch, { ceiling: point(1), unsupported: point(3), ordinary: point(4) })
  assert.equal(isValidLandingPosition(point(0, 8), map, new Set(), f.profile('wall').caps), true)
  assert.equal(isValidLandingPosition(point(1, 8), map, new Set(), f.profile('ceiling').caps), false)
  assert.equal(isValidLandingPosition(point(2, 8), map, new Set(), f.profile('advanced').caps), true)
  const profile = await f.spatial.getFallerProfile(participant('wall'), new Map([['wall', record('wall', { qualities: [wallclimber] })]]))
  assert.equal(resolveFall(point(0, 8), { width: 1, height: 1, depth: 1 }, map, profile).fallHeight, 0)
  const destroyed = await f.drops(positions, participants, map, new Set(['wall', 'advanced-ceiling']))
  assert.deepEqual(destroyed.patch, { wall: point(0), ceiling: point(1), advanced: point(2), unsupported: point(3), ordinary: point(4) })
})

test('server landing validates diggable materials, blocked Steel and reachable water surfaces', () => {
  const digger = { id: 'extra-movement', choiceId: 'digger' }
  const f = fixture([record('digger', { qualities: [digger] }),
    record('advanced', { qualities: [digger, { id: 'advanced-mobility', choiceId: 'adv-digger' }] }),
    record('swimmer', { qualities: [swimmer] })])
  const map = { ...waterMap, groundTiles: [], spaceTiles: [],
    voxels: ['earth', 'sand', 'snow', 'soft-metal', 'steel', 'water'].map((materialId, x) => ({ ...point(x, 3), materialId })),
  }
  for (const x of [0, 1, 2]) assert.equal(isValidLandingPosition(point(x, 3), map, new Set(), f.profile('digger').caps), true)
  assert.equal(isValidLandingPosition(point(3, 3), map, new Set(), f.profile('digger').caps), false)
  assert.equal(isValidLandingPosition(point(3, 3), map, new Set(), f.profile('advanced').caps), true)
  assert.equal(isValidLandingPosition(point(4, 3), map, new Set(), f.profile('advanced').caps), false)
  assert.equal(isValidLandingPosition(point(5, 4), map, new Set(), f.profile('swimmer').caps), true)
  assert.equal(isValidLandingPosition(point(5, 4), map, new Set(['5,4,0']), f.profile('swimmer').caps), false)
})

test('burrow terrain holds Diggers while blocked Steel and unsupported cells still fall', async () => {
  const digger = { id: 'extra-movement', choiceId: 'digger' }
  const advanced = { id: 'advanced-mobility', choiceId: 'adv-digger' }
  const f = fixture([record('earth', { qualities: [digger] }),
    record('snow', { qualities: [digger], stage: 'champion' }),
    record('glass', { qualities: [digger, advanced] }), record('steel', { qualities: [digger, advanced] })])
  const map = { ...waterMap, spaceTiles: [],
    voxels: ['earth', 'snow', 'glass', 'steel'].map((materialId, x) => ({ ...point(x, 8), materialId })),
  }
  const participants = ['earth', 'snow', 'glass', 'steel'].map(id => participant(id))
  const positions = Object.fromEntries(participants.map((unit, x) => [unit.id, point(x, 8)]))
  const result = await f.drops(positions, participants, map)
  assert.deepEqual(result.patch, { steel: point(3) })
  const zero = fixture([record('zero', { stage: 'champion', qualities: [digger, { id: 'bulky', ranks: 3 }] })])
  const zeroUnit = participant('zero', { currentStance: 'brave' })
  assert.equal(zero.profile('zero', { currentStance: 'brave' }).budget, 0)
  assert.deepEqual((await zero.drops({ zero: point(0, 8) }, [zeroUnit], map)).patch, {})
})

test('knockout turn gravity respects destroyed climbing supports from the room or supplied context', async () => {
  const wallclimber = { id: 'extra-movement', choiceId: 'wallclimber' }
  const f = fixture([record('enemy'), record('wall', { qualities: [wallclimber] }),
    record('ceiling', { qualities: [wallclimber, { id: 'advanced-mobility', choiceId: 'adv-wallclimber' }] })])
  const { getDestroyedStructureIds } = loadTypeScriptWithMocks('server/utils/encounterRoom.ts', { 'drizzle-orm': {}, '../db': {} })
  let roomReads = 0
  const { resolveEnemyKnockouts } = loadTypeScriptWithMocks('server/utils/enemyKnockouts.ts', {
    'drizzle-orm': {}, '../db': { db: { select: unexpected, update: unexpected } },
    './combatSpatial': { ...f.spatial, loadParticipantDigimon: async () => f.digimonById },
    './endOfTurnGravity': f.gravity,
    './partnerDevolution': { autoDevolveParticipant: async () => null },
    './resolveSupportAttack': { getDigimonDerivedStats: unexpected },
    './encounterRoom': {
      getRoomDestructibleStates: async () => {
        roomReads++
        return [{ structureId: 'wall', currentWounds: 0 }, { structureId: 'ceiling', currentWounds: 0 }]
      },
      getDestroyedStructureIds,
    },
    './guidingLight': { refreshGuidingLightForParticipants: async (_id, participants) => participants },
    './damageOverTime': { loadRoundEndContext: unexpected, applyRoundEndEffects: unexpected },
    './roundStartQualityTriggers': { applyRoundStartQualityTriggers: unexpected },
  })
  const map = { ...waterMap, spaceTiles: [], walls: [{ id: 'wall', ...point(0, 8), face: 'west' }],
    ceilings: [{ id: 'ceiling', ...point(1, 8) }] }
  const state = () => ({ participants: [participant('enemy', { isEnemy: true, currentWounds: 30 }),
    participant('wall'), participant('ceiling')], turnOrder: ['enemy', 'wall', 'ceiling'], currentTurnIndex: 0, round: 1 })
  const gravity = { map, positions: { wall: point(0, 8), ceiling: point(1, 8) } }
  const result = await resolveEnemyKnockouts(state(), ['enemy'], { encounterId: 'encounter', gravity })
  assert.equal(result.turnAdvanced, true)
  assert.deepEqual(result.removedIds, ['enemy'])
  assert.deepEqual(result.positionPatch, { wall: point(0), ceiling: point(1) })
  assert.equal(result.participants.find(unit => unit.id === 'wall').currentWounds, 2)
  assert.equal(result.participants.find(unit => unit.id === 'ceiling').currentWounds, 2)
  assert.equal(roomReads, 1)
  const intact = await resolveEnemyKnockouts(state(), ['enemy'], { encounterId: 'encounter',
    gravity: { ...gravity, destroyedStructures: new Set() } })
  assert.equal(intact.positionPatch, undefined)
  assert.equal(roomReads, 1, 'an explicit destruction snapshot does not fetch room state')
  await resolveEnemyKnockouts(state(), ['enemy'], { encounterId: 'encounter' })
  assert.equal(roomReads, 1, 'no-map knockouts do not read room state or the database')
})
