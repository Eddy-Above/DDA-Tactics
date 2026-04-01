// =====================================
// Digimon Digital Adventure 1.4 Types
// =====================================

// === Enums ===

export type DigimonStage =
  | 'fresh'
  | 'in-training'
  | 'rookie'
  | 'champion'
  | 'ultimate'
  | 'mega'
  | 'ultra'

export type DigimonAttribute = 'vaccine' | 'data' | 'virus' | 'free'

export type DigimonFamily =
  | 'dark-empire'
  | 'deep-savers'
  | 'dragons-roar'
  | 'jungle-troopers'
  | 'metal-empire'
  | 'nature-spirits'
  | 'nightmare-soldiers'
  | 'unknown'
  | 'virus-busters'
  | 'wind-guardians'

export type QualityTypeTag = 'static' | 'trigger' | 'attack'

export type AttackRange = 'melee' | 'ranged'
export type AttackType = 'damage' | 'support'
export type AttackArea = 'single' | 'blast' | 'burst' | 'line' | 'cone'

export type Stance = 'neutral' | 'defensive' | 'offensive' | 'sniper' | 'brave'

export type DigimonSize = 'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gigantic'

// Size bonuses (page 110)
export interface SizeConfig {
  size: DigimonSize
  bodyBonus: number
  agilityBonus: number
  squares: string
  extra: string
}

export const SIZE_CONFIG: Record<DigimonSize, SizeConfig> = {
  'tiny': { size: 'tiny', bodyBonus: -2, agilityBonus: 2, squares: '1x1', extra: 'May occupy squares another Digimon or Tamer stands in' },
  'small': { size: 'small', bodyBonus: -1, agilityBonus: 1, squares: '1x1', extra: 'May move through squares other Digimon or Tamers stand in' },
  'medium': { size: 'medium', bodyBonus: 0, agilityBonus: 0, squares: '1x1', extra: '' },
  'large': { size: 'large', bodyBonus: 1, agilityBonus: -1, squares: '2x2', extra: '' },
  'huge': { size: 'huge', bodyBonus: 2, agilityBonus: -1, squares: '3x3', extra: '' },
  'gigantic': { size: 'gigantic', bodyBonus: 3, agilityBonus: -2, squares: '4x4+', extra: '' },
}
export type ActionType = 'simple' | 'complex'

export type TormentSeverity = 'minor' | 'major' | 'terrible'

export interface TormentRequirements {
  mode: 'default' | 'custom'
  minCounts?: {
    minor?: number
    major?: number
    terrible?: number
  }
}

export type SkillRenames = Partial<Record<string, string>>

export interface EddySoulRules {
  accuracyIsAgilityAthletics?: boolean
  damageIsBodyFeatsOfStrength?: boolean
  armorIsWillpowerEndurance?: boolean
  baseStatRangesEnabled?: boolean
  chargeAttackCosts3DP?: boolean
  instinctBoostsDodgeArmorSpeed?: boolean
  hugeSizeRequiresMega?: boolean
}

export interface CampaignRulesSettings {
  tormentRequirements?: TormentRequirements
  skillRenames?: SkillRenames
  eddySoulRules?: EddySoulRules
}

export type CampaignLevel = 'standard' | 'enhanced' | 'extreme'

export const DIGIVOLVE_WILLPOWER_DC: Record<CampaignLevel, number> = {
  standard: 12,
  enhanced: 15,
  extreme: 17,
}

// === Stage Configuration ===

export interface StageConfig {
  stage: DigimonStage
  dp: number
  movement: number
  woundBonus: number
  brainsBonus: number  // Added to (Accuracy/2) to calculate Brains derived stat
  attacks: number
  stageBonus: number   // Added to Spec Values (BIT, CPU, RAM)
}

export const STAGE_CONFIG: Record<DigimonStage, StageConfig> = {
  'fresh': { stage: 'fresh', dp: 5, movement: 2, woundBonus: 0, brainsBonus: 0, attacks: 1, stageBonus: 0 },
  'in-training': { stage: 'in-training', dp: 15, movement: 4, woundBonus: 1, brainsBonus: 1, attacks: 2, stageBonus: 0 },
  'rookie': { stage: 'rookie', dp: 25, movement: 6, woundBonus: 2, brainsBonus: 3, attacks: 2, stageBonus: 1 },
  'champion': { stage: 'champion', dp: 40, movement: 8, woundBonus: 5, brainsBonus: 5, attacks: 3, stageBonus: 2 },
  'ultimate': { stage: 'ultimate', dp: 55, movement: 10, woundBonus: 7, brainsBonus: 7, attacks: 4, stageBonus: 3 },
  'mega': { stage: 'mega', dp: 70, movement: 12, woundBonus: 10, brainsBonus: 10, attacks: 5, stageBonus: 4 },
  'ultra': { stage: 'ultra', dp: 85, movement: 14, woundBonus: 12, brainsBonus: 12, attacks: 6, stageBonus: 5 },
}

