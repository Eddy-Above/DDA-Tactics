export interface MovementQuality {
  id: string
  ranks?: number
  choiceId?: string
}

/** Shared form movement modifiers, clamped only after every base bonus is applied. */
export function calculateEffectiveBaseMovement(
  stageBase: number,
  qualities: readonly MovementQuality[] = [],
): number {
  let effective = stageBase

  const dataOpt = qualities.find(quality => quality.id === 'data-optimization')
  if (dataOpt?.choiceId === 'speed-striker') effective += 2
  if (dataOpt?.choiceId === 'guardian') effective -= 1

  const dataSpec = qualities.find(quality => quality.id === 'data-specialization')
  if (dataSpec?.choiceId === 'mobile-artillery') effective -= 1

  const bulky = qualities.find(quality => quality.id === 'bulky')
  if (bulky) effective -= (bulky.ranks || 0) * 3

  const instinct = qualities.find(quality => quality.id === 'instinct')
  if (instinct) effective += instinct.ranks || 0

  const digizoidArmor = qualities.find(quality => quality.id === 'digizoid-armor')
  if (digizoidArmor?.choiceId === 'blue') effective += 4

  return Math.max(1, effective)
}

/** Preserve Speedy's existing useful-rank rounding, including odd base movement. */
export function getSpeedyMaxRanks(effectiveBase: number, hasAdvancedMovement = false): number {
  return hasAdvancedMovement ? Math.ceil(effectiveBase / 2) : Math.floor(effectiveBase / 2)
}
