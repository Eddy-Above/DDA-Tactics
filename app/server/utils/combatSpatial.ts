import { eq, inArray } from 'drizzle-orm'
import { db, digimon, maps } from '../db'
import type { GameMap } from '../types'
import { calculateDigimonDerivedStats } from '../../types'
import { detectCapabilities, type MovementCapabilities, type FallerProfile } from '../../utils/movementRules'
import { getDigimonDerivedStats } from './resolveSupportAttack'

// Loads a full GameMap (all tile/structure layers) from the maps table for the given id, or null.
// Centralises the map-record construction that was previously copied across every map-aware handler,
// and — unlike those partial copies — includes spaceTiles/ceilings/dimensions so server pathing
// matches the client.
export async function loadEncounterMap(mapId: string | null | undefined): Promise<GameMap | null> {
  if (!mapId) return null
  const [m] = await db.select().from(maps).where(eq(maps.id, mapId))
  if (!m) return null
  return {
    dimensions: (m as any).dimensions,
    groundTiles: m.groundTiles ?? [],
    spaceTiles: (m as any).spaceTiles ?? [],
    voxels: (m as any).voxels ?? [],
    walls: m.walls ?? [],
    doors: m.doors ?? [],
    ceilings: (m as any).ceilings ?? [],
    stairs: m.stairs ?? [],
  } as unknown as GameMap
}

// Bulk-fetches the digimon rows backing the given participants, keyed by entityId. Replaces the
// repeated "unique entityIds → inArray → Map" boilerplate.
export async function loadParticipantDigimon(
  participants: Array<{ type: string; entityId: string }>,
): Promise<Map<string, any>> {
  const entityIds = [...new Set(
    participants.filter(p => p.type === 'digimon').map(p => p.entityId),
  )]
  if (entityIds.length === 0) return new Map()
  const rows = await db.select().from(digimon).where(inArray(digimon.id, entityIds))
  return new Map(rows.map((d: any) => [d.id, d]))
}

export interface MovementProfile {
  caps: MovementCapabilities
  budget: number
  bodyStat: number
}

// Derives a participant's movement profile (capabilities + move budget + Body stat) for spatial
// pathing. Digimon use derived stats + qualities; tamers use Agility+Survival for budget and Body.
export function getMovementProfile(
  participant: { type: string; entityId: string },
  digimonById: Map<string, any>,
  tamerById: Map<string, any>,
): MovementProfile {
  if (participant.type === 'digimon') {
    const digRec = digimonById.get(participant.entityId)
    if (!digRec) return { budget: 0, caps: detectCapabilities([], 0, 0, 0), bodyStat: 0 }
    const quals = digRec.qualities ?? []
    const deriv = calculateDigimonDerivedStats(digRec.baseStats, digRec.stage, digRec.size)
    return {
      budget: deriv.movement,
      caps: detectCapabilities(quals, deriv.movement, deriv.ram, deriv.cpu),
      bodyStat: deriv.body,
    }
  }
  const tamerRecord = tamerById.get(participant.entityId)
  if (!tamerRecord) return { budget: 0, caps: detectCapabilities([], 0, 0, 0), bodyStat: 0 }
  const attrs = tamerRecord.attributes || {}
  const skills = tamerRecord.skills || {}
  return {
    budget: (attrs.agility || 0) + (skills.survival || 0),
    caps: detectCapabilities([], 0, 0, 0),
    bodyStat: attrs.body || 0,
  }
}

// Builds the fall profile (CPU/RAM + Tumbler/adv-jumper/Flight + airborneByJump) for a participant,
// consumed by `resolveFall`. Digimon pull CPU/RAM from derived stats; tamers use CPU 1.
export async function getFallerProfile(
  participant: any,
  digimonById: Map<string, any>,
): Promise<FallerProfile> {
  const airborneByJump = !!participant?.airborneByJump
  if (participant?.type === 'digimon') {
    const quals = digimonById.get(participant.entityId)?.qualities ?? []
    const ds = await getDigimonDerivedStats(participant.entityId)
    return {
      cpu: ds?.cpu ?? 0,
      ram: ds?.ram ?? 0,
      hasTumbler: quals.some((q: any) => q.id === 'tumbler'),
      hasAdvJumper: quals.some((q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper'),
      canFly: detectCapabilities(quals, 0, 0, 0).canFly,
      airborneByJump,
    }
  }
  // Tamer (or unknown): CPU 1, no qualities.
  return { cpu: 1, ram: 0, hasTumbler: false, hasAdvJumper: false, canFly: false, airborneByJump }
}