export const BASE_STAT_RANGES: Partial<Record<DigimonStage, { min: number; max: number }>> = {
  'in-training': { min: 2, max: 4 },
  'rookie':      { min: 3, max: 7 },
  'champion':    { min: 4, max: 9 },
  'ultimate':    { min: 5, max: 11 },
  'mega':        { min: 6, max: 13 },
}

// === Tamer Types ===

export interface TamerAttributes {
  agility: number
  body: number
  charisma: number
  intelligence: number
  willpower: number
}

export interface TamerSkills {
  // Agility
  dodge: number
  fight: number
  stealth: number
  // Body
  athletics: number
  endurance: number
  featsOfStrength: number
  // Charisma
  manipulate: number
  perform: number
  persuasion: number
  // Intelligence
  computer: number
  survival: number
  knowledge: number
  // Willpower
  perception: number
  decipherIntent: number
  bravery: number
}

export interface TamerDerivedStats {
  woundBoxes: number      // Body + Endurance (min 2)
  speed: number           // Agility + Survival
  accuracyPool: number    // Agility + Fight
  dodgePool: number       // Agility + Dodge
  armor: number           // Body + Endurance
  damage: number          // Body + Fight
}

export interface Aspect {
  id: string
  name: string
  description: string
  type: 'major' | 'minor'
  usesRemaining: number   // Major: 1, Minor: 2
}

export interface Torment {
  id: string
  name: string
  description: string
  severity: TormentSeverity
  totalBoxes: number      // Minor: 5, Major: 7, Terrible: 10
  markedBoxes: number
}

export interface Tamer {
  id: string
  name: string
  age: number
  campaignId: string | null
  attributes: TamerAttributes
  skills: TamerSkills
  derivedStats: TamerDerivedStats
  aspects: Aspect[]
  torments: Torment[]
  specialOrders: string[] // IDs of unlocked special orders
  inspiration: number
  maxInspiration: number  // = Willpower (min 1)
  xp: number
  equipment: string[]
  partnerDigimonIds: string[]
  currentWounds: number
  notes: string
  createdAt: Date
  updatedAt: Date
}

// === Digimon Types ===

export interface DigimonBaseStats {
  accuracy: number
  damage: number
  dodge: number
  armor: number
  health: number
}

export interface DigimonDerivedStats {
  // Primary Derived Stats (page 111)
  brains: number          // (Accuracy / 2) + Brains Bonus
  body: number            // ((Health + Damage + Armor) / 3) + Size Bonus
  agility: number         // ((Accuracy + Dodge) / 2) + Size Bonus
  woundBoxes: number      // Health + Wound Box Bonus
  // Spec Values (page 111)
  bit: number             // (Brains / 10) + Stage Bonus
  cpu: number             // (Body / 10) + Stage Bonus
  ram: number             // (Agility / 10) + Stage Bonus
  // Movement
  movement: number        // Base Movement from Stage + modifiers
  // Range & Effective Limit
  range: number           // floor((Accuracy + Brains) / 2) + BIT
  effectiveLimit: number  // floor(Accuracy / 2) + Brains + BIT
}

export interface Attack {
  id: string
  name: string
  range: AttackRange      // [Melee] or [Ranged] - free tag
  type: AttackType        // [Damage] or [Support] - free tag
  tags: string[]          // Quality-based tags (e.g., "Weapon II", "Charge Attack", "Area Attack: Burst 3")
  effect?: string         // Optional effect tag (e.g., "Paralysis", "Poison 3")
  description: string     // Flavor text
}

export interface Quality {
  id: string
  name: string
  type: QualityTypeTag | QualityTypeTag[]
  dpCost: number
  description: string
  effect: string
  ranks?: number
  choiceId?: string
  choiceName?: string
}

export interface Digimon {
  id: string
  name: string
  species: string         // e.g., "Agumon", "Greymon"
  stage: DigimonStage
  attribute: DigimonAttribute
  family: DigimonFamily
  type: string            // e.g., "Dinosaur", "Dragon"
  size: DigimonSize       // Affects Body and Agility derived stats
  baseStats: DigimonBaseStats
  derivedStats: DigimonDerivedStats
  attacks: Attack[]
  qualities: Quality[]
  dataOptimization: string | null  // e.g., "close-combat", "ranged-striker"
  baseDP: number          // DP used for building
  bonusDP: number         // Earned through play
  currentWounds: number
  currentStance: Stance
  evolutionPathIds: string[]  // IDs of evolutions this can evolve to
  evolvesFromId: string | null  // ID of the Digimon this evolves from
  partnerId: string | null    // Tamer ID if partnered
  isEnemy: boolean
  notes: string
  spriteUrl: string | null
  createdAt: Date
  updatedAt: Date
}

// === Encounter Types ===

