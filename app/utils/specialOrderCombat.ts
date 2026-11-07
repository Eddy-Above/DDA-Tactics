/** Attack orders are snapshotted when an attack is declared, then consumed once per cast. */
export function getAttackOrderModifiers(participant: any) {
  return {
    halfDodge: !!participant?.strikeFastReady,
    successThreshold: participant?.finishingTouchReady ? 4 : 5,
    suppressPower: !!(participant?.strikeFastReady || participant?.finishingTouchReady),
  }
}

export function consumeAttackOrders(participant: any): any {
  if (!participant?.strikeFastReady && !participant?.finishingTouchReady) return participant
  return { ...participant, strikeFastReady: false, finishingTouchReady: false }
}

export function signatureReadyRound(participant: any): number {
  return participant?.decimationReady ? 2 : 3
}

export function combatTurnKey(round: number, currentTurnIndex: number): string {
  return `${round}:${currentTurnIndex}`
}

/** A new round ends Quick Reaction, including automatic round wraps after knockouts. */
export function expireRoundSpecialOrders(participant: any): any {
  return participant?.quickReactionDiceBonus
    ? { ...participant, quickReactionDiceBonus: 0 }
    : participant
}

/** Called immediately after damage and before any knockout/devolution checks. Mutates the hit. */
export function preserveEnduringSoul(participant: any, previousWounds = 0): boolean {
  if (participant?.type !== 'digimon' || !participant.enduringSoulAvailable || participant.enduringSoulUsed
    || !(participant.maxWounds > 0) || previousWounds >= participant.maxWounds
    || participant.currentWounds < participant.maxWounds) return false
  participant.currentWounds = Math.max(0, participant.maxWounds - 1)
  participant.enduringSoulAvailable = false
  participant.enduringSoulUsed = true
  return true
}

export function preserveEnduringSouls(participants: any[], previous: readonly any[]): any[] {
  const before = new Map(previous.map(p => [p.id, p]))
  return participants.map(p => {
    const prior = before.get(p.id)
    if (!prior) return p
    const next = { ...p }
    return preserveEnduringSoul(next, prior.currentWounds ?? 0) ? next : p
  })
}
