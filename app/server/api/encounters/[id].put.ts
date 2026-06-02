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

  // Update encounter - explicitly serialize JSON fields
  const updateData: any = {
    ...body,
    updatedAt: new Date(),
  }

  // Parse existing round for Juggernaut comparison
  const existingRound = typeof existing.round === 'number' ? existing.round : 0
  const incomingRound = typeof body.round === 'number' ? body.round : existingRound
  const isNewRound = incomingRound > existingRound

  // Drizzle's text mode:json isn't working properly, so manually serialize
  if (body.participants) {
    const participants = Array.isArray(body.participants)
      ? body.participants
      : JSON.parse(body.participants as any)

    // Auto-devolve any partner digimon KO'd by direct wound edit
    for (const p of participants) {
      if (p.currentWounds >= p.maxWounds && p.evolutionLineId && p.woundsHistory?.length > 0) {
        const rawState = p.woundsHistory.pop()
        const previousState = typeof rawState === 'string' ? JSON.parse(rawState) : rawState
        if (previousState) {
          p.entityId = previousState.entityId
          p.maxWounds = previousState.maxWounds
          p.currentWounds = previousState.wounds !== undefined ? previousState.wounds : 0

          await db.update(evolutionLines).set({
            currentStageIndex: previousState.stageIndex,
            updatedAt: new Date(),
          }).where(eq(evolutionLines.id, p.evolutionLineId))

          const [newDigimon] = await db.select().from(digimon).where(eq(digimon.id, previousState.entityId))
          const devolvedQualities = typeof newDigimon?.qualities === 'string'
            ? JSON.parse(newDigimon.qualities) : (newDigimon?.qualities || [])
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
        const quals = typeof digi.qualities === 'string' ? JSON.parse(digi.qualities) : (digi.qualities || [])
        if (!(quals as any[]).some((q: any) => q.id === 'juggernaut')) continue
        const roll = Math.floor(Math.random() * 6) + 1
        const stat = juggernauntStatMap[roll]
        const prev = p.juggernauntBonuses ?? {}
        p.juggernauntBonuses = { ...prev, [stat]: ((prev as any)[stat] ?? 0) + 2 }
      }
    }

    updateData.participants = JSON.stringify(participants)
  }
  if (body.turnOrder) {
    updateData.turnOrder = JSON.stringify(body.turnOrder)
  }
  if (body.battleLog) {
    updateData.battleLog = JSON.stringify(body.battleLog)
  }
  if (body.hazards) {
    updateData.hazards = JSON.stringify(body.hazards)
  }
  if (body.pendingRequests) {
    updateData.pendingRequests = JSON.stringify(body.pendingRequests)
  }
  if (body.requestResponses) {
    updateData.requestResponses = JSON.stringify(body.requestResponses)
  }
  if ((body as any).mapId !== undefined) {
    updateData.mapId = (body as any).mapId
  }
  if ((body as any).participantPositions !== undefined) {
    updateData.participantPositions = JSON.stringify((body as any).participantPositions)
  }
  if ((body as any).destructibleStates !== undefined) {
    updateData.destructibleStates = JSON.stringify((body as any).destructibleStates)
  }

  await db.update(encounters).set(updateData).where(eq(encounters.id, id))

  // Return updated encounter
  const [updated] = await db.select().from(encounters).where(eq(encounters.id, id))

  // Explicitly parse JSON fields in case they're stored as strings
  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try {
        return JSON.parse(field)
      }
      catch {
        return []
      }
    }
    return []
  }

  const parseJsonObj = (field: any) => {
    if (!field) return {}
    if (typeof field === 'object' && !Array.isArray(field)) return field
    if (typeof field === 'string') { try { return JSON.parse(field) } catch { return {} } }
    return {}
  }

  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    hazards: parseJsonField(updated.hazards),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
    participantPositions: parseJsonObj((updated as any).participantPositions),
    destructibleStates: parseJsonField((updated as any).destructibleStates),
  }
})
