import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { rewardPartners } = loadTypeScript('utils/rewardPartners.ts')
const form = (id, fields = {}) => ({ id, name: id, campaignId: 'campaign', partnerId: 'tai', stage: 'rookie', bonusDP: 2, ...fields })
const groups = (forms, lines = []) => rewardPartners(forms, lines, 'campaign', ['tai', 'matt'])

test('both directions of evolution links group all branches as one partner while separate partners stay distinct', () => {
  const forms = [form('agu', { evolutionPathIds: ['grey', 'geo'] }), form('grey', { stage: 'champion' }),
    form('geo', { stage: 'champion', evolutionPathIds: ['shine'] }), form('shine', { stage: 'mega', bonusDP: 5 }),
    form('pata'), form('ange', { evolvesFromId: 'pata', stage: 'champion' }), form('gabu', { partnerId: 'matt' })]
  const result = groups(forms)
  assert.deepEqual(result.map(p => p.id), ['agu', 'gabu', 'pata'])
  assert.deepEqual(result[0].formIds, ['agu', 'geo', 'grey', 'shine'])
  assert.equal(result[0].bonusDP, 5, 'the shared pool uses the highest saved value, not the sum of stages')
  assert.deepEqual(groups([...forms].reverse()), result, 'input order does not change partner identities')
})

test('evolution lines group stages without direct links, support legacy JSON and merge overlapping lines only once', () => {
  const forms = [form('agu'), form('grey', { stage: 'champion' }), form('war', { stage: 'mega' }), form('pata')]
  const lines = [
    { id: 'line-a', name: 'Agumon partner', campaignId: 'campaign', partnerId: 'tai', chain: JSON.stringify([
      { digimonId: 'agu', evolvesFromIndex: null }, { digimonId: 'grey', evolvesFromIndex: 0 },
    ]) },
    { id: 'line-b', name: 'Branch', campaignId: 'campaign', partnerId: 'tai', chain: [{ digimonId: 'grey' }, { digimonId: 'war' }] },
    { id: 'line-c', name: 'Patamon partner', campaignId: 'campaign', partnerId: 'tai', chain: [{ digimonId: 'pata' }] },
  ]
  const result = groups(forms, lines)
  assert.equal(result.length, 2)
  assert.equal(result[0].name, 'Agumon partner')
  assert.deepEqual(result[0].formIds, ['agu', 'grey', 'war'])
  assert.deepEqual(groups(forms, [...lines].reverse()), result)
})

test('links and line entries never merge another Tamer, campaign, enemy or unowned record into a reward pool', () => {
  const forms = [form('agu', { evolutionPathIds: ['gabu', 'enemy', 'foreign', 'unowned'] }),
    form('gabu', { partnerId: 'matt', bonusDP: 4 }), form('enemy', { isEnemy: true, bonusDP: 100 }),
    form('foreign', { campaignId: 'other', bonusDP: 100 }), form('unowned', { partnerId: null, bonusDP: 100 })]
  const result = groups(forms, [{ id: 'line', partnerId: 'tai', campaignId: 'campaign', chain: forms.map(f => ({ digimonId: f.id })) }])
  assert.equal(result.length, 2)
  assert.deepEqual(result[0].formIds, ['agu'])
  assert.equal(result[0].bonusDP, 2)
  assert.deepEqual(result[1].formIds, ['gabu'])
})

test('cycles and broken references are safe; an actual root is preferred even when its child has a lower stage', () => {
  const result = groups([form('root', { stage: 'champion', evolutionPathIds: ['child', 'missing'] }), form('child')])
  assert.equal(result[0].id, 'root')
  const cycle = [form('a', { evolvesFromId: 'b' }), form('b', { evolvesFromId: 'a' })]
  assert.deepEqual(groups(cycle).map(p => p.formIds), [['a', 'b']])
  assert.deepEqual(groups(cycle, [{ id: 'bad', campaignId: 'campaign', partnerId: 'tai', chain: '{broken' }]).map(p => p.formIds), [['a', 'b']])
})

test('unlinked partners belonging to the same Tamer remain separately selectable', () => {
  assert.deepEqual(groups([form('agu'), form('pata')]).map(p => p.id), ['agu', 'pata'])
})
