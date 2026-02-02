import { pgTable, text, integer, boolean, timestamp } from 'drizzle-orm/pg-core'
import { relations } from 'drizzle-orm'

// =====================================
// Tamers Table
// =====================================

export const tamers = pgTable('tamers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  age: integer('age').notNull(),
  campaignLevel: text('campaign_level').notNull().$type<'standard' | 'enhanced' | 'extreme'>(),

  // Attributes (stored as JSON for flexibility)
  attributes: text('attributes', { mode: 'json' }).notNull().$type<{
    agility: number
    body: number
    charisma: number
    intelligence: number
    willpower: number
  }>(),

  // Skills (stored as JSON)
  skills: text('skills', { mode: 'json' }).notNull().$type<{
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
  aspects: text('aspects', { mode: 'json' }).notNull().$type<Array<{
    id: string
    name: string
    description: string
    type: 'major' | 'minor'
    usesRemaining: number
  }>>(),

  // Torments (stored as JSON array)
  torments: text('torments', { mode: 'json' }).notNull().$type<Array<{
    id: string
    name: string
    description: string
    severity: 'minor' | 'major' | 'terrible'
    totalBoxes: number
    markedBoxes: number
    cpMarkedBoxes: number // Boxes marked at creation with CP (locked, can't be removed)
  }>>(),

  // Special Orders (array of unlocked order IDs)
  specialOrders: text('special_orders', { mode: 'json' }).notNull().$type<string[]>(),

  inspiration: integer('inspiration').notNull().default(1),
  xp: integer('xp').notNull().default(0),

  // XP Bonuses - stored separately from base values for reallocation
  xpBonuses: text('xp_bonuses', { mode: 'json' }).notNull().default('{"attributes":{"agility":0,"body":0,"charisma":0,"intelligence":0,"willpower":0},"skills":{"dodge":0,"fight":0,"stealth":0,"athletics":0,"endurance":0,"featsOfStrength":0,"manipulate":0,"perform":0,"persuasion":0,"computer":0,"survival":0,"knowledge":0,"perception":0,"decipherIntent":0,"bravery":0},"inspiration":0}').$type<{
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
  equipment: text('equipment', { mode: 'json' }).notNull().$type<string[]>(),

  currentWounds: integer('current_wounds').notNull().default(0),
  notes: text('notes').notNull().default(''),
  spriteUrl: text('sprite_url'),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Digimon Table
// =====================================

export const digimon = pgTable('digimon', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  species: text('species').notNull(),

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
  baseStats: text('base_stats', { mode: 'json' }).notNull().$type<{
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }>(),

  // Attacks (stored as JSON array) - DDA 1.4 format
  // Attacks have: range (melee/ranged), type (damage/support), tags from qualities, optional effect
  attacks: text('attacks', { mode: 'json' }).notNull().$type<Array<{
    id: string
    name: string
    range: 'melee' | 'ranged'        // [Melee] or [Ranged] - free tag
    type: 'damage' | 'support'        // [Damage] or [Support] - free tag
    tags: string[]                    // Quality-based tags (e.g., "Weapon II", "Charge Attack", "Area Attack: Burst 3")
    effect?: string                   // Optional effect tag (e.g., "Paralysis", "Poison 3")
    description: string               // Flavor text for the attack
  }>>(),

  // Qualities (stored as JSON array)
  qualities: text('qualities', { mode: 'json' }).notNull().$type<Array<{
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
  bonusStats: text('bonus_stats', { mode: 'json' }).notNull().default('{"accuracy":0,"damage":0,"dodge":0,"armor":0,"health":0}').$type<{
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
  evolutionPathIds: text('evolution_path_ids', { mode: 'json' }).notNull().$type<string[]>(),

  // Evolution link (ID of the Digimon this evolves from)
  evolvesFromId: text('evolves_from_id'),

  partnerId: text('partner_id').references(() => tamers.id),
  isEnemy: boolean('is_enemy').notNull().default(false),

  notes: text('notes').notNull().default(''),
  spriteUrl: text('sprite_url'),

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
  participants: text('participants', { mode: 'json' }).notNull().$type<Array<{
    id: string
    type: 'tamer' | 'digimon'
    entityId: string
    initiative: number
    initiativeRoll: number
    actionsRemaining: { simple: number; complex: number }
    currentStance: 'neutral' | 'defensive' | 'offensive' | 'sniper' | 'brave'
    activeEffects: Array<{
      id: string
      name: string
      type: 'buff' | 'debuff' | 'status'
      duration: number
      source: string
      description: string
    }>
    isActive: boolean
    hasActed: boolean
  }>>(),

  // Turn order (participant IDs)
  turnOrder: text('turn_order', { mode: 'json' }).notNull().$type<string[]>(),
  currentTurnIndex: integer('current_turn_index').notNull().default(0),

  // Battle log
  battleLog: text('battle_log', { mode: 'json' }).notNull().$type<Array<{
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
  }>>(),

  // Environmental hazards
  hazards: text('hazards', { mode: 'json' }).notNull().$type<Array<{
    id: string
    name: string
    description: string
    effect: string
    affectedArea: string
    duration: number | null
  }>>(),

  // Pending player requests (digimon selection, initiative roll, dodge roll)
  pendingRequests: text('pending_requests', { mode: 'json' }).notNull().$type<Array<{
    id: string
    type: 'digimon-selection' | 'initiative-roll' | 'dodge-roll'
    targetTamerId: string
    targetParticipantId?: string
    timestamp: string
    data?: any
  }>>(),

  // Player responses to requests
  requestResponses: text('request_responses', { mode: 'json' }).notNull().$type<Array<{
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
    }
  }>>(),

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

  // Related entity IDs
  tamerIds: text('tamer_ids', { mode: 'json' }).notNull().$type<string[]>(),
  encounterIds: text('encounter_ids', { mode: 'json' }).notNull().$type<string[]>(),
  currentEncounterId: text('current_encounter_id'),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

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
  chain: text('chain', { mode: 'json' }).notNull().$type<Array<{
    stage: 'fresh' | 'in-training' | 'rookie' | 'champion' | 'ultimate' | 'mega' | 'ultra'
    species: string // Species name (e.g., "Agumon", "Greymon")
    digimonId: string // Required: Link to actual Digimon sheet from library
    isUnlocked: boolean // GM can unlock/lock this stage
    evolvesFromIndex: number | null // Index of parent form in chain (null for root)
  }>>(),

  // Which tamer owns this evolution line (for partner Digimon)
  partnerId: text('partner_id').references(() => tamers.id),

  // Current stage index in the chain (0 = first stage, always unlocked)
  // Tracks which form the Digimon is currently in during the session
  currentStageIndex: integer('current_stage_index').notNull().default(0),

  createdAt: timestamp('created_at').notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp('updated_at').notNull().$defaultFn(() => new Date()),
})

// =====================================
// Relations
// =====================================

export const tamersRelations = relations(tamers, ({ many }) => ({
  partnerDigimon: many(digimon),
  evolutionLines: many(evolutionLines),
}))

export const digimonRelations = relations(digimon, ({ one }) => ({
  partner: one(tamers, {
    fields: [digimon.partnerId],
    references: [tamers.id],
  }),
}))

export const evolutionLinesRelations = relations(evolutionLines, ({ one }) => ({
  partner: one(tamers, {
    fields: [evolutionLines.partnerId],
    references: [tamers.id],
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
