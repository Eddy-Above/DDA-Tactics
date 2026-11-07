interface IntercedeActionState {
  actionsRemaining?: { simple: number }
  interceptPenalty?: number
}

/** Repay deferred intercede actions when this participant's next turn starts. */
export function applyDeferredIntercedeCost(participant: IntercedeActionState): void {
  const penalty = participant.interceptPenalty ?? 0
  if (penalty <= 0) return

  participant.actionsRemaining ??= { simple: 2 }
  participant.actionsRemaining.simple = Math.max(0, participant.actionsRemaining.simple - penalty)
  participant.interceptPenalty = 0
}

/**
 * Count a turn start for this participant. Every place a turn starts calls this next to
 * `applyDeferredIntercedeCost`; a "Pass until my next turn" remembers the counter it was set at and
 * is in force only while the counter is unchanged (see `getActiveTemporaryPass`).
 */
export function recordTurnStart(participant: { turnsStarted?: number }): void {
  participant.turnsStarted = (participant.turnsStarted ?? 0) + 1
}
