import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { advanceEncounterTurn } from '../../../../utils/encounterTurn'
import { loadCampaignCombatContext } from '../../../../utils/combatContext'
import { loadParticipantDigimon } from '../../../../utils/combatSpatial'
import { combatTurnKey } from '../../../../../utils/specialOrderCombat'

export default defineEncounterCommand(async event => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ participantId: string; operationId: string; turnKey: string }>(event)
  await authorizeEncounterIntent(event, id, body, 'end-turn')
  return serializeIntercedeClaim(id!, async () => {
    const [encounter] = await db.select().from(encounters).where(eq(encounters.id, id!))
    if (!encounter || encounter.phase !== 'combat') throw createError({ statusCode: 400, message: 'No combat turn is active' })
    if (!body.operationId || body.operationId.length > 128) throw createError({ statusCode: 400, message: 'An operation ID is required' })
    if (encounter.participants.some((p: any) => p.lastEndTurnOperationId === body.operationId)) return encounter
    if (body.turnKey !== combatTurnKey(encounter.round, encounter.currentTurnIndex) || body.participantId !== encounter.turnOrder[encounter.currentTurnIndex]) throw createError({ statusCode: 409, message: 'The active turn changed' })
    const roster = encounter.participants.map((p: any) => p.id === body.participantId ? { ...p, lastEndTurnOperationId: body.operationId } : p)
    const records = await loadParticipantDigimon(roster)
    const context = await loadCampaignCombatContext(encounter.campaignId)
    return advanceEncounterTurn({ ...encounter, participants: roster }, records, context.houseRules)
  })
})
