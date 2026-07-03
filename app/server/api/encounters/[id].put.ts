import { eq } from 'drizzle-orm'
import { db, encounters, digimon, evolutionLines, type Encounter } from '../../db'
import { getRoomSnapshot } from '../../utils/encounterRoom'
import { applyEndOfTurnGravity } from '../../utils/endOfTurnGravity'

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
    const participants = body.participants as any[]

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

    // Boss quality: Juggernaut — at the start of each new round, add stacking +2 to a random stat
    if (isNewRound) {
      const juggernauntStatMap: Record<number, 'accuracy' | 'damage' | 'dodge' | 'armor'> = {
        1: 'armor',    // 1: Health → nearest analog is armor for automation
        2: 'accuracy',
        3: 'damage',
        4: 'dodge',
        5: 'armor',
        6: 'damage',   // 6: Choose → default to damage
      }
      for (const p of participants) {
        if (p.type !== 'digimon') continue
        const [digi] = await db.select().from(digimon).where(eq(digimon.id, p.entityId))
        if (!digi) continue
        const quals = digi.qualities || []
        if (!(quals as any[]).some((q: any) => q.id === 'juggernaut')) continue
        const roll = Math.floor(Math.random() * 6) + 1
        const stat = juggernauntStatMap[roll]
        const prev = p.juggernauntBonuses ?? {}
        p.juggernauntBonuses = { ...prev, [stat]: ((prev as any)[stat] ?? 0) + 2 }
      }
    }

    updateData.participants = participants
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
