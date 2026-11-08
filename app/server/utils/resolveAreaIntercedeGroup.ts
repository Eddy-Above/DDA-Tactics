import { autoDevolveParticipant } from './partnerDevolution'
import { eq } from 'drizzle-orm'
import { db, digimon, tamers } from '../db'
import { resolveNpcAttack } from './resolveNpcAttack'
import { knockedOutEnemyIds, resolveEnemyKnockouts } from './enemyKnockouts'
import { resolveParticipantName } from './participantName'
import { applyEffectToParticipant } from '~/server/utils/applyEffect'
import { resolvePositiveAuto, resolvePositiveHealth, resolveNegativeSupportNpc, getPositiveSupportResolutionType } from '~/server/utils/resolveSupportAttack'
import { getEffectResolutionType } from '~/data/attackConstants'
import { getSelectiveTargetingFilter } from '~/server/utils/selectiveTargeting'
import { refreshGuidingLightForParticipants } from './guidingLight'
import type { Vec3, GameMap } from '../../types'
import { loadParticipantDigimon } from './combatSpatial'
import { resolveInstantSupportEffect } from './pushPull'
import { preserveEnduringSouls } from '../../utils/specialOrderCombat'
import { readCombatRecord, withCombatRecords } from './combatRecordCache'

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
  interceptorHasCombatMonster?: boolean
  interceptorHealthStat?: number
}

/**
 * Returns true if the given intercede-offer's data still lists the target as one its
 * recipient (tamer, partner digimon, or any NPC under GM control) is eligible to protect.
 */
