import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { grantTankBusterUses, availableTankBusterUses, tankBusterUseError } = loadTypeScript('utils/tankBuster.ts')
const { availableCombatAttacks } = loadTypeScript('utils/combatAttackOptions.ts')
const { applyTankBusterStun } = loadTypeScript('server/utils/tankBusterStun.ts')
const attack = { id: 'tank', type: 'damage', tags: ['Tank Buster'] }
const health = (wounds, uses = 0) => ({ maxWounds: 100, currentWounds: wounds, tankBusterUses: uses })

test('exact thresholds and multi-threshold damage each grant one use', () => {
  assert.equal(grantTankBusterUses(health(0), health(24)), 0)
  assert.equal(grantTankBusterUses(health(24), health(25)), 1)
  assert.equal(grantTankBusterUses(health(25), health(26)), 0)
  assert.equal(grantTankBusterUses(health(0), health(50)), 2)
  assert.equal(grantTankBusterUses(health(0), health(75)), 3)
  assert.equal(grantTankBusterUses(health(50), health(75)), 1)
})

test('healing rearms thresholds without losing banked uses, with no combat-wide cap', () => {
  let state = health(0)
  for (let i = 0; i < 5; i++) {
    const damaged = health(75, state.tankBusterUses)
    damaged.tankBusterUses = grantTankBusterUses(state, damaged)
    const healed = health(0, damaged.tankBusterUses)
    healed.tankBusterUses = grantTankBusterUses(damaged, healed)
    state = healed
  }
  assert.equal(state.tankBusterUses, 15)
  assert.equal(grantTankBusterUses(health(50, 3), health(50, 3)), 3)
  assert.equal(grantTankBusterUses(health(75, 5), health(75, 5), true), 3)
})

test('legacy wounded participants initialize once; an exhausted use balance never refills while staying below a threshold', () => {
  const legacy = { maxWounds: 100, currentWounds: 50 }
  assert.equal(availableTankBusterUses(legacy), 2)
  assert.equal(grantTankBusterUses(legacy, { maxWounds: 100, currentWounds: 0 }), 2)
  assert.ok(tankBusterUseError(health(50, 0), attack))
  assert.equal(availableTankBusterUses(health(50, 0)), 0)
  assert.deepEqual(availableCombatAttacks({ type: 'digimon', ...health(50, 0) }, [attack], [], { round: 1 }), [])
  assert.deepEqual(availableCombatAttacks({ type: 'digimon', ...health(50, 1) }, [attack], [], { round: 1 }), [attack])
})

for (const declaration of [{ tags: ['Tank Buster'] }, { effect: 'Tank Buster' }]) {
  test(`secondary Stun begins at exactly four damage: ${JSON.stringify(declaration)}`, () => {
    const context = { source: 'Boss', round: 1, qualities: [], hasGone: false }
    const low = { actionsRemaining: { simple: 2 }, activeEffects: [] }
    assert.equal(applyTankBusterStun(low, declaration, 3, context), false)
    assert.equal(low.actionsRemaining.simple, 2)
    const target = { actionsRemaining: { simple: 2 }, activeEffects: [] }
    assert.equal(applyTankBusterStun(target, declaration, 4, context), true)
    assert.equal(target.activeEffects[0].name, 'Stun')
    assert.equal(target.activeEffects[0].duration, 1)
    assert.equal(target.actionsRemaining.simple, 1)
    const immune = { actionsRemaining: { simple: 2 }, activeEffects: [] }
    assert.equal(applyTankBusterStun(immune, declaration, 8, { ...context, qualities: [{ id: 'immunity' }] }), false)
    assert.equal(immune.actionsRemaining.simple, 2)
    const acted = { actionsRemaining: { simple: 2 }, activeEffects: [] }
    assert.equal(applyTankBusterStun(acted, declaration, 4, { ...context, hasGone: true }), true)
    assert.equal(acted.interceptPenalty, 1)
  })
}
