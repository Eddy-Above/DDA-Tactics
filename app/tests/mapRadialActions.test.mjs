import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref, shallowRef } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const attackOptions = loadTypeScript('utils/combatAttackOptions.ts')
const radialAttackOptions = loadTypeScript('utils/attackRadialOptions.ts')

const pages = {
  gm: 'pages/campaigns/[campaignId]/encounters/[id].vue',
  player: 'pages/campaigns/[campaignId]/player/[tamerId].vue',
}

function createMapActions(role) {
  const attack = { id: 'pepper-breath', name: 'Pepper Breath', range: 'ranged', tags: [] }
  const areaAttack = { id: 'fire-burst', name: 'Fire Burst', range: 'ranged', tags: ['Area Attack: Burst'] }
  const signature = { id: 'signature', name: 'Signature', range: 'ranged', tags: ['Signature Move'] }
  const record = { id: 'agumon', attacks: [attack, areaAttack, signature] }
  const actor = { id: 'actor', entityId: record.id, type: 'digimon', currentStance: 'neutral', actionsRemaining: { simple: 2 } }
  const encounter = shallowRef({ id: 'encounter', phase: 'combat', round: 3, participants: [actor] })
  const updates = []
  const logs = []
  const rejected = []
  const dependencies = {
    ...attackOptions,
    ...radialAttackOptions,
    radialAttackDraft: ref(null),
    mapDirectMode: ref(null),
    getMapAttackContext: () => ({ round: 3, campaignLevel: 'standard', hasTamer: true, inspiration: 100, fatefulAvailable: true,
      record: { qualities: [{ id: 'huge-power', ranks: 2 }] } }),
    canParticipantAct: () => true,
    currentEncounter: encounter,
    activeEncounter: encounter,
    activeParticipant: computed(() => encounter.value.participants[0]),
    myParticipants: computed(() => encounter.value.participants),
    digimonMap: shallowRef(new Map([[record.id, record]])),
    partnerDigimon: shallowRef([record]),
    eddySoulRules: ref({}),
    houseRules: ref({}),
    BASIC_ATTACKS: [],
    selectedAttack: shallowRef(null),
    bolsterAttackEnabled: ref(true),
    bolsterAttackType: ref('damage'),
    lifestealComplexEnabled: ref(true),
    hugePowerEnabled: ref(true),
    hugePowerRank2Enabled: ref(true),
    actOfInspirationEnabled: ref(true),
    showMapView: ref(true),
    showTargetSelector: ref(false),
    npcAttackParticipantId: ref(actor.id),
    playerAttackParticipantId: ref(actor.id),
    npcStanceParticipantId: ref(actor.id),
    mapStanceDigimonParticipantId: ref(actor.id),
    tamer: shallowRef({ id: 'tamer' }),
    getEntityDetails: () => ({ name: 'Agumon' }),
    getParticipantName: () => 'Agumon',
    updateEncounter: async () => { throw new Error('Player stance must use a scoped intent') },
    performIntent: async (id, action, body) => {
      updates.push([id, action, body])
      const current = encounter.value.participants.find(p => p.id === body.participantId)
      if (!current || current.clash || current.actionsRemaining.simple < 1) { rejected.push(body); return null }
      if (current.currentStance === body.stance) return encounter.value
      encounter.value = { ...encounter.value, participants: encounter.value.participants.map(p => p.id === current.id ? { ...p, currentStance: body.stance, actionsRemaining: { simple: p.actionsRemaining.simple - 1 } } : p) }
      return encounter.value
    },
    applyActionResult: async snapshot => { if (snapshot) encounter.value = snapshot },
    alert: () => {},
    addBattleLogEntry: async (...args) => { logs.push(args) },
  }
  const handlers = loadPageFunctions(pages[role], [
    'getParticipantAttacks', 'canUseAttack', 'selectAttackAndShowTargets',
    'onMapAttackSelected', 'onMapAttackRiderSelected', 'onMapStanceSelected', role === 'gm' ? 'changeStance' : 'changePlayerStance',
  ], dependencies)
  return { ...handlers, dependencies, actor, record, attack, areaAttack, encounter, updates, logs, rejected }
}

