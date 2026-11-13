// =====================================
// Digimon Digital Adventure 1.4 Types
// =====================================

import type { EncounterIntercedeOptOuts } from '../utils/intercedeOptOuts'
import type { CombatParticipant } from './combat'

export type { ActiveEffect, ClashState, CombatParticipant, StoredCombatParticipant } from './combat'

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

// === Map Types ===

export type ElementType = 'fire' | 'water' | 'wind' | 'ice' | 'thunder' | 'wood' | 'earth' | 'darkness' | 'steel' | 'light' | 'void'
export type TerrainType = 'normal' | 'water' | 'earth' | 'climbable'
export type SpaceType = 'air' | 'water' | 'earth'
export type WallFace = 'north' | 'south' | 'east' | 'west'
export type MapTool = 'area-select' | 'stamp' | 'eyedropper' | 'room' | 'select' | 'add-space' | 'add-ground' | 'paint-element' | 'voxel' | 'ramp' | 'wall' | 'window' | 'door' | 'ceiling' | 'stairs' | 'delete' | 'spawn'
export type AreaTag = 'blast' | 'burst' | 'close-blast' | 'cone' | 'line' | 'pass'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface MapGroundTile {
  materialId?: string
  x: number
  y: number
  z: number
  element: ElementType
  terrain: TerrainType
  isSpawnPoint?: boolean
}

export interface MapSpaceTile {
  x: number
  y: number
  z: number
  spaceType: SpaceType
}

export interface MapVoxel {
  x: number
  y: number
  z: number
  /** Omitted on older maps, which use full blocks. Shapes share voxel grid movement rules. */
  shape?: 'block' | 'ramp'
  /** Direction the ramp ascends; defaults to north. */
  rampDirection?: WallFace
  /** Material id. Existing element ids are valid material ids. */
  materialId: string
  /** Optional elemental affinity for DDA rules/UI. */
  element?: ElementType
  /** Optional custom #rrggbb color override. */
  color?: string
  /** Overrides material movement blocking; defaults to material behavior. */
  blocksMovement?: boolean
  /** Overrides material line-of-sight blocking; defaults to material behavior. */
  blocksSight?: boolean
  /** Optional opacity override for transparent terrain such as water/glass. */
  opacity?: number
  /** Gameplay feature carved into this voxel. */
  feature?: 'window'
  /** Units may be placed on top of this voxel during player placement. */
  isSpawnPoint?: boolean
  tags?: string[]
}

export interface MapWall {
  id: string
  x: number
  y: number
  z: number
  face: WallFace
  woundBoxes?: number  // undefined = unbreakable
}

export interface MapWindow {
  id: string
  wallId: string       // must be placed on a wall
  woundBoxes?: number  // undefined = unbreakable
}

export interface MapDoor {
  id: string
  wallId: string       // must be placed on a wall
  isOpen: boolean
}

export interface MapCeiling {
  id: string
  x: number
  y: number
  z: number
  woundBoxes?: number  // undefined = unbreakable
}

export interface MapStair {
  id: string
  x: number
  y: number
  z: number
  /** Legacy facing; use stairDirectionForFace to resolve the visible uphill direction. */
  face: WallFace
}

export interface GameMap {
  /** Content-derived display metadata; never constrains the map. */
  contentBounds?: import('~/utils/mapContentBounds').MapContentBounds | null
  ownerId?: string | null
  hidden?: boolean
  id: string
  name: string
  description: string
  campaignId: string | null
  dimensions: { width: number; depth: number; height?: number }
  groundTiles: MapGroundTile[]
  spaceTiles: MapSpaceTile[]
  voxels: MapVoxel[]
  walls: MapWall[]
  windows: MapWindow[]
  doors: MapDoor[]
  ceilings: MapCeiling[]
  stairs: MapStair[]
  createdAt: string
  updatedAt: string
}

export const ELEMENT_COLORS: Record<ElementType, number> = {
  fire:      0xff4422,
  water:     0x2288ff,
  wind:      0x88ddaa,
  ice:       0xaaddff,
  thunder:   0xffdd00,
  wood:      0x44aa44,
  earth:     0x886644,
  darkness:  0x442266,
  steel:     0x99aabb,
  light:     0xffffcc,
  void:      0x555566,
}

export interface DestructibleState {
  structureId: string
  currentWounds: number
}

// One entry in the campaign-wide roll history (skill/attribute/torment rolls
// plus "new day" markers). Mirrors the roll_log table row shape; createdAt is
// a Date server-side but a string once JSON-serialized over HTTP/WS.
export interface RollLogEntry {
  id: string
  campaignId: string
  kind: 'roll' | 'new-day'
  tamerId: string | null
  characterName: string | null
  spriteUrl: string | null
  rollName: string | null
  rolls: number[]
  modifier: number
  total: number
  passed: boolean | null
  createdAt: string | Date
}

