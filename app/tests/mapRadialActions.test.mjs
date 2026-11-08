import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref, shallowRef } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const attackOptions = loadTypeScript('utils/combatAttackOptions.ts')

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
  const encounter = shallowRef({ id: 'encounter', round: 3, participants: [actor] })
  const updates = []
  const logs = []
  const dependencies = {
    ...attackOptions,
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
    updateEncounter: async (...args) => { updates.push(args) },
    addBattleLogEntry: async (...args) => { logs.push(args) },
  }
  const handlers = loadPageFunctions(pages[role], [
    'getParticipantAttacks', 'canUseAttack', 'selectAttackAndShowTargets',
    'onMapAttackSelected', 'onMapStanceSelected', role === 'gm' ? 'changeStance' : 'changePlayerStance',
  ], dependencies)
  return { ...handlers, dependencies, actor, record, attack, areaAttack, encounter, updates, logs }
}

for (const role of Object.keys(pages)) {
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

  test(`${role} radial stance changes the selected participant once and logs the action`, async () => {
    const page = createMapActions(role)
    await page.onMapStanceSelected(page.actor.id, 'defensive')
    assert.equal(page.actor.currentStance, 'defensive')
    assert.equal(page.actor.actionsRemaining.simple, 1)
    assert.equal(page.updates.length, 1)
    assert.equal(page.updates[0][1].participants[0].id, page.actor.id)
    assert.equal(page.logs.length, 1)
    assert.equal(page.logs[0][1].actorId, page.actor.id)
    await page.onMapStanceSelected(page.actor.id, 'defensive')
    assert.equal(page.actor.actionsRemaining.simple, 1)
    assert.equal(page.updates.length, 1)
  })

  test(`${role} radial stance rejects missing, clashing and exhausted participants`, async () => {
    const page = createMapActions(role)
    await page.onMapStanceSelected('removed-participant', 'offensive')
    page.actor.clash = { isController: false }
    await page.onMapStanceSelected(page.actor.id, 'offensive')
    delete page.actor.clash
    page.actor.actionsRemaining.simple = 0
    await page.onMapStanceSelected(page.actor.id, 'offensive')
    assert.equal(page.actor.currentStance, 'neutral')
    assert.equal(page.updates.length, 0)
    assert.equal(page.logs.length, 0)
  })
}

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
