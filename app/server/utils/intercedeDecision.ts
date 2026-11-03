import { eq } from 'drizzle-orm'
import { db, encounters, digimon, campaigns } from '../db'
import { getRoomPositions, broadcastPositionPatch } from '~/server/utils/encounterRoom'
import { applyGuidingLightAuras } from '~/server/utils/guidingLight'
import { loadEncounterMap } from '~/server/utils/combatSpatial'
import { resolveInstantSupportEffect } from '~/server/utils/pushPull'
import { resolveNpcAttack } from '~/server/utils/resolveNpcAttack'
import { allAreaTargetsDecided, resolveAreaIntercedeGroup } from '~/server/utils/resolveAreaIntercedeGroup'
import { resolvePositiveAuto, resolvePositiveHealth, resolveNegativeSupportNpc, getPositiveSupportResolutionType } from '~/server/utils/resolveSupportAttack'
import { getEffectResolutionType } from '~/data/attackConstants'
import { GM_OPT_OUT_OWNER } from '~/utils/intercedeOptOuts'

// What happens once an intercede-offer is answered without anyone stepping in — a Skip, or an
// opt-out clearing it. Shared by intercede-skip and intercede-optouts so an opt-out can clear
// every prompt already queued for that target, not just the one that was clicked.

export interface IntercedeDecisionContext {
  encounterId: string
  mapId: string | null
  houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  campaignLevel: 'standard' | 'enhanced' | 'extreme'
  mapRecord: any
  participantPositions: Record<string, { x: number; y: number; z: number }>
}

export interface IntercedeDecisionState {
  participants: any[]
  pendingRequests: any[]
  battleLog: any[]
  turnOrder: any[]
  currentTurnIndex: number
  round: number
  /** An attack was resolved, so participants/battleLog/turnOrder must be persisted too. */
  resolved: boolean
}

export async function loadIntercedeDecisionContext(encounter: any): Promise<IntercedeDecisionContext> {
  const encounterId = encounter.id as string

  // Map + positions for push/pull displacement (only if this encounter uses a map)
  const participantPositions = await getRoomPositions(encounterId)
  const mapRecord = (encounter.mapId && Object.keys(participantPositions).length > 0)
    ? await loadEncounterMap(encounter.mapId)
    : null

  let houseRules: IntercedeDecisionContext['houseRules']
  let campaignLevel: IntercedeDecisionContext['campaignLevel'] = 'standard'
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      houseRules = (campaign.rulesSettings || {}).houseRules
      if (campaign.level) campaignLevel = campaign.level
    }
  }

  return { encounterId, mapId: encounter.mapId ?? null, houseRules, campaignLevel, mapRecord, participantPositions }
}

export function initialDecisionState(encounter: any): IntercedeDecisionState {
  return {
    participants: encounter.participants || [],
    pendingRequests: encounter.pendingRequests || [],
    battleLog: encounter.battleLog || [],
    turnOrder: encounter.turnOrder || [],
    currentTurnIndex: encounter.currentTurnIndex || 0,
    round: encounter.round || 0,
    resolved: false,
  }
}

/**
 * Writes back what the decision changed. pendingRequests always changes; the rest is only
 * written when an attack actually resolved, so a plain skip doesn't rewrite (and risk
 * reverting) participants another request is updating at the same moment.
 */
export async function persistDecisionState(encounter: any, state: IntercedeDecisionState): Promise<void> {
  const updateData: any = { pendingRequests: state.pendingRequests, updatedAt: new Date() }
  if (state.resolved) {
    updateData.participants = state.participants
    updateData.battleLog = state.battleLog
    if (state.turnOrder) updateData.turnOrder = state.turnOrder
  }
  if (state.currentTurnIndex !== (encounter.currentTurnIndex || 0)) updateData.currentTurnIndex = state.currentTurnIndex
  if (state.round !== (encounter.round || 0)) updateData.round = state.round
  await db.update(encounters).set(updateData).where(eq(encounters.id, encounter.id))
}

/**
 * Call after `removedOffer` has been taken out of (or trimmed in) `state.pendingRequests`.
 * If nobody is left deciding on its attack, resolves it: area attacks via the group resolver,
 * single-target attacks with a dodge-roll (player target), a positive-support auto-resolve, or
 * an NPC auto-resolve.
 */
