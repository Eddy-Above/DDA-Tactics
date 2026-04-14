import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { EFFECT_ALIGNMENT, getEffectStatModifiers } from '../../data/attackConstants'
import { getDigimonDerivedStats, calculateEffectPotency } from './resolveSupportAttack'

export interface ComputeAttackDamageParams {
  attackerParticipant: any
  /** The entity taking the hit — the attack target for dodge, the interceptor for intercede. */
  targetParticipant: any
  attackId: string
  attackerName: string
  accuracySuccesses: number
  dodgeSuccesses: number        // Pass 0 for intercede
  isSignatureMove?: boolean
  batteryCount?: number
  outsideClashCpuPenalty?: number
  houseRules?: any
}

export interface ComputeAttackDamageResult {
  attackBaseDamage: number
  armorPiercing: number
  targetArmor: number
  effectiveArmor: number
  netSuccesses: number
  hit: boolean
  damageDealt: number
  attackDef: any                // Full attack definition (type, effect, tags, etc.)
  appliedEffectName: string | null
  effectData: any | null        // Fully-built effect object ready to apply to participants
  attackerHasCombatMonster: boolean
  attackerCombatMonsterBonus: number
  attackerHasPositiveReinforcement: boolean
  attackerMoodValue: number
  targetHasCombatMonster: boolean
  targetHasPositiveReinforcement: boolean
  targetMoodValue: number
  targetHealthStat: number
}

/**
 * Canonical damage calculation used by both dodge-roll resolution (resolveNpcAttack)
 * and intercede resolution (intercede-claim). Pass dodgeSuccesses=0 for intercede.
 *
 * Loads attacker and target data from DB. Does NOT mutate participants or battleLog.
 */
