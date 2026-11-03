// Clash armor — shared server-side logic.
// A clashing participant attacked from OUTSIDE its clash adds the CPU of both clashers to its Armor.
// Selective Targeting: "In Clash targeting, enemy only gets own CPU to Armor."

import { getDigimonDerivedStats } from './resolveSupportAttack'
import { isAttackedFromOutsideClash } from '../../utils/clashRules'

/** A participant's CPU for clash purposes. Tamers have no CPU and count as 1 (same as Clash Pin). */
async function getClashCpu(participant: any): Promise<number> {
  if (participant?.type === 'digimon') {
    const derived = await getDigimonDerivedStats(participant.entityId)
    return derived?.cpu ?? 0
  }
  if (participant?.type === 'tamer') return 1
  return 0
}

/**
 * Armor bonus for `target` against an attack by `attacker`: target CPU + clash opponent CPU
 * (target CPU only if the attacker has Selective Targeting). 0 when the target isn't clashing
 * or the attacker is part of the same clash (a Clash Attack).
 */
export async function getOutsideClashArmorBonus(
  attacker: any,
  target: any,
  participants: any[],
  attackerHasSelectiveTargeting: boolean,
): Promise<number> {
  if (!isAttackedFromOutsideClash(attacker, target)) return 0

  const targetCpu = await getClashCpu(target)
  if (attackerHasSelectiveTargeting) return targetCpu

  const opponent = participants.find((p: any) => p.id === target.clash.opponentParticipantId)
  return targetCpu + (opponent ? await getClashCpu(opponent) : 0)
}