for (const role of Object.keys(pages)) {
  test(`${role} radial can select a charged Signature in round 2 without spending locally`, () => {
    const page = createMapActions(role)
    page.encounter.value.round = 2
    page.dependencies.houseRules.value = { signatureMoveBattery: true }
    page.actor.battery = 1
    page.onMapAttackSelected(page.actor.id, 'signature')
    assert.equal(page.dependencies.selectedAttack.value.attack.id, 'signature')
    assert.equal(page.actor.battery, 1)
    assert.equal(page.actor.actionsRemaining.simple, 2)
    assert.deepEqual(page.updates, [])
  })

  test(`${role} charge choices reach map targeting and empty Continue clears a previous movement choice`, () => {
    const page = createMapActions(role)
    page.attack.tags.push('Charge Attack')
    page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'charge-before')
    page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'charge-after')
    page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'huge-power')
    const selected = page.dependencies.radialAttackDraft.value.riders
    assert.deepEqual(selected, ['charge-after', 'huge-power'])
    page.onMapAttackSelected(page.actor.id, page.attack.id, selected)
    assert.equal(page.dependencies.selectedAttack.value.radialOptions.chargeMode, 'after')
    assert.equal(page.dependencies.hugePowerEnabled.value, true)
    page.onMapAttackSelected(page.actor.id, page.attack.id, [])
    assert.equal(page.dependencies.selectedAttack.value.radialOptions.chargeMode, null)
    assert.equal(page.dependencies.hugePowerEnabled.value, false)
    assert.equal(page.actor.actionsRemaining.simple, 2)
    assert.deepEqual(page.updates, [])
  })

  test(`${role} radial toggles combine riders and Continue also supports no riders without spending`, () => {
    const page = createMapActions(role)
    page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'bolster-bit-cpu')
    page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'huge-power-2')
    const chosen = page.dependencies.radialAttackDraft.value.riders
    assert.deepEqual(chosen, ['bolster-bit-cpu', 'huge-power-2'])
    assert.equal(page.dependencies.selectedAttack.value, null)
    page.onMapAttackSelected(page.actor.id, page.attack.id, chosen)
    assert.equal(page.dependencies.bolsterAttackEnabled.value, true)
    assert.equal(page.dependencies.bolsterAttackType.value, 'bit-cpu')
    assert.equal(page.dependencies.hugePowerRank2Enabled.value, true)
    assert.equal(page.dependencies.selectedAttack.value.radialOptions.hugePower, true)
    assert.equal(page.dependencies.radialAttackDraft.value, null)
    page.onMapAttackSelected(page.actor.id, page.attack.id, [])
    assert.equal(page.dependencies.bolsterAttackEnabled.value, false)
    assert.equal(page.dependencies.hugePowerEnabled.value, false)
    assert.equal(page.dependencies.selectedAttack.value.radialOptions.fatefulIntervention, false)
    assert.deepEqual(page.updates, [])
    assert.equal(page.actor.actionsRemaining.simple, 2)
  })

  test(`${role} stale rider choices recheck actions and turn ownership before targeting`, () => {
    const page = createMapActions(role)
    page.actor.actionsRemaining.simple = 1
    page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'bolster-bit-cpu')
    page.onMapAttackSelected(page.actor.id, page.attack.id, ['bolster-bit-cpu'])
    assert.equal(page.dependencies.radialAttackDraft.value, null)
    assert.equal(page.dependencies.selectedAttack.value, null)
    page.dependencies.canParticipantAct = () => false
    const handlers = loadPageFunctions(pages[role], ['onMapAttackSelected', 'onMapAttackRiderSelected'], {
      ...page.dependencies, getParticipantAttacks: () => [page.attack], canUseAttack: () => true,
      selectAttackAndShowTargets: () => { throw new Error('Off-turn attacks must not start') },
    })
    handlers.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'fateful-intervention')
    handlers.onMapAttackSelected(page.actor.id, page.attack.id, [])
    assert.equal(page.dependencies.radialAttackDraft.value, null)
  })
  test(`${role} radial attack starts map targeting with the current attack and resets riders`, () => {
    const page = createMapActions(role)
    page.onMapAttackSelected(page.actor.id, page.attack.id)
    assert.equal(page.dependencies.selectedAttack.value.participant, page.actor)
    assert.equal(page.dependencies.selectedAttack.value.attack, page.attack)
    assert.equal(page.dependencies.showTargetSelector.value, false)
    assert.equal(page.dependencies.bolsterAttackEnabled.value, false)
    assert.equal(page.dependencies.lifestealComplexEnabled.value, false)
    assert.equal(page.dependencies.hugePowerEnabled.value, false)
    assert.equal(page.dependencies.hugePowerRank2Enabled.value, false)
    assert.equal(page.updates.length, 0, 'choosing an attack must not spend its action before targeting')
  })

  test(`${role} radial attack rejects stale, spent, unaffordable and clashing choices`, () => {
    const page = createMapActions(role)
    page.onMapAttackSelected('removed-participant', page.attack.id)
    page.onMapAttackSelected(page.actor.id, 'removed-attack')
    page.actor.usedAttackIds = [page.attack.id]
    page.onMapAttackSelected(page.actor.id, page.attack.id)
    page.actor.actionsRemaining.simple = 1
    page.actor.combatMonsterBonus = 2
    page.dependencies.eddySoulRules.value = { combatMonsterAreaAttackRequiresComplex: true }
    page.onMapAttackSelected(page.actor.id, page.areaAttack.id)
    page.dependencies.houseRules.value = { signatureMoveBattery: true }
    page.actor.battery = 0
    page.onMapAttackSelected(page.actor.id, 'signature')
    page.actor.clash = { isController: true }
    page.onMapAttackSelected(page.actor.id, page.areaAttack.id)
    assert.equal(page.dependencies.selectedAttack.value, null)
    assert.equal(page.actor.actionsRemaining.simple, 1)
  })

  test(`${role} radial stance sends the actor intent and adopts the server snapshot without local cost writes`, async () => {
    const page = createMapActions(role)
    await page.onMapStanceSelected(page.actor.id, 'defensive')
    assert.equal(page.actor.currentStance, 'neutral', 'the earlier participant snapshot was not mutated optimistically')
    assert.equal(page.actor.actionsRemaining.simple, 2)
    const current = page.encounter.value.participants[0]
    assert.equal(current.currentStance, 'defensive')
    assert.equal(current.actionsRemaining.simple, 1)
    assert.equal(page.updates.length, 1)
    assert.deepEqual(page.updates[0].slice(0, 2), ['encounter', 'stance'])
    assert.equal(page.updates[0][2].participantId, page.actor.id)
    assert.equal(page.updates[0][2].stance, 'defensive')
    assert.equal(typeof page.updates[0][2].operationId, 'string')
    assert.equal(page.updates[0][2].participants, undefined)
    assert.deepEqual(page.logs, [], 'mechanical logs belong to the committed server action')
    await page.onMapStanceSelected(page.actor.id, 'defensive')
    assert.equal(page.encounter.value.participants[0].actionsRemaining.simple, 1, 'a server-confirmed no-op cannot spend another action')
  })

  test(`${role} radial stance ignores a removed actor and preserves state when the server rejects stale choices`, async () => {
    const page = createMapActions(role)
    await page.onMapStanceSelected('removed-participant', 'offensive')
    page.actor.clash = { isController: false }
    await page.onMapStanceSelected(page.actor.id, 'offensive')
    delete page.actor.clash
    page.actor.actionsRemaining.simple = 0
    await page.onMapStanceSelected(page.actor.id, 'offensive')
    assert.equal(page.actor.currentStance, 'neutral')
    assert.equal(page.updates.length, 2)
    assert.equal(page.rejected.length, 2)
    assert.deepEqual(page.logs, [])
  })
}