// One GM-prepared tab in the Scene editor (campaigns.scene_presets). Empty strings
// mean an empty tab; only the scene the GM actually shows is ever sent to players.
export interface ScenePreset {
  imageUrl: string
  caption: string
}

export const MAX_SCENE_PRESETS = 10

export type WebSocketMapMessage =
  | { type: 'unit-moved';       encounterId: string; participantId: string; position: Vec3; path: Vec3[]; version: number }
  | { type: 'map-edited';       encounterId: string; changeType: 'add' | 'remove'; tileType: 'ground' | 'space' | 'voxel' | 'wall' | 'window' | 'door' | 'ceiling' | 'stairs'; data: unknown }
  | { type: 'door-toggled';     encounterId: string; doorId: string; isOpen: boolean }
  | { type: 'element-painted';  encounterId: string; x: number; y: number; z: number; element: ElementType }
  | { type: 'structure-damaged'; encounterId: string; structureId: string; woundsRemaining: number; version: number }
  | { type: 'position-patch';   encounterId: string; patch: Record<string, Vec3>; version: number }
  | { type: 'full-state';       encounterId: string; participantPositions: Record<string, Vec3>; destructibleStates: DestructibleState[]; version: number }
  | { type: 'encounter-updated'; encounterId: string }
  | { type: 'encounter-state';  encounterId: string; encounter: Encounter; version: number }
  | { type: 'roll-logged';      campaignId: string; entry: RollLogEntry }
  | { type: 'scene-updated';    campaignId: string; sceneImageUrl: string | null; sceneImageCaption: string | null }

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
  hugePowerOncePerTurn?: boolean
  agilityRank2RequiresUltimate?: boolean
  combatMonsterAreaAttackRequiresComplex?: boolean
  chromeWeaponNoWeaponRankRequired?: boolean
  digizoidArmourRequiresInstinct?: boolean
  buffingContested?: boolean
  digivolutionLimit5PerDay?: boolean
  warpEvolution?: boolean
  bonusDPMinPerCategory?: boolean
  enemyDoubleWounds?: boolean
  directRangeOverrides?: { direct?: number; bolsterDirect?: number; digivolve?: number }
  modeChangeFreeSwapsPerCombat?: boolean
  poisonTicksAtTurnEnd?: boolean  // Poison damages at the end of the poisoned unit's own turn (partner digimon: its Tamer's turn) instead of at the end of each round
  burnPerTwoSpacesMoved?: boolean  // Burn deals 1 damage per 2 spaces moved, ignoring Armor, and nothing to a burned Digimon that stays still all round
}

export interface HouseRules {
  stunMaxDuration1?: boolean
  maxTempWoundsRule?: boolean
  signatureMoveBattery?: boolean
  newDayHealsAllWounds?: boolean
  allowDuplicateStatValues?: boolean
  allowFlexCPSplits?: boolean
  giganticMaxSize?: { x: number; y: number; z: number } | null
  skillOrders?: boolean
  burnStationaryIgnoresArmor?: boolean  // Burn's Stage Bonus × 2 for a round without moving isn't reduced by Armor (default: reduced, minimum 1)
}

export const STAGE_BATTERY_CAPACITY: Partial<Record<DigimonStage, number>> = {
  'champion': 2,
  'ultimate': 3,
  'mega': 4,
  'ultra': 5,
}

export interface CampaignRulesSettings {
  houseRules?: HouseRules
  tormentRequirements?: TormentRequirements
  skillRenames?: SkillRenames
  eddySoulRules?: EddySoulRules
  skillOrders?: boolean
}

// The subset of campaign settings that affects character CREATION (not combat).
// Snapshotted onto sandbox (workshop) characters and embedded in export bundles
// so imports can verify rule parity. skillRenames is carried for display
// fidelity only and is never part of the parity comparison.
export interface CreationRules {
  level: CampaignLevel
  eddySoulRules?: Pick<EddySoulRules,
    | 'accuracyIsAgilityAthletics'
    | 'damageIsBodyFeatsOfStrength'
    | 'armorIsWillpowerEndurance'
    | 'baseStatRangesEnabled'
    | 'chargeAttackCosts3DP'
    | 'instinctBoostsDodgeArmorSpeed'
    | 'hugeSizeRequiresMega'
    | 'bonusDPMinPerCategory'
  >
  houseRules?: Pick<HouseRules,
    | 'allowDuplicateStatValues'
    | 'allowFlexCPSplits'
    | 'giganticMaxSize'
    | 'skillOrders'
  >
  tormentRequirements?: TormentRequirements
  skillRenames?: SkillRenames
}

export type CampaignLevel = 'standard' | 'enhanced' | 'extreme'

