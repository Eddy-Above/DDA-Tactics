import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters, digimon } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { canActOnEncounterTurn } from '../../../../utils/participantTurn'
import { STANCE_COLORS } from '../../../../../utils/stanceModifiers'
import { createParticipantActionLog } from '../../../../utils/participantActionLog'
import { includeEncounterCommandReceipt, markEncounterCommandReceiptSaved } from '../../../../utils/encounterCommandReceipt'

export default defineEncounterCommand(async (event, commandContext) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ participantId: string; stance: string; operationId: string }>(event)
  if (!commandContext) await authorizeEncounterIntent(event, id, body, 'stance')
  if (typeof body.stance !== 'string' || !Object.hasOwn(STANCE_COLORS, body.stance) || !body.operationId || body.operationId.length > 128) throw createError({ statusCode: 400, message: 'Choose a valid stance and operation ID' })
  return serializeIntercedeClaim(id!, async () => {
    const encounter = commandContext?.encounter ?? (await db.select().from(encounters).where(eq(encounters.id, id!)))[0]
    const actor = encounter?.participants.find((p: any) => p.id === body.participantId)
    if (!actor || actor.inReserve || actor.clash || encounter.phase !== 'combat') throw createError({ statusCode: 400, message: 'This character cannot change stance' })
    if ((actor as any).lastStanceOperationId === body.operationId || actor.currentStance === body.stance) return encounter
    if ((actor.actionsRemaining?.simple ?? 0) < 1 || !await canActOnEncounterTurn(actor, encounter, id => db.select().from(digimon).where(eq(digimon.id, id)))) throw createError({ statusCode: 403, message: 'Changing stance requires one action on this character’s turn' })
    const participants = encounter.participants.map((p: any) => p.id === actor.id ? { ...p, currentStance: body.stance, lastStanceOperationId: body.operationId, pendingChargeMove: undefined, actionsRemaining: { simple: p.actionsRemaining.simple - 1 } } : p)
    const entry = await createParticipantActionLog(encounter, actor, 'Changed stance', `Switched to ${body.stance} stance`)
    // Stance changes neither the turn nor positions/effects; the command boundary already validated scope.
    const [updated] = await db.update(encounters).set({ participants: includeEncounterCommandReceipt(id!, participants), battleLog: [...encounter.battleLog, entry], updatedAt: new Date() }).where(eq(encounters.id, id!)).returning()
    markEncounterCommandReceiptSaved(id!)
    return updated
  })
})
