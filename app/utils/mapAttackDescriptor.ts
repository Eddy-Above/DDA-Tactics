import type { Attack, DigimonDerivedStats, Quality } from '../types'
import type { CombatParticipant } from '../types/combat'
import { applyDerivedStatEffects } from '../data/attackConstants'

/** The attack information consumed by EncounterMap and MapCanvas. */
export interface MapAttackDescriptor {
  tags: string[]
  range: Attack['range']
  type?: string
  bit: number
  movement?: number
  ram?: number
  sizeAboveLarge?: number
  effectiveLimit?: number
  meleeRange?: number
  attackerParticipantId?: string | null
}

export interface MapAttackSelection {
  participant: Pick<CombatParticipant, 'id'> & Partial<Pick<CombatParticipant, 'activeEffects'>>
  // Clash initiation uses its own type; legacy selections can omit range and tags.
  attack: Partial<Pick<Attack, 'range' | 'tags'>> & { type?: string }
}

interface MapAttackSource {
  digimon: { size?: string | null; qualities: readonly Pick<Quality, 'id' | 'ranks'>[] }
  stats: Pick<DigimonDerivedStats, 'bit' | 'movement' | 'ram' | 'effectiveLimit'>
}

/** Pages resolve records and calculate role-specific stats before adapting them for the map. */
export function buildMapAttackDescriptor(selection: MapAttackSelection, source?: MapAttackSource): MapAttackDescriptor {
  const descriptor: MapAttackDescriptor = {
    tags: selection.attack.tags ?? [],
    range: selection.attack.range ?? 'melee',
    type: selection.attack.type,
    bit: 0,
    effectiveLimit: 0,
    meleeRange: 1,
    attackerParticipantId: selection.participant.id,
  }
  if (!source) return descriptor

  const stats = applyDerivedStatEffects(source.stats, selection.participant.activeEffects ?? [])
  const sizeOrder = ['tiny', 'small', 'medium', 'large', 'huge', 'gigantic']
  const sizeAboveLarge = Math.max(0, sizeOrder.indexOf(source.digimon.size?.toLowerCase() ?? 'medium') - 3)
  const reachRanks = source.digimon.qualities.find(quality => quality.id === 'reach')?.ranks ?? 0
  return {
    ...descriptor,
    bit: stats.bit,
    movement: stats.movement,
    ram: stats.ram,
    sizeAboveLarge,
    effectiveLimit: stats.effectiveLimit,
    meleeRange: reachRanks > 0 ? reachRanks * 2 : 1,
  }
}