export const DIGIVOLVE_WILLPOWER_DC: Record<CampaignLevel, number> = {
  standard: 12,
  enhanced: 15,
  extreme: 17,
}

// Inspiration: cost to trigger Act of Inspiration (1 below Starting Cap per level)
export const INSPIRATION_ACT_COST: Record<CampaignLevel, number> = {
  standard: 2,
  enhanced: 4,
  extreme: 6,
}

// Inspiration: cost to trigger Fateful Intervention (entire maximum pool per level)
export const INSPIRATION_FATEFUL_COST: Record<CampaignLevel, number> = {
  standard: 5,
  enhanced: 7,
  extreme: 10,
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
  cpMarkedBoxes?: number
  gmMarkedBoxes?: number
  xpBoxCosts?: number[]
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
  grantedInspiration: number
  maxInspiration: number  // = Willpower (min 1)
  xp: number
  totalXp?: number | null // Lifetime earned; null for characters predating tracking.
  xpBonuses: {
    attributes: TamerAttributes
    skills: TamerSkills
    inspiration: number
  }
  equipment: string[]
  partnerDigimonIds: string[]
  currentWounds: number
  usedPerDayOrders: string[]        // order names used today (once-per-day)
  usedPerDaySkillOrders: string[]   // skill order names used today (once-per-day)
  digivolutionsUsedToday: number    // for EddySoul digivolution limit rule
  notes: string
  creationRules?: CreationRules | null  // sandbox (workshop) characters: rules snapshot they were built under
  ownerId?: string | null               // account that created the record (accounts feature)
  hidden?: boolean                      // workshop-only: owner hid this character from other users
  publicAccess?: boolean                // in-campaign access: anyone with campaign access can view/edit if true
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
  baseMovement?: number    // Basic Movement before Speedy
  movement: number        // Base Movement from Stage + modifiers
  // Range & Effective Limit
  range: number           // floor((Accuracy + Brains) / 2) + BIT
  effectiveLimit: number  // floor(Accuracy / 2) + Brains + BIT
  stageBonus: number      // Stage Bonus for this stage (also already baked into bit/cpu/ram)
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
  nickname: string | null  // optional player-given name
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
  isDarkEvolution: boolean
  giganticDimensions?: { width: number; height: number; depth: number } | null
  notes: string
  spriteUrl: string | null
  creationRules?: CreationRules | null  // sandbox (workshop) characters: rules snapshot they were built under
  ownerId?: string | null               // account that created the record (accounts feature)
  hidden?: boolean                      // workshop-only: owner hid this character from other users
  createdAt: Date
  updatedAt: Date
}

// === Encounter Types ===

export interface Encounter {
  id: string
  revision?: number             // database row revision; orders encounter snapshots across sources
  name: string
  description: string
  round: number
  phase: 'setup' | 'initiative' | 'combat' | 'ended'
  participants: CombatParticipant[]
  turnOrder: string[]     // Participant IDs in initiative order
  currentTurnIndex: number
  battleLog: BattleLogEntry[]
  hazards: EnvironmentHazard[]
  mapId?: string | null
  visibleToPlayers: boolean      // GM-controlled: players see nothing of this encounter until true
  intercedeOptOuts: EncounterIntercedeOptOuts  // "Never intercede" lists — read via ~/utils/intercedeOptOuts
  participantPositions: Record<string, Vec3>   // participantId → Vec3
  destructibleStates: DestructibleState[]
  createdAt: Date
  updatedAt: Date
  version?: number               // room sync version (present on pushed/detail payloads)
  _battleLogTotal?: number       // total battle log entries before trimming
  _battleLogWasTrimmed?: boolean // true if battleLog was truncated to the most recent entries
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
  naturewalkEnvironment?: { elements: ElementType[]; useMapTerrain: boolean }
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
  ownerId: string | null  // stamped at creation only if logged in; never reassigned
  createdAt: Date
  updatedAt: Date
}

// === Account Types ===

export interface AccountUser {
  id: string
  username: string
}

export interface CampaignAccessGrant {
  id: string
  campaignId: string
  userId: string
  username: string  // joined in for display
  dmRole: 'co-dm' | 'co-owner' | null
}

// Per-tamer player access grant — one row per (tamer, account); a tamer can
// have many, and an account can hold grants on many tamers.
export interface TamerAccessGrant {
  id: string
  tamerId: string
  tamerName: string  // joined in for display
  userId: string
  username: string   // joined in for display
}

// The current viewer's access to a specific campaign (session + grant + ownership resolved server-side)
export interface MyCampaignAccess {
  userId: string | null
  isOwner: boolean
  isCoOwner: boolean
  isCoDm: boolean
  accessibleTamerIds: string[]
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
    stageBonus: stageConfig.stageBonus,
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
