import { tankBusterStunEffect } from '../../utils/attackArmor'
import { applyEffectToParticipant } from './applyEffect'
import { isImmuneToEffect } from './damageOverTime'

/** Apply the secondary Stun independently of the attack's primary effect. */
export function applyTankBusterStun(participant: any, attack: Parameters<typeof tankBusterStunEffect>[0], damage: number,
  context: { source: string; round: number; qualities?: any[]; hasGone: boolean; allowed?: boolean; deferEffect?: boolean }): boolean {
  const effect = tankBusterStunEffect(attack, damage, context.source)
  if (!effect || context.allowed === false || context.qualities?.some(q => q.id === 'immunity')
    || isImmuneToEffect('Stun', context.qualities ?? [])) return false
  if (!context.deferEffect) participant.activeEffects = applyEffectToParticipant(participant.activeEffects ?? [], effect,
    undefined, context.qualities, context.round, participant.naturewalkActiveElements)
  // A primary Stun has already paid its action penalty; never deduct twice for the same hit.
  if (attack?.effect !== 'Stun') {
    if (context.hasGone) participant.interceptPenalty = (participant.interceptPenalty ?? 0) + 1
    else participant.actionsRemaining = { ...participant.actionsRemaining, simple: Math.max(0, (participant.actionsRemaining?.simple ?? 0) - 1) }
    participant.stunActionReducedThisRound = true
  }
  return true
}
