import { computeDodgeDefense, getPaidDodgeDiceBonus, type DodgeDefense } from '../../utils/areaDefense'

/** Server adapter for the same pure Dodge formula the player and GM display. */
export function serverDodgeDefense(request: any, participants: readonly any[], record: any) {
  const target = participants.find((p: any) => p.id === request?.targetParticipantId)
  return computeDodgeDefense(request, {
    participants,
    findDigimon: id => target?.type === 'digimon' && id === target.entityId ? record : undefined,
    findTamer: id => target?.type === 'tamer' && id === target.entityId ? record : undefined,
  })
}

/** Recount only valid die faces; an optional server limit is applied before counting. */
export function recountDodgeDice(dice: unknown, maximumDice = Number.POSITIVE_INFINITY): number | null {
  if (!Array.isArray(dice) || dice.some(die => !Number.isInteger(die) || die < 1 || die > 6)) return null
  return dice.slice(0, maximumDice).filter(die => die >= 5).length
}

/** Only accepted, request-bound Inspiration spends extend a halved defense. */
export function paidDodgeDiceBonus(request: any): number {
  return getPaidDodgeDiceBonus(request)
}

export function recountSubmittedDodge(request: any, defense: DodgeDefense, dice: unknown) {
  const maximumDice = defense.blocked ? 0 : request.data?.fatefulIntervention ? defense.pool
    : defense.half ? defense.pool + paidDodgeDiceBonus(request) : Number.POSITIVE_INFINITY
  const successes = recountDodgeDice(dice, maximumDice)
  if (successes === null) return null
  const rolls = (dice as number[]).slice(0, maximumDice)
  return { rolls, dicePool: rolls.length, successes }
}
