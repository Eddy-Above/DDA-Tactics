import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

globalThis.createError = value => Object.assign(new Error(value.message), value)
const point = (x = 0, y = 0) => ({ x, y, z: 0 })
function fixture({ devolution = false, failCleanup = false, passClash = false } = {}) {
  const actor = { id: 'actor', entityId: 'form', type: 'digimon', isEnemy: !devolution, currentWounds: 0, maxWounds: 10, actionsRemaining: { simple: 2 } }
  const next = { id: 'next', entityId: 'next-form', type: 'digimon' }
  if (passClash) {
    actor.clash = { isController: true, opponentParticipantId: 'next', clashId: 'clash' }
    next.clash = { isController: false, opponentParticipantId: 'actor', clashId: 'clash' }
  }
  const encounter = { id: 'enc', mapId: 'map', round: 1, revision: 4, currentTurnIndex: 0, turnOrder: ['actor', 'next'], participants: [actor, next], battleLog: [] }
  const positions = { actor: point(), next: point(4, 3) }, writes = [], publishes = [], phases = [], cleanups = []
  const map = { groundTiles: [point(), point(1), point(2)], voxels: [], walls: [], doors: [], ceilings: [], stairs: [], spaceTiles: [] }
  const module = loadTypeScriptWithMocks('server/utils/attackMovement.ts', {
    '../db': { encounters: { id: 'id' }, db: { update: () => ({ set: fields => ({ where: async () => { phases.push('persist'); writes.push(structuredClone(fields)) } }) }) } },
    'drizzle-orm': { eq: () => null },
    './encounterRoom': { getRoomPositions: async () => positions, publishCommittedPositions: async (_id, patch) => { phases.push('publish'); publishes.push(structuredClone(patch)) }, broadcast() {} },
    './encounterMovement': { prepareEncounterMovement: async () => ({
      participants: [{ ...actor, currentWounds: 10 }, next], battleLog: [{ action: 'Burn' }], participantPositions: { ...positions, actor: point(2, 2) },
      position: point(2, 2), path: [point(), point(1, 1), point(2, 2)], openedDoorIds: [], defeated: true,
      commitDoors: async () => { phases.push('doors') },
    }) },
    './combatSpatial': { loadEncounterMap: async () => map,
      loadParticipantDigimon: async () => new Map([['form', { id: 'form', size: 'medium' }]]), loadTamersByIds: async () => new Map(),
      getMovementProfile: () => ({ budget: 4, caps: loadTypeScript('utils/movementRules.ts').detectCapabilities([], 4, 0, 0) }),
    },
    './resolveSupportAttack': { getDigimonDerivedStats: async () => ({ ram: 0, bit: 1 }) },
    './enemyKnockouts': { resolveEnemyKnockouts: async (state, candidates, context) => {
      phases.push('cleanup'); cleanups.push({ state: structuredClone(state), candidates, context })
      if (failCleanup) throw new Error('Cleanup failed')
      return { participants: devolution ? [{ ...state.participants[0], entityId: 'previous-form', currentWounds: 0 }, next] : [next],
        turnOrder: devolution ? state.turnOrder : ['next'], currentTurnIndex: 0, round: 1,
        logEntries: [{ action: devolution ? 'Auto-Devolve' : 'Defeated' }],
        positionPatch: devolution ? { actor: point(2) } : { next: point(4) },
      }
    } },
  })
  const body = passClash ? { operationId: 'pass', expectedRevision: 4, movement: { kind: 'pass', origin: point(), destination: point(2), direction: point(1), movement: 2, ram: 0 } }
    : { operationId: 'charge', expectedRevision: 4, chargeTiming: 'before', movement: { kind: 'charge-before', origin: point(), destination: point(2, 2) } }
  const commit = () => module.commitAttackMovement(encounter, 'actor', { id: passClash ? 'pass' : 'charge', tags: passClash ? ['Area Attack: Pass'] : ['Charge Attack'], type: 'damage', range: 'melee' }, body, { isDm: false, campaign: { rulesSettings: {} } })
  return { commit, writes, publishes, phases, cleanups }
}

test('a Charge movement Burn knockout pays its attack once, removes the enemy, advances the turn and publishes all gravity changes', async () => {
  const f = fixture()
  const result = await f.commit()
  assert.equal(result.defeated, true)
  assert.deepEqual(f.cleanups[0].candidates, ['actor'])
  assert.equal(f.cleanups[0].state.participants[0].actionsRemaining.simple, 1)
  assert.deepEqual(f.cleanups[0].context.gravity.positions.actor, point(2, 2))
  assert.deepEqual(f.writes[0].participants.map(p => p.id), ['next'])
  assert.deepEqual(f.writes[0].turnOrder, ['next'])
  assert.deepEqual(f.writes[0].battleLog.map(entry => entry.action), ['Burn', 'Defeated'])
  assert.deepEqual(f.publishes, [{ actor: point(2, 2), next: point(4) }])
  assert.deepEqual(f.phases, ['cleanup', 'doors', 'persist', 'publish'])
})

test('a partner knocked out by attack movement auto-devolves and returns the final gravity position while cancelling its declared attack', async () => {
  const f = fixture({ devolution: true })
  const result = await f.commit()
  assert.equal(result.defeated, true, 'the original attack must stay cancelled after restoring an earlier form')
  assert.equal(result.participants[0].entityId, 'previous-form')
  assert.equal(result.participants[0].actionsRemaining.simple, 1)
  assert.deepEqual(result.position, point(2))
  assert.deepEqual(f.writes[0].participantPositions.actor, point(2))
  assert.deepEqual(f.publishes[0].actor, point(2))
})

test('failed knockout cleanup cannot persist movement, doors or a position publication', async () => {
  const f = fixture({ failCleanup: true })
  await assert.rejects(f.commit(), /Cleanup failed/)
  assert.deepEqual(f.writes, [])
  assert.deepEqual(f.publishes, [])
  assert.deepEqual(f.phases, ['cleanup'])
})

test('a Pass stopped by Burn still ends both sides of the original Clash after restoring a knocked-out partner', async () => {
  const f = fixture({ devolution: true, passClash: true })
  const result = await f.commit()
  assert.equal(result.defeated, true)
  assert.equal(result.participants[0].actionsRemaining.simple, 0, 'a Clash attack pays its complex action once')
  assert.equal(result.participants[0].entityId, 'previous-form')
  for (const participant of result.participants) {
    assert.equal(participant.clash, undefined)
    assert.equal(participant.clashCooldownUntilRound, 2)
  }
  assert.ok(f.writes[0].participants.every(participant => !participant.clash))
})
