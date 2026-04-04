import {
  EFFECT_DURATION_LIMITS,
  MUTUALLY_EXCLUSIVE_EFFECTS,
  INSTANT_EFFECTS,
} from '../../data/attackConstants'

interface EffectInput {
  name: string
  type: 'buff' | 'debuff' | 'status'
  duration: number
  source: string
  description?: string
  value?: number
  potency?: number
  potencyStat?: string
}

interface ActiveEffect extends EffectInput {
  id: string
}

/**
 * Apply an effect to a participant's activeEffects array, handling:
 * - Duration limits (min/max per effect)
 * - Mutual exclusion (Burn/Poison override)
 * - N debuff stacking (same name, different source: add duration, update potency)
 * - N debuff replacement (same name, same source: replace entirely)
 *
 * Returns a new activeEffects array (does not mutate the input).
 */
export function applyEffectToParticipant(
  activeEffects: ActiveEffect[],
  newEffect: EffectInput,
  houseRules?: { stunMaxDuration1?: boolean }
): ActiveEffect[] {
  // Don't persist instant effects
  if (INSTANT_EFFECTS.has(newEffect.name)) {
    return [...activeEffects]
  }

  // Apply duration limits
  let duration = newEffect.duration
  const limits = EFFECT_DURATION_LIMITS[newEffect.name]
  if (limits) {
    if (limits.min !== undefined) duration = Math.max(limits.min, duration)
    if (limits.max !== undefined) duration = Math.min(limits.max, duration)
  }
  if (houseRules?.stunMaxDuration1 && newEffect.name === 'Stun') {
    duration = Math.min(1, duration)
  }

  // Remove mutually exclusive effects
  let effects = [...activeEffects]
  for (const [a, b] of MUTUALLY_EXCLUSIVE_EFFECTS) {
    if (newEffect.name === a) {
      effects = effects.filter(e => e.name !== b)
    } else if (newEffect.name === b) {
      effects = effects.filter(e => e.name !== a)
    }
  }

  // N debuff stacking rules
  if (newEffect.type === 'debuff') {
    const existingIdx = effects.findIndex(e => e.name === newEffect.name)
    if (existingIdx >= 0) {
      const existing = effects[existingIdx]
      if (existing.source !== newEffect.source) {
        // Different source: add duration, update potency to newest
        const stacked: ActiveEffect = {
          ...existing,
          duration: existing.duration + duration,
          potency: newEffect.potency ?? existing.potency,
          potencyStat: newEffect.potencyStat ?? existing.potencyStat,
          source: newEffect.source,
        }
        // Apply duration limits to stacked result
        if (limits?.max !== undefined) {
          stacked.duration = Math.min(limits.max, stacked.duration)
        }
        return [
          ...effects.slice(0, existingIdx),
          stacked,
          ...effects.slice(existingIdx + 1),
        ]
      } else {
        // Same source: replace entirely
        const replaced: ActiveEffect = {
          ...existing,
          duration,
          potency: newEffect.potency ?? existing.potency,
          potencyStat: newEffect.potencyStat ?? existing.potencyStat,
        }
        return [
          ...effects.slice(0, existingIdx),
          replaced,
          ...effects.slice(existingIdx + 1),
        ]
      }
    }
  }

  // Default: add new effect
  const effect: ActiveEffect = {
    id: `effect-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    name: newEffect.name,
    type: newEffect.type,
    duration,
    source: newEffect.source,
    description: newEffect.description || '',
    ...(newEffect.value !== undefined ? { value: newEffect.value } : {}),
    ...(newEffect.potency !== undefined ? { potency: newEffect.potency } : {}),
    ...(newEffect.potencyStat ? { potencyStat: newEffect.potencyStat } : {}),
  }

  return [...effects, effect]
}
