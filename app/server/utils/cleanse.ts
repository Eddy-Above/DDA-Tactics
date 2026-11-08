import type { CleanseCast } from '../../utils/cleanse'
import { cleanseChoices, cleanseLimit } from '../../utils/cleanse'

export function startCleanseCast(pendingRequests: any[], args: Omit<CleanseCast, 'ready' | 'outcomes'> & { ownerId: string }) {
  const id = `req-cleanse-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const { ownerId, ...cast } = args
  pendingRequests.push({ id, type: 'cleanse-select', targetTamerId: ownerId, targetParticipantId: cast.attackerId,
    timestamp: new Date().toISOString(), data: { ...cast, outcomes: {}, ready: false } })
  return id
}

/** Record one original target, which may now be protected by an interceptor. */
export function recordCleanseOutcome(pendingRequests: any[] | undefined, castId: string | undefined,
  originalTargetId: string, recipient: any, leftover: number, eligible: boolean) {
  if (!pendingRequests || !castId) return
  const request = pendingRequests.find(request => request.id === castId && request.type === 'cleanse-select')
  if (!request || !request.data.targetIds.includes(originalTargetId) || request.data.outcomes[originalTargetId]) return
  const cast = request.data as CleanseCast
  cast.outcomes[originalTargetId] = { participantId: recipient.id, leftover: eligible ? Math.max(0, leftover) : 0,
    effectIds: eligible ? (recipient.activeEffects ?? []).map((effect: any) => effect.id) : [] }
  cast.ready = cast.targetIds.every(id => !!cast.outcomes[id])
  if (cast.ready && (cleanseLimit(cast) === 0 || cast.potency <= 0 || !Object.values(cast.outcomes).some(outcome => outcome.effectIds.length))) {
    pendingRequests.splice(pendingRequests.indexOf(request), 1)
  }
}

export function pruneEmptyCleanseRequests(pendingRequests: any[], participants: any[]) {
  for (const request of pendingRequests) {
    if (request.type !== 'cleanse-select') continue
    const cast = request.data as CleanseCast
    for (const id of cast.targetIds) {
      if (!cast.outcomes[id] && !participants.some(participant => participant.id === id)) {
        cast.outcomes[id] = { participantId: id, leftover: 0, effectIds: [] }
      }
    }
    cast.ready = cast.targetIds.every(id => !!cast.outcomes[id])
  }
  return pendingRequests.filter(request => request.type !== 'cleanse-select' || !request.data.ready || cleanseChoices(request.data, participants).length > 0)
}
