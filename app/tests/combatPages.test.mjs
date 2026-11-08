import assert from 'node:assert/strict'
import test from 'node:test'
import { ref, shallowRef } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { prepareAttackAccuracy, snapshotAttackRiders } = loadTypeScript('utils/attackAccuracy.ts')
const { getAttackOrderModifiers } = loadTypeScript('utils/specialOrderCombat.ts')
const { usePendingAttackFateful } = loadTypeScript('composables/usePendingAttackFateful.ts')
const gmPage = 'pages/campaigns/[campaignId]/encounters/[id].vue'
const playerPage = 'pages/campaigns/[campaignId]/player/[tamerId].vue'
const finalDice = [5, 3, 4, 5, 6]
const initialRiders = {
  bolster: true, bolsterType: 'damage-accuracy', lifesteal: true,
  hugePower: true, hugePowerRank2: true,
}

function createCombatPage(role, responseExtras = {}) {
  const attacker = { id: 'attacker', entityId: 'agumon', type: 'digimon', battery: 2 }
  const target = { id: 'target', entityId: 'goblimon', type: 'digimon' }
  const opponent = { id: 'opponent', entityId: 'ogremon', type: 'digimon' }
  const attack = { id: 'pepper-breath', name: 'Pepper Breath', range: 'ranged', tags: ['Signature Move'] }
  const encounter = { id: 'encounter-1', round: 3, participants: [attacker, target, opponent] }
  const returnedEncounter = { ...encounter, round: 4, ...responseExtras }
  const stats = { accuracy: 3, damage: 7 }
  const events = []
  const requests = []
  const logs = []
  const errors = []
  const alerts = []
  const accuracyCalls = []
  const spends = []
  const clashActions = []
  const attackSubmissions = []
  let dice = [1, 2, 4, 5, 6, 5, 3]
  let dieIndex = 0

  const dependencies = {
    currentEncounter: shallowRef(encounter),
    activeEncounter: shallowRef(encounter),
    selectedAttack: shallowRef({ participant: attacker, attack }),
    selectedTargetIds: ref([target.id]),
    showTargetSelector: ref(true),
    bolsterAttackEnabled: ref(true),
    bolsterAttackType: ref('damage-accuracy'),
    lifestealComplexEnabled: ref(true),
    hugePowerEnabled: ref(true),
    hugePowerRank2Enabled: ref(true),
    eddySoulRules: ref({ hugePowerOncePerTurn: true }),
    houseRules: ref({ signatureMoveBattery: true }),
    clashAreaAttack: shallowRef(null),
    getAttackStats: () => stats,
    getEntityDetails: (participant) => ({ name: {
      attacker: 'Agumon', target: 'Goblimon', opponent: 'Ogremon',
    }[participant.id] }),
    snapshotAttackRiders,
    getAttackOrderModifiers,
    prepareAttackAccuracy: (baseAccuracy, riders, options = {}) => {
      events.push('accuracy')
      accuracyCalls.push({ baseAccuracy, riders: { ...riders }, options })
      return prepareAttackAccuracy(baseAccuracy, riders, {
        ...options,
        random: () => {
          assert.ok(dieIndex < dice.length, 'unexpected extra accuracy dice')
          return (dice[dieIndex++] - 1) / 6
        },
      })
    },
    $fetch: async (...args) => {
      events.push('request')
      requests.push(args)
      return returnedEncounter
    },
    addBattleLogEntry: async (...args) => { events.push('log'); logs.push(args) },
    executeClashAction: async (...args) => { events.push('end-clash'); clashActions.push(args) },
    tamer: shallowRef({ id: 'tamer-entity' }),
    actOfInspirationEnabled: ref(false),
    actOfInspirationCost: ref(4),
    handleSpendInspiration: async (...args) => { events.push('spend'); spends.push(args); return true },
    applyActionResult: async result => {
      if (result) dependencies.currentEncounter.value = result
    },
    accuracyReview: shallowRef(null),
    accuracyReviewContext: shallowRef(null),
    showAccuracyReview: ref(false),
    performAttack: async (...args) => { attackSubmissions.push(args) },
    alert: (message) => { alerts.push(message) },
    console: { error: (...args) => { errors.push(args) } },
  }
  return {
    attacker, target, opponent, attack, encounter, returnedEncounter, stats,
    dependencies, events, requests, logs, errors, alerts, accuracyCalls, spends, clashActions, attackSubmissions,
    setDice(values) { dice = values; dieIndex = 0 },
    load() {
      return loadPageFunctions(role === 'gm' ? gmPage : playerPage,
        ['confirmAttack', 'confirmAreaAttack'], dependencies)
    },
    assertNoErrors() { assert.deepEqual(errors, []); assert.deepEqual(alerts, []) },
  }
}

