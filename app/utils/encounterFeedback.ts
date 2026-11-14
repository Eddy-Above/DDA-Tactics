import { ref } from 'vue'

export interface PendingEncounterAction {
  id: number
  encounterId: string
  action: string
  method: string
  requestId?: string
  body: any
}

const labels: Record<string, string> = {
  move: 'Moving', stance: 'Changing stance', attack: 'Attacking', 'npc-attack': 'Attacking',
  'intercede-offer': 'Attacking', 'end-turn': 'Ending turn', 'card-move': 'Using movement',
  doors: 'Changing doors', digivolve: 'Digivolving', 'gm-digivolve': 'Digivolving',
  'mode-change': 'Changing mode', direct: 'Directing', 'special-order': 'Using order',
  'skill-order': 'Using skill order', 'spend-inspiration': 'Spending Inspiration',
  requests: 'Sending request', responses: 'Sending response', log: 'Saving roll',
}

/** One browser's pending work. Confirmed encounter snapshots remain untouched. */
export function createEncounterFeedback(send: (request: any, options?: any) => Promise<any>) {
  const pending = ref<PendingEncounterAction[]>([])
  const errors = ref<Array<{ id: number; encounterId: string; message: string }>>([])
  const movementPreviews = ref<Array<{ encounterId: string; operationId: string; participantId: string; position: any }>>([])
  const inFlight = new Map<string, Promise<any>>()
  let sequence = 0

  function fetch<T>(request: any, options?: any): Promise<T> {
    const match = typeof request === 'string' && request.match(/^\/api\/encounters\/([^/?]+)(?:\/(.*?))?\/?(?:\?.*)?$/)
    const method = String(options?.method ?? 'GET').toUpperCase()
    if (!match || !['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return send(request, options)
    const body = options?.body ?? {}
    // Repeated clicks join the same request even if a caller generated a new retry ID.
    const { operationId: _operation, expectedRevision: _revision, ...intent } = typeof body === 'object' ? body : {}
    const key = JSON.stringify([method, request, typeof body === 'string' ? body : intent])
    const existing = inFlight.get(key)
    if (existing) return existing
    const id = ++sequence, encounterId = match[1]
    const action = match[2]?.replace(/^actions\//, '').split('/')[0] || 'update'
    pending.value = [...pending.value, { id, encounterId, action, body, method, requestId: action === 'requests' ? match[2]?.split('/')[1] : body.requestId }]
    if (body.movement && body.operationId) previewMovement(encounterId, body.operationId, body.participantId ?? body.attackerId, body.movement.destination)
    let resolve!: (value: any) => void, reject!: (error: any) => void
    const result = new Promise<T>((yes, no) => { resolve = yes; reject = no })
    inFlight.set(key, result)
    // Start immediately, after publishing the pending state and duplicate guard.
    void (async () => {
      try { resolve(await send(request, options)) }
      catch (error: any) {
        errors.value = [...errors.value, { id, encounterId, message: error?.data?.message ?? error?.message ?? 'The action could not be saved' }].slice(-5)
        reject(error)
      } finally {
        pending.value = pending.value.filter(item => item.id !== id)
        if (body.operationId) movementPreviews.value = movementPreviews.value.filter(item => item.operationId !== body.operationId || item.encounterId !== encounterId)
        inFlight.delete(key)
      }
    })()
    return result
  }
  function previewMovement(encounterId: string, operationId: string, participantId: string, position: any) {
    movementPreviews.value = [...movementPreviews.value.filter(item => item.encounterId !== encounterId || item.participantId !== participantId), { encounterId, operationId, participantId, position }]
  }
  function cancelMovementPreview(encounterId: string) {
    const sending = new Set(pending.value.filter(item => item.encounterId === encounterId).map(item => item.body.operationId))
    movementPreviews.value = movementPreviews.value.filter(item => item.encounterId !== encounterId || sending.has(item.operationId))
  }
  return { pending, errors, movementPreviews, previewMovement, cancelMovementPreview, fetch, dismiss: (id: number) => { errors.value = errors.value.filter(item => item.id !== id) } }
}

let browserFeedback: ReturnType<typeof createEncounterFeedback> | undefined
export function getEncounterFeedback() {
  const create = () => createEncounterFeedback((request, options) => ($fetch as (url: string, options?: any) => Promise<any>)(request, options))
  // Server rendering must never share a user's state with another request.
  return typeof window === 'undefined' ? create() : browserFeedback ??= create()
}

/** Shared by every encounter write, including setup and specialized combat dialogs. */
export function encounterFetch<T = any>(request: string, options?: any): Promise<T> {
  return getEncounterFeedback().fetch<T>(request, options)
}

export function encounterActionLabel(action: PendingEncounterAction): string {
  if (action.action === 'move' && action.body.kind === 'placement') return 'Placing token'
  if (action.action === 'update' && 'mapId' in action.body) return 'Attaching map'
  if (action.action === 'update' && action.body.participants) return 'Saving characters'
  return labels[action.action] ?? 'Saving action'
}

/** Predict only deterministic presentation; rolls, damage and permissions stay authoritative. */
export function previewEncounterActions<T extends { id: string; participants?: any[]; pendingRequests?: any[]; requestResponses?: any[] }>(encounter: T, actions: PendingEncounterAction[]): T {
  let next = encounter
  for (const action of actions) {
    if (action.encounterId !== encounter.id) continue
    const body = action.body
    if (action.action === 'stance') {
      next = { ...next, participants: next.participants?.map(p => p.id === body.participantId && p.currentStance !== body.stance
        ? { ...p, currentStance: body.stance, actionsRemaining: { ...p.actionsRemaining, simple: Math.max(0, (p.actionsRemaining?.simple ?? 0) - 1) } } : p) }
    }
    if (action.action === 'update' && action.method === 'PUT') {
      for (const field of ['mapId', 'name', 'visibleToPlayers', 'participants', 'phase'] as const) {
        if (Object.hasOwn(body, field)) next = { ...next, [field]: body[field] }
      }
    }
    if (action.action === 'responses' && action.method === 'POST' || action.action === 'requests' && action.method === 'DELETE') {
      next = { ...next, pendingRequests: next.pendingRequests?.filter(r => r.id !== action.requestId) }
    }
  }
  return next
}
