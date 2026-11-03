import { eq } from 'drizzle-orm'
import { db, encounters, digimon, evolutionLines, campaigns, type Encounter } from '../../db'
import { getRoomSnapshot } from '../../utils/encounterRoom'
import { applyEndOfTurnGravity } from '../../utils/endOfTurnGravity'
import { applyRoundStartQualityTriggers } from '../../utils/roundStartQualityTriggers'
import { applyEncounterStartTriggers } from '../../utils/encounterStartTriggers'
import { applyGuidingLightAuras } from '../../utils/guidingLight'
import { applyTurnEndEffects, applyRoundEndEffects } from '../../utils/damageOverTime'
import type { EddySoulRules } from '../../../types'

type UpdateEncounterBody = Partial<Omit<Encounter, 'id' | 'createdAt' | 'updatedAt'>>

export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<UpdateEncounterBody>(event)

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Encounter ID is required',
    })
  }

  if ('participantPositions' in body || 'destructibleStates' in body) {
    throw createError({
      statusCode: 400,
      message: 'participantPositions and destructibleStates are managed via the encounter WebSocket and cannot be updated via PUT',
    })
  }

  // Check if encounter exists
  const [existing] = await db.select().from(encounters).where(eq(encounters.id, id))

  if (!existing) {
    throw createError({
      statusCode: 404,
      message: `Encounter with ID ${id} not found`,
    })
  }

  // Intercede opt-outs are written only by the intercede-optouts/intercede-skip endpoints (under a
  // row lock). Ignore them here so a client PUT built from an older copy can't revert them.
  const { intercedeOptOuts: _managedByOptOutEndpoints, ...updatableFields } = body

  const updateData: Partial<Encounter> = {
    ...updatableFields,
    updatedAt: new Date(),
  }

  // Parse existing round for Juggernaut comparison
  const existingRound = typeof existing.round === 'number' ? existing.round : 0
  const incomingRound = typeof body.round === 'number' ? body.round : existingRound
  const isNewRound = incomingRound > existingRound

  // Campaign level + house rules + EddySoul rules, used by end-of-turn gravity (Guiding Light
  // recompute), Poison/Burn, the combat-start triggers, and the Guiding Light combat-start pass below.
  const getCampaignRules = async () => {
    let campaignLevel: 'standard' | 'enhanced' | 'extreme' = 'standard'
    let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
    let eddySoulRules: EddySoulRules | undefined
    if (existing.campaignId) {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, existing.campaignId))
      if (campaign) {
        campaignLevel = campaign.level
        houseRules = (campaign.rulesSettings || {}).houseRules
        eddySoulRules = (campaign.rulesSettings || {}).eddySoulRules
      }
    }
    return { campaignLevel, houseRules, eddySoulRules }
  }

  if (body.participants) {
    let participants = body.participants as any[]

    // End-of-turn gravity: on a real turn advance (a new participant becomes active, or a new round),
    // drop airborne non-flyers and apply fall damage BEFORE the KO/auto-devolve checks below.
    const isTurnAdvance = typeof body.currentTurnIndex === 'number'
      && (body.currentTurnIndex !== existing.currentTurnIndex || incomingRound > existingRound)
    if (isTurnAdvance) {
      const { campaignLevel, houseRules } = await getCampaignRules()
      const gravity = await applyEndOfTurnGravity(id, (existing as any).mapId, participants, incomingRound, campaignLevel, houseRules)
      participants = gravity.participants
      if (gravity.logEntries.length > 0) {
        updateData.battleLog = [...(((body.battleLog as any[]) ?? existing.battleLog ?? []) as any[]), ...gravity.logEntries]
      }
    }

    // Poison/Burn (damage over time): first the turn that just ended (EddySoul turn-end Poison),
    // then the round that just ended. A turn has ended only when the active participant changes
    // (or the round advances) — rebuildTurnOrder() re-anchors on whoever is active, so adding or
    // re-sorting participants doesn't count — and the outgoing participant is still here (removing
    // the active participant ends nobody's turn). Runs before the KO/auto-devolve check below so a
    // partner knocked out by Poison devolves in this same request.
    if (existing.phase === 'combat') {
      const prevTurnOrder = (existing.turnOrder as string[]) || []
      const outgoingId = prevTurnOrder[existing.currentTurnIndex ?? 0]
      const nextTurnOrder = (body.turnOrder as string[] | undefined) ?? prevTurnOrder
      const incomingActiveId = typeof body.currentTurnIndex === 'number' ? nextTurnOrder[body.currentTurnIndex] : outgoingId
      const turnEnded = typeof body.currentTurnIndex === 'number'
        && !!outgoingId
        && (incomingActiveId !== outgoingId || isNewRound)
        && participants.some((p: any) => p.id === outgoingId)
      const roundEnded = isNewRound && existingRound >= 1

      if (turnEnded || roundEnded) {
        const { eddySoulRules } = await getCampaignRules()
        const dotLogEntries: any[] = []
        if (turnEnded) {
          const turnEnd = await applyTurnEndEffects({
            participants, endedParticipantId: outgoingId!, turnOrder: nextTurnOrder, round: existingRound, rules: eddySoulRules,
          })
          participants = turnEnd.participants
          dotLogEntries.push(...turnEnd.logEntries)
        }
        if (roundEnded) {
          const roundEnd = await applyRoundEndEffects({ participants, endingRound: existingRound, rules: eddySoulRules })
          participants = roundEnd.participants
          dotLogEntries.push(...roundEnd.logEntries)
        }
        if (dotLogEntries.length > 0) {
          updateData.battleLog = [...((updateData.battleLog ?? (body.battleLog as any[]) ?? existing.battleLog ?? []) as any[]), ...dotLogEntries]
        }
      }
    }

    // Auto-devolve any partner digimon KO'd by direct wound edit
    for (const p of participants) {
      if (p.currentWounds >= p.maxWounds && p.evolutionLineId && p.woundsHistory?.length > 0) {
        const previousState = p.woundsHistory.pop()
        if (previousState) {
          p.entityId = previousState.entityId
          p.maxWounds = previousState.maxWounds
          p.currentWounds = previousState.wounds !== undefined ? previousState.wounds : 0

          await db.update(evolutionLines).set({
            currentStageIndex: previousState.stageIndex,
            updatedAt: new Date(),
          }).where(eq(evolutionLines.id, p.evolutionLineId))

          const [newDigimon] = await db.select().from(digimon).where(eq(digimon.id, previousState.entityId))
          const devolvedQualities = newDigimon?.qualities || []
          const devolvedHasCombatMonster = (devolvedQualities as any[]).some((q: any) => q.id === 'combat-monster')
          p.combatMonsterBonus = devolvedHasCombatMonster
            ? Math.min(p.combatMonsterBonus ?? 0, previousState.totalHealth ?? previousState.maxWounds)
            : 0
        }
      }
    }

    // Round-start quality triggers: Juggernaut stacking bonus, Black/Brown Digizoid Armor resets
    if (isNewRound) {
      participants = await applyRoundStartQualityTriggers(participants)
    }

    updateData.participants = participants
  }

  // Encounter-start triggers: [Challenger] grants temp wounds (via Shield) to eligible partner
  // digimon the moment the encounter's phase transitions into 'combat' for the first time, and
  // again to any partner digimon added as reinforcements after combat has already begun.
  const isCombatStart = existing.phase !== 'combat' && body.phase === 'combat'
  const isReinforcement = !isCombatStart && existing.phase === 'combat' && !!body.participants

  if (isCombatStart || isReinforcement) {
    if (isCombatStart) {
      const { campaignLevel, houseRules } = await getCampaignRules()
      const basisParticipants = (updateData.participants as any[] | undefined) ?? (existing.participants as any[])
      updateData.participants = await applyEncounterStartTriggers(basisParticipants, campaignLevel, houseRules)
    } else {
      const existingIds = new Set(((existing.participants as any[]) || []).map((p) => p.id))
      const newParticipants = (updateData.participants as any[]).filter(
        (p) => p.type === 'digimon' && !p.isEnemy && !existingIds.has(p.id)
      )
      if (newParticipants.length > 0) {
        const { campaignLevel, houseRules } = await getCampaignRules()
        updateData.participants = await applyEncounterStartTriggers(
          updateData.participants as any[],
          campaignLevel,
          houseRules,
          new Set(newParticipants.map((p) => p.id))
        )
      }
    }

    // [Guiding Light]: apply the initial aura the moment combat begins, so allies already in
    // radius are buffed before anyone has to move (subsequent moves recompute it live over WS).
    if (isCombatStart) {
      const { campaignLevel, houseRules } = await getCampaignRules()
      const { participantPositions } = await getRoomSnapshot(id)
      const auraResult = await applyGuidingLightAuras(
        updateData.participants as any[],
        participantPositions,
        campaignLevel,
        houseRules
      )
      if (auraResult.changed) updateData.participants = auraResult.participants
    }
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, id))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, id))

  const room = await getRoomSnapshot(id)

  return {
    ...updated,
    participantPositions: room.participantPositions,
    destructibleStates: room.destructibleStates,
  }
})
