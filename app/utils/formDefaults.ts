import type { DigimonStage, DigimonSize, DigimonFamily } from '../types'
import type { Digimon } from '../server/db/schema'
import type { DigimonFormData } from '../composables/useDigimonForm'

/**
 * Base stats structure
 */
export interface BaseStats {
  accuracy: number
  damage: number
  dodge: number
  armor: number
  health: number
}

/**
 * Default base stats for a new Digimon
 */
export const DEFAULT_BASE_STATS: BaseStats = {
  accuracy: 3,
  damage: 3,
  dodge: 3,
  armor: 3,
  health: 3,
}

/**
 * Default bonus stats (all zeros)
 */
export const DEFAULT_BONUS_STATS: BaseStats = {
  accuracy: 0,
  damage: 0,
  dodge: 0,
  armor: 0,
  health: 0,
}

/**
 * Create default form data for a new Digimon
 * @returns Fresh form data object with default values
 */
export function createDigimonFormDefaults(): DigimonFormData {
  return {
    name: '',
    species: '',
    stage: 'rookie',
    attribute: 'data',
    family: 'nature-spirits',
    type: '',
    size: 'medium',
    baseStats: { ...DEFAULT_BASE_STATS },
    attacks: [],
    qualities: [],
    dataOptimization: '',
    bonusDP: 0,
    bonusStats: { ...DEFAULT_BONUS_STATS },
    bonusDPForQualities: 0,
    syncBonusDP: true,
    partnerId: null,
    isEnemy: false,
    notes: '',
    spriteUrl: '',
    evolvesFromId: null,
    evolutionPathIds: [],
  }
}

/**
 * Create form data from an existing Digimon
 * @param digimon - The Digimon to populate from
 * @returns Form data object populated with Digimon values
 */
export function createDigimonFormFromData(digimon: Digimon): DigimonFormData {
  return {
    name: digimon.name,
    species: digimon.species,
    stage: digimon.stage as DigimonStage,
    attribute: digimon.attribute as 'vaccine' | 'data' | 'virus' | 'free',
    family: digimon.family as DigimonFamily,
    type: digimon.type || '',
    size: digimon.size as DigimonSize,
    baseStats: { ...digimon.baseStats },
    attacks: digimon.attacks ? [...digimon.attacks] : [],
    qualities: digimon.qualities ? [...digimon.qualities] : [],
    dataOptimization: digimon.dataOptimization || '',
    bonusDP: digimon.bonusDP || 0,
    bonusStats: digimon.bonusStats
      ? { ...digimon.bonusStats }
      : { ...DEFAULT_BONUS_STATS },
    bonusDPForQualities: digimon.bonusDPForQualities || 0,
    syncBonusDP: true,
    partnerId: digimon.partnerId || null,
    isEnemy: digimon.isEnemy,
    notes: digimon.notes || '',
    spriteUrl: digimon.spriteUrl || '',
    evolvesFromId: digimon.evolvesFromId || null,
    evolutionPathIds: digimon.evolutionPathIds ? [...digimon.evolutionPathIds] : [],
  }
}

/**
 * New attack form defaults
 */
export interface NewAttackFormData {
  name: string
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[]
  effect: string | undefined
  description: string
}

/**
 * Create default form data for a new attack
 * @returns Fresh attack form data object
 */
export function createNewAttackDefaults(): NewAttackFormData {
  return {
    name: '',
    range: 'melee',
    type: 'damage',
    tags: [],
    effect: undefined,
    description: '',
  }
}
