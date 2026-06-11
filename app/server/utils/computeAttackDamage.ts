import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { EFFECT_ALIGNMENT, getEffectStatModifiers } from '../../data/attackConstants'
import { getDigimonDerivedStats, calculateEffectPotency } from './resolveSupportAttack'
import { type StatBlock, applyStatSwaps } from '../../utils/statSwaps'

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
  secondaryEffectData: any | null  // Tank Buster secondary Stun, etc.
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

  // Lazy-cached derived stats (shared by Weapons Expert + effect potency calculation)
  let atkDerivedCached: any = null
  // Boss quality: Finesse ranks (set in attacker/target blocks, used during armor/damage calc)
  let attackerFinesseRanks = 0
  let targetFinesseRanks = 0

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
      const baseStats = attackerDigimon.baseStats
      const bonusStats = attackerDigimon.bonusStats
      const rawAttackerStats: StatBlock = {
        accuracy: (baseStats?.accuracy ?? 0) + (bonusStats?.accuracy ?? 0),
        damage: (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0),
        dodge: (baseStats?.dodge ?? 0) + (bonusStats?.dodge ?? 0),
        armor: (baseStats?.armor ?? 0) + (bonusStats?.armor ?? 0),
      }
      const resolvedAttackerStats = applyStatSwaps(rawAttackerStats, attackerParticipant.statSwaps)
      attackBaseDamage = resolvedAttackerStats.damage

      const attacks = attackerDigimon.attacks
      attackDef = attacks?.find((a: any) => a.id === attackId)

      const attackerIsDisarmed = (attackerParticipant.activeEffects || []).some((e: any) => e.name === 'Disarmed')

      if (attackDef?.tags && Array.isArray(attackDef.tags)) {
        for (const tag of attackDef.tags) {
          const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
          if (weaponMatch && !attackerIsDisarmed) {
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

      const qualities = attackerDigimon.qualities
      attackerHasCombatMonster = (qualities || []).some((q: any) => q.id === 'combat-monster')
      attackerHasPositiveReinforcement = (qualities || []).some((q: any) => q.id === 'positive-reinforcement')

      // Weapons Expert: add chosen SPEC value (bit/cpu/ram) to Weapon-tagged attacks
      const attackerHasWeaponTag = attackDef?.tags?.some((t: string) => /^Weapon/i.test(t))
      if (attackerHasWeaponTag && !attackerIsDisarmed) {
        const weaponsExpertQ = (qualities || []).find((q: any) => q.id === 'weapons-expert')
        if (weaponsExpertQ) {
          if (!atkDerivedCached) atkDerivedCached = await getDigimonDerivedStats(attackerParticipant.entityId)
          const chosenSpec = (weaponsExpertQ.choiceId || 'bit') as 'bit' | 'cpu' | 'ram'
          attackBaseDamage += atkDerivedCached?.[chosenSpec] ?? 0
        }
      }

      attackerFinesseRanks = (qualities || []).find((q: any) => q.id === 'finesse')?.ranks ?? 0
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
      const baseStats = targetDigimon.baseStats
      const bonusStats = targetDigimon.bonusStats
      const rawTargetStats: StatBlock = {
        accuracy: (baseStats?.accuracy ?? 0) + (bonusStats?.accuracy ?? 0),
        damage: (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0),
        dodge: (baseStats?.dodge ?? 0) + (bonusStats?.dodge ?? 0),
        armor: (baseStats?.armor ?? 0) + (bonusStats?.armor ?? 0),
      }
      const resolvedTargetStats = applyStatSwaps(rawTargetStats, targetParticipant.statSwaps)
      targetArmor = resolvedTargetStats.armor
      targetHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

      const qualities = targetDigimon.qualities
      targetHasCombatMonster = (qualities || []).some((q: any) => q.id === 'combat-monster')
      targetHasPositiveReinforcement = (qualities || []).some((q: any) => q.id === 'positive-reinforcement')
      const dataOpt = (qualities || []).find((q: any) => q.id === 'data-optimization')
      if (dataOpt?.choiceId === 'guardian') targetArmor += 2

      targetFinesseRanks = (qualities || []).find((q: any) => q.id === 'finesse')?.ranks ?? 0
    }
  } else if (targetParticipant.type === 'tamer') {
    const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, targetParticipant.entityId))
    if (targetTamer) {
      const attrs = targetTamer.attributes
      const skills = targetTamer.skills
      targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
    }
  }

  // Effect stat modifiers
  const attackerEffectMods = getEffectStatModifiers(attackerParticipant.activeEffects || [])
  attackBaseDamage += attackerEffectMods.damage
  const targetEffectMods = getEffectStatModifiers(targetParticipant.activeEffects || [])
  targetArmor += targetEffectMods.armor

  // Boss quality: Juggernaut stacking stat bonuses
  attackBaseDamage += attackerParticipant.juggernauntBonuses?.damage ?? 0
  targetArmor += targetParticipant.juggernauntBonuses?.armor ?? 0

  // Boss quality: Tormentor stacking stat bonuses (+2 per stack to all stats)
  attackBaseDamage += (attackerParticipant.tormentorBonusStacks ?? 0) * 2
  targetArmor += (targetParticipant.tormentorBonusStacks ?? 0) * 2

  // Positive Reinforcement mood modifiers
  if (attackerHasPositiveReinforcement && attackerMoodValue >= 5) {
    attackBaseDamage += attackerMoodValue - 4   // Mood 5 → +1, Mood 6 → +2
  }
  if (targetHasPositiveReinforcement && targetMoodValue <= 2) {
    targetArmor -= 3 - targetMoodValue          // Mood 2 → –1, Mood 1 → –2
  }

  // Boss quality: Finesse — attacker ignores ranks points of target armor
  if (attackerFinesseRanks > 0) {
    targetArmor = Math.max(0, targetArmor - attackerFinesseRanks)
  }

  // Boss quality: Tank Buster — halve target armor on hit
  const hasTankBusterTag = attackDef?.tags?.some((t: string) => t === 'Tank Buster')

  // ── Final damage ──────────────────────────────────────────────────────────
  let effectiveTargetArmor = targetArmor
  if (hasTankBusterTag) effectiveTargetArmor = Math.floor(effectiveTargetArmor / 2)
  const effectiveArmor = Math.max(0, effectiveTargetArmor - armorPiercing)
  let damageDealt = 0
  if (hit && attackDef?.type !== 'support') {
    damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
    const penalty = params.outsideClashCpuPenalty ?? 0
    if (penalty > 0) damageDealt = Math.max(1, damageDealt - penalty)
  }

  // Boss quality: Smite — deal floor(baseDamage/2) even on a miss
  if (!hit && attackDef?.type !== 'support' && attackDef?.tags?.some((t: string) => t === 'Smite')) {
    damageDealt = Math.max(1, Math.floor(attackBaseDamage / 2))
  }

  // Boss quality: Finesse — target ignores ranks points of incoming damage
  if (targetFinesseRanks > 0 && damageDealt > 0) {
    damageDealt = Math.max(0, damageDealt - targetFinesseRanks)
  }

  // ── Effect potency & data ─────────────────────────────────────────────────
  let appliedEffectName: string | null = null
  let effectData: any | null = null
  let secondaryEffectData: any | null = null

  // Boss quality: Tank Buster secondary Stun when damage ≥ 4
  if (hit && hasTankBusterTag && damageDealt >= 4) {
    secondaryEffectData = {
      name: 'Stun',
      type: 'debuff' as const,
      duration: 1,
      source: attackerName,
      description: 'Tank Buster: stunned by overwhelming strike.',
      potency: 1,
    }
  }

  if (attackDef?.effect) {
    const shouldApply = attackDef.type === 'damage' ? damageDealt >= 2 : true
    if (hit && shouldApply) {
      if (!atkDerivedCached && attackerParticipant.type === 'digimon') {
        atkDerivedCached = await getDigimonDerivedStats(attackerParticipant.entityId)
      }
      const atkDerived = atkDerivedCached
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
    secondaryEffectData,
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
