import type { Stance } from '../types'

type StanceParticipant = { type?: string; currentStance?: string; currentWounds?: number; maxWounds?: number }
type StanceQuality = { id: string; choiceId?: string | null; ranks?: number }
const stances: Stance[] = ['neutral', 'defensive', 'offensive', 'sniper', 'brave']

export function combatStanceError(participant: StanceParticipant, stance: string, qualities: readonly StanceQuality[] = []): string | null {
  if (!stances.includes(stance as Stance)) return 'Choose a valid stance'
  if (stance === 'sniper') {
    const sniper = qualities.some(q => (q.ranks ?? 1) > 0 && (q.id === 'sniper' || q.id === 'data-specialization' && q.choiceId === 'sniper'))
    if (participant.type !== 'digimon' || !sniper) return 'Sniper stance requires the Sniper specialization'
  }
  if (stance === 'brave') {
    if (participant.type !== 'digimon' || !qualities.some(q => q.id === 'braveheart' && (q.ranks ?? 1) > 0)) return 'Brave stance requires Braveheart'
    // currentWounds counts damage taken. Enter below half remaining; an existing Brave stance persists at exactly half.
    const damage = participant.currentWounds ?? 0, total = participant.maxWounds ?? 0
    if (total <= 0 || damage >= total || (participant.currentStance === 'brave' ? damage < total / 2 : damage <= total / 2)) {
      return 'Brave stance requires fewer than half of the total Wound Boxes remaining'
    }
  }
  return null
}

export function availableCombatStances(participant: StanceParticipant, qualities: readonly StanceQuality[] = []): Stance[] {
  return stances.filter(stance => !combatStanceError(participant, stance, qualities))
}

export function clearHealedBraveStance<T extends StanceParticipant>(participant: T): T {
  if (participant.currentStance === 'brave' && (participant.maxWounds ?? 0) > 0
    && (participant.currentWounds ?? 0) < participant.maxWounds! / 2) return { ...participant, currentStance: 'neutral' }
  return participant
}
