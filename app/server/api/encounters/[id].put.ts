import { eq } from 'drizzle-orm'
import { db, encounters, digimon, evolutionLines, type Encounter } from '../../db'

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

  return updated
})
