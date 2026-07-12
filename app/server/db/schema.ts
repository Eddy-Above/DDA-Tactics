import { pgTable, text, integer, boolean, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'
import type { CreationRules } from '../../types'

// =====================================
// Tamers Table
// =====================================

export const tamers = pgTable('tamers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  campaignId: text('campaign_id').references(() => campaigns.id),

  // Attributes (stored as JSON for flexibility)
  attributes: jsonb('attributes').notNull().$type<{
    agility: number
    body: number
    charisma: number
    intelligence: number
    willpower: number
  }>(),

  // Skills (stored as JSON)
  skills: jsonb('skills').notNull().$type<{
    dodge: number
    fight: number
    stealth: number
    athletics: number
    endurance: number
    featsOfStrength: number
    manipulate: number
    perform: number
    persuasion: number
    computer: number
    survival: number
    knowledge: number
    perception: number
    decipherIntent: number
    bravery: number
  }>(),

  // Aspects (stored as JSON array)
  aspects: jsonb('aspects').notNull().$type<Array<{
    id: string
    name: string
    description: string
    type: 'major' | 'minor'
    usesRemaining: number
  }>>(),

  // Torments (stored as JSON array)
  torments: jsonb('torments').notNull().$type<Array<{
    id: string
    name: string
    description: string
    severity: 'minor' | 'major' | 'terrible'
    totalBoxes: number
    markedBoxes: number
    cpMarkedBoxes: number // Boxes marked at creation with CP (locked, can't be removed)
  }>>(),

  // Special Orders (array of unlocked order IDs)
  specialOrders: jsonb('special_orders').notNull().$type<string[]>(),

  inspiration: integer('inspiration').notNull().default(1),
  grantedInspiration: integer('granted_inspiration').notNull().default(0),
  xp: integer('xp').notNull().default(0),

  // XP Bonuses - stored separately from base values for reallocation
  xpBonuses: jsonb('xp_bonuses').notNull().default({
    attributes: { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 },
    skills: {
      dodge: 0, fight: 0, stealth: 0,
      athletics: 0, endurance: 0, featsOfStrength: 0,
      manipulate: 0, perform: 0, persuasion: 0,
      computer: 0, survival: 0, knowledge: 0,
      perception: 0, decipherIntent: 0, bravery: 0,
    },
    inspiration: 0,
  }).$type<{
    attributes: { agility: number; body: number; charisma: number; intelligence: number; willpower: number }
    skills: {
      dodge: number; fight: number; stealth: number
      athletics: number; endurance: number; featsOfStrength: number
      manipulate: number; perform: number; persuasion: number
      computer: number; survival: number; knowledge: number
      perception: number; decipherIntent: number; bravery: number
    }
    inspiration: number
  }>(),

  // Equipment (array of item names/descriptions)
  equipment: jsonb('equipment').notNull().$type<string[]>(),

  currentWounds: integer('current_wounds').notNull().default(0),
  usedPerDayOrders: jsonb('used_per_day_orders').notNull().default([]).$type<string[]>(),
  usedPerDaySkillOrders: jsonb('used_per_day_skill_orders').notNull().default([]).$type<string[]>(),
  digivolutionsUsedToday: integer('digivolutions_used_today').notNull().default(0),
  notes: text('notes').notNull().default(''),
  spriteUrl: text('sprite_url'),

  // Workshop (sandbox) characters: rules snapshot they were built under
  creationRules: jsonb('creation_rules').$type<CreationRules | null>(),
  // Reserved for future accounts feature (unused for now)
  ownerId: text('owner_id'),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Digimon Table
// =====================================

export const digimon = pgTable('digimon', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nickname: text('nickname'),

  stage: text('stage').notNull().$type<
    'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'
  >(),

  attribute: text('attribute').notNull().$type<'vaccine' | 'data' | 'virus' | 'free'>(),
  family: text('family').notNull(),
  type: text('type'), // e.g., "Dinosaur", "Dragon" - optional
  size: text('size').notNull().default('medium').$type<
    'tiny' | 'small' | 'medium' | 'large' | 'huge' | 'gigantic'
  >(),

  // Base Stats
  baseStats: jsonb('base_stats').notNull().$type<{
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }>(),

  // Attacks (stored as JSON array) - DDA 1.4 format
  // Attacks have: range (melee/ranged), type (damage/support), tags from qualities, optional effect
  attacks: jsonb('attacks').notNull().$type<Array<{
    id: string
    name: string
    range: 'melee' | 'ranged'        // [Melee] or [Ranged] - free tag
    type: 'damage' | 'support'        // [Damage] or [Support] - free tag
    tags: string[]                    // Quality-based tags (e.g., "Weapon II", "Charge Attack", "Area Attack: Burst 3")
    effect?: string                   // Optional effect tag (e.g., "Paralysis", "Poison 3")
    description: string               // Flavor text for the attack
  }>>(),

  // Qualities (stored as JSON array)
  qualities: jsonb('qualities').notNull().$type<Array<{
    id: string
    name: string
    type: 'static' | 'trigger' | 'attack' | Array<'static' | 'trigger' | 'attack'>
    dpCost: number
    description: string
    effect: string
    ranks?: number
    choiceId?: string
    choiceName?: string
  }>>(),

  dataOptimization: text('data_optimization'),
  baseDP: integer('base_dp').notNull(),
  bonusDP: integer('bonus_dp').notNull().default(0),
  // Track bonus DP allocation per stat
  bonusStats: jsonb('bonus_stats').notNull().default({ accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }).$type<{
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }>(),
  bonusDPForQualities: integer('bonus_dp_for_qualities').notNull().default(0),

  currentWounds: integer('current_wounds').notNull().default(0),
  currentStance: text('current_stance').notNull().default('neutral').$type<
    'neutral' | 'defensive' | 'offensive' | 'sniper' | 'brave'
  >(),

  // Evolution paths (array of Digimon IDs this can evolve to)
  evolutionPathIds: jsonb('evolution_path_ids').notNull().$type<string[]>(),

  // Evolution link (ID of the Digimon this evolves from)
  evolvesFromId: text('evolves_from_id'),

  partnerId: text('partner_id').references(() => tamers.id),
  isEnemy: boolean('is_enemy').notNull().default(false),
  isDarkEvolution: boolean('is_dark_evolution').notNull().default(false),
  campaignId: text('campaign_id').references(() => campaigns.id),

  giganticDimensions: jsonb('gigantic_dimensions').$type<{
    width: number
    height: number
    depth: number
  } | null>(),

  notes: text('notes').notNull().default(''),
  spriteUrl: text('sprite_url'),

  // Workshop (sandbox) characters: rules snapshot they were built under
  creationRules: jsonb('creation_rules').$type<CreationRules | null>(),
  // Reserved for future accounts feature (unused for now)
  ownerId: text('owner_id'),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Encounters Table
// =====================================

export const encounters = pgTable('encounters', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),

  round: integer('round').notNull().default(0),
  phase: text('phase').notNull().default('setup').$type<
    'setup' | 'initiative' | 'combat' | 'ended'
  >(),

  // Participants with full combat state
  participants: jsonb('participants').notNull().$type<Array<{
    id: string
    type: 'tamer' | 'digimon'
    entityId: string
    initiative: number
    initiativeRoll: number
    actionsRemaining: { simple: number }
    currentStance: 'neutral' | 'defensive' | 'offensive' | 'sniper' | 'brave'
    activeEffects: Array<{
      id: string
      name: string
      type: 'buff' | 'debuff' | 'status'
      duration: number
      source: string
      description: string
      value?: number
      potency?: number
      potencyStat?: string
    }>
    isActive: boolean
    hasActed: boolean
    name?: string
    currentWounds?: number
    maxWounds?: number
    currentTempWounds?: number
    usedAttackIds?: string[]
    dodgePenalty?: number
    evolutionLineId?: string
    woundsHistory?: Array<{ stageIndex: number; wounds: number; entityId: string; maxWounds: number }>
    usedSpecialOrders?: string[]
    usedSkillOrders?: string[]
    interceptPenalty?: number
    intercedeOptOuts?: string[]
    gmCharacterOptOuts?: Record<string, string[]>
    hasDirectedThisTurn?: boolean
    digimonBolsterCount?: number
    lastBitCpuBolsterRound?: number
    lastHugePowerRound?: number
    lastHugePowerRank2Round?: number
    isEnemy?: boolean
    battery?: number
    usedSignatureMoveThisTurn?: boolean
    combatMonsterBonus?: number
    totalHealth?: number
    hasAttemptedDigivolve?: boolean
    npcStageIndex?: number
    clash?: {
      clashId: string
      opponentParticipantId: string
      isController: boolean
      isPinned: boolean
      clashPinsUsed?: number
      clashCheckNeeded: boolean
      pendingRoll?: number
      reachInitiated?: boolean
      reachDistance?: number
      cannotInitiateUntilRound?: number
    }
    clashCooldownUntilRound?: number
    usedFreeClashThisRound?: boolean
    usedCounterattackThisCombat?: boolean
    moodValue?: number
    currentInspiration?: number
    divineProtectionUsesThisBattle?: number
    pendingDivineProtectionDamage?: number
    pendingSimpleActionPenalty?: number
    statSwaps?: Partial<Record<'accuracy' | 'damage' | 'dodge' | 'armor', 'accuracy' | 'damage' | 'dodge' | 'armor'>>
    quickReactionDiceBonus?: number
    stunActionReducedThisRound?: boolean
    dataAbsorbActive?: boolean
    dataAbsorbHealAmount?: number
    maxPostTurnIntercedes?: number
    seenAttackIds?: Record<string, number>
    juggernauntBonuses?: Partial<Record<'accuracy' | 'damage' | 'dodge' | 'armor', number>>
    timeControlUsed?: boolean
    buggedSpecValues?: { bit: number; cpu: number; ram: number }
    demoralizedAttributes?: Partial<Record<'agility' | 'body' | 'charisma' | 'intelligence' | 'willpower', number>>
    tormentorBonusStacks?: number
    tankBusterUsedAtThresholds?: number[]
    mapPosition?: { x: number; y: number; z: number }
  }>>(),

  // Turn order (participant IDs)
  turnOrder: jsonb('turn_order').notNull().$type<string[]>(),
  currentTurnIndex: integer('current_turn_index').notNull().default(0),

  // Battle log
  battleLog: jsonb('battle_log').notNull().$type<Array<{
    id: string
    timestamp: string
    round: number
    actorId: string
    actorName: string
    action: string
    target: string | null
    result: string
    damage: number | null
    effects: string[]
    hit?: boolean
    dodgeDicePool?: number
    dodgeDiceResults?: number[]
    dodgeSuccesses?: number
    accuracyDicePool?: number
    accuracyDiceResults?: number[]
    accuracySuccesses?: number
    attackerParticipantId?: string
    baseDamage?: number
    netSuccesses?: number
    targetArmor?: number
    armorPiercing?: number
    effectiveArmor?: number
    finalDamage?: number
  }>>(),

  // Environmental hazards
  hazards: jsonb('hazards').notNull().$type<Array<{
    id: string
    name: string
    description: string
    effect: string
    affectedArea: string
    duration: number | null
  }>>(),

  // Pending player requests (digimon selection, initiative roll, dodge roll, etc.)
  pendingRequests: jsonb('pending_requests').notNull().default([]).$type<Array<{
    id: string
    type: 'digimon-selection' | 'initiative-roll' | 'dodge-roll' | 'intercede-offer' | 'intercede-group-state' | 'clash-check' | 'counterattack-prompt' | 'health-roll' | 'divine-protection-offer' | 'throw-impact-attack'
    targetTamerId: string
    targetParticipantId?: string
    timestamp: string
    data?: any
  }>>(),

  // Player responses to requests
  requestResponses: jsonb('request_responses').notNull().default([]).$type<Array<{
    id: string
    requestId: string
    tamerId: string
    participantId?: string
    response: {
      type: 'digimon-selected' | 'initiative-rolled' | 'dodge-rolled'
      digimonId?: string
      initiative?: number
      initiativeRoll?: number
      dodgeRoll?: number
      timestamp: string
      attackerParticipantId?: string
      attackerName?: string
    }
  }>>(),

  campaignId: text('campaign_id').references(() => campaigns.id),
  mapId: text('map_id'),  // FK to maps.id (added via migration; FK constraint omitted to avoid circular ref at schema load time)

  // Map state: participant positions and breakable structure states
  participantPositions: jsonb('participant_positions').notNull().default({}).$type<Record<string, { x: number; y: number; z: number }>>(),
  destructibleStates: jsonb('destructible_states').notNull().default([]).$type<Array<{ structureId: string; currentWounds: number }>>(),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Campaigns Table
// =====================================

export const campaigns = pgTable('campaigns', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  level: text('level').notNull().default('standard').$type<'standard' | 'enhanced' | 'extreme'>(),

  passwordHash: text('password_hash'),
  dmPasswordHash: text('dm_password_hash'),
  rulesSettings: jsonb('rules_settings').notNull().default({}).$type<Record<string, any>>(),

  // Stamped only at creation time if the creator was logged in; never
  // reassigned afterward (no ownership transfer/retroactive claiming).
  ownerId: text('owner_id'),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Roll Log Table
// =====================================

// Campaign-wide log of player skill/attribute/torment rolls plus "new day"
// markers. Append-only; pruned to the newest 50 rows per campaign on insert
// (see server/utils/rollLog.ts) so storage stays bounded per campaign.
export const rollLog = pgTable('roll_log', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),  // FK to campaigns.id (constraint omitted, matching encounters.mapId pattern)
  kind: text('kind').notNull().$type<'roll' | 'new-day'>(),

  tamerId: text('tamer_id'),
  characterName: text('character_name'),  // snapshot at roll time
  spriteUrl: text('sprite_url'),          // snapshot at roll time
  rollName: text('roll_name'),

  rolls: jsonb('rolls').notNull().default([]).$type<number[]>(),
  modifier: integer('modifier').notNull().default(0),
  total: integer('total').notNull().default(0),
  passed: boolean('passed'),  // torment rolls only

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
}, (table) => ({
  campaignCreatedIdx: index('roll_log_campaign_created_idx').on(table.campaignId, table.createdAt),
}))

// =====================================
// Evolution Lines Table
// =====================================

export const evolutionLines = pgTable('evolution_lines', {
  id: text('id').primaryKey(),
  name: text('name').notNull(), // e.g., "Agumon Line", "Gabumon Line"
  description: text('description').notNull().default(''),

  // The evolution tree of Digimon forms in this evolution line
  // Each entry must link to an actual Digimon in the library
  // GM can lock/unlock individual stages to control progression
  // Tree structure uses evolvesFromIndex to track parent-child relationships
  chain: jsonb('chain').notNull().$type<Array<{
    stage: 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'
    species: string // Species name (e.g., "Agumon", "Greymon")
    digimonId: string // Required: Link to actual Digimon sheet from library
    isUnlocked: boolean // GM can unlock/lock this stage
    evolvesFromIndex: number | null // Index of parent form in chain (null for root)
  }>>(),

  // Which tamer owns this evolution line (for partner Digimon)
  partnerId: text('partner_id').references(() => tamers.id),
  campaignId: text('campaign_id').references(() => campaigns.id),

  // Current stage index in the chain (0 = first stage, always unlocked)
  // Tracks which form the Digimon is currently in during the session
  currentStageIndex: integer('current_stage_index').notNull().default(0),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Maps Table
// =====================================

export const maps = pgTable('maps', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  campaignId: text('campaign_id').references(() => campaigns.id),

  dimensions: jsonb('dimensions').notNull().$type<{
    width: number
    depth: number
    height: number
  }>(),

  groundTiles: jsonb('ground_tiles').notNull().default([]).$type<Array<{
    x: number; y: number; z: number
    element: string
    terrain: string
  }>>(),

  spaceTiles: jsonb('space_tiles').notNull().default([]).$type<Array<{
    x: number; y: number; z: number
    spaceType: string
  }>>(),

  voxels: jsonb('voxels').notNull().default([]).$type<Array<{
    x: number; y: number; z: number
    materialId: string
    element?: string
    color?: string
    blocksMovement?: boolean
    blocksSight?: boolean
    opacity?: number
    feature?: 'window'
    isSpawnPoint?: boolean
    tags?: string[]
  }>>(),

  walls: jsonb('walls').notNull().default([]).$type<Array<{
    id: string; x: number; y: number; z: number
    face: string
    woundBoxes?: number
  }>>(),

  windows: jsonb('windows').notNull().default([]).$type<Array<{
    id: string
    wallId: string
    woundBoxes?: number
  }>>(),

  doors: jsonb('doors').notNull().default([]).$type<Array<{
    id: string
    wallId: string
    isOpen: boolean
  }>>(),

  ceilings: jsonb('ceilings').notNull().default([]).$type<Array<{
    id: string; x: number; y: number; z: number
    woundBoxes?: number
  }>>(),

  stairs: jsonb('stairs').notNull().default([]).$type<Array<{
    id: string; x: number; y: number; z: number
    face: string
  }>>(),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Users / Sessions / Campaign Access Grants Tables
// =====================================

// Optional accounts: username + password only, no personal data.
// Case-insensitive uniqueness is enforced via a functional unique index in
// migration 0016 (CREATE UNIQUE INDEX ... ON users (LOWER(username))).
export const users = pgTable('users', {
  id: text('id').primaryKey(),
  username: text('username').notNull(),
  passwordHash: text('password_hash').notNull(),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// Server-side sessions backing an httpOnly cookie. The row id itself is the
// opaque session token (the cookie value) — no separate token column.
export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  expiresAt: timestamp('expires_at').notNull(),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
})

// One row per (campaign, account). Holds two independent grant axes at
// once so a single account can e.g. be a co-dm AND scoped to one specific
// player tamer simultaneously.
export const campaignAccessGrants = pgTable('campaign_access_grants', {
  id: text('id').primaryKey(),
  campaignId: text('campaign_id').notNull(),
  userId: text('user_id').notNull(),

  dmRole: text('dm_role').$type<'co-dm' | 'co-owner' | null>(),
  playerScope: text('player_scope').$type<'all' | 'specific' | null>(),
  playerTamerId: text('player_tamer_id'),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Relations
// =====================================

export const mapsRelations = relations(maps, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [maps.campaignId],
    references: [campaigns.id],
  }),
}))

export const campaignsRelations = relations(campaigns, ({ many }) => ({
  tamers: many(tamers),
  digimon: many(digimon),
  encounters: many(encounters),
  evolutionLines: many(evolutionLines),
  maps: many(maps),
}))

export const tamersRelations = relations(tamers, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [tamers.campaignId],
    references: [campaigns.id],
  }),
  partnerDigimon: many(digimon),
  evolutionLines: many(evolutionLines),
}))

