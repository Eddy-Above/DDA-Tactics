import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { allowFields, boundedString, finiteNumber } from '../../../../utils/securityValidation'
import { createParticipantActionLog } from '../../../../utils/participantActionLog'

export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  const body = allowFields(await readBody(event), ['actorId', 'actorName', 'action', 'target', 'result', 'damage', 'effects', 'round', 'baseDamage', 'netSuccesses', 'targetArmor', 'clashArmorBonus', 'armorPiercing', 'effectiveArmor', 'finalDamage', 'hit', 'accuracyDicePool', 'accuracyDiceResults', 'accuracySuccesses', 'dodgeDicePool', 'dodgeDiceResults', 'dodgeSuccesses', 'operationId', 'expectedRevision'])
  await authorizeEncounterIntent(event, id, { participantId: body.actorId }, 'log')
  for (const name of ['actorId', 'actorName', 'action', 'result']) boundedString(body[name], name, name === 'result' ? 10000 : 200)
  for (const [field, value] of Object.entries(body)) if (typeof value === 'number') finiteNumber(value, field)
  if (body.effects && (!Array.isArray(body.effects) || body.effects.some((value: any) => typeof value !== 'string'))) throw createError({ statusCode: 400, message: 'Invalid log effects' })
  return serializeIntercedeClaim(id!, async () => {
    const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id!))
    const { operationId: _operation, expectedRevision: _revision, ...details } = body
    const actor = encounter.participants.find(p => p.id === body.actorId)
    const identity = actor ? await createParticipantActionLog(encounter, actor, body.action, body.result)
      : { actorId: 'GM', actorName: 'GM' }
    const entry = { ...details, actorId: identity.actorId, actorName: identity.actorName, id: `log-${crypto.randomUUID()}`, timestamp: new Date().toISOString(), round: encounter.round }
    const [updated] = await db.update(encounters).set({ battleLog: [...encounter.battleLog, entry] as any, updatedAt: new Date() }).where(eq(encounters.id, id!)).returning()
    return updated
  })
})