test('the real GM single-target handler submits shared accuracy and logs the Huge Power reroll', async () => {
  const fixture = createCombatPage('gm')
  const { confirmAttack } = fixture.load()
  const operation = confirmAttack(fixture.target)
  assert.equal(fixture.dependencies.showTargetSelector.value, false)
  assert.equal(fixture.dependencies.selectedAttack.value, null)
  assert.deepEqual(fixture.dependencies.selectedTargetIds.value, [])
  await operation
  fixture.assertNoErrors()
  assert.deepEqual(fixture.accuracyCalls, [{ baseAccuracy: 3, riders: initialRiders, options: { halfDodge: false, successThreshold: 5, suppressPower: false, automaticSuccesses: undefined } }])
  assert.deepEqual(fixture.requests, [[
    '/api/encounters/encounter-1/actions/intercede-offer',
    { method: 'POST', body: {
      attackerId: 'attacker', targetId: 'target', accuracySuccesses: 3,
      accuracyDice: finalDice, attackId: 'pepper-breath', attackName: 'Pepper Breath',
      attackData: { dicePool: 5, attackStats: fixture.stats },
      bolstered: true, bolsterType: 'damage-accuracy', lifestealed: true,
      hugePowerUsed: true, hugePowerAttackRange: 'ranged', hugePowerRank: 2,
      hugePowerTrackAll: true, isSignatureMove: true, batteryCount: 2,
    } },
  ]])
  assert.equal(fixture.dependencies.currentEncounter.value, fixture.returnedEncounter)
  assert.deepEqual(fixture.logs, [['encounter-1', {
    round: 4, actorId: 'attacker', actorName: 'Agumon', action: 'Attack', target: 'Goblimon',
    result: '5d6 => [1,2,4,5,6] => HP2 reroll => [5,3,4,5,6] = 3 successes',
    damage: null, effects: ['Attack'], accuracyDicePool: 5,
    accuracyDiceResults: finalDice, accuracySuccesses: 3,
  }]])
  assert.deepEqual(fixture.events, ['accuracy', 'request', 'log'])
})

for (const area of [false, true]) {
  test(`player radial Fateful opens the dice chooser after preparing the ${area ? 'area' : 'single-target'} review`, async () => {
    const f = createCombatPage('player')
    let opened = false
    f.dependencies.fateful = { open: () => { opened = true; assert.ok(f.dependencies.accuracyReview.value) } }
    f.dependencies.selectedAttack.value.radialOptions = { fatefulIntervention: true }
    const handlers = f.load()
    await (area ? handlers.confirmAreaAttack([f.target]) : handlers.confirmAttack(f.target))
    f.assertNoErrors()
    assert.equal(opened, true)
    assert.equal(f.dependencies.showAccuracyReview.value, true)
    assert.deepEqual(f.requests, [])
    assert.deepEqual(f.attackSubmissions, [])
  })

  test(`GM radial Inspiration prepares and pauses a ${area ? 'area' : 'single-target'} attack before sending the chosen dice`, async () => {
    const f = createCombatPage('gm')
    const pending = usePendingAttackFateful()
    const payer = { id: 'owning-tamer', type: 'tamer' }
    const options = { ...initialRiders, lifesteal: false, actOfInspiration: true, fatefulIntervention: true }
    f.dependencies.selectedAttack.value.radialOptions = options
    f.encounter.phase = 'combat'
    f.returnedEncounter.phase = 'combat'
    f.encounter.participants.push(payer)
    f.setDice(Array(10).fill(5))
    Object.assign(f.dependencies, { getMapAttackTamer: () => payer, campaignLevel: ref('standard'),
      INSPIRATION_ACT_COST: { standard: 4 }, pendingAttackFateful: pending, gmFatefulTamer: ref(null),
      gmFateful: { open: () => f.events.push('fateful') }, canParticipantAct: () => true })
    const handlers = loadPageFunctions(gmPage, ['confirmAttack', 'confirmAreaAttack', 'prepareRadialAttackAccuracy'], f.dependencies)
    const operation = area ? handlers.confirmAreaAttack([f.target]) : handlers.confirmAttack(f.target)
    for (let i = 0; i < 10 && !pending.target.value; i++) await Promise.resolve()
    f.assertNoErrors()
    assert.ok(pending.target.value)
    assert.equal(pending.target.value.isCurrent(), true)
    assert.equal(f.dependencies.gmFatefulTamer.value.id, payer.id)
    assert.equal(f.requests.length, 1, 'only Act of Inspiration is paid before the chooser')
    assert.equal(f.requests[0][1].body.participantId, payer.id)
    assert.equal(pending.target.value.baseDicePool, 10)
    assert.equal(f.dependencies.selectedAttack.value, null)
    await pending.target.value.apply({ rolls: [6, 6, 6], dicePool: 3, successes: 3 })
    await operation
    f.assertNoErrors()
    assert.equal(f.requests.length, 2)
    assert.match(f.requests[1][0], /intercede-offer$/)
    assert.deepEqual(f.requests[1][1].body.accuracyDice, [6, 6, 6])
    assert.equal(f.requests[1][1].body.accuracySuccesses, 3)
    assert.equal(f.requests[1][1].body.bolstered, true)
    assert.equal(f.requests[1][1].body.hugePowerRank, 2)
  })
}

