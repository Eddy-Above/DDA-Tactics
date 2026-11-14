import type { Attack, EddySoulRules, HouseRules, Quality } from '../types'
import type { CombatParticipant } from '../types/combat'
import { signatureReadyRound } from './specialOrderCombat'
import { getAreaShape } from './areaShapes'

export interface CombatAttackOption {
  id: Attack['id']
  range?: Attack['range']
  effect?: Attack['effect']
  tags?: readonly string[]
}

export type AttackOptionParticipant = Pick<CombatParticipant, 'type'> & Partial<Pick<CombatParticipant,
  | 'actionsRemaining' | 'usedAttackIds' | 'battery' | 'clash' | 'combatMonsterBonus'
  | 'digimonBolsterCount' | 'lastHugePowerRound' | 'lastHugePowerRank2Round' | 'decimationReady' | 'lastShieldRound'
>>

type AttackOptionRules = Pick<EddySoulRules, 'combatMonsterAreaAttackRequiresComplex' | 'hugePowerOncePerTurn'>

function isSignatureAttack(attack: Pick<CombatAttackOption, 'tags'>): boolean {
  return attack.tags?.some(tag => /signature/i.test(tag)) ?? false
}

type SignatureMoveContext = { round: number; houseRules?: Pick<HouseRules, 'signatureMoveBattery'> | null }

/** Battery replaces the opening-round restriction; it is not an additional cooldown. */
export function signatureMoveError(
  participant: Pick<AttackOptionParticipant, 'battery' | 'decimationReady'>,
  attack: Pick<CombatAttackOption, 'tags'> | null | undefined,
  context: SignatureMoveContext,
): string | null {
  if (!attack || !isSignatureAttack(attack)) return null
  if (context.houseRules?.signatureMoveBattery) {
    return (participant.battery ?? 0) >= 1 ? null : 'Signature Move requires at least 1 Battery'
  }
  const readyRound = signatureReadyRound(participant)
  return context.round < readyRound ? `Signature Move is available from round ${readyRound}` : null
}

/** Custom attacks retain their order, followed by the unused basic attacks. No action is spent. */
export function availableCombatAttacks<T extends CombatAttackOption>(
  participant: AttackOptionParticipant,
  attacks: readonly T[],
  basicAttacks: readonly T[],
  context: SignatureMoveContext,
): T[] {
  if (participant.type !== 'digimon') return []
  const usedIds = new Set(participant.usedAttackIds ?? [])
  const filtered = attacks.filter(attack => {
    if (usedIds.has(attack.id)) return false
    if (attack.effect === 'Shield' && participant.lastShieldRound === context.round) return false
    return !signatureMoveError(participant, attack, context)
  })
  return [...filtered, ...basicAttacks.filter(attack => !usedIds.has(attack.id))]
}

/** The ordinary attack gate's action cost, including the optional Combat Monster area rule. */
export function requiredAttackActions(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'tags' | 'effect'>,
  rules?: AttackOptionRules | null,
): 1 | 2 {
  if (attack.effect === 'Haste' || attack.effect === 'Lag') return 2
  return rules?.combatMonsterAreaAttackRequiresComplex
    && (participant.combatMonsterBonus ?? 0) > 0
    && attack.tags?.some(tag => tag.startsWith('Area Attack')) ? 2 : 1
}

/** Full declared action cost, shared by the radial display and direct GM submissions. */
export function attackActionCost(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'tags' | 'effect'>,
  rules?: AttackOptionRules | null,
  riders: { bolstered?: boolean; lifestealed?: boolean; shieldComplex?: boolean } = {},
): 1 | 2 {
  return riders.bolstered || riders.lifestealed || riders.shieldComplex
    || (getAreaShape([...(attack.tags ?? [])]) === 'pass' && !attack.tags?.includes('Charge Attack'))
    ? 2 : requiredAttackActions(participant, attack, rules)
}

/** Optional effect upgrades replace Bolster; mandatory Complex effects cannot be bolstered. */
export function effectActionError(
  attack: Pick<CombatAttackOption, 'effect'>,
  options: { bolstered?: boolean; lifestealed?: boolean; shieldComplex?: boolean },
): string | null {
  if (options.lifestealed && attack.effect !== 'Lifesteal') return 'Double Lifesteal requires a Lifesteal attack'
  if (options.shieldComplex && attack.effect !== 'Shield') return 'Triple Shield requires a Shield attack'
  if (options.bolstered && (options.lifestealed || options.shieldComplex)) return 'Cannot combine Bolster with a Complex effect option'
  if ((attack.effect === 'Haste' || attack.effect === 'Lag') && options.bolstered) return `${attack.effect} already requires a Complex Action and cannot be bolstered`
  return null
}

export function canUseCombatAttack(
  participant: AttackOptionParticipant,
  attack: Pick<CombatAttackOption, 'tags' | 'effect'>,
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
