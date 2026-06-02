import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'
import { getDigimonDerivedStats } from '../../../../utils/resolveSupportAttack'

interface DataAbsorbBody {
  participantId: string
  extraActions?: number  // 0 = BIT×2, 1 = BIT×4, 2 = BIT×6
}

const parseJsonField = (field: any): any[] => {
  if (!field) return []
  if (Array.isArray(field)) return field
  if (typeof field === 'string') { try { return JSON.parse(field) } catch { return [] } }
  return []
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<DataAbsorbBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body.participantId) {
    throw createError({ statusCode: 400, message: 'participantId is required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  let participants = parseJsonField(encounter.participants)
  const battleLog = parseJsonField(encounter.battleLog)

  const participant = participants.find((p: any) => p.id === body.participantId)
  if (!participant) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }
  if (participant.type !== 'digimon') {
    throw createError({ statusCode: 400, message: 'Data Absorb only applies to digimon' })
  }

  const [digi] = await db.select().from(digimon).where(eq(digimon.id, participant.entityId))
  if (!digi) {
    throw createError({ statusCode: 404, message: 'Digimon not found' })
  }

  const quals = typeof digi.qualities === 'string' ? JSON.parse(digi.qualities) : (digi.qualities || [])
  if (!(quals as any[]).some((q: any) => q.id === 'data-absorb')) {
    throw createError({ statusCode: 400, message: 'Digimon does not have Data Absorb' })
  }

  const extraActions = body.extraActions ?? 0
  const actionCost = 1 + extraActions
  if ((participant.actionsRemaining?.simple ?? 0) < actionCost) {
    throw createError({ statusCode: 400, message: 'Not enough Simple Actions' })
  }

  const toggling = !participant.dataAbsorbActive
  const derived = toggling ? await getDigimonDerivedStats(participant.entityId) : null
  const bitMultiplier = 2 + extraActions * 2  // 2, 4, or 6

  participants = participants.map((p: any) => {
    if (p.id !== body.participantId) return p
    return {
      ...p,
      dataAbsorbActive: toggling,
      dataAbsorbHealAmount: toggling ? (derived?.bit ?? 0) * bitMultiplier : undefined,
      actionsRemaining: {
        ...p.actionsRemaining,
        simple: (p.actionsRemaining?.simple ?? 0) - actionCost,
      },
      // When activating, movement is 0 (GM enforces); when deactivating, restored by GM
    }
  })

  const logEntry = {
    id: `log-${Date.now()}-data-absorb`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: participant.id,
    actorName: digi.name || 'Digimon',
    action: toggling
      ? `activates Data Absorb (BIT×${bitMultiplier} healing per round, movement = 0)`
      : 'deactivates Data Absorb',
    target: null,
    result: toggling
      ? `Will heal ${(derived?.bit ?? 0) * bitMultiplier} wounds at end of each round.`
      : 'Movement restored.',
    damage: null,
    effects: ['Data Absorb'],
  }
  battleLog.push(logEntry)

  await db.update(encounters).set({
    participants: JSON.stringify(participants),
    battleLog: JSON.stringify(battleLog),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    battleLog: parseJsonField(updated.battleLog),
  }
})