test('cancelling GM radial Fateful abandons the outgoing attack without submitting it', async () => {
  const f = createCombatPage('gm'), pending = usePendingAttackFateful()
  f.dependencies.selectedAttack.value.radialOptions = { ...initialRiders, actOfInspiration: false, fatefulIntervention: true }
  Object.assign(f.dependencies, { getMapAttackTamer: () => ({ id: 'tamer' }), pendingAttackFateful: pending,
    gmFatefulTamer: ref(null), gmFateful: { open: () => {} } })
  const handlers = loadPageFunctions(gmPage, ['confirmAttack', 'prepareRadialAttackAccuracy'], f.dependencies)
  const operation = handlers.confirmAttack(f.target)
  assert.ok(pending.target.value)
  pending.cancel()
  await operation
  f.assertNoErrors()
  assert.deepEqual(f.requests, [])
})

test('the real GM area handler sends one shared roll, forces the clash opponent and ends the clash', async () => {
  const fixture = createCombatPage('gm', { selectiveTargetingExcludedIds: ['target'] })
  const clash = { controllerId: 'attacker', opponentId: 'opponent' }
  fixture.dependencies.clashAreaAttack.value = clash
  const shape = { shape: 'pass', origin: { x: 1, y: 0, z: 2 }, direction: { x: 1, y: 0, z: 0 } }
  const targets = [fixture.target]
  await fixture.load().confirmAreaAttack(targets, shape)
  fixture.assertNoErrors()
  assert.equal(fixture.accuracyCalls.length, 1)
  assert.equal(fixture.requests.length, 1)
  const [url, request] = fixture.requests[0]
  assert.equal(url, '/api/encounters/encounter-1/actions/intercede-offer')
  assert.equal(request.method, 'POST')
  assert.deepEqual(request.body.targetIds, ['target', 'opponent'])
  assert.equal(request.body.areaShapeData, shape)
  assert.equal(request.body.clashNoInterceptTargetId, 'opponent')
  assert.deepEqual(request.body.accuracyDice, finalDice)
  assert.equal(request.body.accuracySuccesses, 3)
  assert.deepEqual(request.body.attackData, { dicePool: 5, attackStats: fixture.stats })
  assert.deepEqual(fixture.clashActions, [['attacker', 'end']])
  assert.equal(fixture.dependencies.clashAreaAttack.value, null)
  assert.deepEqual(targets, [fixture.target], 'forcing the opponent must not mutate the caller target list')
  assert.equal(fixture.logs[0][1].action, 'Area Attack')
  assert.equal(fixture.logs[0][1].target, 'Ogremon', 'selectively excluded targets stay out of the log')
  assert.deepEqual(fixture.events, ['accuracy', 'request', 'end-clash', 'log'])
})

test('the real GM area handler keeps an already selected clash opponent once and normalizes absent shape data', async () => {
  const fixture = createCombatPage('gm')
  fixture.dependencies.clashAreaAttack.value = { controllerId: 'attacker', opponentId: 'opponent' }
  await fixture.load().confirmAreaAttack([fixture.target, fixture.opponent])
  fixture.assertNoErrors()
  assert.equal(fixture.requests.length, 1)
  assert.deepEqual(fixture.requests[0][1].body.targetIds, ['target', 'opponent'])
  assert.equal(fixture.requests[0][1].body.areaShapeData, null)
  assert.equal(fixture.clashActions.length, 1)
})

