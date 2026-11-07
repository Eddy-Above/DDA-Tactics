import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'

const { useAutomaticDefenses } = loadTypeScript('composables/useAutomaticDefenses.ts')

function fixture() {
  const state = { encounterId: 'one', pending: new Set(['a', 'b']), blocked: new Set(['a', 'b']), sends: [], accept: true }
  const controller = useAutomaticDefenses({
    encounterId: () => state.encounterId,
    isPending: r => state.pending.has(r.id), isBlocked: r => state.blocked.has(r.id),
    submit: async r => { state.sends.push(r.id); return state.accept },
  })
  return { state, ...controller }
}

test('zero-dice defenses are sent once, in order, despite repeated encounter pushes', async () => {
  const f = fixture()
  await Promise.all([f.resolve({ id: 'a' }), f.resolve({ id: 'a' }), f.resolve({ id: 'b' })])
  await f.resolve({ id: 'a' })
  assert.deepEqual(f.state.sends, ['a', 'b'])
})

test('failed automatic defenses wait for an explicit retry and retain normal continuation', async () => {
  const f = fixture()
  f.state.accept = false
  assert.equal(await f.resolve({ id: 'a' }), false)
  assert.equal(f.hasFailed({ id: 'a' }), true)
  await f.resolve({ id: 'a' })
  assert.deepEqual(f.state.sends, ['a'])
  f.state.accept = true
  assert.equal(await f.resolve({ id: 'a' }, true), true)
  assert.equal(f.hasFailed({ id: 'a' }), false)
  assert.deepEqual(f.state.sends, ['a', 'a'])
})

test('queued defenses are rechecked after protection, a clash change, or encounter navigation', async () => {
  for (const change of [f => f.state.pending.delete('a'), f => f.state.blocked.delete('a'), f => { f.state.encounterId = 'two' }]) {
    const f = fixture()
    const pending = f.resolve({ id: 'a' })
    change(f)
    assert.equal(await pending, false)
    assert.deepEqual(f.state.sends, [])
  }
})