test('GM map attack, rider and stance choices stop when combat ends with the same active token', async () => {
  const page = createMapActions('gm')
  page.encounter.value.phase = 'ended'
  page.onMapAttackRiderSelected(page.actor.id, page.attack.id, 'huge-power')
  page.onMapAttackSelected(page.actor.id, page.attack.id)
  await page.onMapStanceSelected(page.actor.id, 'defensive')
  assert.equal(page.dependencies.selectedAttack.value, null)
  assert.equal(page.dependencies.radialAttackDraft.value, null)
  assert.equal(page.actor.currentStance, 'neutral')
  assert.deepEqual(page.updates, [])
})

test('canvas radial choices recheck the live branch and preserve colon-containing choice ids', () => {
  const participantId = ref('actor')
  const radialItems = shallowRef([])
  const events = []
  let closeCount = 0
  const { onRadialSelect } = loadPageFunctions('components/MapCanvas.vue', ['enabledRadialLeaf', 'onRadialSelect'], {
    radialParticipantId: participantId,
    radialItems,
    closeRadial: () => { closeCount++; participantId.value = null },
    emit: (...args) => { events.push(args) },
  })

  for (const action of ['digivolve', 'direct', 'attack']) {
    const staleLeaf = { id: `${action}:choice`, label: 'Choice', disabled: false }
    radialItems.value = [{ id: action, label: action, disabled: true, children: [staleLeaf] }]
    onRadialSelect(staleLeaf)
  }
  radialItems.value = [{ id: 'attack', label: 'Attack', children: [] }]
  onRadialSelect({ id: 'attack:removed', label: 'Removed attack', disabled: false })
  assert.deepEqual(events, [])
  assert.equal(closeCount, 0, 'stale choices cannot dismiss the live menu or dispatch an action')

  const modeChoice = { id: 'mode-change:form-a:form-b', label: 'Change form' }
  radialItems.value = [{ id: 'mode-change', label: 'Mode Change', children: [modeChoice] }]
  onRadialSelect(modeChoice)
  onRadialSelect(modeChoice)
  assert.deepEqual(events, [['action-selected', 'actor', 'mode-change', 'form-a:form-b']])
  assert.equal(closeCount, 1)
})

