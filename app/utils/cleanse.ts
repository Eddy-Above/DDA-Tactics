import { EFFECT_ALIGNMENT, PERMANENT_EFFECTS } from '../data/attackConstants'

export type CleanseMode = 'cleanse' | 'dispel' | 'purify'
export interface CleanseSelection { participantId: string; effectId: string }
export interface CleanseCast {
  attackerId: string
  attackerName: string
  attackName: string
  attackerIsEnemy: boolean
  potency: number
  isArea: boolean
  selectiveTargeting: boolean
  targetIds: string[]
  outcomes: Record<string, { participantId: string; leftover: number; effectIds: string[] }>
  ready: boolean
}

export function cleanseLimit(cast: CleanseCast): number {
  return Math.max(0, ...Object.values(cast.outcomes).map(outcome => outcome.leftover))
}

export function cleanseChoices(cast: CleanseCast, participants: any[], mode: CleanseMode = 'cleanse') {
  if (mode !== 'cleanse' && (!cast.isArea || !cast.selectiveTargeting)) return []
  const choices = new Map<string, { participantId: string; effectId: string; name: string; duration: number; remaining: number }>()
  for (const outcome of Object.values(cast.outcomes)) {
    const participant = participants.find(participant => participant.id === outcome.participantId)
    if (!participant) continue
    const ally = !!participant.isEnemy === cast.attackerIsEnemy
    for (const effect of participant.activeEffects ?? []) {
      if (!outcome.effectIds.includes(effect.id) || effect.duration <= 0 || PERMANENT_EFFECTS.has(effect.name)) continue
      const alignment = EFFECT_ALIGNMENT[effect.name] ?? (effect.type === 'buff' ? 'P' : effect.type === 'debuff' ? 'N' : 'NA')
      if (mode === 'dispel' && (ally || alignment !== 'P')) continue
      if (mode === 'purify' && (!ally || alignment !== 'N')) continue
      const key = JSON.stringify([participant.id, effect.id])
      choices.set(key, { participantId: participant.id, effectId: effect.id, name: effect.name,
        duration: effect.duration, remaining: Math.max(0, effect.duration - cast.potency) })
    }
  }
  return [...choices.values()]
}

export function applyCleanseSelections(cast: CleanseCast, participants: any[], mode: CleanseMode, selections: CleanseSelection[]) {
  if (!cast.ready) throw new Error('Wait for every target to finish defending')
  if (!['cleanse', 'dispel', 'purify'].includes(mode) || (mode !== 'cleanse' && (!cast.isArea || !cast.selectiveTargeting))) {
    throw new Error('This Cleanse mode is not available')
  }
  if (!Array.isArray(selections) || selections.length > cleanseLimit(cast)) throw new Error('Too many effects selected')
  const key = (choice: CleanseSelection) => JSON.stringify([choice.participantId, choice.effectId])
  const allowed = new Set(cleanseChoices(cast, participants, mode).map(key))
  const selected = new Set<string>()
  for (const choice of selections) {
    if (!choice || typeof choice.participantId !== 'string' || typeof choice.effectId !== 'string' || !allowed.has(key(choice))) {
      throw new Error('A selected effect is no longer available')
    }
    if (selected.has(key(choice))) throw new Error('An effect can only be selected once')
    selected.add(key(choice))
  }
  return participants.map(participant => ({ ...participant, activeEffects: (participant.activeEffects ?? []).flatMap((effect: any) => {
    if (!selected.has(key({ participantId: participant.id, effectId: effect.id }))) return [effect]
    const duration = Math.max(0, effect.duration - cast.potency)
    return duration > 0 ? [{ ...effect, duration }] : []
  }) }))
}
