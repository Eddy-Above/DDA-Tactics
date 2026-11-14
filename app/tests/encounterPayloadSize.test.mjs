import assert from 'node:assert/strict'
import test from 'node:test'
import { loadTypeScript } from './helpers/loadTypeScript.mjs'
const { shapeEncounterResult } = loadTypeScript('utils/encounterSnapshot.ts')

test('public snapshots omit retry paths and bound log history without modifying durable receipts', () => {
  const receipt = { operationId: 'retry', fingerprint: 'a'.repeat(64), result: { path: Array.from({ length: 40 }, (_, x) => ({ x, y: 0, z: 0 })) } }
  const row = { id: 'encounter', revision: 9, participants: Array.from({ length: 12 }, (_, i) => ({
    id: `participant-${i}`, actionsRemaining: { simple: 1 }, movementReceipts: Array(50).fill(receipt), attackReceipts: Array(50).fill(receipt),
  })), battleLog: Array.from({ length: 1000 }, (_, i) => ({ id: `log-${i}`, result: 'A completed attack with dice results', actorName: 'Agumon' })) }
  const before = JSON.stringify(row), result = shapeEncounterResult(row)
  assert.equal(result.battleLog.length, 50)
  assert.equal(result._battleLogTotal, 1000)
  assert.equal(result.revision, 9)
  assert.equal(result.participants[0].movementReceipts, undefined)
  assert.equal(result.participants[0].attackReceipts, undefined)
  assert.equal(JSON.stringify(row), before, 'retry protection and full history remain in storage')
  assert.ok(JSON.stringify(result).length < before.length / 20)
  assert.deepEqual(shapeEncounterResult({ success: true, encounter: row }).encounter, result)
  assert.deepEqual(shapeEncounterResult({ doors: [] }), { doors: [] })
})