export async function resolveIntercedeGroupIfDecided(
  ctx: IntercedeDecisionContext,
  state: IntercedeDecisionState,
  removedOffer: any,
): Promise<IntercedeDecisionState> {
  const { encounterId, houseRules, campaignLevel, mapRecord, participantPositions } = ctx
  const data = removedOffer.data || {}
  const intercedeGroupId = data.intercedeGroupId
  let { participants, pendingRequests, battleLog, turnOrder, currentTurnIndex, round } = state

  if (data.isAreaAttack) {
    // All area decisions are deferred — resolve once nobody covers any remaining target
    const groupState = pendingRequests.find(
      (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
    )
    if (!groupState || !allAreaTargetsDecided(groupState, pendingRequests, intercedeGroupId)) return state

    const resolved = await resolveAreaIntercedeGroup({
      groupState,
      participants,
      battleLog,
      pendingRequests,
      turnOrder,
      round,
      currentTurnIndex,
      houseRules,
      encounterId,
    })
    return {
      participants: resolved.participants,
      battleLog: resolved.battleLog,
      pendingRequests: resolved.pendingRequests,
      turnOrder: resolved.turnOrder,
      currentTurnIndex: resolved.nextTurnIndex ?? currentTurnIndex,
      round: resolved.nextRound ?? round,
      resolved: true,
    }
  }

  // Single-target: wait until every offer in the group has been answered
  if (pendingRequests.some((r: any) => r.data?.intercedeGroupId === intercedeGroupId)) return state

  const target = participants.find((p: any) => p.id === data.targetId)
  if (!target) return state

  // Check if target is player-controlled or NPC
  let isPlayerTarget = false
  if (target.type === 'tamer') {
    isPlayerTarget = true
  } else if (target.type === 'digimon') {
    const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
    isPlayerTarget = !!dig?.partnerId
  }

  const isSupportAttack = data.isSupportAttack || false
  const attackDef = data.attackData || null
  const supportParams = {
    participants,
    battleLog,
    pendingRequests,
    attackerParticipantId: data.attackerId,
    targetParticipantId: data.targetId,
    attackDef,
    accuracySuccesses: data.accuracySuccesses,
    accuracyDice: data.accuracyDice,
    round,
    attackerName: data.attackerName,
    targetName: data.targetName,
    encounterId,
    turnOrder,
    houseRules,
    isSignatureMove: data.isSignatureMove || false,
    batteryCount: data.batteryCount ?? 0,
  }
  const withSupportResult = (supportResult: any): IntercedeDecisionState => ({
    participants: supportResult.participants,
    battleLog: supportResult.battleLog,
    pendingRequests: supportResult.pendingRequests,
    turnOrder: supportResult.turnOrder || turnOrder,
    currentTurnIndex,
    round,
    resolved: true,
  })

  if (isPlayerTarget) {
    const positiveResolutionType = getPositiveSupportResolutionType(isSupportAttack, attackDef)
    if (positiveResolutionType) {
      const supportResult = positiveResolutionType === 'positive-auto'
        ? await resolvePositiveAuto(supportParams)
        : await resolvePositiveHealth(supportParams)
      return withSupportResult(supportResult)
    }

    // Player target — create dodge request
    let targetTamerId = GM_OPT_OUT_OWNER
    if (target.type === 'tamer') {
      targetTamerId = target.entityId
    } else if (target.type === 'digimon') {
      const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
      if (dig?.partnerId) targetTamerId = dig.partnerId
    }

    const dodgeRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      type: 'dodge-roll',
      targetTamerId,
      targetParticipantId: data.targetId,
      timestamp: new Date().toISOString(),
      data: {
        attackerName: data.attackerName,
        targetName: data.targetName,
        attackName: data.attackName || 'Attack',
        accuracySuccesses: data.accuracySuccesses,
        accuracyDice: data.accuracyDice,
        attackId: data.attackId,
        attackData: data.attackData,
        attackerEntityId: participants.find((p: any) => p.id === data.attackerId)?.entityId,
        attackerParticipantId: data.attackerId,
        targetEntityId: target.entityId,
        dodgePenalty: target.dodgePenalty ?? 0,
        // Pass through bolster bonuses from intercede-offer
        bolstered: data.bolstered || false,
        bolsterType: data.bolsterType || null,
        bolsterDamageBonus: data.bolsterDamageBonus || 0,
        bolsterBitCpuBonus: data.bolsterBitCpuBonus || 0,
        // Support attack flag — downstream handlers skip damage
        isSupportAttack: data.isSupportAttack || false,
      },
    }
    // Only pendingRequests changes — keep `resolved` as-is so participants aren't rewritten
    return { ...state, pendingRequests: [...pendingRequests, dodgeRequest] }
  }

  // NPC target — auto-resolve based on attack type
  if (isSupportAttack && attackDef) {
    const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')
    let supportResult: any = null
    if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
    else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
    else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)
    else if (resolutionType === 'instant') supportResult = await resolveInstantSupportEffect({ ...supportParams, mapId: ctx.mapId as any, campaignLevel })
    return supportResult ? withSupportResult(supportResult) : state
  }

  // Damage attack — auto-resolve (roll dodge, calculate damage)
  const result = await resolveNpcAttack({
    participants, battleLog,
    attackerParticipantId: data.attackerId,
    targetParticipantId: data.targetId,
    attackId: data.attackId,
    accuracySuccesses: data.accuracySuccesses,
    accuracyDice: data.accuracyDice,
    round,
    attackerName: data.attackerName,
    targetName: data.targetName,
    turnOrder,
    currentTurnIndex,
    mapRecord: mapRecord ?? undefined,
    participantPositions: participantPositions ?? undefined,
  })

  if (result.positionPatch) {
    await broadcastPositionPatch(encounterId, result.positionPatch)
    // [Guiding Light]: fold the recompute into `result.participants`, which the caller's
    // single persist still has to write (a standalone recompute here would race that write).
    const positions = await getRoomPositions(encounterId)
    const auraResult = await applyGuidingLightAuras(result.participants, positions, campaignLevel, houseRules)
    if (auraResult.changed) result.participants = auraResult.participants
  }

  return {
    participants: result.participants,
    battleLog: result.battleLog,
    pendingRequests,
    turnOrder: result.turnOrder || turnOrder,
    currentTurnIndex: result.nextTurnIndex ?? currentTurnIndex,
    round: result.nextRound ?? round,
    resolved: true,
  }
}

