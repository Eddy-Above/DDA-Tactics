import { defineEncounterCommand } from '../../../../utils/encounterCommand'
import { eq } from 'drizzle-orm'
import { db, encounters, maps } from '../../../../db'
import { authorizeEncounterIntent } from '../../../../utils/encounterAuthorization'
import { serializeIntercedeClaim } from '../../../../utils/intercedeClaims'
import { getRoomSnapshot, broadcast } from '../../../../utils/encounterRoom'
import { loadEncounterMap, loadParticipantDigimon } from '../../../../utils/combatSpatial'
import { getFootprintDimensions } from '../../../../utils/mapMovement'
import { doorsAdjacentTo } from '../../../../../utils/mapDoors'

export default defineEncounterCommand(async (event, commandContext) => {
  const id = getRouterParam(event, 'id')
  const body = await readBody<{ participantId?: string; doorIds: string[]; isOpen: boolean }>(event)
  const { access } = (commandContext ?? await authorizeEncounterIntent(event, id, body, 'doors'))
  if (!Array.isArray(body.doorIds) || body.doorIds.length < 1 || body.doorIds.length > 100 || body.doorIds.some(id => typeof id !== 'string') || typeof body.isOpen !== 'boolean') throw createError({ statusCode: 400, message: 'Choose doors and an open state' })
  return serializeIntercedeClaim(id!, async () => {
    const encounter = commandContext?.encounter ?? (await db.select().from(encounters).where(eq(encounters.id, id!)))[0]
    if (encounter?.mapId) await db.select({ id: maps.id }).from(maps).where(eq(maps.id, encounter.mapId)).for('update')
    const map = await loadEncounterMap(encounter?.mapId)
    if (!map) throw createError({ statusCode: 400, message: 'No encounter map is available' })
    const ids = new Set(body.doorIds)
    if ([...ids].some(id => !map.doors.some(door => door.id === id))) throw createError({ statusCode: 404, message: 'Door not found' })
    if (!access?.isDm) {
      const actor = encounter.participants.find(p => p.id === body.participantId)
      const room = await getRoomSnapshot(id!)
      const position = actor && room.participantPositions[actor.id]
      if (!actor || actor.inReserve || !position) throw createError({ statusCode: 403, message: 'Choose a placed character beside the door' })
      const record = (await loadParticipantDigimon([actor])).get(actor.entityId)
      const adjacent = new Set(doorsAdjacentTo(map, position, getFootprintDimensions(record?.size ?? 'medium', record?.giganticDimensions)).map(door => door.id))
      if ([...ids].some(id => !adjacent.has(id))) throw createError({ statusCode: 403, message: 'The character must stand beside each door' })
    }
    const doors = map.doors.map(door => ids.has(door.id) ? { ...door, isOpen: body.isOpen } : door)
    await db.update(maps).set({ doors, updatedAt: new Date() }).where(eq(maps.id, encounter.mapId!))
    broadcast(id!, { type: 'door-toggled', encounterId: id! })
    return { success: true, doors }
  })
})
