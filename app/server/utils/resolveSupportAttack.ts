import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import {
  EFFECT_ALIGNMENT,
  SPECIAL_P_EFFECTS,
  EFFECT_POTENCY_STAT,
  EFFECT_TARGET_POTENCY,
  getEffectResolutionType,
  getEffectStatModifiers,
} from '../../data/attackConstants'
import { calculateDigimonDerivedStats } from '../../types'
import type { DigimonBaseStats, DigimonStage, DigimonSize } from '../../types'
import { applyEffectToParticipant } from './applyEffect'
import { applyStanceToDodge } from '../../utils/stanceModifiers'
import { resolveParticipantName } from './participantName'

interface SupportAttackParams {
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  attackerParticipantId: string
  targetParticipantId: string
  attackDef: any
  accuracySuccesses: number
  accuracyDice: number[]
  round: number
  attackerName: string
  targetName: string
  encounterId: string
  turnOrder?: string[]
  bolstered?: boolean
  bolsterType?: string
  houseRules?: { stunMaxDuration1?: boolean }
}

interface SupportAttackResult {
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  turnOrder?: string[]
  /** If true, caller should save and return — no further processing needed */
  resolved: boolean
}

/**
 * Fetch a digimon's derived stats by entity ID
 */
export async function getDigimonDerivedStats(entityId: string) {
  const [dig] = await db.select().from(digimon).where(eq(digimon.id, entityId))
  if (!dig) return null

  const baseStats = typeof dig.baseStats === 'string'
    ? JSON.parse(dig.baseStats) : dig.baseStats
  const bonusStats = typeof (dig as any).bonusStats === 'string'
    ? JSON.parse((dig as any).bonusStats) : (dig as any).bonusStats

  const totalBaseStats: DigimonBaseStats = {
    accuracy: (baseStats?.accuracy ?? 0) + (bonusStats?.accuracy ?? 0),
    damage: (baseStats?.damage ?? 0) + (bonusStats?.damage ?? 0),
    dodge: (baseStats?.dodge ?? 0) + (bonusStats?.dodge ?? 0),
    armor: (baseStats?.armor ?? 0) + (bonusStats?.armor ?? 0),
    health: (baseStats?.health ?? 0) + (bonusStats?.health ?? 0),
  }

  const stage = dig.stage as DigimonStage
  const size = ((dig as any).size || 'medium') as DigimonSize

  return calculateDigimonDerivedStats(totalBaseStats, stage, size)
}

/**
 * Get the target's health dice pool for health rolls
 */
async function getTargetHealthPool(targetEntityId: string, targetType: string): Promise<number> {
  if (targetType === 'digimon') {
    const [targetDigimon] = await db.select().from(digimon).where(eq(digimon.id, targetEntityId))
    if (targetDigimon) {
      const baseStats = typeof targetDigimon.baseStats === 'string'
        ? JSON.parse(targetDigimon.baseStats) : targetDigimon.baseStats
      const bonusStats = typeof (targetDigimon as any).bonusStats === 'string'
        ? JSON.parse((targetDigimon as any).bonusStats) : (targetDigimon as any).bonusStats
      return (baseStats?.health ?? 0) + (bonusStats?.health ?? 0) || 3
    }
  }
  return 3
}

/**
 * Calculate potency for an effect, using attacker or target stats as appropriate.
 */
export function calculateEffectPotency(
  effectName: string,
  attackerDerived: any | null,
  targetDerived: any | null
): { potency: number; potencyStat: string } {
  const targetPotencyDef = EFFECT_TARGET_POTENCY[effectName]
  if (targetPotencyDef && targetDerived) {
    let potency: number
    if (targetPotencyDef.formula === 'max(cpu, bit)') {
      potency = Math.max(targetDerived.cpu ?? 0, targetDerived.bit ?? 0)
    } else {
      potency = targetDerived[targetPotencyDef.stat] ?? 0
    }
    return { potency, potencyStat: targetPotencyDef.stat }
  }

  const potencyStat = EFFECT_POTENCY_STAT[effectName] || 'bit'
  const potency = attackerDerived ? (attackerDerived[potencyStat] ?? 0) : 0
  return { potency, potencyStat }
}

/**
 * Build effect object for application
 */
