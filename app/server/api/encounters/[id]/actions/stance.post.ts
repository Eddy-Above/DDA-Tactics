import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { canActOnEncounterTurn } from '../../../../utils/participantTurn'
import { updateEncounterState } from '../../../../utils/encounterUpdate'
import { STANCE_COLORS } from '../../../../../utils/stanceModifiers'
import { createParticipantActionLog } from '../../../../utils/participantActionLog'

export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ participantId: string; stance: string; operationId: string }>(event)
  await authorizeEncounterIntent(event, id, body, 'stance')
  if (typeof body.stance !== 'string' || !Object.hasOwn(STANCE_COLORS, body.stance) || !body.operationId || body.operationId.length > 128) throw createError({ statusCode: 400, message: 'Choose a valid stance and operation ID' })
  return serializeIntercedeClaim(id!, async () => {
    const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id!))
    const actor = encounter?.participants.find((p: any) => p.id === body.participantId)
    if (!actor || actor.inReserve || actor.clash || encounter.phase !== 'combat') throw createError({ statusCode: 400, message: 'This character cannot change stance' })
    if ((actor as any).lastStanceOperationId === body.operationId || actor.currentStance === body.stance) return encounter
    if ((actor.actionsRemaining?.simple ?? 0) < 1 || !await canActOnEncounterTurn(actor, encounter, id => db.select().from(digimon).where(eq(digimon.id, id)))) throw createError({ statusCode: 403, message: 'Changing stance requires one action on this character’s turn' })
    const participants = encounter.participants.map((p: any) => p.id === actor.id ? { ...p, currentStance: body.stance, lastStanceOperationId: body.operationId, pendingChargeMove: undefined, actionsRemaining: { simple: p.actionsRemaining.simple - 1 } } : p)
    const entry = await createParticipantActionLog(encounter, actor, 'Changed stance', `Switched to ${body.stance} stance`)
    return updateEncounterState(id!, { participants, battleLog: [...encounter.battleLog, entry] })
  })
})
