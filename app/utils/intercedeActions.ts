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
