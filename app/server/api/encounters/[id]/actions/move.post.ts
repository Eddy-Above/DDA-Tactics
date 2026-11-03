import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { applyMovementBurn, loadCampaignDamageOverTimeRules } from '../../../../utils/damageOverTime'
import { loadParticipantDigimon } from '../../../../utils/combatSpatial'

interface MoveBody {
  participantId: string
  /** Cells moved (path steps). In combat it stamps lastMovedRound and drives Burn's movement damage. */
  distance?: number
  /** Movement that is part of another action (Charge, Pass): no simple action is spent. */
  noActionCost?: boolean
}

export default defineEventHandler(async (event) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<MoveBody>(event)

  if (!encounterId) {
    throw createError({ statusCode: 400, message: 'Encounter ID is required' })
  }
  if (!body.participantId) {
    throw createError({ statusCode: 400, message: 'participantId is required' })
  }

  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter) {
    throw createError({ statusCode: 404, message: `Encounter ${encounterId} not found` })
  }

  const participants = encounter.participants
  const mover = participants.find((p: any) => p.id === body.participantId)
  if (!mover) {
    throw createError({ statusCode: 404, message: 'Participant not found' })
  }

  let updatedParticipants = body.noActionCost ? participants : participants.map((p: any) => {
    if (p.id !== body.participantId) return p
    return {
      ...p,
      actionsRemaining: {
        ...p.actionsRemaining,
        simple: Math.max(0, (p.actionsRemaining?.simple ?? 0) - 1),
      },
    }
  })

  // Burn: the move stamps lastMovedRound (the stationary check) and a burned digimon takes damage
  // for the cells it moved.
  let battleLog: any[] | undefined
  const distance = Math.max(0, Math.floor(Number(body.distance) || 0))
  if (encounter.phase === 'combat' && distance > 0) {
    const moved = applyMovementBurn(updatedParticipants, [{ participantId: body.participantId, meters: distance }], {
      round: encounter.round ?? 0,
      digimonById: await loadParticipantDigimon([mover]),
      rules: await loadCampaignDamageOverTimeRules(encounter.campaignId),
    })
    updatedParticipants = moved.participants
    if (moved.logEntries.length > 0) battleLog = [...(encounter.battleLog ?? []), ...moved.logEntries]
  }

  await db.update(encounters).set({
    participants: updatedParticipants,
    ...(battleLog ? { battleLog } : {}),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  return { success: true }
})
