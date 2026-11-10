import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { canActOnEncounterTurn } from '../../../../utils/participantTurn'
import { combatTurnKey } from '../../../../../utils/specialOrderCombat'
import { createParticipantActionLog } from '../../../../utils/participantActionLog'

export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ participantId: string; operationId: string }>(event)
  await authorizeEncounterIntent(event, id, body, 'card-move')
  if (!body.operationId || body.operationId.length > 128) throw createError({ statusCode: 400, message: 'An operation ID is required' })
  return serializeIntercedeClaim(id!, async () => {
    const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id!))
    const actor = encounter?.participants.find(p => p.id === body.participantId)
    if (!actor || actor.inReserve || actor.clash || encounter.phase !== 'combat') throw createError({ statusCode: 400, message: 'This character cannot move now' })
    if ((actor as any).lastCardMoveOperationId === body.operationId) return encounter
    if ((actor.actionsRemaining?.simple ?? 0) < 1 || !await canActOnEncounterTurn(actor, encounter, id => db.select().from(digimon).where(eq(digimon.id, id)))) throw createError({ statusCode: 403, message: 'Movement requires one action on this character’s turn' })
    const participants = encounter.participants.map((p: any) => p.id === actor.id ? { ...p, lastCardMoveOperationId: body.operationId, lastMovedRound: encounter.round, lastMovedTurnKey: combatTurnKey(encounter.round, encounter.currentTurnIndex), actionsRemaining: { simple: p.actionsRemaining.simple - 1 } } : p)
    const entry = await createParticipantActionLog(encounter, actor, 'Movement', 'Used movement action')
    const [updated] = await db.update(encounters).set({ participants, battleLog: [...encounter.battleLog, entry], updatedAt: new Date() }).where(eq(encounters.id, id!)).returning()
    return updated
  })
})
