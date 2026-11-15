import test from 'node:test'
import assert from 'node:assert/strict'
import { ref } from 'vue'
import { readFileSync } from 'node:fs'
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc'
import { loadTypeScript, loadPageFunctions } from './helpers/loadTypeScript.mjs'

const { selectIntercedeTargets } = loadTypeScript('utils/intercedeSelections.ts')
const participants = [
  { id: 'me', entityId: 'alice', type: 'tamer' },
  { id: 'other', entityId: 'bob', type: 'tamer' },
  { id: 'partner', entityId: 'agumon', type: 'digimon' },
  { id: 'other-partner', entityId: 'gabumon', type: 'digimon' },
  { id: 'friendly-npc', entityId: 'guide', type: 'digimon' },
  { id: 'enemy', entityId: 'foe', type: 'digimon' },
  { id: 'enemy-instance', entityId: 'agumon', type: 'digimon', isEnemy: true },
  { id: 'reserve', entityId: 'agumon', type: 'digimon', inReserve: true },
  { id: 'reserve-tamer', entityId: 'charlie', type: 'tamer', inReserve: true },
  { id: 'gm', type: 'gm' },
]
const digimon = new Map([
  ['agumon', { partnerId: 'alice' }],
  ['gabumon', { partnerId: 'bob' }],
  ['guide', {}],
  ['foe', { isEnemy: true }],
])
const ids = (owner, preset) => [...selectIntercedeTargets(participants, digimon, owner, preset)]

test('combat presets distinguish tamers, partners, ownership, allies and reserve characters', () => {
  assert.deepEqual(ids('alice', 'tamers'), ['me', 'other'])
  assert.deepEqual(ids('alice', 'partners'), ['partner', 'other-partner'])
  assert.deepEqual(ids('alice', 'mine'), ['me', 'partner'])
  assert.deepEqual(ids('bob', 'mine'), ['other', 'other-partner'])
  assert.deepEqual(ids('alice', 'allies'), ['me', 'other', 'partner', 'other-partner', 'friendly-npc'])
  assert.deepEqual(ids('GM', 'mine'), ['friendly-npc', 'enemy', 'enemy-instance'])
  assert.deepEqual(ids('GM', 'allies'), ids('GM', 'mine'))
})

test('player presets replace previous choices and respect the available target list', () => {
  const selections = ref(new Set(['enemy']))
  const targets = participants.filter(p => p.id !== 'me')
  const { selectIntercedeGroup } = loadPageFunctions('pages/campaigns/[campaignId]/player/[tamerId].vue', ['selectIntercedeGroup'], {
    tamer: ref({ id: 'alice' }), intercedeOptionsSelections: selections,
    intercedeOptionTargets: ref(targets), digimonMap: ref(digimon), selectIntercedeTargets,
  })
  selectIntercedeGroup('mine')
  assert.deepEqual([...selections.value], ['partner'])
  selectIntercedeGroup('tamers')
  assert.deepEqual([...selections.value], ['other'])
})

test('GM presets invert checked selections into opt-outs and preserve hidden targets', () => {
  const optOuts = ref(new Set(['partner', 'reserve']))
  const targets = participants.filter(p => !p.inReserve && p.type !== 'gm')
  const { selectGmIntercedeGroup } = loadPageFunctions('pages/campaigns/[campaignId]/encounters/[id].vue', ['selectGmIntercedeGroup'], {
    gmIntercedeTargets: ref(targets), intercedeOptOutSelections: optOuts,
    digimonMap: ref(digimon), GM_OPT_OUT_OWNER: 'GM', selectIntercedeTargets,
  })
  selectGmIntercedeGroup('partners')
  assert.equal(optOuts.value.has('partner'), false)
  assert.equal(optOuts.value.has('other-partner'), false)
  assert.equal(optOuts.value.has('enemy'), true)
  assert.equal(optOuts.value.has('reserve'), true)
  selectGmIntercedeGroup('none')
  assert.ok(targets.every(p => optOuts.value.has(p.id)))
})

test('both encounter page templates compile with the selection controls', () => {
  for (const path of ['pages/campaigns/[campaignId]/player/[tamerId].vue', 'pages/campaigns/[campaignId]/encounters/[id].vue']) {
    const { descriptor, errors } = parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { filename: path })
    assert.deepEqual(errors, [])
    const script = compileScript(descriptor, { id: path })
    const result = compileTemplate({ source: descriptor.template.content, filename: path, id: path, compilerOptions: { bindingMetadata: script.bindings } })
    assert.deepEqual(result.errors, [])
  }
})
