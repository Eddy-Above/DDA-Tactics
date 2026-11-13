import type { Vec3, GameMap } from '../../types'
import { getNaturewalkBonuses, getNaturewalkElements, getNaturewalkEnvironmentSettings, resolveNaturewalkEnvironment } from '../../utils/naturewalk'
import { createMovementMapView } from '../../utils/movementMapIndex'
import { loadEncounterMap, loadParticipantDigimon } from './combatSpatial'
import { getRoomPositions } from './encounterRoom'

/** Derive conditional benefits from authoritative terrain; never grant passage through a barrier. */
export async function applyNaturewalkEnvironment(
  encounter: any,
  participants: any[],
  positions?: Record<string, Vec3>,
  options: { grantWater?: boolean; resetWater?: boolean; records?: Map<string, any>; map?: GameMap | null } = {},
): Promise<{ participants: any[]; changed: boolean }> {
  const records = options.records ?? await loadParticipantDigimon(participants)
  if (![...records.values()].some(record => getNaturewalkElements(record.qualities).length)
    && !participants.some(p => p.naturewalkActiveElements?.length || options.resetWater && p.naturewalkWaterGranted)) return { participants, changed: false }
  const settings = getNaturewalkEnvironmentSettings(encounter.hazards)
  const map = settings.useMapTerrain && encounter.mapId
    ? options.map === undefined ? await loadEncounterMap(encounter.mapId) : options.map
    : null
  const queryMap = map ? createMovementMapView(map) : null
  const currentPositions = positions ?? (encounter.mapId ? await getRoomPositions(encounter.id) : {})
  let changed = false
  const next = participants.map(participant => {
    if (participant.type !== 'digimon') return participant
    const record = records.get(participant.entityId)
    const environment = participant.inReserve ? [] : resolveNaturewalkEnvironment(queryMap, currentPositions[participant.id], settings)
    const chosen = getNaturewalkElements(record?.qualities)
    const active = chosen.filter(element => environment.includes(element))
    let updated = participant
    if (JSON.stringify(active) !== JSON.stringify(participant.naturewalkActiveElements ?? [])) {
      updated = { ...updated, naturewalkActiveElements: active }; changed = true
    }
    if (options.resetWater && participant.naturewalkWaterGranted) {
      updated = { ...updated, naturewalkWaterGranted: false }; changed = true
    }
    const bonus = getNaturewalkBonuses(record?.qualities, active)
    if (bonus.immuneToBurn && updated.activeEffects?.some((effect: any) => effect.name === 'Burn')) {
      updated = { ...updated, activeEffects: updated.activeEffects.filter((effect: any) => effect.name !== 'Burn') }; changed = true
    }
    if (options.grantWater && encounter.phase === 'combat' && !updated.naturewalkWaterGranted && bonus.waterTempWounds) {
      updated = { ...updated, naturewalkWaterGranted: true, currentTempWounds: (updated.currentTempWounds ?? 0) + bonus.waterTempWounds }
      changed = true
    }
    return updated
  })
  return { participants: changed ? next : participants, changed }
}