export async function computeAttackDamage(
  params: ComputeAttackDamageParams,
): Promise<ComputeAttackDamageResult> {
  const {
    attackerParticipant,
    targetParticipant,
    attackId,
    attackerName,
    accuracySuccesses,
    dodgeSuccesses,
  } = params

  // ── Attacker ──────────────────────────────────────────────────────────────
  let attackBaseDamage = 0
  let armorPiercing = 0
  let attackDef: any = null
  let attackerHasCombatMonster = false
  let attackerHasPositiveReinforcement = false
  const attackerCombatMonsterBonus: number = attackerParticipant.combatMonsterBonus ?? 0
  const attackerMoodValue: number = attackerParticipant.moodValue ?? 3

  if (attackerParticipant.type === 'digimon') {
    const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, attackerParticipant.entityId))
    if (attackerDigimon) {
      const baseStats = typeof attackerDigimon.baseStats === 'string'
        ? JSON.parse(attackerDigimon.baseStats) : attackerDigimon.baseStats
      const bonusStats = typeof attackerDigimon.bonusStats === 'string'
        ? JSON.parse(attackerDigimon.bonusStats) : attackerDigimon.bonusStats
      attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

      const attacks = typeof attackerDigimon.attacks === 'string'
        ? JSON.parse(attackerDigimon.attacks) : attackerDigimon.attacks
      attackDef = attacks?.find((a: any) => a.id === attackId)

      if (attackDef?.tags && Array.isArray(attackDef.tags)) {
        for (const tag of attackDef.tags) {
          const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
          if (weaponMatch) {
            const romanMap: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }
            attackBaseDamage += romanMap[weaponMatch[1].toUpperCase()] || parseInt(weaponMatch[1]) || 1
          }
          const apMatch = tag.match(/^Armor Piercing\s+(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)$/i)
          if (apMatch) {
            const romanMap: Record<string, number> = {
              I: 1, II: 2, III: 3, IV: 4, V: 5,
              VI: 6, VII: 7, VIII: 8, IX: 9, X: 10,
            }
            armorPiercing = (romanMap[apMatch[1].toUpperCase()] || parseInt(apMatch[1]) || 0) * 2
          }
        }
      }

      const qualities = typeof attackerDigimon.qualities === 'string'
        ? JSON.parse(attackerDigimon.qualities) : attackerDigimon.qualities
      attackerHasCombatMonster = (qualities || []).some((q: any) => q.id === 'combat-monster')
      attackerHasPositiveReinforcement = (qualities || []).some((q: any) => q.id === 'positive-reinforcement')
    }
  }

  // Signature Move battery bonus
  if (params.isSignatureMove && params.batteryCount) {
    attackBaseDamage += params.batteryCount
  }

  // ── Net successes / hit ────────────────────────────────────────────────────
  const netSuccesses = accuracySuccesses - dodgeSuccesses
  const hit = netSuccesses >= 0

  // Combat Monster bonus applies only on a hit
  if (hit && attackerHasCombatMonster && attackerCombatMonsterBonus > 0) {
    attackBaseDamage += attackerCombatMonsterBonus
  }

  // ── Target armor ──────────────────────────────────────────────────────────
  let targetArmor = 0
  let targetHasCombatMonster = false
  let targetHasPositiveReinforcement = false
  let targetHealthStat = 0
  const targetMoodValue: number = targetParticipant.moodValue ?? 3

  if (targetParticipant.type === 'digimon') {
    const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, targetParticipant.entityId))
    if (targetDigimon) {
      const baseStats = typeof targetDigimon.baseStats === 'string'
        ? JSON.parse(targetDigimon.baseStats) : targetDigimon.baseStats
      const bonusStats = typeof targetDigimon.bonusStats === 'string'
        ? JSON.parse(targetDigimon.bonusStats) : targetDigimon.bonusStats
      targetArmor = (baseStats?.armor ?? 0) + (bonusStats?.armor ?? 0)
      targetHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

      const qualities = typeof targetDigimon.qualities === 'string'
        ? JSON.parse(targetDigimon.qualities) : targetDigimon.qualities
      targetHasCombatMonster = (qualities || []).some((q: any) => q.id === 'combat-monster')
      targetHasPositiveReinforcement = (qualities || []).some((q: any) => q.id === 'positive-reinforcement')
      const dataOpt = (qualities || []).find((q: any) => q.id === 'data-optimization')
      if (dataOpt?.choiceId === 'guardian') targetArmor += 2
    }
  } else if (targetParticipant.type === 'tamer') {
    const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, targetParticipant.entityId))
    if (targetTamer) {
      const attrs = typeof targetTamer.attributes === 'string'
        ? JSON.parse(targetTamer.attributes) : targetTamer.attributes
      const skills = typeof targetTamer.skills === 'string'
        ? JSON.parse(targetTamer.skills) : targetTamer.skills
      targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
    }
  }

  // Effect stat modifiers
  const attackerEffectMods = getEffectStatModifiers(attackerParticipant.activeEffects || [])
  attackBaseDamage += attackerEffectMods.damage
  const targetEffectMods = getEffectStatModifiers(targetParticipant.activeEffects || [])
  targetArmor += targetEffectMods.armor

  // Positive Reinforcement mood modifiers
  if (attackerHasPositiveReinforcement && attackerMoodValue >= 5) {
    attackBaseDamage += attackerMoodValue - 4   // Mood 5 → +1, Mood 6 → +2
  }
  if (targetHasPositiveReinforcement && targetMoodValue <= 2) {
    targetArmor -= 3 - targetMoodValue          // Mood 2 → –1, Mood 1 → –2
  }

  // ── Final damage ──────────────────────────────────────────────────────────
  const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
  let damageDealt = 0
  if (hit && attackDef?.type !== 'support') {
    damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
    const penalty = params.outsideClashCpuPenalty ?? 0
    if (penalty > 0) damageDealt = Math.max(1, damageDealt - penalty)
  }

  // ── Effect potency & data ─────────────────────────────────────────────────
  let appliedEffectName: string | null = null
  let effectData: any | null = null

  if (attackDef?.effect) {
    const shouldApply = attackDef.type === 'damage' ? damageDealt >= 2 : true
    if (hit && shouldApply) {
      const atkDerived = attackerParticipant.type === 'digimon'
        ? await getDigimonDerivedStats(attackerParticipant.entityId) : null
      const tgtDerived = targetParticipant.type === 'digimon'
        ? await getDigimonDerivedStats(targetParticipant.entityId) : null
      const { potency, potencyStat } = calculateEffectPotency(attackDef.effect, atkDerived, tgtDerived)

      let potencyFinal = potency
      if (params.isSignatureMove && params.batteryCount) potencyFinal += params.batteryCount

      const alignment = EFFECT_ALIGNMENT[attackDef.effect]
      const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
      effectData = {
        name: attackDef.effect,
        type: effectType as 'buff' | 'debuff' | 'status',
        duration: Math.max(1, netSuccesses),
        source: attackerName,
        description: '',
        potency: potencyFinal,
        potencyStat,
      }
      appliedEffectName = attackDef.effect
    }
  }

  return {
    attackBaseDamage,
    armorPiercing,
    targetArmor,
    effectiveArmor,
    netSuccesses,
    hit,
    damageDealt,
    attackDef,
    appliedEffectName,
    effectData,
    attackerHasCombatMonster,
    attackerCombatMonsterBonus,
    attackerHasPositiveReinforcement,
    attackerMoodValue,
    targetHasCombatMonster,
    targetHasPositiveReinforcement,
    targetMoodValue,
    targetHealthStat,
  }
}
