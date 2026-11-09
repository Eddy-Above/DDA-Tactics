import { eq, inArray } from 'drizzle-orm'
import { db, digimon, tamers, maps, type Digimon, type Tamer } from '../db'
import type { GameMap } from '../../types'
import { calculateDigimonDerivedStats } from '../../types'
import { calculateSwimSpeed, detectCapabilities, type MovementCapabilities, type FallerProfile } from '../../utils/movementRules'
import { calculateEffectiveBaseMovement } from '../../utils/movementQualities'
import { applyStanceToMovement } from '../../utils/stanceModifiers'
import { getDigimonDerivedStats } from './resolveSupportAttack'
import { applyDerivedStatEffects } from '../../data/attackConstants'
import { readCombatRecords } from './combatRecordCache'

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

// Bulk-fetches only records absent from the current action's cache, keyed by entityId.
export async function loadParticipantDigimon(
  participants: Array<{ type: string; entityId: string }>,
): Promise<Map<string, Digimon>> {
  const entityIds = participants.filter(p => p.type === 'digimon').map(p => p.entityId)
  return readCombatRecords('digimon', entityIds,
    ids => db.select().from(digimon).where(inArray(digimon.id, ids)))
}

export async function loadTamersByIds(ids: readonly string[]): Promise<Map<string, Tamer>> {
  return readCombatRecords('tamer', ids,
    missingIds => db.select().from(tamers).where(inArray(tamers.id, missingIds)))
}

export interface MovementProfile {
  caps: MovementCapabilities
  budget: number
  bodyStat: number
}

