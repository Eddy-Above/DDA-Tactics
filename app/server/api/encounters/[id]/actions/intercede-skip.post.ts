import { eq } from 'drizzle-orm'
import { db, encounters, digimon, tamers, campaigns } from '../../../../db'
import { resolveNpcAttack } from '~/server/utils/resolveNpcAttack'
import { allAreaTargetsDecided, resolveAreaIntercedeGroup } from '~/server/utils/resolveAreaIntercedeGroup'
import { resolvePositiveAuto, resolvePositiveHealth, resolveNegativeSupportNpc, getPositiveSupportResolutionType } from '~/server/utils/resolveSupportAttack'
import { getEffectResolutionType } from '~/data/attackConstants'

interface IntercedeSkipBody {
  requestId: string
  optOut?: boolean // If true, permanently opt out of interceding for this target
  characterOptOuts?: string[] // GM-only: participant IDs to never intercede with for this target
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<IntercedeSkipBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.requestId) {
    throw createError({ statusCode: 400, message: 'requestId is required' })
  }

  // Fetch encounter
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  // Fetch campaign house rules
  let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
  if (encounter.campaignId) {
    const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, encounter.campaignId))
    if (campaign) {
      const rulesSettings = campaign.rulesSettings || {}
      houseRules = rulesSettings.houseRules
    }
  }

  let participants = encounter.participants
  let pendingRequests = encounter.pendingRequests
  let battleLog = encounter.battleLog
  let turnOrder = encounter.turnOrder

  // Find the request
  const request = pendingRequests.find((r: any) => r.id === body.requestId)
  if (!request || request.type !== 'intercede-offer') {
    throw createError({ statusCode: 404, message: 'Intercede offer not found' })
  }

  const isAreaAttack = !!request.data.isAreaAttack
  const intercedeGroupId = request.data.intercedeGroupId

  // Handle per-character opt-outs (GM-only): save which interceptors should never intercede for this target
  if (body.characterOptOuts && request.targetTamerId === 'GM') {
    const gmP = participants.find((p: any) => p.id === 'gm')
    if (gmP) {
      gmP.gmCharacterOptOuts = {
        ...(gmP.gmCharacterOptOuts || {}),
        [request.data.targetId]: body.characterOptOuts,
      }
    } else {
      participants.push({
        id: 'gm',
        type: 'gm',
        intercedeOptOuts: [],
        gmCharacterOptOuts: { [request.data.targetId]: body.characterOptOuts },
      } as any)
    }

    // Save participants but do NOT remove the pending request
    await db.update(encounters).set({
      participants,
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))

    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  }

  // Handle opt-out: save target(s) to tamer's or GM's intercedeOptOuts
  if (body.optOut) {
    const optOutTargets: string[] = isAreaAttack
      ? (request.data.areaTargetIds || [])
      : [request.data.targetId]

    if (request.targetTamerId === 'GM') {
      const gmP = participants.find((p: any) => p.id === 'gm')
      if (gmP) {
        gmP.intercedeOptOuts = [...(gmP.intercedeOptOuts || []), ...optOutTargets]
      } else {
        participants.push({ id: 'gm', type: 'gm', intercedeOptOuts: optOutTargets } as any)
      }
    } else {
      const tamerParticipant = participants.find(
        (p: any) => p.type === 'tamer' && p.entityId === request.targetTamerId
      )
      if (tamerParticipant) {
        tamerParticipant.intercedeOptOuts = [
          ...(tamerParticipant.intercedeOptOuts || []),
          ...optOutTargets,
        ]
      }
    }
  }

  // Remove this specific request
  pendingRequests = pendingRequests.filter((r: any) => r.id !== body.requestId)

  const updateData: any = {
    pendingRequests,
    updatedAt: new Date(),
  }

  if (isAreaAttack) {
    // All decisions are now deferred — check if this skip was the last one
    const groupState = pendingRequests.find(
      (r: any) => r.type === 'intercede-group-state' && r.data?.intercedeGroupId === intercedeGroupId
    )
    if (groupState && allAreaTargetsDecided(groupState, pendingRequests, intercedeGroupId)) {
      const resolved = await resolveAreaIntercedeGroup({
        groupState,
        participants,
        battleLog,
        pendingRequests,
        turnOrder,
        round: encounter.round || 0,
        currentTurnIndex: encounter.currentTurnIndex || 0,
        houseRules,
        encounterId: encounterId!,
      })
      participants = resolved.participants
      battleLog = resolved.battleLog
      pendingRequests = resolved.pendingRequests
      turnOrder = resolved.turnOrder
      if (resolved.nextTurnIndex !== undefined) updateData.currentTurnIndex = resolved.nextTurnIndex
      if (resolved.nextRound !== undefined) updateData.round = resolved.nextRound
    }

    updateData.pendingRequests = pendingRequests
    updateData.participants = participants
    updateData.battleLog = battleLog
    if (turnOrder) updateData.turnOrder = turnOrder
  } else {
    // Single-target path: check if all eligible tamers have now skipped
    const remainingGroupRequests = pendingRequests.filter((r: any) => r.data?.intercedeGroupId === intercedeGroupId)

    // If all skipped, resolve the attack
    if (remainingGroupRequests.length === 0) {
      const target = participants.find((p: any) => p.id === request.data.targetId)
      if (target) {
        // Check if target is player-controlled or NPC
        let isPlayerTarget = false
        if (target.type === 'tamer') {
          isPlayerTarget = true
        } else if (target.type === 'digimon') {
          const [dig] = await db.select().from(digimon).where(eq(digimon.id, target.entityId))
          isPlayerTarget = !!dig?.partnerId
        }

        const isSupportAttack = request.data.isSupportAttack || false
        const attackDef = request.data.attackData || null

        if (isPlayerTarget) {
          const positiveResolutionType = getPositiveSupportResolutionType(isSupportAttack, attackDef)
          if (positiveResolutionType) {
            const supportParams = {
              participants,
              battleLog,
              pendingRequests,
              attackerParticipantId: request.data.attackerId,
              targetParticipantId: request.data.targetId,
              attackDef,
              accuracySuccesses: request.data.accuracySuccesses,
              accuracyDice: request.data.accuracyDice,
              round: encounter.round || 0,
              attackerName: request.data.attackerName,
              targetName: request.data.targetName,
              encounterId: encounterId!,
              turnOrder,
              houseRules,
              isSignatureMove: request.data.isSignatureMove || false,
              batteryCount: request.data.batteryCount ?? 0,
            }
            const supportResult = positiveResolutionType === 'positive-auto'
              ? await resolvePositiveAuto(supportParams)
              : await resolvePositiveHealth(supportParams)

            updateData.participants = supportResult.participants
            updateData.battleLog = supportResult.battleLog
            updateData.pendingRequests = supportResult.pendingRequests
            if (supportResult.turnOrder) updateData.turnOrder = supportResult.turnOrder
          } else {
          // Player target — create dodge request
          let targetTamerId = 'GM'
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
            targetParticipantId: request.data.targetId,
            timestamp: new Date().toISOString(),
            data: {
              attackerName: request.data.attackerName,
              targetName: request.data.targetName,
              attackName: request.data.attackName || 'Attack',
              accuracySuccesses: request.data.accuracySuccesses,
              accuracyDice: request.data.accuracyDice,
              attackId: request.data.attackId,
              attackData: request.data.attackData,
              attackerEntityId: participants.find((p: any) => p.id === request.data.attackerId)?.entityId,
              attackerParticipantId: request.data.attackerId,
              targetEntityId: target.entityId,
              dodgePenalty: target.dodgePenalty ?? 0,
              // Pass through bolster bonuses from intercede-offer
              bolstered: request.data.bolstered || false,
              bolsterType: request.data.bolsterType || null,
              bolsterDamageBonus: request.data.bolsterDamageBonus || 0,
              bolsterBitCpuBonus: request.data.bolsterBitCpuBonus || 0,
              // Support attack flag — downstream handlers skip damage
              isSupportAttack: request.data.isSupportAttack || false,
            },
          }

          const updatedRequests = [...pendingRequests, dodgeRequest]
          updateData.pendingRequests = updatedRequests

          updateData.participants = participants
          }
        } else {
          // NPC target — auto-resolve based on attack type
          if (isSupportAttack && attackDef) {
            const resolutionType = getEffectResolutionType(attackDef.effect, attackDef.tags || [], 'support')
            const supportParams = {
              participants,
              battleLog,
              pendingRequests,
              attackerParticipantId: request.data.attackerId,
              targetParticipantId: request.data.targetId,
              attackDef,
              accuracySuccesses: request.data.accuracySuccesses,
              accuracyDice: request.data.accuracyDice,
              round: encounter.round || 0,
              attackerName: request.data.attackerName,
              targetName: request.data.targetName,
              encounterId: encounterId!,
              turnOrder,
              houseRules,
              isSignatureMove: request.data.isSignatureMove || false,
              batteryCount: request.data.batteryCount ?? 0,
            }
            let supportResult: any = null
            if (resolutionType === 'positive-auto') supportResult = await resolvePositiveAuto(supportParams)
            else if (resolutionType === 'positive-health') supportResult = await resolvePositiveHealth(supportParams)
            else if (resolutionType === 'negative') supportResult = await resolveNegativeSupportNpc(supportParams)

            if (supportResult) {
              updateData.participants = supportResult.participants
              updateData.battleLog = supportResult.battleLog
              updateData.pendingRequests = supportResult.pendingRequests
              if (supportResult.turnOrder) updateData.turnOrder = supportResult.turnOrder
            }
          } else {
            // Damage attack — auto-resolve (roll dodge, calculate damage)
            const result = await resolveNpcAttack({
              participants, battleLog,
              attackerParticipantId: request.data.attackerId,
              targetParticipantId: request.data.targetId,
              attackId: request.data.attackId,
              accuracySuccesses: request.data.accuracySuccesses,
              accuracyDice: request.data.accuracyDice,
              round: encounter.round || 0,
              attackerName: request.data.attackerName,
              targetName: request.data.targetName,
              turnOrder,
              currentTurnIndex: encounter.currentTurnIndex || 0,
            })

            updateData.participants = result.participants
            updateData.battleLog = result.battleLog
            if (result.turnOrder) {
              updateData.turnOrder = result.turnOrder
            }
            if (result.nextTurnIndex !== undefined) updateData.currentTurnIndex = result.nextTurnIndex
            if (result.nextRound !== undefined) updateData.round = result.nextRound
          }
        }
      }
    } else {
      // Not all skipped yet, but still save participant changes (opt-out)
      updateData.participants = participants
    }
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))

  if (!updated) {
    throw createError({ statusCode: 500, message: 'Failed to retrieve encounter after update' })
  }

  return updated
})
