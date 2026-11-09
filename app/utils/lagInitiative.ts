interface LagParticipant {
  id: string
  type?: string
  entityId?: string
  inReserve?: boolean
  activeEffects?: Array<{ name: string; potency?: number; appliesRound?: number; [key: string]: any }>
  lagBaseOrder?: number
  lagOrderRound?: number
}

/** Resolve a round's Lag slots, retaining base ranks for restoration. Mutates only Lag metadata/effects. */
export function applyLagInitiative(
  participants: LagParticipant[], turnOrder: readonly string[], round: number,
  digimonMap?: ReadonlyMap<string, { partnerId?: string | null }>,
): string[] {
  const byId = new Map(participants.map(participant => [participant.id, participant]))
  const order = [...new Set(turnOrder)].filter(id => byId.has(id) && !byId.get(id)!.inReserve)
  const currentRanks = new Map(order.map((id, index) => [id, index]))
  const base = [...order].sort((a, b) => (byId.get(a)!.lagBaseOrder ?? currentRanks.get(a)!) - (byId.get(b)!.lagBaseOrder ?? currentRanks.get(b)!))
  const ranks = new Map(base.map((id, index) => [id, index]))
  const shifts = new Map<string, number>()
  for (const participant of participants) {
    if (!participant.activeEffects?.some(effect => effect.name === 'Lag')) continue
    participant.activeEffects = participant.activeEffects.flatMap(effect => {
      if (effect.name !== 'Lag') return [effect]
      const appliesRound = effect.appliesRound ?? round
      if (appliesRound < round) return []
      let turnId = participant.id
      if (!ranks.has(turnId) && participant.type === 'digimon' && participant.entityId) {
        const owner = digimonMap?.get(participant.entityId)?.partnerId
        turnId = participants.find(other => other.type === 'tamer' && other.entityId === owner && ranks.has(other.id))?.id ?? turnId
      }
      if (appliesRound === round && ranks.has(turnId) && !participant.inReserve) {
        shifts.set(turnId, Math.max(shifts.get(turnId) ?? 0, Math.max(0, Math.floor(effect.potency ?? 0))))
      }
      return [{ ...effect, appliesRound }]
    })
  }
  const active = [...shifts.values()].some(places => places > 0)
  for (const participant of participants) {
    if (active && ranks.has(participant.id)) {
      participant.lagBaseOrder = ranks.get(participant.id)
      participant.lagOrderRound = round
    } else {
      delete participant.lagBaseOrder
      delete participant.lagOrderRound
    }
  }
  if (!active) return base
  const priority = (id: string) => {
    const places = shifts.get(id) ?? 0, rank = ranks.get(id)!
    return Math.min(base.length - 1, rank + places) * 2 + (places > 0 ? 1 : 0)
  }
  return [...base].sort((a, b) => priority(a) - priority(b) || ranks.get(a)! - ranks.get(b)!)
}