test('the real player single handler spends the +5 Inspiration before dice and preserves captured riders for review', async () => {
  const fixture = createCombatPage('player')
  let completeSpend
  fixture.dependencies.actOfInspirationEnabled.value = true
  fixture.dependencies.handleSpendInspiration = (...args) => {
    fixture.events.push('spend')
    fixture.spends.push(args)
    return new Promise((resolve) => { completeSpend = resolve })
  }
  fixture.setDice([1, 2, 4, 5, 6, 5, 6, 3, 4, 5, 6, 5])
  const operation = fixture.load().confirmAttack(fixture.target)
  assert.deepEqual(fixture.spends, [['act-of-inspiration', 4]])
  assert.equal(fixture.accuracyCalls.length, 0)
  assert.equal(fixture.dependencies.showAccuracyReview.value, false)
  assert.equal(fixture.dependencies.selectedAttack.value, null)

  // Controls can change while the spend is pending; this attack retains the choices made on click.
  fixture.dependencies.bolsterAttackEnabled.value = false
  fixture.dependencies.bolsterAttackType.value = 'bit-cpu'
  fixture.dependencies.lifestealComplexEnabled.value = false
  fixture.dependencies.hugePowerEnabled.value = false
  fixture.dependencies.hugePowerRank2Enabled.value = false
  fixture.dependencies.actOfInspirationEnabled.value = false
  completeSpend(true)
  await operation
  fixture.assertNoErrors()
  assert.deepEqual(fixture.accuracyCalls, [{
    baseAccuracy: 3, riders: initialRiders, options: { actOfInspiration: true, halfDodge: false, successThreshold: 5, suppressPower: false, automaticSuccesses: undefined },
  }])
  assert.deepEqual(fixture.dependencies.accuracyReview.value, {
    dicePool: 10, rolls: [6, 5, 4, 5, 6, 5, 6, 3, 4, 5], successes: 7, successThreshold: 5, automaticSuccesses: 0,
  })
  assert.deepEqual(fixture.dependencies.accuracyReviewContext.value, {
    participant: fixture.attacker, attack: fixture.attack, target: fixture.target, ...initialRiders,
  })
  assert.equal(fixture.dependencies.showAccuracyReview.value, true)
  assert.equal(fixture.requests.length, 0)
  assert.equal(fixture.attackSubmissions.length, 0)
  assert.deepEqual(fixture.events, ['spend', 'accuracy'])
})

test('the real player area handler hands shape, shared accuracy and clash context to review before submission', async () => {
  const fixture = createCombatPage('player')
  const clash = { controllerId: 'attacker', opponentId: 'opponent' }
  fixture.dependencies.clashAreaAttack.value = clash
  const shape = { shape: 'burst', origin: { x: 1, y: 2, z: 3 }, radius: 2 }
  await fixture.load().confirmAreaAttack([fixture.target], shape)
  fixture.assertNoErrors()
  assert.deepEqual(fixture.accuracyCalls, [{
    baseAccuracy: 3, riders: initialRiders, options: { actOfInspiration: false, halfDodge: false, successThreshold: 5, suppressPower: false, automaticSuccesses: undefined },
  }])
  assert.deepEqual(fixture.dependencies.accuracyReview.value, {
    dicePool: 5, rolls: finalDice, successes: 3, successThreshold: 5, automaticSuccesses: 0,
  })
  assert.deepEqual(fixture.dependencies.accuracyReviewContext.value, {
    participant: fixture.attacker, attack: fixture.attack, target: fixture.target,
    areaTargets: [fixture.target, fixture.opponent], areaShapeData: shape,
    ...initialRiders, clashAreaAttack: clash,
  })
  assert.equal(fixture.dependencies.clashAreaAttack.value, null)
  assert.equal(fixture.dependencies.showAccuracyReview.value, true)
  assert.equal(fixture.spends.length, 0)
  assert.equal(fixture.requests.length, 0)
  assert.equal(fixture.attackSubmissions.length, 0)
  assert.equal(fixture.clashActions.length, 0, 'the player clash ends only after review submits the attack')
})

