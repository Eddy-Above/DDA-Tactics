import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { applyMovementBurn, loadCampaignDamageOverTimeRules } from '../../../../utils/damageOverTime'
import { loadParticipantDigimon } from '../../../../utils/combatSpatial'
import { knockedOutEnemyIds, resolveEnemyKnockouts, type KnockoutResult } from '../../../../utils/enemyKnockouts'
import { combatTurnKey } from '../../../../../utils/specialOrderCombat'
import { applyNaturewalkEnvironment } from '../../../../utils/naturewalk'

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
    const records = await loadParticipantDigimon([mover])
    const refreshed = await applyNaturewalkEnvironment(encounter, [mover], undefined, { grantWater: true, records })
    updatedParticipants = updatedParticipants.map(p => p.id === mover.id ? { ...p, ...refreshed.participants[0], actionsRemaining: p.actionsRemaining } : p)
    updatedParticipants = updatedParticipants.map((p: any) => p.id === body.participantId
      ? { ...p, lastMovedTurnKey: combatTurnKey(encounter.round ?? 0, encounter.currentTurnIndex ?? 0) } : p)
    const moved = applyMovementBurn(updatedParticipants, [{ participantId: body.participantId, meters: distance }], {
      round: encounter.round ?? 0,
      digimonById: records,
      rules: await loadCampaignDamageOverTimeRules(encounter.campaignId),
    })
    updatedParticipants = moved.participants
    if (moved.logEntries.length > 0) battleLog = [...(encounter.battleLog ?? []), ...moved.logEntries]
  }

  // An enemy whose Burn knocks it out on this move leaves the encounter; if it was the active
  // participant, its turn ends and the next one's starts.
  let knockout: KnockoutResult | null = null
  if (battleLog && !knockedOutEnemyIds(participants).includes(body.participantId)) {
    knockout = await resolveEnemyKnockouts({
      participants: updatedParticipants,
      turnOrder: encounter.turnOrder ?? [],
      currentTurnIndex: encounter.currentTurnIndex ?? 0,
      round: encounter.round ?? 0,
    }, [body.participantId], { encounterId, mapId: (encounter as any).mapId, gravity: 'room' })
    if (knockout.changed) {
      updatedParticipants = knockout.participants
      battleLog = [...battleLog, ...knockout.logEntries]
    } else {
      knockout = null
    }
  }

  await db.update(encounters).set({
    participants: updatedParticipants,
    ...(battleLog ? { battleLog } : {}),
    ...(knockout ? { turnOrder: knockout.turnOrder, currentTurnIndex: knockout.currentTurnIndex, round: knockout.round } : {}),
    updatedAt: new Date(),
  }).where(eq(encounters.id, encounterId))

  // `defeated`: the mover was knocked out and removed — a Charge or Pass attack it was moving for
  // doesn't happen
  return { success: true, defeated: !!knockout?.removedIds.includes(body.participantId) }
})
