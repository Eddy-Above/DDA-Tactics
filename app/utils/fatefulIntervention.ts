export interface FatefulChoice {
  bonusSign: 1 | -1
  willpowerSign: 1 | -1
  diceResults: number[]
}

export function getFatefulModifier(willpower: number, choice: Pick<FatefulChoice, 'bonusSign' | 'willpowerSign'>): number {
  if (![1, -1].includes(choice.bonusSign) || ![1, -1].includes(choice.willpowerSign)) {
    throw new Error('Choose whether to add or subtract each Fateful Intervention bonus')
  }
  return choice.bonusSign * 5 + choice.willpowerSign * Math.max(0, willpower)
}

export function validateFatefulDice(dice: number[], count: number): void {
  if (!Array.isArray(dice) || dice.length !== count || dice.some(d => !Number.isInteger(d) || d < 1 || d > 6)) {
    throw new Error(`Choose exactly ${count} dice, each from 1 to 6`)
  }
}

export function applyFatefulPool(basePool: number, willpower: number, choice: FatefulChoice, successThreshold = 5) {
  const modifier = getFatefulModifier(willpower, choice)
  const dicePool = Math.max(0, Math.floor(basePool + modifier))
  validateFatefulDice(choice.diceResults, dicePool)
  const rolls = [...choice.diceResults]
  return { rolls, dicePool, successes: rolls.filter(d => d >= successThreshold).length, modifier }
}

export function applyFatefulCheck(baseModifier: number, willpower: number, choice: FatefulChoice) {
  validateFatefulDice(choice.diceResults, 3)
  const modifier = baseModifier + getFatefulModifier(willpower, choice)
  const rolls = [...choice.diceResults]
  return { rolls, modifier, total: rolls.reduce((sum, die) => sum + die, 0) + modifier }
}