export function isAreaTargetCovered(offerData: any, targetId: string): boolean {
  const d = offerData || {}
  if ((d.tamerAreaTargetIds || []).includes(targetId)) return true
  if ((d.digimonAreaTargetIds || []).includes(targetId)) return true
  if (d.npcAreaEligibility) {
    return Object.values(d.npcAreaEligibility as Record<string, string[]>).some((arr) => arr.includes(targetId))
  }
  return false
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

  const groupOffers = pendingRequests.filter(
    (r: any) => r.type === 'intercede-offer' && r.data?.intercedeGroupId === intercedeGroupId
  )

  for (const targetId of originalTargets) {
    if (claimedTargets.has(targetId)) continue
    const isCovered = groupOffers.some((r: any) => isAreaTargetCovered(r.data, targetId))
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
  positions?: Record<string, Vec3>
  mapRecord?: GameMap | null
  mapId?: string | null
  campaignLevel?: 'standard' | 'enhanced' | 'extreme'
  database?: Pick<typeof db, 'select' | 'update'>
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
  positions,
  mapRecord,
  mapId,
  campaignLevel,
  database = db,
}: ResolveGroupParams): Promise<{
  participants: any[]
  battleLog: any[]
  pendingRequests: any[]
  turnOrder: any[]
  nextTurnIndex?: number
  nextRound?: number
  positionPatch?: Record<string, Vec3>
}> {
  return withCombatRecords(async () => {
  const groupData = groupState.data
  const claims: AreaAttackClaim[] = groupData.claims || []
  const originalTargetIds: string[] = groupData.originalTargetIds || []
  const npcTargetIds: string[] = groupData.npcTargetIds || []
  const playerTargetInfo: Record<string, any> = groupData.playerTargetInfo || {}

  let updatedParticipants = [...participants]
  let updatedBattleLog = [...battleLog]
  let updatedPendingRequests = [...pendingRequests]
  let updatedTurnOrder = [...turnOrder]
  let groupNextTurnIndex: number | undefined
  let groupNextRound: number | undefined
  const currentPositions = { ...positions }
  const positionPatch: Record<string, Vec3> = {}
  const rememberPositions = (patch?: Record<string, Vec3>) => {
    if (patch) { Object.assign(currentPositions, patch); Object.assign(positionPatch, patch) }
  }

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
      if (claim.interceptorHasCombatMonster && claim.damageDealt > 0) {
        updated.combatMonsterBonus = Math.min(
          p.totalHealth ?? claim.interceptorHealthStat ?? p.maxWounds,
          (p.combatMonsterBonus ?? 0) + claim.damageDealt
        )
      }
      if (claim.effectData) {
        updated.activeEffects = applyEffectToParticipant(p.activeEffects || [], claim.effectData, houseRules)
      }
      return updated
    }
    // The original target always takes a dodge penalty, even when claimed/thrown out of the AoE
    if (claimedTargetIds.has(p.id)) {
      return { ...p, dodgePenalty: (p.dodgePenalty ?? 0) + 1 }
    }
    return p
  })

  updatedParticipants = preserveEnduringSouls(updatedParticipants, participants)

  let claimFormChanged = false
  const autoDevolvedIds = new Set<string>()
  for (const claim of claims) {
    if (!claim.effectData || (claim.appliedEffectName !== 'Knockback' && claim.appliedEffectName !== 'Pull')) continue
    const before = updatedParticipants.find((participant: any) => participant.id === claim.interceptorParticipantId)
    const forced = await resolveInstantSupportEffect({ participants: updatedParticipants, battleLog: updatedBattleLog,
      pendingRequests: updatedPendingRequests, attackerParticipantId: groupData.attackerId,
      targetParticipantId: claim.interceptorParticipantId, attackDef: { effect: claim.appliedEffectName },
      distance: claim.effectData.potency, round, attackerName: groupData.attackerName, targetName: claim.interceptorName,
      encounterId, mapId, turnOrder: updatedTurnOrder, currentTurnIndex: groupNextTurnIndex ?? currentTurnIndex,
      campaignLevel, houseRules, deferPositionBroadcast: true,
      spatial: mapRecord ? { map: mapRecord, positions: currentPositions, digimonById: await loadParticipantDigimon(updatedParticipants) } : undefined,
    })
    updatedParticipants = forced.participants
    updatedBattleLog = forced.battleLog
    if (forced.turnOrder) updatedTurnOrder = forced.turnOrder
    if (forced.nextTurnIndex !== undefined) groupNextTurnIndex = forced.nextTurnIndex
    if (forced.nextRound !== undefined) groupNextRound = forced.nextRound
    rememberPositions(forced.positionPatch)
    const after = updatedParticipants.find((participant: any) => participant.id === claim.interceptorParticipantId)
    if (before && after && before.entityId !== after.entityId) {
      autoDevolvedIds.add(after.id)
      claimFormChanged = true
    }
  }
  for (const claim of claims) {
    if (claim.isSupportAttack || claim.damageDealt <= 0 || autoDevolvedIds.has(claim.interceptorParticipantId)) continue
    const interceptor = updatedParticipants.find((p: any) => p.id === claim.interceptorParticipantId)
    const autoDevolveLog = interceptor
      ? await autoDevolveParticipant(interceptor, updatedParticipants, { round, database })
      : null
    if (autoDevolveLog) {
      autoDevolvedIds.add(interceptor!.id)
      claimFormChanged = true
      updatedBattleLog.push(autoDevolveLog)
    }
  }

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

  // Enemy interceptors knocked out by the hit leave the encounter. An interceptor isn't the active
  // participant (the attacker is), so at most the turn index shifts.
  const knockedOutBefore = new Set(knockedOutEnemyIds(participants))
  const knockout = await resolveEnemyKnockouts(
    { participants: updatedParticipants, turnOrder: updatedTurnOrder, currentTurnIndex: groupNextTurnIndex ?? currentTurnIndex, round: groupNextRound ?? round },
    claims.map(c => c.interceptorParticipantId).filter(id => !knockedOutBefore.has(id) && !autoDevolvedIds.has(id)),
    { encounterId, houseRules, campaignLevel, mapId, gravity: mapRecord ? { map: mapRecord, positions: currentPositions } : undefined },
  )
  if (knockout.changed) {
    rememberPositions(knockout.positionPatch)
    updatedParticipants = knockout.participants
    updatedTurnOrder = knockout.turnOrder
    updatedBattleLog.push(...knockout.logEntries)
    if (knockout.turnAdvanced || knockout.currentTurnIndex !== currentTurnIndex) groupNextTurnIndex = knockout.currentTurnIndex
    if (knockout.round !== round) groupNextRound = knockout.round
  }

  // A shrinking or removed interceptor can change another target's Dodge bonus. Refresh
  // before uncovered targets roll, including the current claim's unbroadcast positions.
  if (claimFormChanged || knockout.changed) {
    updatedParticipants = await refreshGuidingLightForParticipants(encounterId, updatedParticipants, currentPositions)
  }

  // Targets that were not claimed by any interceptor
  const uncoveredIds = originalTargetIds.filter(id => !claimedTargetIds.has(id))

  // Uncovered player targets → resolve positive support via Health roll, otherwise dodge-roll
  const isSupportAttack = !!groupData.isSupportAttack
  let attackDef = groupData.attackData || null
  if (isSupportAttack && !attackDef?.effect) {
    const attacker = participants.find((p: any) => p.id === groupData.attackerId && p.type === 'digimon')
    const record = attacker ? await readCombatRecord('digimon', attacker.entityId,
      () => database.select().from(digimon).where(eq(digimon.id, attacker.entityId))) : null
    const storedAttack = record?.attacks?.find((a: any) => a.id === groupData.attackId)
    if (storedAttack) attackDef = { ...attackDef, ...storedAttack, effect: storedAttack.effect }
  }

  for (const targetId of uncoveredIds) {
    if (npcTargetIds.includes(targetId)) continue
    const info = playerTargetInfo[targetId]
    if (!info) continue
    const target = updatedParticipants.find((p: any) => p.id === targetId)
    let targetTamerId = 'GM'
    if (info.type === 'tamer') targetTamerId = info.entityId
    else if (info.partnerId) targetTamerId = info.partnerId

    const selectiveTargetingFilter = getSelectiveTargetingFilter(
      !!groupData.attackerHasSelectiveTargeting, true, originalTargetIds.length,
      !!groupData.attackerIsEnemy, !!target?.isEnemy,
    )

    const positiveResolutionType = getPositiveSupportResolutionType(isSupportAttack, attackDef)
    if (positiveResolutionType) {
      const supportParams = {
        participants: updatedParticipants,
        battleLog: updatedBattleLog,
        pendingRequests: updatedPendingRequests,
        attackerParticipantId: groupData.attackerId,
        targetParticipantId: targetId,
        attackDef,
        halfDodge: !!groupData.attackData?.orderModifiers?.halfDodge,
        accuracySuccesses: groupData.accuracySuccesses,
        accuracyDice: groupData.accuracyDice,
        round,
        attackerName: groupData.attackerName,
        targetName: info.name,
        encounterId,
        turnOrder: updatedTurnOrder,
        houseRules,
        isSignatureMove: groupData.isSignatureMove || false,
        batteryCount: groupData.batteryCount ?? 0,
        selectiveTargetingFilter,
      }
      const supportResult = positiveResolutionType === 'positive-auto'
        ? await resolvePositiveAuto(supportParams)
        : await resolvePositiveHealth(supportParams)

      updatedParticipants = supportResult.participants
      updatedBattleLog = supportResult.battleLog
      updatedPendingRequests = supportResult.pendingRequests
      if (supportResult.turnOrder) updatedTurnOrder = supportResult.turnOrder
      continue
    }

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
        totalTargetCount: originalTargetIds.length,
        // The cast these requests came from (the no-offer area path sets it too): the player page
        // defends everything one cast hit among a player's characters in a single panel.
        intercedeGroupId: groupData.intercedeGroupId,
      },
    })
  }

  // Uncovered NPC targets → auto-resolve
  for (const targetId of uncoveredIds) {
    if (!npcTargetIds.includes(targetId)) continue
    const target = updatedParticipants.find((p: any) => p.id === targetId)
    let resolvedName = targetId
    if (target?.type === 'digimon') {
      const dig = await readCombatRecord('digimon', target.entityId, () => database.select().from(digimon).where(eq(digimon.id, target.entityId)))
      resolvedName = resolveParticipantName(target, updatedParticipants, dig?.name || 'Digimon', target.isEnemy || false)
    } else if (target?.type === 'tamer') {
      const tam = await readCombatRecord('tamer', target.entityId, () => database.select().from(tamers).where(eq(tamers.id, target.entityId)))
      resolvedName = tam?.name || targetId
    }

    const selectiveTargetingFilter = getSelectiveTargetingFilter(
      !!groupData.attackerHasSelectiveTargeting, true, originalTargetIds.length,
      !!groupData.attackerIsEnemy, !!target?.isEnemy,
    )

    if (isSupportAttack && attackDef && getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support') !== 'instant') {
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
        selectiveTargetingFilter,
      }
      let supportResult: any = null
      if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
      else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
      else if (resolutionType === 'negative' || resolutionType === 'cleanse') supportResult = await resolveNegativeSupportNpc(supportParams)

      if (supportResult) {
        updatedParticipants = supportResult.participants
        updatedBattleLog = supportResult.battleLog
        updatedPendingRequests = supportResult.pendingRequests
        if (supportResult.turnOrder) updatedTurnOrder = supportResult.turnOrder
      }
    } else {
      const result = await resolveNpcAttack({
        pendingRequests: updatedPendingRequests, cleanseCastId: groupData.attackData?.cleanseCastId,
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
        currentTurnIndex: groupNextTurnIndex ?? currentTurnIndex,
        houseRules,
        clashAttack: groupData.clashAttack,
        strikeFast: !!groupData.attackData?.orderModifiers?.halfDodge,
        totalTargetCount: originalTargetIds.length,
        encounterId,
        mapRecord: mapRecord ?? undefined,
        participantPositions: currentPositions,
      })
      updatedParticipants = result.participants
      updatedBattleLog = result.battleLog
      if (result.turnOrder) updatedTurnOrder = result.turnOrder
      if (result.nextTurnIndex !== undefined) groupNextTurnIndex = result.nextTurnIndex
      if (result.nextRound !== undefined) groupNextRound = result.nextRound
      rememberPositions(result.positionPatch)
    }
  }

  // Remove the intercede-group-state tracking request
  updatedPendingRequests = updatedPendingRequests.filter((r: any) => r.id !== groupState.id)
  if (Object.keys(positionPatch).length > 0) {
    updatedParticipants = await refreshGuidingLightForParticipants(encounterId, updatedParticipants, currentPositions)
  }

  return {
    participants: updatedParticipants,
    battleLog: updatedBattleLog,
    pendingRequests: updatedPendingRequests,
    turnOrder: updatedTurnOrder,
    nextTurnIndex: groupNextTurnIndex,
    nextRound: groupNextRound,
    ...(Object.keys(positionPatch).length > 0 ? { positionPatch } : {}),
  }
  })
}
