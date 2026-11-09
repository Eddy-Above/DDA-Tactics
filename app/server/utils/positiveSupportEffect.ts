import { applyEffectToParticipant } from './applyEffect'

/** Apply the effect and its immediate resource changes without changing Combat Monster damage. */
export function applyPositiveSupportEffect(participant: any, effect: any, houseRules?: { maxTempWoundsRule?: boolean; stunMaxDuration1?: boolean }, targetQualities?: Array<{ id: string }>) {
  if (targetQualities?.some(quality => quality.id === 'immunity')) return participant
  if (effect.name === 'Shield' && houseRules?.maxTempWoundsRule && (effect.potency ?? 0) < (participant.currentTempWounds ?? 0)) return participant
  // Haste is a single action credit, not a buff whose duration scales with Accuracy/Health.
  const applied = effect.name === 'Haste' ? { ...effect, duration: 1, potency: participant.hasActed ? 1 : 0 } : effect
  const updated = { ...participant, activeEffects: applyEffectToParticipant(participant.activeEffects ?? [], applied, houseRules, targetQualities) }
  if (effect.name === 'Shield') updated.currentTempWounds = Math.max(0, effect.potency ?? 0)
  if (effect.name === 'Haste') {
    updated.actionsRemaining = { simple: (participant.actionsRemaining?.simple ?? 0) + 1 }
  }
  return updated
}
