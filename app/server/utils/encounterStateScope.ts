import { eq, inArray } from 'drizzle-orm'
import { db, digimon, tamers, evolutionLines, maps } from '../db'
import { allowFields, finiteNumber } from './securityValidation'
import { combatTurnKey } from '../../utils/specialOrderCombat'

/** Server-owned allowances survive snapshots only while their original cast context is current. */
export function clearInvalidChargeMoves(previous: any, update: any): any[] {
  const phase = update.phase ?? previous.phase
  const mapId = update.mapId === undefined ? previous.mapId : update.mapId
  const turnKey = combatTurnKey(update.round ?? previous.round, update.currentTurnIndex ?? previous.currentTurnIndex ?? 0)
  return (update.participants ?? previous.participants ?? []).map((participant: any) => {
    const allowance = participant.pendingChargeMove
    if (!allowance || phase === 'combat' && !participant.inReserve && allowance.entityId === participant.entityId && allowance.mapId === mapId && allowance.turnKey === turnKey) return participant
    const { pendingChargeMove: _expired, ...remaining } = participant
    return remaining
  })
}

/** Check linked identifiers before gravity, devolution or any encounter write can run. */
export async function validateEncounterStateScope(encounter: any, body: any): Promise<void> {
  allowFields(body, ['name', 'description', 'round', 'phase', 'participants', 'turnOrder', 'currentTurnIndex', 'battleLog', 'hazards', 'pendingRequests', 'requestResponses', 'mapId', 'visibleToPlayers', 'intercedeOptOuts', 'movementActionParticipantId'])
  if (!encounter.campaignId) throw createError({ statusCode: 403, message: 'Standalone encounters are read-only' })
  if (body.phase !== undefined && !['setup', 'initiative', 'combat', 'ended'].includes(body.phase)) throw createError({ statusCode: 400, message: 'Invalid encounter phase' })
  for (const field of ['round', 'currentTurnIndex']) if (body[field] !== undefined) finiteNumber(body[field], field, { integer: true, min: 0 })
  if (body.mapId) {
    const [map] = await db.select().from(maps).where(eq(maps.id, body.mapId))
    if (!map || map.campaignId !== encounter.campaignId) throw createError({ statusCode: 400, message: 'The map belongs to a different campaign' })
  }
  const roster = body.participants ?? encounter.participants ?? []
  if (body.turnOrder !== undefined && (!Array.isArray(body.turnOrder) || body.turnOrder.some((id: any) => !roster.some((p: any) => p.id === id)))) throw createError({ statusCode: 400, message: 'Turn order must refer to current participants' })
  const order = body.turnOrder ?? encounter.turnOrder ?? []
  if (body.currentTurnIndex !== undefined && order.length > 0 && body.currentTurnIndex >= order.length) throw createError({ statusCode: 400, message: 'The current turn index is outside the turn order' })
  if (body.participants === undefined) return
  if (!Array.isArray(body.participants)) throw createError({ statusCode: 400, message: 'Participants must be an array' })
  const participantIds = new Set<string>(), digimonIds = new Set<string>(), tamerIds = new Set<string>(), lineIds = new Set<string>()
  for (const participant of body.participants) {
    if (!participant || typeof participant.id !== 'string' || !participant.id || participantIds.has(participant.id) || typeof participant.entityId !== 'string' || !['digimon', 'tamer'].includes(participant.type)) throw createError({ statusCode: 400, message: 'Invalid encounter participant' })
    participantIds.add(participant.id)
    ;(participant.type === 'digimon' ? digimonIds : tamerIds).add(participant.entityId)
    if (participant.evolutionLineId) {
      if (typeof participant.evolutionLineId !== 'string') throw createError({ statusCode: 400, message: 'Invalid evolution line' })
      lineIds.add(participant.evolutionLineId)
    }
    if (participant.woundsHistory !== undefined) {
      if (!Array.isArray(participant.woundsHistory)) throw createError({ statusCode: 400, message: 'Invalid evolution history' })
      for (const state of participant.woundsHistory) {
        if (!state || typeof state.entityId !== 'string') throw createError({ statusCode: 400, message: 'Invalid saved evolution form' })
        digimonIds.add(state.entityId)
      }
    }
  }
  for (const [table, ids] of [[digimon, digimonIds], [tamers, tamerIds], [evolutionLines, lineIds]] as const) {
    if (!ids.size) continue
    const rows = await db.select().from(table).where(inArray(table.id, [...ids]))
    const matching = new Set(rows.filter(row => row.campaignId === encounter.campaignId).map(row => row.id))
    if ([...ids].some(id => !matching.has(id))) throw createError({ statusCode: 400, message: 'An encounter character or evolution form belongs to a different campaign' })
  }
  if (body.turnOrder !== undefined && (!Array.isArray(body.turnOrder) || body.turnOrder.some((id: any) => !participantIds.has(id)))) throw createError({ statusCode: 400, message: 'Turn order must refer to current participants' })
}
