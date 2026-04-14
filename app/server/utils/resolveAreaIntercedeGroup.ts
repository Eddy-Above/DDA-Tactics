import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { resolveNpcAttack } from './resolveNpcAttack'
import { applyEffectToParticipant } from '~/server/utils/applyEffect'
import { resolvePositiveAuto, resolvePositiveHealth, resolveNegativeSupportNpc } from '~/server/utils/resolveSupportAttack'
import { getEffectResolutionType } from '~/data/attackConstants'

export interface AreaAttackClaim {
  interceptorParticipantId: string
  targetId: string
  interceptorName: string
  targetName: string
  damageDealt: number
  appliedEffectName: string | null
  effectData: any | null
  stunActionReducedThisRound: boolean
  interceptorArmor: number
  armorPiercing: number
  effectiveArmor: number
  attackBaseDamage: number
  netSuccesses: number
  isSupportAttack: boolean
}

/**
 * Returns true when every target in the group has either been claimed or is no longer
 * covered by any remaining intercede-offer request.
 */
export function allAreaTargetsDecided(
  groupState: any,
  pendingRequests: any[],
  intercedeGroupId: string
): boolean {
  if (!groupState) return false
  const originalTargets: string[] = groupState.data?.originalTargetIds || []
  const claims: any[] = groupState.data?.claims || []
  const claimedTargets = new Set(claims.map((c: any) => c.targetId))

  for (const targetId of originalTargets) {
    if (claimedTargets.has(targetId)) continue
    const isCovered = pendingRequests.some(
      (r: any) =>
        r.type === 'intercede-offer' &&
        r.data?.intercedeGroupId === intercedeGroupId &&
        (r.data?.areaTargetIds || []).includes(targetId)
    )
    if (isCovered) return false
  }
  return true
}

interface ResolveGroupParams {
  groupState: any
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  turnOrder: any[]
  round: number
  currentTurnIndex: number
  houseRules?: any
  encounterId: string
}

/**
 * Applies all accumulated intercede claims at once, then issues dodge-roll requests for
 * uncovered player targets and auto-resolves uncovered NPC targets.
 * Removes the intercede-group-state tracking request from pendingRequests.
 */
