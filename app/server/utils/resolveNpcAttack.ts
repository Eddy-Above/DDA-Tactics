import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { EFFECT_ALIGNMENT, getEffectStatModifiers } from '../../data/attackConstants'
import { calculateDigimonDerivedStats } from '../../types'
import type { DigimonBaseStats, DigimonStage, DigimonSize } from '../../types'
import { applyEffectToParticipant } from './applyEffect'
import { getDigimonDerivedStats, calculateEffectPotency } from './resolveSupportAttack'
import { applyStanceToDodge } from '../../utils/stanceModifiers'
import { resolveParticipantName } from './participantName'

interface ResolveNpcAttackParams {
  participants: any[]
  battleLog: any[]
  attackerParticipantId: string
  targetParticipantId: string
  attackId: string
  accuracySuccesses: number
  accuracyDice: number[]
  round: number
  attackerName: string
  targetName: string
  turnOrder?: string[]
  houseRules?: { stunMaxDuration1?: boolean }
}

/**
 * Auto-resolve an attack against an NPC target (rolls dodge server-side, calculates damage).
 * Does NOT deduct attacker actions — caller handles that.
 * Returns updated participants, battleLog, and optionally turnOrder arrays.
 */
export async function resolveNpcAttack(params: ResolveNpcAttackParams): Promise<{
  participants: any[]
  battleLog: any[]
  turnOrder?: string[]
}> {
  let { participants, battleLog } = params

  const attacker = participants.find((p: any) => p.id === params.attackerParticipantId)
  const target = participants.find((p: any) => p.id === params.targetParticipantId)
  if (!attacker || !target) {
    return { participants, battleLog }
  }

  // --- Attacker damage stats ---
  let attackBaseDamage = 0
  let armorPiercing = 0
  let attackDef: any = null

  if (attacker.type === 'digimon') {
    const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
    if (attackerDigimon) {
      const baseStats = typeof attackerDigimon.baseStats === 'string'
        ? JSON.parse(attackerDigimon.baseStats) : attackerDigimon.baseStats
      const bonusStats = typeof (attackerDigimon as any).bonusStats === 'string'
        ? JSON.parse((attackerDigimon as any).bonusStats) : (attackerDigimon as any).bonusStats

      attackBaseDamage = (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0)

      if (attackerDigimon.attacks) {
        const attacks = typeof attackerDigimon.attacks === 'string'
          ? JSON.parse(attackerDigimon.attacks) : attackerDigimon.attacks
        attackDef = attacks?.find((a: any) => a.id === params.attackId)

        if (attackDef?.tags && Array.isArray(attackDef.tags)) {
          for (const tag of attackDef.tags) {
            const weaponMatch = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
            if (weaponMatch) {
              const romanMap: Record<string, number> = { 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 }
              attackBaseDamage += romanMap[weaponMatch[1].toUpperCase()] || parseInt(weaponMatch[1]) || 1
            }
            const apMatch = tag.match(/^Armor Piercing\s+(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)$/i)
            if (apMatch) {
              const romanMap: Record<string, number> = {
                'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5,
                'VI': 6, 'VII': 7, 'VIII': 8, 'IX': 9, 'X': 10,
              }
              armorPiercing = (romanMap[apMatch[1].toUpperCase()] || parseInt(apMatch[1]) || 0) * 2
            }
          }
        }
      }
    }
  }

  // --- Combat Monster for attacker ---
  let attackerHasCombatMonster = false
  let attackerHealthStat = 0
  let attackerCombatMonsterBonus = 0
  if (attacker.type === 'digimon') {
    const [attackerDigimon] = await db.select().from(digimon).where(eq(digimon.id, attacker.entityId))
    if (attackerDigimon) {
      const baseStats = typeof attackerDigimon.baseStats === 'string'
        ? JSON.parse(attackerDigimon.baseStats) : attackerDigimon.baseStats
      const bonusStats = typeof (attackerDigimon as any).bonusStats === 'string'
        ? JSON.parse((attackerDigimon as any).bonusStats) : (attackerDigimon as any).bonusStats
      attackerHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

      const attackerQualities = typeof attackerDigimon.qualities === 'string'
        ? JSON.parse(attackerDigimon.qualities) : attackerDigimon.qualities
      attackerHasCombatMonster = (attackerQualities || []).some((q: any) => q.id === 'combat-monster')
      attackerCombatMonsterBonus = attacker.combatMonsterBonus ?? 0
    }
  }

  // --- Target dodge pool ---
  let dodgePool = 3
  if (target.type === 'digimon') {
    const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    if (targetDigimon) {
      const baseStats = typeof targetDigimon.baseStats === 'string'
        ? JSON.parse(targetDigimon.baseStats) : targetDigimon.baseStats
      const bonusStats = typeof (targetDigimon as any).bonusStats === 'string'
        ? JSON.parse((targetDigimon as any).bonusStats) : (targetDigimon as any).bonusStats
      dodgePool = (baseStats?.dodge ?? 0) + (bonusStats?.dodge ?? 0) || 3
    }
  } else if (target.type === 'tamer') {
    const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    if (targetTamer) {
      const attrs = typeof targetTamer.attributes === 'string'
        ? JSON.parse(targetTamer.attributes) : targetTamer.attributes
      const skills = typeof targetTamer.skills === 'string'
        ? JSON.parse(targetTamer.skills) : targetTamer.skills
      dodgePool = (attrs?.agility ?? 0) + (skills?.dodge ?? 0) || 3
    }
  }
  dodgePool = applyStanceToDodge(dodgePool, target.currentStance)
  dodgePool = Math.max(1, dodgePool - (target.dodgePenalty ?? 0))

  // Apply active effect dodge modifiers
  const targetEffectMods = getEffectStatModifiers(target.activeEffects || [])
  dodgePool += targetEffectMods.dodge

  // Apply Directed bonus to dodge pool (for NPC targets that were directed by a tamer)
  const directedEffect = (target.activeEffects || []).find((e: any) => e.name === 'Directed')
  if (directedEffect?.value) {
    dodgePool += directedEffect.value
  }

  dodgePool = Math.max(1, dodgePool)

  // Roll dodge
  const dodgeDiceResults: number[] = []
  for (let i = 0; i < dodgePool; i++) {
    dodgeDiceResults.push(Math.floor(Math.random() * 6) + 1)
  }
  const dodgeSuccesses = dodgeDiceResults.filter((d: number) => d >= 5).length

  // --- Support attack: skip damage, apply N effect only ---
  if (attackDef?.type === 'support') {
    const netSuccesses = params.accuracySuccesses - dodgeSuccesses
    const hit = netSuccesses >= 0
    let appliedEffectName: string | null = null

    // Get derived stats for potency (attacker and target)
    const attackerDerived = attacker.type === 'digimon' ? await getDigimonDerivedStats(attacker.entityId) : null
    const targetDerived = target.type === 'digimon' ? await getDigimonDerivedStats(target.entityId) : null

    participants = participants.map((p: any) => {
      if (p.id === params.targetParticipantId) {
        const updated = {
          ...p,
          dodgePenalty: (p.dodgePenalty ?? 0) + 1,
          activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
        }

        if (hit && attackDef.effect) {
          const alignment = EFFECT_ALIGNMENT[attackDef.effect]
          const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
          const { potency, potencyStat } = calculateEffectPotency(attackDef.effect, attackerDerived, targetDerived)

          const effectData = {
            name: attackDef.effect,
            type: effectType as 'buff' | 'debuff' | 'status',
            duration: Math.max(1, netSuccesses),
            source: params.attackerName,
            description: '',
            potency,
            potencyStat,
          }
          updated.activeEffects = applyEffectToParticipant(updated.activeEffects, effectData, params.houseRules)
          appliedEffectName = attackDef.effect
        }

        return updated
      }
      return p
    })

    const supportDodgeLog = {
      id: `log-${Date.now()}-dodge`,
      timestamp: new Date().toISOString(),
      round: params.round,
      actorId: params.targetParticipantId,
      actorName: params.targetName,
      action: 'Dodge (Support)',
      target: null,
      result: `${dodgePool}d6 => [${dodgeDiceResults.join(',')}] = ${dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
      damage: 0,
      effects: appliedEffectName ? ['Dodge', `Applied: ${appliedEffectName}`] : ['Dodge'],
      hit,
      dodgeDicePool: dodgePool,
      dodgeDiceResults,
      dodgeSuccesses,
    }

    battleLog = [...battleLog, supportDodgeLog]
    return { participants, battleLog, turnOrder: params.turnOrder }
  }

  // --- Damage calculation ---
  const netSuccesses = params.accuracySuccesses - dodgeSuccesses
  const hit = netSuccesses >= 0

  // Apply Combat Monster bonus to attacker's damage on hit
  if (hit && attackerHasCombatMonster && attackerCombatMonsterBonus > 0) {
    attackBaseDamage += attackerCombatMonsterBonus
  }

  // Target armor and Combat Monster
  let targetArmor = 0
  let targetHasCombatMonster = false
  let targetHealthStat = 0
  if (target.type === 'digimon') {
    const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    if (targetDigimon) {
      const baseStats = typeof targetDigimon.baseStats === 'string'
        ? JSON.parse(targetDigimon.baseStats) : targetDigimon.baseStats
      const bonusStats = typeof (targetDigimon as any).bonusStats === 'string'
        ? JSON.parse((targetDigimon as any).bonusStats) : (targetDigimon as any).bonusStats
      targetArmor = (baseStats?.armor ?? 0) + (bonusStats?.armor ?? 0)
      targetHealthStat = (baseStats?.health ?? 0) + (bonusStats?.health ?? 0)

      const qualities = typeof targetDigimon.qualities === 'string'
        ? JSON.parse(targetDigimon.qualities) : targetDigimon.qualities
      const dataOpt = qualities?.find((q: any) => q.id === 'data-optimization')
      if (dataOpt?.choiceId === 'guardian') targetArmor += 2
      targetHasCombatMonster = (qualities || []).some((q: any) => q.id === 'combat-monster')
    }
  } else if (target.type === 'tamer') {
    const [targetTamer] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
    if (targetTamer) {
      const attrs = typeof targetTamer.attributes === 'string'
        ? JSON.parse(targetTamer.attributes) : targetTamer.attributes
      const skills = typeof targetTamer.skills === 'string'
        ? JSON.parse(targetTamer.skills) : targetTamer.skills
      targetArmor = (attrs?.body ?? 0) + (skills?.endurance ?? 0)
    }
  }

  // Apply active effect modifiers to attacker damage and target armor
  const attackerEffectMods = getEffectStatModifiers(attacker.activeEffects || [])
  attackBaseDamage += attackerEffectMods.damage
  targetArmor += targetEffectMods.armor

  let damageDealt = 0
  if (hit) {
    const effectiveArmor = Math.max(0, targetArmor - armorPiercing)
    damageDealt = Math.max(1, attackBaseDamage + netSuccesses - effectiveArmor)
  }

  // --- Pre-calculate effect potency (async, can't be inside .map()) ---
  let effectPotency = 0
  let effectPotencyStat = 'bit'
  if (hit && attackDef?.effect) {
    const attackerDerived = attacker.type === 'digimon' ? await getDigimonDerivedStats(attacker.entityId) : null
    const targetDerived = target.type === 'digimon' ? await getDigimonDerivedStats(target.entityId) : null
    const result = calculateEffectPotency(attackDef.effect, attackerDerived, targetDerived)
    effectPotency = result.potency
    effectPotencyStat = result.potencyStat
  }

  // --- Apply damage, effects, dodge penalty ---
  let appliedEffectName: string | null = null
  participants = participants.map((p: any) => {
    // Handle attacker: reset Combat Monster bonus on hit
    if (p.id === params.attackerParticipantId && hit && attackerHasCombatMonster) {
      return { ...p, combatMonsterBonus: 0 }
    }

    // Handle target: apply damage and Combat Monster accumulation
    if (p.id === params.targetParticipantId) {
      const updated = {
        ...p,
        dodgePenalty: (p.dodgePenalty ?? 0) + 1,
        // Consume Directed effect (bonus was applied to dodge pool above)
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }
      if (hit) {
        updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + damageDealt)

        // Accumulate Combat Monster bonus for target
        if (targetHasCombatMonster) {
          updated.combatMonsterBonus = Math.min(
            targetHealthStat,
            (p.combatMonsterBonus ?? 0) + damageDealt
          )
        }

        if (attackDef?.effect) {
          const shouldApply = attackDef.type === 'damage' ? damageDealt >= 2 : true
          if (shouldApply) {
            const alignment = EFFECT_ALIGNMENT[attackDef.effect]
            const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'

            const effectData = {
              name: attackDef.effect,
              type: effectType as 'buff' | 'debuff' | 'status',
              duration: Math.max(1, netSuccesses),
              source: params.attackerName,
              description: '',
              potency: effectPotency,
              potencyStat: effectPotencyStat,
            }
            updated.activeEffects = applyEffectToParticipant(updated.activeEffects, effectData, params.houseRules)
            appliedEffectName = attackDef.effect
          }
        }
      }
      return updated
    }
    return p
  })

  // --- Auto-devolve check ---
  let autoDevolveLog: any = null
  const damagedTarget = participants.find((p: any) => p.id === params.targetParticipantId)
  if (damagedTarget && hit &&
      damagedTarget.currentWounds >= damagedTarget.maxWounds &&
      damagedTarget.evolutionLineId &&
      damagedTarget.woundsHistory?.length > 0) {
    const rawState = damagedTarget.woundsHistory.pop()
    // Handle case where previousState might be serialized as JSON string
    const previousState = typeof rawState === 'string' ? JSON.parse(rawState) : rawState
    if (previousState) {
      const oldEntityId = damagedTarget.entityId
      damagedTarget.entityId = previousState.entityId
      damagedTarget.maxWounds = previousState.maxWounds
      damagedTarget.currentWounds = previousState.wounds !== undefined ? previousState.wounds : 0

      // Update npcStageIndex on the participant (NPCs track stage locally)
      (damagedTarget as any).npcStageIndex = previousState.stageIndex

      const [oldDigimon] = await db.select().from(digimon).where(eq(digimon.id, oldEntityId))
      const [newDigimon] = await db.select().from(digimon).where(eq(digimon.id, previousState.entityId))

      autoDevolveLog = {
        id: `log-${Date.now()}-autodevolve`,
        timestamp: new Date().toISOString(),
        round: params.round,
        actorId: damagedTarget.id,
        actorName: resolveParticipantName(damagedTarget, params.participants, oldDigimon?.name || 'Digimon', damagedTarget?.isEnemy || false),
        action: `was knocked out and devolved to ${newDigimon?.name || 'previous form'}!`,
        target: null,
        result: `Wounds restored to ${previousState.wounds !== undefined ? previousState.wounds : 0}`,
        damage: null,
        effects: ['Auto-Devolve'],
      }
    }
  }

  // --- Remove defeated NPC from encounter ---
  let defeatedLog: any = null
  if (damagedTarget && hit &&
      damagedTarget.currentWounds >= damagedTarget.maxWounds &&
      damagedTarget.isEnemy &&
      !autoDevolveLog) {
    participants = participants.filter((p: any) => p.id !== params.targetParticipantId)
    if (params.turnOrder) {
      params.turnOrder = params.turnOrder.filter((id: string) => id !== params.targetParticipantId)
    }
    defeatedLog = {
      id: `log-${Date.now()}-defeated`,
      timestamp: new Date().toISOString(),
      round: params.round,
      actorId: params.targetParticipantId,
      actorName: params.targetName,
      action: 'was defeated and removed from the encounter!',
      target: null,
      result: 'Defeated',
      damage: null,
      effects: ['Defeated'],
    }
  }

  // --- Battle log ---
  const dodgeLogEntry = {
    id: `log-${Date.now()}-dodge`,
    timestamp: new Date().toISOString(),
    round: params.round,
    actorId: params.targetParticipantId,
    actorName: params.targetName,
    action: 'Dodge',
    target: null,
    result: `${dodgePool}d6 => [${dodgeDiceResults.join(',')}] = ${dodgeSuccesses} successes - Net: ${netSuccesses} - ${hit ? 'HIT!' : 'MISS!'}`,
    damage: hit ? damageDealt : 0,
    effects: appliedEffectName ? ['Dodge', `Applied: ${appliedEffectName}`] : ['Dodge'],
    attackerParticipantId: params.attackerParticipantId,
    baseDamage: attackBaseDamage,
    netSuccesses,
    targetArmor,
    armorPiercing,
    effectiveArmor: hit ? Math.max(0, targetArmor - armorPiercing) : undefined,
    finalDamage: hit ? damageDealt : 0,
    hit,
    dodgeDicePool: dodgePool,
    dodgeDiceResults,
    dodgeSuccesses,
  }

  battleLog = [...battleLog, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : []), ...(defeatedLog ? [defeatedLog] : [])]

  return { participants, battleLog, turnOrder: params.turnOrder }
}
