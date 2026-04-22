import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { getEffectStatModifiers } from '../../data/attackConstants'
import { applyEffectToParticipant } from './applyEffect'
import { applyStanceToDodge } from '../../utils/stanceModifiers'
import { resolveParticipantName } from './participantName'
import { computeAttackDamage } from './computeAttackDamage'

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
  currentTurnIndex?: number
  houseRules?: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean }
  clashAttack?: boolean        // If true, target's dodge pool is halved (clash mechanic)
  counterattack?: boolean      // If true, target's dodge pool is halved (Counterattack mechanic)
  outsideClashCpuPenalty?: number  // Damage reduction when attacker is outside target's active clash
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
  hit: boolean
}> {
  let { participants, battleLog } = params

  const currentTurnIndex = params.currentTurnIndex ?? 0
  // Digimon are not in turnOrder — use their partner Tamer's position instead.
  const targetParticipantForTurn = params.participants.find((p: any) => p.id === params.targetParticipantId)
  let targetHasGone = false
  if (targetParticipantForTurn?.type === 'tamer') {
    const idx = (params.turnOrder || []).indexOf(targetParticipantForTurn.id)
    targetHasGone = idx >= 0 && idx < currentTurnIndex
  } else if (targetParticipantForTurn?.type === 'digimon') {
    const [targetDigimonForTurn] = await db.select().from(digimon).where(eq(digimon.id, targetParticipantForTurn.entityId))
    if (targetDigimonForTurn?.partnerId) {
      const tamerOfTarget = params.participants.find((p: any) => p.type === 'tamer' && p.entityId === targetDigimonForTurn.partnerId)
      if (tamerOfTarget) {
        const idx = (params.turnOrder || []).indexOf(tamerOfTarget.id)
        targetHasGone = idx >= 0 && idx < currentTurnIndex
      }
    } else {
      // NPC digimon — appears in turnOrder directly
      const idx = (params.turnOrder || []).indexOf(targetParticipantForTurn.id)
      targetHasGone = idx >= 0 && idx < currentTurnIndex
    }
  }

  const attacker = participants.find((p: any) => p.id === params.attackerParticipantId)
  const target = participants.find((p: any) => p.id === params.targetParticipantId)
  if (!attacker || !target) {
    return { participants, battleLog, hit: false }
  }

  // --- Target quality vars (used in dodge pool and participant update below) ---
  let targetHasPositiveReinforcement = false
  let targetHasCombatMonster = false
  const targetMoodValue = target.moodValue ?? 3

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
      const targetQualities = typeof targetDigimon.qualities === 'string'
        ? JSON.parse(targetDigimon.qualities) : targetDigimon.qualities
      targetHasPositiveReinforcement = (targetQualities || []).some((q: any) => q.id === 'positive-reinforcement')
      targetHasCombatMonster = (targetQualities || []).some((q: any) => q.id === 'combat-monster')
      const instinct = (targetQualities || []).find((q: any) => q.id === 'instinct')
      dodgePool += instinct?.ranks || 0
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

  // Apply Positive Reinforcement mood dodge bonus for target
  if (targetHasPositiveReinforcement && targetMoodValue >= 5) {
    dodgePool += targetMoodValue - 4  // Mood 5 → +1, Mood 6 → +2
  }

  // Apply Directed bonus to dodge pool (for NPC targets that were directed by a tamer)
  const directedEffect = (target.activeEffects || []).find((e: any) => e.name === 'Directed')
  if (directedEffect?.value) {
    dodgePool += directedEffect.value
  }

  // Clash Attack: target can only use half their dodge pool
  if (params.clashAttack) {
    dodgePool = Math.max(1, Math.floor(dodgePool / 2))
  }

  // Counterattack: target can only use half their dodge pool
  if (params.counterattack) {
    dodgePool = Math.max(1, Math.floor(dodgePool / 2))
  }

  dodgePool = Math.max(1, dodgePool)

  // Roll dodge
  const dodgeDiceResults: number[] = []
  for (let i = 0; i < dodgePool; i++) {
    dodgeDiceResults.push(Math.floor(Math.random() * 6) + 1)
  }
  const dodgeSuccesses = dodgeDiceResults.filter((d: number) => d >= 5).length

  // Shared damage calculation (handles attacker loading, armor, and effects internally)
  const damageCalc = await computeAttackDamage({
    attackerParticipant: attacker,
    targetParticipant: target,
    attackId: params.attackId,
    attackerName: params.attackerName,
    accuracySuccesses: params.accuracySuccesses,
    dodgeSuccesses,
    outsideClashCpuPenalty: params.outsideClashCpuPenalty,
    houseRules: params.houseRules,
  })

  const attackDef = damageCalc.attackDef
  const attackBaseDamage = damageCalc.attackBaseDamage
  const armorPiercing = damageCalc.armorPiercing
  const attackerHasCombatMonster = damageCalc.attackerHasCombatMonster
  const attackerCombatMonsterBonus = damageCalc.attackerCombatMonsterBonus
  const attackerHasPositiveReinforcement = damageCalc.attackerHasPositiveReinforcement
  const attackerMoodValue = damageCalc.attackerMoodValue
  const netSuccesses = damageCalc.netSuccesses
  const hit = damageCalc.hit
  const targetArmor = damageCalc.targetArmor
  const damageDealt = damageCalc.damageDealt
  const effectiveArmor = damageCalc.effectiveArmor

  // --- Support attack: skip damage, apply effect only ---
  if (attackDef?.type === 'support') {
    let appliedEffectName: string | null = null

    participants = participants.map((p: any) => {
      if (p.id === params.targetParticipantId) {
        const updated = {
          ...p,
          dodgePenalty: (p.dodgePenalty ?? 0) + 1,
          activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
        }

        if (hit && damageCalc.effectData) {
          updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.effectData, params.houseRules)
          appliedEffectName = damageCalc.appliedEffectName
          // Stun: immediately reduce actions if target hasn't taken their turn yet this round
          if (attackDef.effect === 'Stun' && !targetHasGone) {
            updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
            updated.stunActionReducedThisRound = true
          } else if (attackDef.effect === 'Stun' && targetHasGone) {
            // Target already went — reduce intercede capacity this round and carry -1 action to next round
            updated.interceptPenalty = (p.interceptPenalty || 0) + 1
            updated.stunActionReducedThisRound = true
          }
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
    return { participants, battleLog, turnOrder: params.turnOrder, hit }
  }

  // All damage/effect values computed by computeAttackDamage above.

  // --- Apply damage, effects, dodge penalty ---
  let appliedEffectName: string | null = null
  let lifestealHealAmount = 0
  participants = participants.map((p: any) => {
    // Handle attacker: reset Combat Monster bonus on hit + Lifesteal healing + Positive Reinforcement mood
    if (p.id === params.attackerParticipantId) {
      const attackerUpdates: any = {}
      if (hit && attackerHasCombatMonster) {
        attackerUpdates.combatMonsterBonus = 0
      }
      if (hit && attackDef?.effect === 'Lifesteal' && damageDealt >= 2) {
        // effectData.potency is the attacker's CPU value (from computeAttackDamage)
        lifestealHealAmount = Math.min(damageDealt, damageCalc.effectData?.potency ?? 0)
        attackerUpdates.currentWounds = Math.max(0, (p.currentWounds || 0) - lifestealHealAmount)
      }
      if (attackerHasPositiveReinforcement) {
        // Land attack → +1 Mood; Miss → –1 Mood
        attackerUpdates.moodValue = Math.min(6, Math.max(1, (p.moodValue ?? 3) + (hit ? 1 : -1)))
      }
      if (Object.keys(attackerUpdates).length > 0) {
        return { ...p, ...attackerUpdates }
      }
    }

    // Handle target: apply damage and Combat Monster accumulation
    if (p.id === params.targetParticipantId) {
      const updated: any = {
        ...p,
        dodgePenalty: (p.dodgePenalty ?? 0) + 1,
        // Consume Directed effect (bonus was applied to dodge pool above)
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }
      // Positive Reinforcement: get hit → –1 Mood; successfully dodge → +1 Mood
      if (targetHasPositiveReinforcement) {
        updated.moodValue = Math.min(6, Math.max(1, (p.moodValue ?? 3) + (hit ? -1 : 1)))
      }
      if (hit) {
        const tempAvailable = p.currentTempWounds ?? 0
        const tempAbsorb = Math.min(tempAvailable, damageDealt)
        const remainder = damageDealt - tempAbsorb
        updated.currentTempWounds = tempAvailable - tempAbsorb
        if (tempAbsorb > 0 && updated.currentTempWounds === 0) {
          updated.activeEffects = (updated.activeEffects || []).filter((e: any) => e.name !== 'Shield')
        }
        updated.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + remainder)

        // Accumulate Combat Monster bonus for target (only from real wound damage)
        if (targetHasCombatMonster && remainder > 0) {
          updated.combatMonsterBonus = Math.min(
            p.totalHealth ?? p.maxWounds,
            (p.combatMonsterBonus ?? 0) + remainder
          )
        }

        if (damageCalc.effectData) {
          updated.activeEffects = applyEffectToParticipant(updated.activeEffects, damageCalc.effectData, params.houseRules)
          appliedEffectName = damageCalc.appliedEffectName
          // Stun: immediately reduce actions if target hasn't taken their turn yet this round
          if (attackDef?.effect === 'Stun' && !targetHasGone) {
            updated.actionsRemaining = { simple: Math.max(0, (p.actionsRemaining?.simple || 0) - 1) }
            updated.stunActionReducedThisRound = true
          } else if (attackDef?.effect === 'Stun' && targetHasGone) {
            // Target already went — reduce intercede capacity this round and carry -1 action to next round
            updated.interceptPenalty = (p.interceptPenalty || 0) + 1
            updated.stunActionReducedThisRound = true
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

      const devolvedQualities = typeof newDigimon?.qualities === 'string'
        ? JSON.parse(newDigimon.qualities) : (newDigimon?.qualities || [])
      const devolvedHasCombatMonster = (devolvedQualities as any[]).some((q: any) => q.id === 'combat-monster')
      damagedTarget.combatMonsterBonus = devolvedHasCombatMonster
        ? Math.min((damagedTarget as any).combatMonsterBonus ?? 0, previousState.totalHealth ?? previousState.maxWounds)
        : 0

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
    effects: [
      'Dodge',
      ...(appliedEffectName ? [`Applied: ${appliedEffectName}`] : []),
      ...(lifestealHealAmount > 0 ? [`Lifesteal: healed ${lifestealHealAmount}`] : []),
    ],
    attackerParticipantId: params.attackerParticipantId,
    baseDamage: attackBaseDamage,
    netSuccesses,
    targetArmor,
    armorPiercing,
    effectiveArmor: hit ? effectiveArmor : undefined,
    finalDamage: hit ? damageDealt : 0,
    hit,
    dodgeDicePool: dodgePool,
    dodgeDiceResults,
    dodgeSuccesses,
  }

  battleLog = [...battleLog, dodgeLogEntry, ...(autoDevolveLog ? [autoDevolveLog] : []), ...(defeatedLog ? [defeatedLog] : [])]

  return { participants, battleLog, turnOrder: params.turnOrder, hit }
}
