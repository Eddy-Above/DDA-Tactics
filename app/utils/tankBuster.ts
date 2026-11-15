import { isTankBusterAttack } from './attackArmor'

export const TANK_BUSTER_THRESHOLDS = [0.75, 0.5, 0.25] as const
type Health = { currentWounds?: number; maxWounds?: number; tankBusterUses?: number }

export function remainingHealthRatio(participant: Health): number {
  const maximum = participant.maxWounds ?? 0
  return maximum > 0 ? Math.max(0, Math.min(1, 1 - (participant.currentWounds ?? 0) / maximum)) : 1
}

/** Legacy participants are initialized from their current health, once. */
export function availableTankBusterUses(participant: Health): number {
  return participant.tankBusterUses === undefined
    ? TANK_BUSTER_THRESHOLDS.filter(threshold => remainingHealthRatio(participant) <= threshold).length
    : Math.max(0, Math.floor(participant.tankBusterUses))
}

export function tankBusterUseError(participant: Health, attack: Parameters<typeof isTankBusterAttack>[0]): string | null {
  return isTankBusterAttack(attack) && !availableTankBusterUses(participant)
    ? 'Tank Buster requires a use earned by reaching 75%, 50%, or 25% remaining health' : null
}

/** Every downward crossing grants a use; healing only rearms the crossed thresholds. */
export function grantTankBusterUses(previous: Health | undefined, current: Health, newCombat = false): number {
  if (!previous || newCombat) {
    return TANK_BUSTER_THRESHOLDS.filter(threshold => remainingHealthRatio(current) <= threshold).length
  }
  const from = remainingHealthRatio(previous), to = remainingHealthRatio(current)
  return availableTankBusterUses(current.tankBusterUses === undefined ? previous : current)
    + TANK_BUSTER_THRESHOLDS.filter(threshold => from > threshold && to <= threshold).length
}
