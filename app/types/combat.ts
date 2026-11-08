import type { Stance, Vec3 } from './index'

export interface ActiveEffect {
  id: string
  name: string
  type: 'buff' | 'debuff' | 'status'
  duration: number        // Rounds remaining
  source: string          // Who applied it
  description: string
  value?: number          // Optional numeric value (Directed bonus, etc.)
  potency?: number        // Effect strength (e.g. Immobilize uses the applier's BIT)
  potencyStat?: string    // SPEC stat driving potency ('bit', 'ram', 'cpu')
}

export interface ClashState {
  clashId: string                    // Links both participants
  opponentParticipantId: string      // The other participant in the clash
  isController: boolean              // Whether this participant currently controls
  isPinned: boolean                  // Cannot act while pinned by the controller
  clashPinsUsed?: number
  cannotInitiateUntilRound?: number  // Cannot start another clash until this round
  clashCheckNeeded: boolean          // Round-start re-roll needed
  pendingRoll?: number               // Roll awaiting the opponent's response (player-vs-player)
  pendingRollDescription?: string    // Stored breakdown to display when the opposing roll arrives
  reachInitiated?: boolean           // Whether the clash started using Reach
  reachDistance?: number             // Initial distance; ongoing roll penalty for the Reach user
}

/** Shared client/server combat state. Stored legacy encounters may omit wound totals (below). */
export interface CombatParticipant {
  id: string
  type: 'tamer' | 'digimon'
  entityId: string        // Reference to a Tamer or Digimon record
  seq?: number            // Stable instance number assigned at add-time; never renumbers after removals
  name?: string
  isEnemy?: boolean
  inReserve?: boolean     // GM-staged: excluded from turn order, the map and targets until deployed

  initiative: number
  initiativeRoll: number  // The 3d6 roll result
  actionsRemaining: {
    simple: number       // Source of truth: a complex action spends two simple actions
    /** @deprecated Derive complex-action affordability from the simple-action pool. */
    complex?: number
  }
  currentStance: Stance
  activeEffects: ActiveEffect[]
  isActive: boolean       // Currently taking its turn
  hasActed: boolean       // Completed its turn this round
  currentWounds: number
  maxWounds: number
  currentTempWounds?: number
  usedAttackIds?: string[]
  dodgePenalty?: number
  evolutionLineId?: string
  woundsHistory?: Array<{ stageIndex: number; wounds: number; entityId: string; maxWounds: number; totalHealth?: number }>
  hasAttemptedDigivolve?: boolean  // Attempted digivolution this turn (evolving only, not devolving)
  npcStageIndex?: number           // NPC instance's stage, independent of a shared evolution line

  usedSpecialOrders?: string[]
  usedSkillOrders?: string[]
  interceptPenalty?: number
  specialOrderDebt?: Record<string, number>  // Due-round action debt; cannot be paid before that round
  intercedeOptOuts?: string[]                // Legacy fallback; current opt-outs live on the encounter
  gmCharacterOptOuts?: Record<string, string[]>  // Legacy GM character opt-outs, also encounter-owned now
  maxPostTurnIntercedes?: number
  hasDirectedThisTurn?: boolean
  digimonBolsterCount?: number
  lastBitCpuBolsterRound?: number
  lastHugePowerRound?: number
  lastHugePowerRank2Round?: number
  quickReactionDiceBonus?: number  // Remaining Quick Reaction dodge pool this round
  lastMovedTurnKey?: string
  strikeFastReady?: boolean
  strikeFastTurnKey?: string
  fatefulSpentRollIds?: string[]
  finishingTouchReady?: boolean
  decimationReady?: boolean
  enduringSoulAvailable?: boolean
  enduringSoulUsed?: boolean
  strikeLastCounter?: { attackerId: string; groupId: string; tamerId: string }
  isMinion?: boolean
  summonerId?: string
  summonedByParticipantId?: string
  currentInspiration?: number                // Tamer's live combat pool, initialized from DB totals
  divineProtectionUsesThisBattle?: number    // First use free; subsequent uses cost two Inspiration
  pendingDivineProtectionDamage?: number     // Damage held while the player answers the offer
  pendingSimpleActionPenalty?: number        // Simple actions to deduct at the next turn start

  combatMonsterBonus?: number      // Cumulative damage bonus for the next successful attack
  totalHealth?: number             // Base + bonus-DP Health, without quality/stage modifiers; caps Combat Monster
  battery?: number                // Signature Move's current Battery charge
  usedSignatureMoveThisTurn?: boolean
  moodValue?: number               // Positive Reinforcement meter (1–6, initially 3)
  stunActionReducedThisRound?: boolean  // Prevents applying Stun's action reduction twice at rollover
  clash?: ClashState
  clashCooldownUntilRound?: number
  usedFreeClashThisRound?: boolean      // Wrestlemania free clash initiation already used
  usedCounterattackThisCombat?: boolean // Chain Counter may skip setting this after use

  mapPosition?: Vec3
  // A deliberate jump onto an air tile still falls at turn end, but takes no fall damage. Cleared
  // on landing; when unset, getFallerProfile derives the exemption from the Jumper quality.
  airborneByJump?: boolean
  turnsStarted?: number   // Bumped at every turn start; temporary intercede passes expire when it changes
  lastMovedRound?: number // Set server-side for every movement path; read by Burn's stationary penalty
  statSwaps?: Partial<Record<'accuracy' | 'damage' | 'dodge' | 'armor', 'accuracy' | 'damage' | 'dodge' | 'armor'>>
  modeChangeFreeSwapsUsed?: number  // Mode Change X.0 Rank 2 free swaps used this combat (0–3)

  // Boss qualities. Keep persisted field spellings stable for existing encounter JSON.
  seenAttackIds?: Record<string, number>  // Adaptive Intelligence: times this participant saw each attack
  juggernauntBonuses?: Partial<Record<'accuracy' | 'damage' | 'dodge' | 'armor', number>> // Juggernaut's cumulative +2 stacks
  timeControlUsed?: boolean               // Prevents re-triggering Time Control in the same combat
  dataAbsorbActive?: boolean
  dataAbsorbHealAmount?: number           // BIT × 2/4/6, captured when Data Absorb is toggled on
  buggedSpecValues?: { bit: number; cpu: number; ram: number }
  demoralizedAttributes?: Partial<Record<'agility' | 'body' | 'charisma' | 'intelligence' | 'willpower', number>>
  tormentorBonusStacks?: number           // +2 per participant who failed the check
  tankBusterUsedAtThresholds?: number[]   // Already-consumed wound-% thresholds (e.g. 0.75, 0.50)
  blackArmorRoundBonus?: { armor: number; dodge: number } // Rolled fresh each round
  brownArmorAutoDodgeAvailable?: boolean  // One free dodge success, reset each round
}

/** JSONB compatibility: older participants may predate encounter-local wound totals. */
export type StoredCombatParticipant = Omit<CombatParticipant, 'currentWounds' | 'maxWounds'>
  & Partial<Pick<CombatParticipant, 'currentWounds' | 'maxWounds'>>