for (const area of [false, true]) {
  test(`a refused Act of Inspiration does not roll or submit a ${area ? 'area' : 'single-target'} attack`, async () => {
    const fixture = createCombatPage('player')
    fixture.dependencies.actOfInspirationEnabled.value = true
    fixture.dependencies.handleSpendInspiration = async () => false
    const handlers = fixture.load()
    if (area) await handlers.confirmAreaAttack([fixture.target])
    else await handlers.confirmAttack(fixture.target)
    assert.equal(fixture.accuracyCalls.length, 0)
    assert.equal(fixture.dependencies.showAccuracyReview.value, false)
    assert.equal(fixture.requests.length, 0)
    assert.equal(fixture.attackSubmissions.length, 0)
  })
}

function createIntercedePage(role) {
  const encounter = {
    id: 'encounter-1', round: 2,
    participants: [{ id: 'guard', actionsRemaining: { simple: 1 }, currentWounds: 3 }],
    pendingRequests: [{ id: 'offer', type: 'intercede-offer' }], battleLog: [],
  }
  const request = { id: 'offer', data: { isAreaAttack: true, targetName: 'Target' } }
  const alerts = []
  const requests = []
  const reloads = []
  let rejectRequest
  const dependencies = {
    currentEncounter: shallowRef(encounter),
    activeEncounter: shallowRef(encounter),
    gmIntercedeRequest: shallowRef(request),
    currentIntercedeRequest: shallowRef(request),
    gmIntercedeLoading: ref(false),
    intercedeLoading: ref(false),
    showGmIntercedeModal: ref(true),
    intercedeResultData: shallowRef(null),
    showIntercedeResultModal: ref(false),
    $fetch: (...args) => {
      requests.push(args)
      return new Promise((_resolve, reject) => { rejectRequest = reject })
    },
    loadData: async () => { reloads.push('reload') },
    alert: message => { alerts.push(message) },
    console: { error: () => {} },
  }
  const name = role === 'gm' ? 'handleGmIntercedeClaim' : 'handleIntercedeClaim'
  const handler = loadPageFunctions(role === 'gm' ? gmPage : playerPage, [name], dependencies)[name]
  return {
    encounter, dependencies, alerts, requests, reloads,
    loading: role === 'gm' ? dependencies.gmIntercedeLoading : dependencies.intercedeLoading,
    reject: error => rejectRequest(error),
    claim: () => {
      const throwOptions = { allyId: 'target', landingPos: { x: 2, y: 0, z: 1 } }
      return role === 'gm' ? handler('offer', 'guard', throwOptions) : handler('guard', throwOptions)
    },
  }
}

const claimConflicts = [
  {
    name: 'an interceptor already used in this AoE',
    message: 'This character has already interceded for this area attack. Choose a different character.',
  },
  {
    name: 'a target claimed by someone else',
    message: 'Another participant already interceded for this target',
  },
  {
    name: 'an area-shape conflict',
    message: 'Area shape data missing from group state',
  },
  {
    name: 'a conflict without a server message',
    message: undefined,
    expected: 'This intercede offer is no longer available.',
  },
]

for (const role of ['gm', 'player']) {
  for (const conflict of claimConflicts) {
    test(`the real ${role} intercede handler explains ${conflict.name} without spending actions`, async () => {
      const fixture = createIntercedePage(role)
      const before = structuredClone(fixture.encounter)
      const operation = fixture.claim()
      assert.equal(fixture.loading.value, true)
      fixture.reject({ statusCode: 409, ...(conflict.message ? { data: { message: conflict.message } } : {}) })
      await operation

      assert.deepEqual(fixture.alerts, [conflict.expected ?? conflict.message])
      assert.equal(fixture.loading.value, false, 'a rejected claim must release its busy state')
      assert.equal(fixture.requests.length, 1)
      assert.deepEqual(fixture.requests[0], [
        '/api/encounters/encounter-1/actions/intercede-claim',
        { method: 'POST', body: {
          requestId: 'offer', interceptorParticipantId: 'guard', chosenTargetId: 'target',
          throwAllyLandingPos: { x: 2, y: 0, z: 1 },
        } },
      ])
      assert.strictEqual(fixture.dependencies.currentEncounter.value, fixture.encounter)
      assert.strictEqual(fixture.dependencies.activeEncounter.value, fixture.encounter)
      assert.deepEqual(fixture.encounter, before, 'a conflict must not deduct actions, apply damage or replace encounter data')
      assert.deepEqual(fixture.reloads, [], 'a rejected claim must not run the success refresh')
      assert.equal(fixture.dependencies.intercedeResultData.value, null)
      assert.equal(fixture.dependencies.showIntercedeResultModal.value, false)
    })
  }
}
