import { eq } from 'drizzle-orm'
import { db, encounters, digimon, evolutionLines, campaigns, type Encounter } from '../../db'
import { getRoomSnapshot } from '../../utils/encounterRoom'
import { applyEndOfTurnGravity } from '../../utils/endOfTurnGravity'
import { applyRoundStartQualityTriggers } from '../../utils/roundStartQualityTriggers'
import { applyEncounterStartTriggers } from '../../utils/encounterStartTriggers'

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

  if (body.participants) {
    let participants = body.participants as any[]

    // End-of-turn gravity: on a real turn advance (a new participant becomes active, or a new round),
    // drop airborne non-flyers and apply fall damage BEFORE the KO/auto-devolve checks below.
    const isTurnAdvance = typeof body.currentTurnIndex === 'number'
      && (body.currentTurnIndex !== existing.currentTurnIndex || incomingRound > existingRound)
    if (isTurnAdvance) {
      const gravity = await applyEndOfTurnGravity(id, (existing as any).mapId, participants, incomingRound)
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
  // digimon the moment the encounter's phase transitions into 'combat' for the first time.
  const isCombatStart = existing.phase !== 'combat' && body.phase === 'combat'
  if (isCombatStart) {
    let campaignLevel: 'standard' | 'enhanced' | 'extreme' = 'standard'
    let houseRules: { stunMaxDuration1?: boolean; maxTempWoundsRule?: boolean } | undefined
    if (existing.campaignId) {
      const [campaign] = await db.select().from(campaigns).where(eq(campaigns.id, existing.campaignId))
      if (campaign) {
        campaignLevel = campaign.level
        houseRules = (campaign.rulesSettings || {}).houseRules
      }
    }
    const basisParticipants = (updateData.participants as any[] | undefined) ?? (existing.participants as any[])
    updateData.participants = await applyEncounterStartTriggers(basisParticipants, campaignLevel, houseRules)
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