/**
 * Removes opted-out targets from an offer. Returns the offer unchanged when none of its targets
 * are opted out, a trimmed copy when some are (area attacks only), or null when nothing is left.
 */
function stripOptedOutTargets(offer: any, optedOut: Set<string>): any | null {
  const d = offer.data || {}
  if (!d.isAreaAttack) return optedOut.has(d.targetId) ? null : offer

  if (offer.targetTamerId === GM_OPT_OUT_OWNER) {
    let changed = false
    const npcAreaEligibility: Record<string, string[]> = {}
    for (const [npcId, targets] of Object.entries((d.npcAreaEligibility || {}) as Record<string, string[]>)) {
      const remaining = targets.filter((tid) => !optedOut.has(tid))
      if (remaining.length !== targets.length) changed = true
      if (remaining.length > 0) npcAreaEligibility[npcId] = remaining
    }
    if (!changed) return offer
    if (Object.keys(npcAreaEligibility).length === 0) return null
    return { ...offer, data: { ...d, npcAreaEligibility, gmAreaTargetIds: [...new Set(Object.values(npcAreaEligibility).flat())] } }
  }

  const tamerAreaTargetIds: string[] = (d.tamerAreaTargetIds || []).filter((tid: string) => !optedOut.has(tid))
  const digimonAreaTargetIds: string[] = (d.digimonAreaTargetIds || []).filter((tid: string) => !optedOut.has(tid))
  if (tamerAreaTargetIds.length === (d.tamerAreaTargetIds || []).length &&
      digimonAreaTargetIds.length === (d.digimonAreaTargetIds || []).length) return offer
  if (tamerAreaTargetIds.length === 0 && digimonAreaTargetIds.length === 0) return null
  return { ...offer, data: { ...d, tamerAreaTargetIds, digimonAreaTargetIds } }
}

/**
 * Clears every intercede prompt already queued for `ownerId` (a tamer entity id or 'GM') about
 * a target they've opted out of: single-target offers are dropped, area offers lose just those
 * targets (dropped if none remain). Each attack whose last open decision this was resolves.
 */
export async function pruneOptedOutOffers(
  ctx: IntercedeDecisionContext,
  state: IntercedeDecisionState,
  ownerId: string,
  optedOutIds: string[],
): Promise<IntercedeDecisionState> {
  const optedOut = new Set(optedOutIds)
  if (optedOut.size === 0) return state

  const offerIds = state.pendingRequests
    .filter((r: any) => r.type === 'intercede-offer' && r.targetTamerId === ownerId)
    .map((r: any) => r.id)

  for (const offerId of offerIds) {
    // An earlier resolution in this loop may already have removed it
    const offer = state.pendingRequests.find((r: any) => r.id === offerId)
    if (!offer) continue
    const pruned = stripOptedOutTargets(offer, optedOut)
    if (pruned === offer) continue

    state = {
      ...state,
      pendingRequests: pruned
        ? state.pendingRequests.map((r: any) => (r.id === offerId ? pruned : r))
        : state.pendingRequests.filter((r: any) => r.id !== offerId),
    }
    state = await resolveIntercedeGroupIfDecided(ctx, state, offer)
  }
  return state
}
