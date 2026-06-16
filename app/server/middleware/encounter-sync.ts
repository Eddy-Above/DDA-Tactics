import { broadcast } from '../utils/encounterRoom'
import { buildEncounterPayload } from '../utils/encounterPayload'

// After any successful POST/PUT/DELETE to `/api/encounters/[id]` or any of
// its subpaths (actions, requests, responses, the encounter resource itself,
// etc.), push the full updated encounter state to that encounter's WebSocket
// room. Centralizing this here means new endpoints under /api/encounters/[id]
// get realtime sync automatically, with no per-file wiring.
export default defineEventHandler((event) => {
  const method = event.node.req.method
  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return

  const path = (event.path ?? event.node.req.url ?? '').split('?')[0]
  const match = path.match(/^\/api\/encounters\/([^/?]+)(?:\/.*)?$/)
  if (!match) return

  const encounterId = match[1]
  event.node.res.on('finish', () => {
    if (event.node.res.statusCode >= 200 && event.node.res.statusCode < 300) {
      buildEncounterPayload(encounterId).then((encounter) => {
        if (!encounter) return
        broadcast(encounterId, { type: 'encounter-state', encounterId, encounter, version: Date.now() })
      }).catch((e) => console.error('[encounter-sync] Failed to broadcast encounter-state:', e))
    }
  })
})
