export type AttackBolsterType = 'damage-accuracy' | 'bit-cpu'

export interface AttackRiders {
  bolster: boolean
  bolsterType: AttackBolsterType
  lifesteal: boolean
  hugePower: boolean
  hugePowerRank2: boolean
}

export interface AccuracyRollResult {
  fatefulIntervention?: boolean
  rolls: number[]
  dicePool: number
  successes: number
  successThreshold?: number
  automaticSuccesses?: number
}

export interface PreparedAttackAccuracy extends AccuracyRollResult {
  riders: AttackRiders
  originalRolls: number[]
  hadHugePowerRerolls: boolean
}

interface AttackAccuracyOptions {
  actOfInspiration?: boolean
  random?: () => number
  successThreshold?: number
  automaticSuccesses?: number
  suppressPower?: boolean
}

/** Capture rider choices before an asynchronous Inspiration spend or attack submission. */
export function snapshotAttackRiders(riders: Partial<AttackRiders> = {}): AttackRiders {
  return {
    bolster: riders.bolster ?? false,
    bolsterType: riders.bolsterType ?? 'damage-accuracy',
    lifesteal: riders.lifesteal ?? false,
    hugePower: riders.hugePower ?? false,
    hugePowerRank2: riders.hugePowerRank2 ?? false,
  }
}

/**
 * Prepare the shared accuracy roll. Callers remain responsible for spending Inspiration
 * and for submitting the attack or offering the player a roll review.
 */
export function prepareAttackAccuracy(
  baseAccuracy: number,
  riders: Partial<AttackRiders> = {},
  options: AttackAccuracyOptions = {},
): PreparedAttackAccuracy {
  const capturedRiders = snapshotAttackRiders(riders)
  if (options.suppressPower) {
    capturedRiders.hugePower = false
    capturedRiders.hugePowerRank2 = false
  }
  const random = options.random ?? Math.random
  const rollDie = () => Math.floor(random() * 6) + 1

  let dicePool = baseAccuracy
  if (capturedRiders.bolster && capturedRiders.bolsterType === 'damage-accuracy') {
    dicePool += 2
  }
  if (options.actOfInspiration) dicePool += 5

  const rolls: number[] = []
  for (let i = 0; i < dicePool; i++) rolls.push(rollDie())
  const originalRolls = [...rolls]

  let hadHugePowerRerolls = false
  if (capturedRiders.hugePower && !options.suppressPower) {
    const rerollThreshold = capturedRiders.hugePowerRank2 ? 2 : 1
    for (let i = 0; i < rolls.length; i++) {
      if (rolls[i] <= rerollThreshold) {
        rolls[i] = rollDie()
        hadHugePowerRerolls = true
      }
    }
  }

  return {
    riders: capturedRiders,
    dicePool,
    rolls,
    originalRolls,
    successes: rolls.filter(die => die >= (options.successThreshold ?? 5)).length + (options.automaticSuccesses ?? 0),
    successThreshold: options.successThreshold ?? 5,
    automaticSuccesses: options.automaticSuccesses ?? 0,
    hadHugePowerRerolls,
  }
}