// Mobility spec values include the stored stat allocation and quality bonuses. Keep this local to
// movement so changing a swim/jump allowance does not change unrelated combat damage calculations.
function getMobilityStats(digRec: any) {
  const qualities = digRec.qualities ?? []
  const totalStats = Object.fromEntries(['accuracy', 'damage', 'dodge', 'armor', 'health'].map(stat => [
    stat, (digRec.baseStats?.[stat] ?? 0) + (digRec.bonusStats?.[stat] ?? 0) + (digRec.isDarkEvolution ? 2 : 0),
  ])) as { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  const instinct = qualities.find((q: any) => q.id === 'instinct')?.ranks || 0
  totalStats.dodge += instinct
  totalStats.health += instinct
  const optimization = qualities.find((q: any) => q.id === 'data-optimization')
  if (optimization?.choiceId === 'guardian') totalStats.armor += 2
  if (optimization?.choiceId === 'effect-warrior') totalStats.armor -= 2
  const armor = qualities.find((q: any) => q.id === 'digizoid-armor')?.choiceId
  if (armor) {
    totalStats.armor += armor === 'red' ? 4 : 2
    if (['chrome', 'gold', 'obsidian'].includes(armor)) totalStats.health += 1
    if (armor === 'red') totalStats.health += 2
    if (armor === 'blue') totalStats.dodge += 2
  }
  const stats = calculateDigimonDerivedStats(totalStats, digRec.stage, digRec.size)
  for (const quality of qualities.filter((q: any) => q.id === 'improved-derived-stat')) {
    if (quality.choiceId === 'body') stats.body += quality.ranks || 1
    if (quality.choiceId === 'agility') stats.agility += quality.ranks || 1
  }
  const effectWarrior = optimization?.choiceId === 'effect-warrior' ? 1 : 0
  stats.cpu = Math.floor(stats.body / 10) + stats.stageBonus + effectWarrior
  stats.ram = Math.floor(stats.agility / 10) + stats.stageBonus + effectWarrior
  const baseCpu = stats.cpu, baseRam = stats.ram
  for (const quality of qualities.filter((q: any) => q.id === 'system-boost')) {
    if (quality.choiceId === 'cpu') stats.cpu = Math.min(stats.cpu + (quality.ranks || 1), baseCpu * 2)
    if (quality.choiceId === 'ram') stats.ram = Math.min(stats.ram + (quality.ranks || 1), baseRam * 2)
  }
  return stats
}

// Derives a participant's movement profile (capabilities + move budget + Body stat) for spatial
// pathing. Digimon use derived stats + qualities; tamers use Agility+Survival for budget and Body.
export function getMovementProfile(
  participant: { type: string; entityId: string; activeEffects?: any[]; currentStance?: string },
  digimonById: Map<string, any>,
  tamerById: Map<string, any>,
): MovementProfile {
  if (participant.type === 'digimon') {
    const digRec = digimonById.get(participant.entityId)
    if (!digRec) return { budget: 0, caps: detectCapabilities([], 0, 0, 0), bodyStat: 0 }
    const quals = digRec.qualities ?? []
    const baseStats = calculateDigimonDerivedStats(digRec.baseStats, digRec.stage, digRec.size)
    const basicMovement = calculateEffectiveBaseMovement(baseStats.movement, quals)
    const speedyRanks = quals.find((q: any) => q.id === 'speedy')?.ranks || 0
    const advancedMovement = quals.some((q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-movement')
    const movement = basicMovement + Math.min(speedyRanks * 2, basicMovement * (advancedMovement ? 3 : 2))
    const stance = participant.currentStance ?? 'neutral'
    const deriv = applyDerivedStatEffects({
      ...getMobilityStats(digRec),
      movement,
    }, participant.activeEffects ?? [])
    deriv.movement = applyStanceToMovement(deriv.movement, stance, baseStats.stageBonus)
    const effectiveBasicMovement = applyStanceToMovement(
      applyDerivedStatEffects({ movement: basicMovement }, participant.activeEffects ?? []).movement,
      stance,
      baseStats.stageBonus,
    )
    const ram = Math.max(0, deriv.ram), cpu = Math.max(0, deriv.cpu)
    const swimSpeed = calculateSwimSpeed(quals, deriv.movement, ram, effectiveBasicMovement)
    return {
      budget: Math.max(0, deriv.movement),
      caps: detectCapabilities(quals, deriv.movement, ram, cpu, swimSpeed, effectiveBasicMovement),
      bodyStat: applyDerivedStatEffects(baseStats, participant.activeEffects ?? []).body,
    }
  }
  const tamerRecord = tamerById.get(participant.entityId)
  if (!tamerRecord) return { budget: 0, caps: detectCapabilities([], 0, 0, 0), bodyStat: 0 }
  const attrs = tamerRecord.attributes || {}
  const skills = tamerRecord.skills || {}
  return {
    budget: (attrs.agility || 0) + (skills.survival || 0),
    caps: detectCapabilities([], 0, 0, 0, 0, 0),
    bodyStat: attrs.body || 0,
  }
}

// Builds the fall profile (CPU/RAM + Tumbler/adv-jumper/Flight + airborneByJump) for a participant,
// consumed by `resolveFall`. Digimon pull CPU/RAM from derived stats; tamers use CPU 1.
//
// End-of-turn gravity passes selfMoved because forced displacements already resolve their falls
// immediately. An innate jump within its height therefore lands safely at turn end without
// exempting high falls or pushed/thrown Digimon. Explicit Jumper and participant flags keep their
// existing rules.
export async function getFallerProfile(
  participant: any,
  digimonById: Map<string, any>,
  selfMoved = false,
): Promise<FallerProfile> {
  const airborneByJump = !!participant?.airborneByJump
  if (participant?.type === 'digimon') {
    const quals = digimonById.get(participant.entityId)?.qualities ?? []
    const ds = await getDigimonDerivedStats(participant.entityId, participant)
    const { caps } = getMovementProfile(participant, digimonById, new Map())
    return {
      cpu: ds?.cpu ?? 0,
      ram: ds?.ram ?? 0,
      hasTumbler: quals.some((q: any) => q.id === 'tumbler'),
      hasAdvJumper: quals.some((q: any) => q.id === 'advanced-mobility' && q.choiceId === 'adv-jumper'),
      canFly: caps.canFly,
      canClimb: caps.canClimb,
      canClimbCeilings: caps.canClimbCeilings,
      canDig: caps.canDig,
      canDigHardSurfaces: caps.canDigHardSurfaces,
      floatsOnWater: quals.some((q: any) => q.id === 'extra-movement' && q.choiceId === 'swimmer'),
      airborneByJump: airborneByJump || quals.some((q: any) => q.id === 'extra-movement' && q.choiceId === 'jumper'),
      safeJumpHeight: selfMoved ? caps.jumpHeight : undefined,
    }
  }
  // Tamer (or unknown): CPU 1, no qualities.
  return { cpu: 1, ram: 0, hasTumbler: false, hasAdvJumper: false, canFly: false,
    canClimb: false, canClimbCeilings: false, canDig: false, canDigHardSurfaces: false,
    floatsOnWater: false, airborneByJump }
}
