import { broadcast } from '../utils/encounterRoom'
import { buildEncounterPayload } from '../utils/encounterPayload'

// After any successful POST to an encounter action endpoint, or a PUT to the
// encounter resource itself (e.g. nextTurn, endCombat, map placement, wound
// edits), push the full updated encounter state to that encounter's
// WebSocket room. Centralizing this here means new action endpoints and
// direct encounter updates get realtime sync automatically, with no
// per-file wiring.
export default defineEventHandler((event) => {
  const method = event.node.req.method
  if (method !== 'POST' && method !== 'PUT') return

  const path = (event.path ?? event.node.req.url ?? '').split('?')[0]
  const match = method === 'POST'
    ? path.match(/^\/api\/encounters\/([^/?]+)\/actions\/[^/?]+/)
    : path.match(/^\/api\/encounters\/([^/?]+)$/)
  if (!match) return

  const encounterId = match[1]
  event.node.res.on('finish', () => {
    if (event.node.res.statusCode >= 200 && event.node.res.statusCode < 300) {
      buildEncounterPayload(encounterId).then((encounter) => {
        if (!encounter) return
        broadcast(encounterId, { type: 'encounter-state', encounterId, encounter, version: encounter.version })
      }).catch((e) => console.error('[encounter-sync] Failed to broadcast encounter-state:', e))
    }
  })
})