test('GM Manage dispatches the chosen token once and rejects players or removed tokens', () => {
  const participantId = ref('shared-token-choice')
  const props = { isDm: true, participants: [{ id: participantId.value }] }
  const events = []
  const { onRadialSelect } = loadPageFunctions('components/MapCanvas.vue', ['enabledRadialLeaf', 'onRadialSelect'], {
    props, radialParticipantId: participantId,
    radialItems: ref([{ id: 'gm-manage', label: 'Manage' }]),
    closeRadial: () => { participantId.value = null }, emit: (...args) => events.push(args),
  })
  const item = { id: 'gm-manage', label: 'Manage' }
  props.isDm = false
  onRadialSelect(item)
  props.isDm = true
  props.participants = []
  onRadialSelect(item)
  assert.deepEqual(events, [])
  props.participants = [{ id: participantId.value }]
  onRadialSelect(item)
  onRadialSelect(item)
  assert.deepEqual(events, [['gm-manage', 'shared-token-choice']])
})

test('canvas rider toggles keep the wheel open and Continue dispatches the current rider selection including empty', () => {
  const participantId = ref('actor'), events = []
  const option = { id: 'toggle', label: 'Huge Power', attackId: 'attack:colon', attackRider: 'huge-power' }
  const confirm = { id: 'continue', label: 'Continue', attackId: 'attack:colon', attackRiders: ['huge-power'] }
  const radialItems = ref([{ id: 'attack', label: 'Attack', children: [{ id: 'attack:colon', label: 'Claw', children: [option, confirm] }] }])
  const handlers = loadPageFunctions('components/MapCanvas.vue', ['enabledRadialLeaf', 'onRadialSelect'], {
    radialParticipantId: participantId, radialItems, closeRadial: () => { participantId.value = null }, emit: (...args) => events.push(args),
  })
  handlers.onRadialSelect({ ...option, attackId: 'forged', attackRider: 'fateful-intervention' })
  assert.equal(participantId.value, 'actor')
  assert.deepEqual(events.pop(), ['attack-rider-selected', 'actor', 'attack:colon', 'huge-power'])
  handlers.onRadialSelect(confirm)
  assert.equal(participantId.value, null)
  assert.deepEqual(events.pop(), ['attack-selected', 'actor', 'attack:colon', ['huge-power']])
  participantId.value = 'actor'
  radialItems.value[0].children[0].children[1].attackRiders = []
  handlers.onRadialSelect(confirm)
  assert.deepEqual(events.pop(), ['attack-selected', 'actor', 'attack:colon', []])
  participantId.value = 'actor'
  radialItems.value[0].children[0].disabled = true
  handlers.onRadialSelect(option)
  assert.deepEqual(events, [])
})