function buildEffectData(effectName: string, duration: number, source: string, attackerDerived: any, targetDerived?: any) {
  const alignment = EFFECT_ALIGNMENT[effectName]
  const effectType = alignment === 'P' ? 'buff' : alignment === 'N' ? 'debuff' : 'status'
  const { potency, potencyStat } = calculateEffectPotency(effectName, attackerDerived, targetDerived || null)

  return {
    name: effectName,
    type: effectType as 'buff' | 'debuff' | 'status',
    duration,
    source,
    description: '',
    potency,
    potencyStat,
  }
}

/**
 * Resolve a positive support attack with auto-resolve (special P effects, single-target).
 * Shield, Haste, Purify, Revitalize — guaranteed duration 1, no health roll needed.
 */
export async function resolvePositiveAuto(params: SupportAttackParams): Promise<SupportAttackResult> {
  let { participants, battleLog, pendingRequests } = params

  const attacker = participants.find((p: any) => p.id === params.attackerParticipantId)
  if (!attacker) return { participants, battleLog, pendingRequests, resolved: true }

  const derivedStats = await getDigimonDerivedStats(attacker.entityId)

  const effectData = buildEffectData(
    params.attackDef.effect,
    1, // guaranteed duration
    params.attackerName,
    derivedStats
  )

  participants = participants.map((p: any) => {
    if (p.id === params.targetParticipantId) {
      return {
        ...p,
        activeEffects: applyEffectToParticipant(p.activeEffects || [], effectData, params.houseRules),
      }
    }
    return p
  })

  const logEntry = {
    id: `log-${Date.now()}-support`,
    timestamp: new Date().toISOString(),
    round: params.round,
    actorId: params.attackerParticipantId,
    actorName: params.attackerName,
    action: 'Support',
    target: params.targetName,
    result: `Applied ${params.attackDef.effect} (guaranteed 1 round)`,
    damage: 0,
    effects: ['Support', `Applied: ${params.attackDef.effect}`],
    hit: true,
  }

  battleLog = [...battleLog, logEntry]

  return { participants, battleLog, pendingRequests, resolved: true }
}

/**
 * Resolve a positive support attack that needs a Health roll.
 * For NPC targets: auto-roll health server-side.
 * For player targets: create a 'health-roll' request.
 */
export async function resolvePositiveHealth(params: SupportAttackParams): Promise<SupportAttackResult> {
  let { participants, battleLog, pendingRequests } = params

  const attacker = participants.find((p: any) => p.id === params.attackerParticipantId)
  const target = participants.find((p: any) => p.id === params.targetParticipantId)
  if (!attacker || !target) return { participants, battleLog, pendingRequests, resolved: true }

  const derivedStats = await getDigimonDerivedStats(attacker.entityId)

  // Determine if target is player-controlled
  let isPlayerTarget = false
  let targetTamerId = 'GM'
  if (target.type === 'tamer') {
    isPlayerTarget = true
    targetTamerId = target.entityId
  } else if (target.type === 'digimon') {
    const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    if (dig?.partnerId) {
      isPlayerTarget = true
      targetTamerId = dig.partnerId
    }
  }

  const isAoe = (params.attackDef.tags || []).some((t: string) => t.startsWith('Area Attack'))

  if (isPlayerTarget) {
    // Create health-roll request for the player
    const healthPool = await getTargetHealthPool(target.entityId, target.type)
    const healthRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'health-roll',
      targetTamerId,
      targetParticipantId: params.targetParticipantId,
      timestamp: new Date().toISOString(),
      data: {
        attackerName: params.attackerName,
        targetName: params.targetName,
        attackName: params.attackDef.name || 'Support',
        effectName: params.attackDef.effect,
        accuracySuccesses: params.accuracySuccesses,
        accuracyDice: params.accuracyDice,
        attackId: params.attackDef.id,
        attackerEntityId: attacker.entityId,
        attackerParticipantId: params.attackerParticipantId,
        targetEntityId: target.entityId,
        healthDicePool: healthPool,
        isAoe,
        isSupportAttack: true,
      },
    }

    pendingRequests = [...pendingRequests, healthRequest]
    return { participants, battleLog, pendingRequests, resolved: true }
  } else {
    // NPC target — auto-roll health server-side
    const healthPool = await getTargetHealthPool(target.entityId, target.type)
    const healthDiceResults: number[] = []
    for (let i = 0; i < healthPool; i++) {
      healthDiceResults.push(Math.floor(Math.random() * 6) + 1)
    }
    const healthSuccesses = healthDiceResults.filter((d: number) => d >= 5).length

    let duration: number
    if (isAoe) {
      duration = healthSuccesses - params.accuracySuccesses
      if (duration <= 0) {
        // No buff applied
        const logEntry = {
          id: `log-${Date.now()}-support`,
          timestamp: new Date().toISOString(),
          round: params.round,
          actorId: params.attackerParticipantId,
          actorName: params.attackerName,
          action: 'Support',
          target: params.targetName,
          result: `${params.attackDef.effect} failed — Health ${healthPool}d6 => [${healthDiceResults.join(',')}] = ${healthSuccesses} successes (needed > ${params.accuracySuccesses})`,
          damage: 0,
          effects: ['Support', 'Buff Failed'],
          hit: false,
        }
        battleLog = [...battleLog, logEntry]
        return { participants, battleLog, pendingRequests, resolved: true }
      }
    } else {
      duration = Math.max(1, healthSuccesses - params.accuracySuccesses + 1)
    }

    const effectData = buildEffectData(
      params.attackDef.effect,
      duration,
      params.attackerName,
      derivedStats
    )

    participants = participants.map((p: any) => {
      if (p.id === params.targetParticipantId) {
        return {
          ...p,
          activeEffects: applyEffectToParticipant(p.activeEffects || [], effectData, params.houseRules),
        }
      }
      return p
    })

    const logEntry = {
      id: `log-${Date.now()}-support`,
      timestamp: new Date().toISOString(),
      round: params.round,
      actorId: params.attackerParticipantId,
      actorName: params.attackerName,
      action: 'Support',
      target: params.targetName,
      result: `${params.attackDef.effect} applied for ${duration} rounds — Health ${healthPool}d6 => [${healthDiceResults.join(',')}] = ${healthSuccesses} successes`,
      damage: 0,
      effects: ['Support', `Applied: ${params.attackDef.effect}`],
      hit: true,
    }
    battleLog = [...battleLog, logEntry]

    return { participants, battleLog, pendingRequests, resolved: true }
  }
}

