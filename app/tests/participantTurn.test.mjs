import { loadTrustedGameplayModule } from './helpers/loadTrustedGameplayModule.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, test } from 'node:test'
import ts from 'typescript'
import { loadTypeScript, loadTypeScriptWithMocks } from './helpers/loadTypeScript.mjs'

const { canActOnEncounterTurn } = loadTypeScript('server/utils/participantTurn.ts')
const cache = loadTypeScript('server/utils/combatRecordCache.ts')
const orders = loadTypeScript('utils/specialOrderCombat.ts')
const unexpected = () => { throw new Error('unexpected record lookup or combat mutation') }
const actor = (over = {}) => ({ id: 'actor', type: 'digimon', entityId: 'agumon', ...over })
const owner = { id: 'owner-participant', type: 'tamer', entityId: 'owner-record' }
const other = { id: 'other-participant', type: 'tamer', entityId: 'other-record' }
const context = (over = {}) => ({ participants: [actor(), owner, other], turnOrder: [owner.id, other.id], currentTurnIndex: 0, ...over })

test('direct turns accept Tamers and Digimon without any partner lookup', async () => {
  for (const type of ['tamer', 'digimon']) {
    const participant = actor({ type })
    for (const currentTurnIndex of [undefined, null, 0]) {
      assert.equal(await canActOnEncounterTurn(participant, context({ turnOrder: [participant.id], currentTurnIndex }), unexpected), true)
    }
  }
})

test('partner eligibility compares the active Tamer entity id, not the participant id or another Tamer', async () => {
  const lookups = []
  const query = async id => { lookups.push(id); return [{ partnerId: owner.entityId }] }
  assert.equal(await canActOnEncounterTurn(actor(), context(), query), true)
  assert.equal(await canActOnEncounterTurn(actor(), context({ currentTurnIndex: 1 }), query), false)
  assert.deepEqual(lookups, ['agumon', 'agumon'])
  assert.equal(await canActOnEncounterTurn(actor(), context(), async () => [{ partnerId: owner.id }]), false)
  assert.equal(await canActOnEncounterTurn(actor(), context(), async () => [{ partnerId: null }]), false)
  assert.equal(await canActOnEncounterTurn(actor(), context(), async () => []), false)
})

test('off-turn Tamers, other active Digimon, absent turns and missing active participants do not query', async () => {
  assert.equal(await canActOnEncounterTurn(actor({ type: 'tamer' }), context(), unexpected), false)
  assert.equal(await canActOnEncounterTurn(actor(), context({ turnOrder: ['other-digimon'], participants: [actor(), actor({ id: 'other-digimon' })] }), unexpected), false)
  assert.equal(await canActOnEncounterTurn(actor(), context({ turnOrder: [] }), unexpected), false)
  assert.equal(await canActOnEncounterTurn(actor(), context({ currentTurnIndex: 10 }), unexpected), false)
  assert.equal(await canActOnEncounterTurn(actor(), context({ participants: [actor()] }), unexpected), false)
})

test('an actor record already loaded by the action avoids another read, including a missing record', async () => {
  assert.equal(await canActOnEncounterTurn(actor(), context({ actorDigimon: { partnerId: owner.entityId } }), unexpected), true)
  assert.equal(await canActOnEncounterTurn(actor(), context({ actorDigimon: { partnerId: other.entityId } }), unexpected), false)
  assert.equal(await canActOnEncounterTurn(actor(), context({ actorDigimon: null }), unexpected), false)
})

test('partner lookups reuse the existing action cache and honor entity invalidation', async () => {
  let reads = 0
  let partnerId = owner.entityId
  const query = async () => { reads++; return [{ id: 'agumon', partnerId }] }
  await cache.withCombatRecords(async () => {
    assert.deepEqual(await Promise.all([
      canActOnEncounterTurn(actor(), context(), query),
      canActOnEncounterTurn(actor(), context(), query),
    ]), [true, true])
    assert.equal(reads, 1)
    partnerId = other.entityId
    cache.invalidateCombatRecord('digimon', 'agumon')
    assert.equal(await canActOnEncounterTurn(actor(), context(), query), false)
    assert.equal(reads, 2)
  })
  assert.equal(await canActOnEncounterTurn(actor(), context(), query), false)
  assert.equal(reads, 3, 'a later action must not inherit another action\'s partner record')
  await cache.withCombatRecords(async () => {
    cache.primeCombatRecords('digimon', [{ id: 'agumon', partnerId: owner.entityId }])
    assert.equal(await canActOnEncounterTurn(actor(), context(), unexpected), true)
  })
})

