import { encounterLatencyFixture } from '../tests/helpers/encounterLatencyFixture.mjs'
if (process.env.DDA_OFFLINE_VERIFY !== '1') throw new Error('Preload ./scripts/offline-env.mjs; this benchmark must stay offline')
const delayMs = Number(process.argv[2] ?? 25)
for (const signedIn of [false, true]) for (const [action, body] of [['stance', { stance: 'defensive' }], ['card-move', {}], ['log', { actorId: 'actor', actorName: 'Tai', action: 'Skill check', result: 'Success' }]]) {
  const fixture = encounterLatencyFixture({ delayMs, signedIn })
  try {
    const result = await fixture.invoke(action, body)
    console.log(JSON.stringify({ action, signedIn, simulatedDbRoundTripMs: delayMs, statements: result.statements, elapsedMs: Math.round(result.elapsedMs), queries: result.trace.map(item => `${item.kind}:${item.table}`) }))
  } finally { fixture.restore() }
}
