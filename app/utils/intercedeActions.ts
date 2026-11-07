interface IntercedeActionState {
  actionsRemaining?: { simple: number }
  interceptPenalty?: number
  specialOrderDebt?: Record<string, number>
}

/** Repay deferred intercede actions when this participant's next turn starts. */
export function applyDeferredIntercedeCost(participant: IntercedeActionState, round = Number.POSITIVE_INFINITY): void {
  const penalty = participant.interceptPenalty ?? 0
  if (penalty <= 0) return

  const future = Object.fromEntries(Object.entries(participant.specialOrderDebt ?? {}).filter(([dueRound]) => Number(dueRound) > round))
  const deferred = Math.min(penalty, Object.values(future).reduce((sum, amount) => sum + amount, 0))
  const due = penalty - deferred

  participant.actionsRemaining ??= { simple: 2 }
  participant.actionsRemaining.simple = Math.max(0, participant.actionsRemaining.simple - due)
  participant.interceptPenalty = deferred
  if (participant.specialOrderDebt) participant.specialOrderDebt = future
}

/** Quick Reaction and Strike Last always borrow from the next round, even before this turn. */
export function deferSpecialOrderCost(participant: any, round: number) {
  const dueRound = String(round + 1)
  return { ...participant, interceptPenalty: (participant.interceptPenalty ?? 0) + 1,
    specialOrderDebt: { ...(participant.specialOrderDebt ?? {}), [dueRound]: (participant.specialOrderDebt?.[dueRound] ?? 0) + 1 } }
}

/**
 * Count a turn start for this participant. Every place a turn starts calls this next to
 * `applyDeferredIntercedeCost`; a "Pass until my next turn" remembers the counter it was set at and
 * is in force only while the counter is unchanged (see `getActiveTemporaryPass`).
 */
export function recordTurnStart(participant: { turnsStarted?: number }): void {
  participant.turnsStarted = (participant.turnsStarted ?? 0) + 1
}
