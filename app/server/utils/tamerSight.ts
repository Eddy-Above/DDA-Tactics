import type { DigimonSize } from '../../types'
import { createTamerSightCheck } from '../../utils/tamerSight'
import { getFootprintDimensions } from '../../utils/movementRules'
import { loadEncounterMap } from './combatSpatial'
import { getRoomSnapshot, getDestroyedStructureIds } from './encounterRoom'

export async function requireTamerDigimonSight(
  encounter: { id: string; mapId?: string | null }, tamer: { id: string; inReserve?: boolean },
  target: { id: string; inReserve?: boolean }, record: { size?: DigimonSize; giganticDimensions?: { width: number; height: number; depth: number } | null } | undefined,
  action: string,
): Promise<void> {
  if (!encounter.mapId) return
  const [map, room] = await Promise.all([loadEncounterMap(encounter.mapId), getRoomSnapshot(encounter.id)])
  if (!map) throw createError({ statusCode: 400, message: `The map is unavailable to verify ${action} line of sight` })
  const origin = room.participantPositions[tamer.id], destination = room.participantPositions[target.id]
  if (tamer.inReserve || target.inReserve || !origin || !destination) {
    throw createError({ statusCode: 400, message: `${action} requires the Tamer and Digimon to be placed on the map` })
  }
  const visible = createTamerSightCheck(map, origin, getDestroyedStructureIds(room.destructibleStates ?? []))
  if (!visible(destination, getFootprintDimensions(record?.size ?? 'medium', record?.giganticDimensions))) {
    throw createError({ statusCode: 400, message: `${action} requires line of sight from the Tamer to the Digimon` })
  }
}
