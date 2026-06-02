import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'

interface TormentorCheckBody {
  bossParticipantId: string
  failingParticipantIds: string[]
}

const parseJsonField = (field: any): any[] => {
  if (!field) return []
  if (Array.isArray(field)) return field
  if (typeof field === 'string') { try { return JSON.parse(field) } catch { return [] } }
  return []
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<TormentorCheckBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body.bossParticipantId || !Array.isArray(body.failingParticipantIds)) {
    throw createError({ statusCode: 400, message: 'bossParticipantId and failingParticipantIds[] are required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: 'Encounter not found' })
  }

  let participants = parseJsonField(encounter.participants)
  const battleLog = parseJsonField(encounter.battleLog)

  const boss = participants.find((p: any) => p.id === body.bossParticipantId)
  if (!boss) {
    throw createError({ statusCode: 404, message: 'Boss participant not found' })
  }
  if (boss.type !== 'digimon') {
    throw createError({ statusCode: 400, message: 'Tormentor only applies to digimon' })
  }

  const [digi] = await db.select().from(digimon).where(eq(digimon.id, boss.entityId))
  if (!digi) {
    throw createError({ statusCode: 404, message: 'Boss digimon not found' })
  }

  const quals = typeof digi.qualities === 'string' ? JSON.parse(digi.qualities) : (digi.qualities || [])
  if (!(quals as any[]).some((q: any) => q.id === 'tormentor')) {
    throw createError({ statusCode: 400, message: 'Digimon does not have Tormentor' })
  }

  const totalCheckers = body.failingParticipantIds.length
  if (totalCheckers === 0) {
    throw createError({ statusCode: 400, message: 'No failing participants provided' })
  }

  const prevStacks = boss.tormentorBonusStacks ?? 0
  const cap = participants.filter((p: any) => p.id !== body.bossParticipantId).length
  const newStacks = Math.min(prevStacks + totalCheckers, cap)
  const stacksGained = newStacks - prevStacks
  const statBonus = newStacks * 2

  participants = participants.map((p: any) => {
    if (p.id !== body.bossParticipantId) return p
    return { ...p, tormentorBonusStacks: newStacks }
  })

  battleLog.push({
    id: `log-${Date.now()}-tormentor`,
    timestamp: new Date().toISOString(),
    round: encounter.round,
    actorId: boss.id,
    actorName: digi.name || 'Boss',
    action: `Tormentor — ${totalCheckers} participant${totalCheckers > 1 ? 's' : ''} checked, ${stacksGained} failed`,
    target: null,
    result: `+${stacksGained * 2} to all boss stats (total +${statBonus} from ${newStacks} stacks).`,
    damage: null,
    effects: ['Tormentor'],
  })

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