export const digimonRelations = relations(digimon, ({ one }) => ({
  partner: one(tamers, {
    fields: [digimon.partnerId],
    references: [tamers.id],
  }),
  campaign: one(campaigns, {
    fields: [digimon.campaignId],
    references: [campaigns.id],
  }),
}))

export const encountersRelations = relations(encounters, ({ one }) => ({
  campaign: one(campaigns, {
    fields: [encounters.campaignId],
    references: [campaigns.id],
  }),
}))

export const evolutionLinesRelations = relations(evolutionLines, ({ one }) => ({
  partner: one(tamers, {
    fields: [evolutionLines.partnerId],
    references: [tamers.id],
  }),
  campaign: one(campaigns, {
    fields: [evolutionLines.campaignId],
    references: [campaigns.id],
  }),
}))

// =====================================
// Type Exports
// =====================================

export type Tamer = typeof tamers.$inferSelect
export type NewTamer = typeof tamers.$inferInsert

export type Digimon = typeof digimon.$inferSelect
export type NewDigimon = typeof digimon.$inferInsert

export type Encounter = typeof encounters.$inferSelect
export type NewEncounter = typeof encounters.$inferInsert

export type Campaign = typeof campaigns.$inferSelect
export type NewCampaign = typeof campaigns.$inferInsert

export type EvolutionLine = typeof evolutionLines.$inferSelect
export type NewEvolutionLine = typeof evolutionLines.$inferInsert

export type Map = typeof maps.$inferSelect
export type NewMap = typeof maps.$inferInsert

export type RollLogRow = typeof rollLog.$inferSelect
export type NewRollLogRow = typeof rollLog.$inferInsert

export type UserRow = typeof users.$inferSelect
export type NewUserRow = typeof users.$inferInsert

export type SessionRow = typeof sessions.$inferSelect
export type NewSessionRow = typeof sessions.$inferInsert

export type CampaignAccessGrantRow = typeof campaignAccessGrants.$inferSelect
export type NewCampaignAccessGrantRow = typeof campaignAccessGrants.$inferInsert
