import { eq } from 'drizzle-orm'
import { db, encounters, digimon, evolutionLines, campaigns, type Encounter } from '../../db'
import { getRoomSnapshot } from '../../utils/encounterRoom'
import { applyEndOfTurnGravity } from '../../utils/endOfTurnGravity'
import { applyRoundStartQualityTriggers } from '../../utils/roundStartQualityTriggers'
import { applyEncounterStartTriggers } from '../../utils/encounterStartTriggers'
import { applyGuidingLightAuras } from '../../utils/guidingLight'

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

  const updateData: Partial<Encounter> = {
    ...body,
    updatedAt: new Date(),
  }

  // Parse existing round for Juggernaut comparison
  const existingRound = typeof existing.round === 'number' ? existing.round : 0
  const incomingRound = typeof body.round === 'number' ? body.round : existingRound
  const isNewRound = incomingRound > existingRound

  // Campaign level + house rules, used by end-of-turn gravity (Guiding Light recompute), the
  // combat-start triggers, and the Guiding Light combat-start pass below.
  const getCampaignRules = async () => {
    let campaignLevel: 'standard' | 'enhanced' | 'extreme' = 'standard'
    let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
    if (existing.campaignId) {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, existing.campaignId))
      if (campaign) {
        campaignLevel = campaign.level
        houseRules = (campaign.rulesSettings || {}).houseRules
      }
    }
    return { campaignLevel, houseRules }
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
