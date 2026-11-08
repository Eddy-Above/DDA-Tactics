import assert from 'node:assert/strict'
import test from 'node:test'
import { computed, ref } from 'vue'
import { loadPageFunctions, loadTypeScript } from './helpers/loadTypeScript.mjs'

const { buildParticipantDisplayNames } = loadTypeScript('utils/participantDisplayNames.ts')
const { resolveParticipantName } = loadTypeScript('server/utils/participantName.ts')
const pages = {
  gm: 'pages/campaigns/[campaignId]/encounters/[id].vue',
  player: 'pages/campaigns/[campaignId]/player/[tamerId].vue',
}

for (const role of Object.keys(pages)) {
  test(`${role} names number only enemies and react to record/participant classification`, () => {
    const roster = ref([
      { id: 't1', type: 'tamer', entityId: 't1', seq: 8, isEnemy: true },
      { id: 't2', type: 'tamer', entityId: 't2' },
      { id: 'p1', type: 'digimon', entityId: 'partner', seq: 7 },
      { id: 'p2', type: 'digimon', entityId: 'partner', seq: 9 },
      { id: 'e1', type: 'digimon', entityId: 'enemy' },
      { id: 'e2', type: 'digimon', entityId: 'enemy' },
      { id: 'p3', type: 'digimon', entityId: 'enemy', isEnemy: false, seq: 4 },
    ])
    const tamers = ref([{ id: 't1', name: 'Alex' }, { id: 't2', name: 'Alex' }])
    const digimon = ref([{ id: 'partner', name: 'Alex', isEnemy: false }, { id: 'enemy', name: 'Alex', isEnemy: true }])
    let handlers
    const dependencies = {
      tamerMap: computed(() => new Map(tamers.value.map(t => [t.id, t]))),
      digimonMap: computed(() => new Map(digimon.value.map(d => [d.id, d]))),
      allTamers: tamers,
      partnerDigimon: computed(() => digimon.value.filter(d => !d.isEnemy)),
      allDigimon: digimon,
      participantDisplayNames: computed(() => buildParticipantDisplayNames(
        roster.value, handlers.getParticipantBaseName, handlers.isEnemyForDisplayName,
      )),
    }
    handlers = loadPageFunctions(pages[role], [
      ...(role === 'player' ? ['getParticipantNameDigimon'] : []),
      'getParticipantBaseName', 'isEnemyForDisplayName', role === 'gm' ? 'getDisplayName' : 'getParticipantName',
    ], dependencies)
    const name = role === 'gm' ? handlers.getDisplayName : handlers.getParticipantName
    assert.deepEqual(roster.value.map(name), ['Alex', 'Alex', 'Alex', 'Alex', 'Alex 1', 'Alex 2', 'Alex'])

    roster.value[5].isEnemy = false
    assert.equal(name(roster.value[4]), 'Alex', 'a former enemy no longer inflates the enemy group')
    assert.equal(name(roster.value[5]), 'Alex')
    roster.value[4].seq = 6
    assert.equal(name(roster.value[4]), 'Alex 6', 'stable enemy sequence survives removal of its peer')
    digimon.value[1].isEnemy = false
    assert.equal(name(roster.value[4]), 'Alex', 'a stale sequence never numbers a partner')
    assert.equal(name({ id: 'absent', type: 'digimon', entityId: 'missing' }), 'Unknown')
  })
}

test('server names never number tamers or partners, even with a stored sequence', () => {
  const tamer = { id: 't', type: 'tamer', entityId: 'same', seq: 5, isEnemy: true }
  const partner = { id: 'p', type: 'digimon', entityId: 'same', seq: 8, isEnemy: false }
  const enemy = { id: 'e', type: 'digimon', entityId: 'same', seq: 1, isEnemy: true }
  const roster = [tamer, partner, enemy]
  assert.equal(resolveParticipantName(tamer, roster, 'Alex', true), 'Alex')
  assert.equal(resolveParticipantName(partner, roster, 'Alex', true), 'Alex')
  assert.equal(resolveParticipantName(enemy, roster, 'Alex', true), 'Alex')
})

test('server names support legacy enemies without including explicit non-enemy peers', () => {
  const first = { id: 'a', type: 'digimon', entityId: 'same' }
  const second = { id: 'b', type: 'digimon', entityId: 'same' }
  const partner = { id: '0', type: 'digimon', entityId: 'same', isEnemy: false }
  assert.equal(resolveParticipantName(first, [partner, second, first], 'Goblimon', true), 'Goblimon 1')
  assert.equal(resolveParticipantName(second, [partner, second, first], 'Goblimon', true), 'Goblimon 2')
  assert.equal(resolveParticipantName({ ...second, seq: 5 }, [second], 'Goblimon', true), 'Goblimon 5')
  assert.equal(resolveParticipantName(second, [first, second], 'Gabumon', false), 'Gabumon')
})
