import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { applyCleanseSelections, type CleanseMode, type CleanseSelection } from '../../../../../utils/cleanse'

export default defineEncounterCommand(async (event, commandContext) => {
  const encounterId = getRouterParam(event, 'id')
  const body = await readBody<{ requestId: string; ownerId: string; mode: CleanseMode; selections: CleanseSelection[] }>(event)
  if (!commandContext) await authorizeEncounterIntent(event, encounterId, body, 'cleanse')
  if (!encounterId || !body.requestId || !body.ownerId) throw createError({ statusCode: 400, message: 'Encounter, request and owner are required' })
  return serializeIntercedeClaim(encounterId, async () => {
    const encounter = commandContext?.encounter ?? (await db.select().from(encounters).where(eq(encounters.id, encounterId)))[0]
    if (!encounter) throw createError({ statusCode: 404, message: 'Encounter not found' })
    const request = encounter.pendingRequests.find(request => request.id === body.requestId && request.type === 'cleanse-select')
    if (!request) throw createError({ statusCode: 404, message: 'Cleanse selection is no longer pending' })
    if (request.targetTamerId !== body.ownerId) throw createError({ statusCode: 403, message: 'This Cleanse belongs to another character' })
    let participants
    try { participants = applyCleanseSelections(request.data as any, encounter.participants, body.mode, body.selections) }
    catch (error) { throw createError({ statusCode: 400, message: (error as Error).message }) }
    const count = body.selections.length
    const label = body.mode === 'dispel' ? 'Dispel' : body.mode === 'purify' ? 'Purify' : 'Cleanse'
    await db.update(encounters).set({
      participants,
      pendingRequests: encounter.pendingRequests.filter(pending => pending.id !== request.id),
      battleLog: [...encounter.battleLog, { id: `log-cleanse-${Date.now()}`, timestamp: new Date().toISOString(), round: encounter.round,
        actorId: request.data.attackerId, actorName: request.data.attackerName, action: label, target: null,
        result: `${label}: reduced ${count} effect${count === 1 ? '' : 's'} by ${request.data.potency} turns`,
        damage: null, effects: [label] }],
      updatedAt: new Date(),
    }).where(eq(encounters.id, encounterId))
    const [updated] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
    return updated
  })
})
