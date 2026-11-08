import type { Attack, EddySoulRules, HouseRules, Quality } from '../types'
import type { CombatParticipant } from '../types/combat'
import { signatureReadyRound } from './specialOrderCombat'

export interface CombatAttackOption {
  id: Attack['id']
  range?: Attack['range']
  effect?: Attack['effect']
  tags?: readonly string[]
}

export type AttackOptionParticipant = Pick<CombatParticipant, 'type'> & Partial<Pick<CombatParticipant,
  | 'actionsRemaining' | 'usedAttackIds' | 'battery' | 'clash' | 'combatMonsterBonus'
  | 'digimonBolsterCount' | 'lastHugePowerRound' | 'lastHugePowerRank2Round' | 'decimationReady'
>>

type AttackOptionRules = Pick<EddySoulRules, 'combatMonsterAreaAttackRequiresComplex' | 'hugePowerOncePerTurn'>

function isSignatureAttack(attack: Pick<CombatAttackOption, 'tags'>): boolean {
  return attack.tags?.some(tag => /signature/i.test(tag)) ?? false
}

/** Custom attacks retain their order, followed by the unused basic attacks. No action is spent. */
export function availableCombatAttacks<T extends CombatAttackOption>(
  participant: AttackOptionParticipant,
  attacks: readonly T[],
  basicAttacks: readonly T[],
  context: { round: number; houseRules?: Pick<HouseRules, 'signatureMoveBattery'> | null },
): T[] {
  if (participant.type !== 'digimon') return []
  const usedIds = new Set(participant.usedAttackIds ?? [])
  const filtered = attacks.filter(attack => {
    if (usedIds.has(attack.id)) return false
    if (!isSignatureAttack(attack)) return true
    if (context.round < signatureReadyRound(participant)) return false
    if (context.houseRules?.signatureMoveBattery && (participant.battery ?? 0) < 1) return false
    return true
  })
  return [...filtered, ...basicAttacks.filter(attack => !usedIds.has(attack.id))]
}

/** The ordinary attack gate's action cost, including the optional Combat Monster area rule. */
export function requiredAttackActions(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'tags'>,
  rules?: AttackOptionRules | null,
): 1 | 2 {
  return rules?.combatMonsterAreaAttackRequiresComplex
    && (participant.combatMonsterBonus ?? 0) > 0
    && attack.tags?.some(tag => tag.startsWith('Area Attack')) ? 2 : 1
}

export function canUseCombatAttack(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'tags'>,
  rules?: AttackOptionRules | null,
): boolean {
  return !participant.clash && (participant.actionsRemaining?.simple || 0) >= requiredAttackActions(participant, attack, rules)
}

/** Bolster requires a Complex Action and cannot accompany an attack already requiring one. */
export function canBolsterCombatAttack(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'tags' | 'effect'>,
  rules?: AttackOptionRules | null,
): boolean {
  if (participant.type !== 'digimon') return false
  if ((participant.actionsRemaining?.simple || 0) < 2) return false
  if ((participant.digimonBolsterCount ?? 0) >= 2) return false
  return !isSignatureAttack(attack)
    && requiredAttackActions(participant, attack, rules) === 1
    && attack.effect !== 'Haste'
}

/** Eligibility only; declaration and resolution keep responsibility for consuming Huge Power. */
export function hugePowerAvailability(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'range'>,
  qualities: readonly Pick<Quality, 'id' | 'ranks'>[],
  context: { round: number; eddySoulRules?: AttackOptionRules | null },
): { rank1: boolean; rank2: boolean } {
  const quality = participant.type === 'digimon' ? qualities.find(quality => quality.id === 'huge-power') : undefined
  if (!quality) return { rank1: false, rank2: false }
  const rank = quality.ranks || 1
  const rangedAvailable = participant.lastHugePowerRound !== context.round
  if (context.eddySoulRules?.hugePowerOncePerTurn) {
    return { rank1: rangedAvailable, rank2: rangedAvailable && rank >= 2 }
  }
  return {
    rank1: attack.range === 'melee' || rangedAvailable,
    rank2: rank >= 2 && participant.lastHugePowerRank2Round !== context.round
      && (attack.range === 'melee' || rangedAvailable),
  }
}