export async function resolveAreaIntercedeGroup({
  groupState,
  participants,
  battleLog,
  pendingRequests,
  turnOrder,
  round,
  currentTurnIndex,
  houseRules,
  encounterId,
}: ResolveGroupParams): Promise<{
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  turnOrder: any[]
}> {
  const groupData = groupState.data
  const claims: AreaAttackClaim[] = groupData.claims || []
  const originalTargetIds: string[] = groupData.originalTargetIds || []
  const npcTargetIds: string[] = groupData.npcTargetIds || []
  const playerTargetInfo: Record<string, any> = groupData.playerTargetInfo || {}

  let updatedParticipants = [...participants]
  let updatedBattleLog = [...battleLog]
  let updatedPendingRequests = [...pendingRequests]
  let updatedTurnOrder = [...turnOrder]

  const claimedTargetIds = new Set(claims.map(c => c.targetId))
  const now = Date.now()

  // Apply damage / effects to interceptors; apply dodge penalty to intercepted targets
  updatedParticipants = updatedParticipants.map((p: any) => {
    const claim = claims.find(c => c.interceptorParticipantId === p.id)
    if (claim) {
      const updated: any = {
        ...p,
        currentWounds: Math.min(p.maxWounds, (p.currentWounds || 0) + claim.damageDealt),
      }
      if (claim.effectData) {
        updated.activeEffects = applyEffectToParticipant(p.activeEffects || [], claim.effectData, houseRules)
      }
      return updated
    }
    // Intercepted targets receive a dodge penalty (they were "hit" even though the interceptor took the damage)
    if (claimedTargetIds.has(p.id)) {
      return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
    }
    return p
  })

  // Add battle log entries for all claims in claim order
  for (let i = 0; i < claims.length; i++) {
    const claim = claims[i]
    const logEntry: any = claim.isSupportAttack
      ? {
          id: `log-${now + i}-intercede`,
          timestamp: new Date().toISOString(),
          round,
          actorId: claim.interceptorParticipantId,
          actorName: claim.interceptorName,
          action: `Interceded for ${claim.targetName}! (Support)`,
          target: null,
          result: claim.appliedEffectName
            ? `Takes debuff with 0 dodge - ${claim.appliedEffectName} applied for ${Math.max(1, claim.netSuccesses)} rounds`
            : 'Interceded (no effect)',
          damage: 0,
          effects: claim.appliedEffectName
            ? ['Intercede', `Applied: ${claim.appliedEffectName}`]
            : ['Intercede'],
          hit: true,
          dodgeDicePool: 0,
          dodgeDiceResults: [],
          dodgeSuccesses: 0,
        }
      : {
          id: `log-${now + i}-intercede`,
          timestamp: new Date().toISOString(),
          round,
          actorId: claim.interceptorParticipantId,
          actorName: claim.interceptorName,
          action: `Interceded for ${claim.targetName}!`,
          target: null,
          result: 'Takes hit with 0 dodge',
          damage: claim.damageDealt,
          effects: claim.appliedEffectName
            ? ['Intercede', `Applied: ${claim.appliedEffectName}`]
            : ['Intercede'],
          attackerParticipantId: groupData.attackerId,
          baseDamage: claim.attackBaseDamage,
          netSuccesses: claim.netSuccesses,
          targetArmor: claim.interceptorArmor,
          armorPiercing: claim.armorPiercing,
          effectiveArmor: claim.effectiveArmor,
          finalDamage: claim.damageDealt,
          hit: true,
          dodgeDicePool: 0,
          dodgeDiceResults: [],
          dodgeSuccesses: 0,
        }
    updatedBattleLog.push(logEntry)
  }

  // Targets that were not claimed by any interceptor
  const uncoveredIds = originalTargetIds.filter(id => !claimedTargetIds.has(id))

  // Uncovered player targets → create dodge-roll requests
  for (const targetId of uncoveredIds) {
    if (npcTargetIds.includes(targetId)) continue
    const info = playerTargetInfo[targetId]
    if (!info) continue
    const target = updatedParticipants.find((p: any) => p.id === targetId)
    let targetTamerId = 'GM'
    if (info.type === 'tamer') targetTamerId = info.entityId
    else if (info.partnerId) targetTamerId = info.partnerId

    updatedPendingRequests.push({
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'dodge-roll',
      targetTamerId,
      targetParticipantId: targetId,
      timestamp: new Date().toISOString(),
      data: {
        attackerName: groupData.attackerName,
        targetName: info.name,
        attackName: groupData.attackName || 'Attack',
        accuracySuccesses: groupData.accuracySuccesses,
        accuracyDice: groupData.accuracyDice,
        attackId: groupData.attackId,
        attackData: groupData.attackData,
        attackerEntityId: updatedParticipants.find((p: any) => p.id === groupData.attackerId)?.entityId,
        attackerParticipantId: groupData.attackerId,
        targetEntityId: info.entityId,
        dodgePenalty: target?.dodgePenalty ?? 0,
        bolstered: groupData.bolstered || false,
        bolsterType: groupData.bolsterType || null,
        bolsterDamageBonus: groupData.bolsterDamageBonus || 0,
        bolsterBitCpuBonus: groupData.bolsterBitCpuBonus || 0,
        lifestealed: groupData.lifestealed || false,
        isSupportAttack: groupData.isSupportAttack || false,
        isSignatureMove: groupData.isSignatureMove || false,
        batteryCount: groupData.batteryCount ?? 0,
        clashAttack: groupData.clashAttack || false,
        outsideClashCpuPenalty: groupData.outsideClashCpuPenalty ?? 0,
      },
    })
  }

  // Uncovered NPC targets → auto-resolve
  const isSupportAttack = !!groupData.isSupportAttack
  const attackDef = groupData.attackData || null

  for (const targetId of uncoveredIds) {
    if (!npcTargetIds.includes(targetId)) continue
    const target = updatedParticipants.find((p: any) => p.id === targetId)
    let resolvedName = targetId
    if (target?.type === 'digimon') {
      const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      resolvedName = dig?.name || targetId
    } else if (target?.type === 'tamer') {
      const [tam] = await db.select().from(tamers).where(eq(tamers.id, target.entityId))
      resolvedName = tam?.name || targetId
    }

    if (isSupportAttack && attackDef) {
      const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')
      const supportParams = {
        participants: updatedParticipants,
        battleLog: updatedBattleLog,
        pendingRequests: updatedPendingRequests,
        attackerParticipantId: groupData.attackerId,
        targetParticipantId: targetId,
        attackDef,
        accuracySuccesses: groupData.accuracySuccesses,
        accuracyDice: groupData.accuracyDice,
        round,
        attackerName: groupData.attackerName,
        targetName: resolvedName,
        encounterId,
        turnOrder: updatedTurnOrder,
        houseRules,
        isSignatureMove: groupData.isSignatureMove || false,
        batteryCount: groupData.batteryCount ?? 0,
      }
      let supportResult: any = null
      if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
      else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
      else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)

      if (supportResult) {
        updatedParticipants = supportResult.participants
        updatedBattleLog = supportResult.battleLog
        updatedPendingRequests = supportResult.pendingRequests
        if (supportResult.turnOrder) updatedTurnOrder = supportResult.turnOrder
      }
    } else {
      const result = await resolveNpcAttack({
        participants: updatedParticipants,
        battleLog: updatedBattleLog,
        attackerParticipantId: groupData.attackerId,
        targetParticipantId: targetId,
        attackId: groupData.attackId,
        accuracySuccesses: groupData.accuracySuccesses,
        accuracyDice: groupData.accuracyDice,
        round,
        attackerName: groupData.attackerName,
        targetName: resolvedName,
        turnOrder: updatedTurnOrder,
        currentTurnIndex,
        houseRules,
        clashAttack: groupData.clashAttack,
        outsideClashCpuPenalty: groupData.outsideClashCpuPenalty,
      })
      updatedParticipants = result.participants
      updatedBattleLog = result.battleLog
      if (result.turnOrder) updatedTurnOrder = result.turnOrder
    }
  }

  // Remove the intercede-group-state tracking request
  updatedPendingRequests = updatedPendingRequests.filter((r: any) => r.id !== groupState.id)

  return {
    participants: updatedParticipants,
    battleLog: updatedBattleLog,
    pendingRequests: updatedPendingRequests,
    turnOrder: updatedTurnOrder,
  }
}