test('a failed partner lookup propagates and can be retried in the same action', async () => {
  await cache.withCombatRecords(async () => {
    await assert.rejects(canActOnEncounterTurn(actor(), context(), async () => { throw new Error('database offline') }), /database offline/)
    assert.equal(await canActOnEncounterTurn(actor(), context(), async () => [{ partnerId: owner.entityId }]), true)
  })
})

describe('trusted action business services keep their validation errors around the shared turn guard', () => {
  const names = ['defineEventHandler', 'getRouterParam', 'readBody', 'createError']
  const originalGlobals = new Map(names.map(name => [name, globalThis[name]]))
  afterEach(() => {
    for (const [name, value] of originalGlobals) {
      if (value === undefined) delete globalThis[name]
      else globalThis[name] = value
    }
  })

  function fixture(action, over = {}) {
    globalThis.defineEventHandler = handler => handler
    globalThis.getRouterParam = () => 'encounter'
    globalThis.readBody = async event => event.body
    globalThis.createError = value => Object.assign(new Error(value.message), value)
    const participant = actor({ actionsRemaining: { simple: 2 }, activeEffects: [], ...over.actor })
    if (action === 'clash-action') participant.clash = {
      clashId: 'clash', isController: true, clashCheckNeeded: false, opponentParticipantId: 'missing-target', ...over.clash,
    }
    const encounter = {
      id: 'encounter', campaignId: 'campaign', phase: 'combat', round: over.round ?? 3,
      participants: [participant, owner, other], turnOrder: [over.direct ? participant.id : owner.id],
      currentTurnIndex: 0, battleLog: [], pendingRequests: [],
    }
    const tables = Object.fromEntries(['encounters', 'digimon', 'tamers', 'maps', 'campaigns', 'evolutionLines'].map(name => [name, { id: name, name }]))
    const queries = []
    const record = { id: participant.entityId, partnerId: over.partnerId ?? owner.entityId, attacks: [], ...over.record }
    const db = {
      select: () => ({ from: table => ({ where: async filter => {
        queries.push([table.name, filter.value])
        if (table === tables.encounters) return [encounter]
        if (table === tables.campaigns) return [{ id: 'campaign', rulesSettings: {} }]
        if (table === tables.digimon) return [record]
        throw new Error(`unexpected ${table.name} read`)
      } }) }),
      update: unexpected,
    }
    const relativePath = `server/api/encounters/[id]/actions/${action}.post.ts`
    const filename = fileURLToPath(new URL(`../${relativePath}`, import.meta.url))
    const source = ts.createSourceFile(filename, readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
    // These tests stop at the first validation after eligibility, before any combat mutation.
    const mocks = Object.fromEntries(source.statements.filter(ts.isImportDeclaration)
      .map(statement => [statement.moduleSpecifier.text, {}]))
    Object.assign(mocks, {
      'drizzle-orm': { eq: (_column, value) => ({ value }) },
      '../../../../db': { db, ...tables },
      '../../../../utils/participantTurn': { canActOnEncounterTurn },
      '../../../../utils/intercedeClaims': { serializeIntercedeClaim: (_id, run) => run() },
      '../../../../../utils/specialOrderCombat': orders,
      '../../../../utils/enemyKnockouts': { knockedOutEnemyIds: () => [] },
    })
    // Campaign/actor admission and HTTP payload validation have dedicated security
    // suites. These fixtures exercise the real business services after admission,
    // preserving their turn-guard order and record-read assertions.
    const businessName = { attack: 'prepareAttack', 'npc-attack': 'resolveNpcAttackBody', 'clash-action': 'resolveClashAction' }[action]
    let handler
    if (businessName) {
      const bindings = new Map()
      for (const declaration of source.statements.filter(ts.isImportDeclaration)) {
        for (const element of declaration.importClause?.namedBindings?.elements ?? []) {
          bindings.set(element.name.text, mocks[declaration.moduleSpecifier.text]?.[(element.propertyName ?? element.name).text])
        }
      }
      const businessSource = source.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(source)).join('\n')
      const { outputText } = ts.transpileModule(businessSource, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } })
      const business = new Function(...bindings.keys(), `${outputText}\nreturn ${businessName}`)(...bindings.values())
      handler = event => business('encounter', event.body)
    } else {
      for (const specifier of Object.keys(mocks)) {
        if (/\/(?:encounterCommand|encounterAuthorization|campaignSecurity|securityValidation)$/.test(specifier) && Object.keys(mocks[specifier]).length === 0) delete mocks[specifier]
      }
      handler = loadTrustedGameplayModule(relativePath, mocks).default
    }
    const body = {
      participantId: participant.id, breakerId: participant.id, tamerId: owner.entityId,
      attackId: 'attack', targetId: 'missing-target', clashId: 'clash', actionType: 'attack',
      accuracyDicePool: 1, accuracySuccesses: 1, accuracyDiceResults: [5],
      dodgeDicePool: 0, dodgeSuccesses: 0, dodgeDiceResults: [], bodyRoll: 1, bodyDiceResults: [1], roll: 1, diceResults: [1],
      ...over.body,
    }
    return { handler, body, participant, queries }
  }

  const afterGuard = {
    attack: [404, 'Target not found'],
    'npc-attack': [404, 'Target not found'],
    'clash-initiate': [404, 'Target not found'],
    'clash-action': [404, 'Clash opponent not found'],
    'clash-break': [400, 'Clash not found or already ended'],
  }
  for (const [action, [statusCode, message]] of Object.entries(afterGuard)) {
    test(`${action} accepts a partner turn and continues with its existing next validation`, async () => {
      const { handler, body, queries } = fixture(action)
      await assert.rejects(handler({ body }), error => error.statusCode === statusCode && error.message === message)
      assert.equal(queries.filter(([table]) => table === 'digimon').length, 1, 'attack reuses its already-loaded actor record')
    })
    test(`${action} rejects another Tamer's partner with the existing 403`, async () => {
      const { handler, body } = fixture(action, { partnerId: other.entityId })
      await assert.rejects(handler({ body }), error => error.statusCode === 403 && error.message === "It is not this participant's turn")
    })
    test(`${action} accepts a direct turn without adding a partner lookup`, async () => {
      const { handler, body, queries } = fixture(action, { direct: true })
      await assert.rejects(handler({ body }), error => error.statusCode === statusCode && error.message === message)
      assert.equal(queries.filter(([table]) => table === 'digimon').length, action === 'attack' ? 1 : 0)
    })
  }

  test('clash controller/check and action-budget failures retain precedence over turn rejection', async () => {
    const controller = fixture('clash-action', { partnerId: other.entityId, clash: { isController: false } })
    await assert.rejects(controller.handler({ body: controller.body }), error => error.statusCode === 403 && error.message === 'Only the clash controller can take clash actions')
    assert.equal(controller.queries.some(([table]) => table === 'digimon'), false)
    const pending = fixture('clash-action', { partnerId: other.entityId, clash: { clashCheckNeeded: true } })
    await assert.rejects(pending.handler({ body: pending.body }), error => error.statusCode === 400 && error.message === 'A clash check must be resolved before taking actions')
    const exhausted = fixture('clash-break', { partnerId: other.entityId, actor: { actionsRemaining: { simple: 1 } } })
    await assert.rejects(exhausted.handler({ body: exhausted.body }), error => error.statusCode === 403 && error.message === 'Not enough actions remaining (need 2 Simple Actions to Break a Clash)')
    assert.equal(exhausted.queries.some(([table]) => table === 'digimon'), false)
  })

  test('attack Special Order and Signature failures retain precedence over turn rejection', async () => {
    const order = fixture('attack', { partnerId: other.entityId, actor: { strikeFastReady: true }, body: { hugePowerUsed: true } })
    await assert.rejects(order.handler({ body: order.body }), error => error.statusCode === 400 && error.message === 'Huge Power and Overkill cannot trigger with this Special Order')
    assert.equal(order.queries.some(([table]) => table === 'digimon'), false)
    const signature = fixture('attack', { round: 2, partnerId: other.entityId, record: { attacks: [{ id: 'attack', tags: ['Signature Move'] }] } })
    await assert.rejects(signature.handler({ body: signature.body }), error => error.statusCode === 400 && error.message === 'Signature Move is available from round 3')
    assert.equal(signature.queries.filter(([table]) => table === 'digimon').length, 1)
  })
})
