import type { Vec3, GameMap } from '../types'
import { getRoomPositions, broadcastPositionPatch } from './encounterRoom'
import { loadEncounterMap, loadParticipantDigimon } from './combatSpatial'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import {
  getFootprintDimsForParticipant,
  isFootprintAirborne,
  settleFootprintY,
  computeFallDamage,
  detectCapabilitiesFromQualities,
} from './mapMovement'

// Pure core: drops every airborne, non-flying participant straight down to the surface. Mutates
// wounds in place and returns the position patch + battle-log entries. Flyers hover (skipped
// entirely); a unit flagged `airborneByJump` still falls but takes 0 fall damage and the flag is
// cleared on landing. Callers apply the returned patch (room + broadcast) and battle log.
export async function computeGravityDrops(
  positions: Record<string, Vec3>,
  participants: any[],
  map: GameMap,
  digimonById: Map<string, any>,
  round: number,
): Promise<{ patch: Record<string, Vec3>; logEntries: any[] }> {
  const patch: Record<string, Vec3> = {}
  const logEntries: any[] = []

  for (const p of participants) {
    const pos = positions[p.id]
    if (!pos) continue
    const dims = getFootprintDimsForParticipant(p, digimonById)
    if (!isFootprintAirborne(pos, dims, map)) continue

    // Flight hovers — no drop, no damage.
    if (p.type === 'digimon') {
      const quals = digimonById.get(p.entityId)?.qualities ?? []
      if (detectCapabilitiesFromQualities(quals, 0, 0, 0).canFly) continue
    }

    const landingY = settleFootprintY(pos, dims, map)
    const fallHeight = pos.y - landingY
    if (fallHeight <= 0) continue

    let damage = 0
    if (p.airborneByJump) {
      // Jumped onto an air tile intentionally: still falls, but takes no fall damage.
      damage = 0
    } else if (p.type === 'digimon') {
      const quals = digimonById.get(p.entityId)?.qualities ?? []
      const hasTumbler = quals.some((q: any) => q.id === 'tumbler')
      const hasAdvJumper = quals.some((q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper')
      const ds = await getDigimonDerivedStats(p.entityId)   // CPU (and RAM for Tumbler) always needed
      damage = computeFallDamage(fallHeight, ds?.cpu ?? 0, hasTumbler, hasAdvJumper, ds?.ram ?? 0)
    } else {
      // Tamer (or other): CPU 1, no Tumbler.
      damage = computeFallDamage(fallHeight, 1, false, false, 0)
    }

    patch[p.id] = { x: pos.x, y: landingY, z: pos.z }
    if (damage > 0) p.currentWounds = Math.min(p.maxWounds, (p.currentWounds || 0) + damage)
    if (p.airborneByJump) p.airborneByJump = false

    logEntries.push({
      id: `log-fall-${p.id}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      round,
      actorId: p.id,
      actorName: p.id,
      action: 'Fall',
      target: null,
      result: `Fell ${fallHeight} tile${fallHeight !== 1 ? 's' : ''}${damage > 0 ? ` (${damage} wound${damage !== 1 ? 's' : ''})` : ' (no damage)'}`,
      damage: damage || null,
      effects: ['Fall'],
    })
  }

  return { patch, logEntries }
}

// Room wrapper for persistence-path callers ([id].put, npc-attack): loads the map, room positions and
// digimon records, runs the pure core, then applies the position patch to the room and broadcasts a
// `position-patch`. Returns the (mutated) participants and the fall battle-log entries.
export async function applyEndOfTurnGravity(
  encounterId: string,
  mapId: string | null | undefined,
  participants: any[],
  round: number,
): Promise<{ participants: any[]; logEntries: any[] }> {
  if (!mapId) return { participants, logEntries: [] }

  const positions = await getRoomPositions(encounterId)
  if (Object.keys(positions).length === 0) return { participants, logEntries: [] }

  const map = await loadEncounterMap(mapId)
  if (!map) return { participants, logEntries: [] }

  const digimonById = await loadParticipantDigimon(participants)

  const { patch, logEntries } = await computeGravityDrops(positions, participants, map, digimonById, round)

  if (Object.keys(patch).length > 0) await broadcastPositionPatch(encounterId, patch)

  return { participants, logEntries }
}