export interface CombatParticipant {
  id: string
  type: 'tamer' | 'digimon'
  entityId: string        // Reference to Tamer or Digimon ID
  initiative: number
  initiativeRoll: number  // The 3d6 roll result
  actionsRemaining: {
    simple: number
    complex: number       // 1 complex = 2 simple
  }
  currentStance: Stance
  activeEffects: ActiveEffect[]
  isActive: boolean       // Currently taking turn
  hasActed: boolean       // Has completed turn this round
  hasAttemptedDigivolve?: boolean  // Has attempted digivolution this turn (evolve only, not devolve)
  npcStageIndex?: number  // NPC-only: tracks current stage independently (allows multiple NPCs to share one evo line)
  combatMonsterBonus?: number  // Combat Monster: cumulative damage bonus for next successful attack
}

export interface ActiveEffect {
  id: string
  name: string
  type: 'buff' | 'debuff' | 'status'
  duration: number        // Rounds remaining
  source: string          // Who applied it
  description: string
  value?: number          // Optional numeric value (used by Directed bonus, etc.)
}

export interface Encounter {
  id: string
  name: string
  description: string
  round: number
  phase: 'setup' | 'initiative' | 'combat' | 'ended'
  participants: CombatParticipant[]
  turnOrder: string[]     // Participant IDs in initiative order
  currentTurnIndex: number
  battleLog: BattleLogEntry[]
  hazards: EnvironmentHazard[]
  createdAt: Date
  updatedAt: Date
}

export interface BattleLogEntry {
  id: string
  timestamp: Date
  round: number
  actorId: string
  actorName: string
  action: string
  target: string | null
  result: string
  damage: number | null
  effects: string[]
}

export interface EnvironmentHazard {
  id: string
  name: string
  description: string
  effect: string
  affectedArea: string
  duration: number | null  // null = permanent
}

// === Campaign Types ===

export interface Campaign {
  id: string
  name: string
  description: string
  level: CampaignLevel
  hasPassword: boolean
  hasDmPassword: boolean
  rulesSettings: CampaignRulesSettings
  createdAt: Date
  updatedAt: Date
}

// === Utility Functions ===

export function calculateTamerDerivedStats(
  attributes: TamerAttributes,
  skills: TamerSkills,
  eddySoulRules?: EddySoulRules
): TamerDerivedStats {
  return {
    woundBoxes: Math.max(2, attributes.body + skills.endurance),
    speed: attributes.agility + skills.survival,
    accuracyPool: eddySoulRules?.accuracyIsAgilityAthletics
      ? attributes.agility + skills.athletics
      : attributes.agility + skills.fight,
    dodgePool: attributes.agility + skills.dodge,
    armor: eddySoulRules?.armorIsWillpowerEndurance
      ? attributes.willpower + skills.endurance
      : attributes.body + skills.endurance,
    damage: eddySoulRules?.damageIsBodyFeatsOfStrength
      ? attributes.body + skills.featsOfStrength
      : attributes.body + skills.fight,
  }
}

export function calculateDigimonDerivedStats(
  baseStats: DigimonBaseStats,
  stage: DigimonStage,
  size: DigimonSize = 'medium'
): DigimonDerivedStats {
  const stageConfig = STAGE_CONFIG[stage]
  const sizeConfig = SIZE_CONFIG[size]

  // Primary Derived Stats (page 111) - always round down
  // Size affects Body and Agility differently (page 110)
  const brains = Math.floor(baseStats.accuracy / 2) + stageConfig.brainsBonus
  const body = Math.max(0, Math.floor((baseStats.health + baseStats.damage + baseStats.armor) / 3) + sizeConfig.bodyBonus)
  const agility = Math.max(0, Math.floor((baseStats.accuracy + baseStats.dodge) / 2) + sizeConfig.agilityBonus)

  // Spec Values (page 111) - derived from derived stats
  const bit = Math.floor(brains / 10) + stageConfig.stageBonus
  const cpu = Math.floor(body / 10) + stageConfig.stageBonus
  const ram = Math.floor(agility / 10) + stageConfig.stageBonus

  const range = Math.floor((baseStats.accuracy + brains) / 2) + bit
  const effectiveLimit = Math.floor(baseStats.accuracy / 2) + brains + bit

  return {
    brains,
    body,
    agility,
    woundBoxes: baseStats.health + stageConfig.woundBonus,
    bit,
    cpu,
    ram,
    movement: stageConfig.movement,
    range,
    effectiveLimit,
  }
}

export function rollInitiative(agility: number): { total: number; roll: number } {
  // 3d6 + Agility
  const roll = Math.floor(Math.random() * 6) + 1 +
               Math.floor(Math.random() * 6) + 1 +
               Math.floor(Math.random() * 6) + 1
  return { total: roll + agility, roll }
}

export function getTormentBoxCount(severity: TormentSeverity): number {
  switch (severity) {
    case 'minor': return 5
    case 'major': return 7
    case 'terrible': return 10
  }
}
