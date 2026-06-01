import { eq } from 'drizzle-orm'
import { db, encounters, tamers } from '../../../../db'

interface GrantInspirationBody {
  participantId: string
  amount: number
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<GrantInspirationBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }

  if (!body.participantId || body.amount === undefined) {
    throw createError({ statusCode: 400, message: 'participantId and amount are required' })
  }

  if (body.amount < 1) {
    throw createError({ statusCode: 400, message: 'amount must be at least 1' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: `Encounter ${encounterId} not found` })
  }

  const parseJsonField = (field: any) => {
    if (!field) return []
    if (Array.isArray(field)) return field
    if (typeof field === 'string') {
      try { return JSON.parse(field) } catch { return [] }
    }
    return []
  }

  const participants: any[] = parseJsonField(encounter.participants)
  const battleLog: any[] = parseJsonField(encounter.battleLog)

  const participant = participants.find((p: any) => p.id === body.participantId)
  if (!participant) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  if (participant.type !== 'tamer') {
    throw createError({ statusCode: 403, message: 'Only tamers have Inspiration' })
  }

  const newInspiration = (participant.currentInspiration ?? 0) + body.amount

  const updatedParticipants = participants.map((p: any) =>
    p.id === body.participantId
      ? { ...p, currentInspiration: newInspiration }
      : p,
  )

  // Sync grant to tamer DB record
  const [tamer] = await db.select().from(tamers).where(eq(tamers.id, participant.entityId))
  if (tamer) {
    await db.update(tamers).set({
      grantedInspiration: (tamer.grantedInspiration ?? 0) + body.amount,
      updatedAt: new Date(),
    }).where(eq(tamers.id, tamer.id))
  }

  const participantName = tamer?.name ?? 'Tamer'
  const newLog = {
    id: `log-${Date.now()}-grant-inspiration`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: body.participantId,
    actorName: participantName,
    action: 'Inspiration Granted',
    target: null,
    result: `GM grants ${body.amount} Inspiration to ${participantName} (${newInspiration} total)`,
    damage: null,
    effects: ['Inspiration', 'Granted'],
  }

  await db.update(encounters).set({
    participants: JSON.stringify(updatedParticipants) as any,
    battleLog: JSON.stringify([...battleLog, newLog]) as any,
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  return {
    ...updated,
    participants: parseJsonField(updated.participants),
    turnOrder: parseJsonField(updated.turnOrder),
    battleLog: parseJsonField(updated.battleLog),
    hazards: parseJsonField(updated.hazards),
    pendingRequests: parseJsonField(updated.pendingRequests),
    requestResponses: parseJsonField(updated.requestResponses),
  }
})