/**
 * Resolve a negative support attack against an NPC target (auto-roll dodge, apply debuff, no damage).
 */
export async function resolveNegativeSupportNpc(params: SupportAttackParams): Promise<SupportAttackResult> {
  let { participants, battleLog } = params

  const attacker = participants.find((p: any) => p.id === params.attackerParticipantId)
  const target = participants.find((p: any) => p.id === params.targetParticipantId)
  if (!attacker || !target) return { participants, battleLog, pendingRequests: params.pendingRequests, resolved: true }

  // Roll dodge for NPC
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

  // Apply Directed bonus to dodge pool
  const directedEffect = (target.activeEffects || []).find((e: any) => e.name === 'Directed')
  if (directedEffect?.value) {
    dodgePool += directedEffect.value
  }

  dodgePool = Math.max(1, dodgePool)

  const dodgeDiceResults: number[] = []
  for (let i = 0; i < dodgePool; i++) {
    dodgeDiceResults.push(Math.floor(Math.random() * 6) + 1)
  }
  const dodgeSuccesses = dodgeDiceResults.filter((d: number) => d >= 5).length

  const netSuccesses = params.accuracySuccesses - dodgeSuccesses
  const hit = netSuccesses >= 0

  const attackerDerived = await getDigimonDerivedStats(attacker.entityId)
  const targetDerived = target.type === 'digimon' ? await getDigimonDerivedStats(target.entityId) : null
  let appliedEffectName: string | null = null

  participants = participants.map((p: any) => {
    if (p.id === params.targetParticipantId) {
      const updated = {
        ...p,
        dodgePenalty: (p.dodgePenalty ?? 0) + 1,
        activeEffects: (p.activeEffects || []).filter((e: any) => e.name !== 'Directed'),
      }

      if (hit && params.attackDef.effect) {
        const effectData = buildEffectData(
          params.attackDef.effect,
          Math.max(1, netSuccesses),
          params.attackerName,
          attackerDerived,
          targetDerived
        )
        updated.activeEffects = applyEffectToParticipant(updated.activeEffects, effectData, params.houseRules)
        appliedEffectName = params.attackDef.effect
      }

      return updated
    }
    return p
  })

  const logEntry = {
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

  battleLog = [...battleLog, logEntry]

  return { participants, battleLog, pendingRequests: params.pendingRequests, turnOrder: params.turnOrder, resolved: true }
}
