// Digimon Qualities Database - DDA 1.4
// Free Qualities (0 DP), Negative Qualities (negative DP), and Purchasable Qualities (positive DP)

import type { DigimonStage, EddySoulRules } from '../types'

export type QualityTypeTag = 'static' | 'trigger' | 'attack' // [S], [T], [A]

// Quality categories matching rulebook sections
export type QualityCategory =
  | 'data-optimization' // 3.03
  | 'data-specialization' // 3.03 sub-tree
  | 'extra-movement' // 3.03a
  | 'offensive' // 3.04
  | 'counterattack' // 3.04a
  | 'stealth' // 3.04b
  | 'defensive' // 3.05
  | 'combat-monster' // 3.05a
  | 'boosting' // 3.06
  | 'utility' // 3.07
  | 'support' // 3.08
  | 'attack-effects' // 3.09
  | 'advanced' // 3.10 (Element Master, Summoner, Mode Change)
  | 'signature-move' // 3.11
  | 'digizoid' // 3.12
  | 'gain-force' // 3.13
  | 'burst-power' // 3.14
  | 'free' // 3.15
  | 'negative' // 3.16

// Quality type (free/negative/purchasable)
export type QualityType = 'free' | 'negative' | 'purchasable'

// Sub-option for qualities with choices (like Data Optimization)
export interface QualityChoice {
  id: string
  name: string
  dpCost?: number // Override base cost if different per choice
  effect: string
  prerequisites?: string[] // For Data Specialization tree validation
  rangeRestriction?: 'melee' | 'ranged' // For Area Attack sub-options
  stageRequirement?: DigimonStage // Per-choice stage requirement (e.g., Digizoid Armor variants)
}

// Stage order for comparisons
export const STAGE_ORDER: DigimonStage[] = [
  'fresh',
  'in-training',
  'rookie',
  'champion',
  'ultimate',
  'mega',
  'ultra',
]

export interface QualityTemplate {
  id: string
  name: string
  type: QualityType
  category: QualityCategory
  qualityType: QualityTypeTag | QualityTypeTag[] // [S], [T], [A] or combinations like [S, T]
  dpCost: number
  maxRanks: number
  prerequisites: string[]
  effect: string
  description: string
  // New fields for purchasable qualities
  stageRequirement?: DigimonStage // Minimum stage required (e.g., 'ultimate')
  maxRanksByStage?: Partial<Record<DigimonStage, number>> // Stage-limited rank caps
  choices?: QualityChoice[] // Sub-options (e.g., Data Optimization options)
  exclusiveChoices?: boolean // If true, can only take ONE choice total (not one of each)
  singleRankPerChoice?: boolean // If true, each choice can only be taken once (no ranks per individual choice)
  limitedTag?: boolean // [LIMITED] - can only apply to one attack
  exclusiveWith?: string[] // IDs of mutually exclusive qualities
  exclusiveOnSameAttackWith?: string[] // IDs of qualities that can't be on same attack (unless Signature Move)
  requiresGMApproval?: boolean // Some qualities need GM approval
  freeFirstRank?: boolean // First rank is free, subsequent ranks cost dpCost
  firstRankDiscountAtStage?: { stage: DigimonStage; discount: number } // Discount on first rank at certain stage+
}

export const QUALITY_DATABASE: QualityTemplate[] = [
  // === FREE QUALITIES (0 DP) - Section 3.15 ===
  {
    id: 'job-well-done',
    name: 'A Job Well Done',
    type: 'free',
    category: 'free',
    qualityType: 'trigger',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Roll 1d6 at start of combat for random benefit or penalty.',
    effect: `At the start of combat, roll 1d6:
• 6: Gain Temporary Wound Boxes equal to Stage Bonus, and Damage Bonus equal to Stage Bonus for the battle. Temporary Wound Boxes may stack with other qualities.
• 3-5: No effect.
• 2: Stage Bonus penalty to Armor for the battle. Applies even if the Digimon evolves.
• 1: Stage Bonus penalty to highest stat, and immediate damage equal to Stage Bonus. Applies even if the Digimon evolves, persists for the battle.`,
  },
  {
    id: 'ammo',
    name: 'Ammo',
    type: 'free',
    category: 'free',
    qualityType: 'attack',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Gain use of [Ammo] tag for consecutive attacks (up to 5 times).',
    effect: `Gain use of the [Ammo] Tag. Can only be applied to a move with three Attack Tags, including [Damage/Support] [Melee/Ranged]. Allows the move to be used up to 5 times consecutively within a round. Once out of ammo, cannot use that attack for the rest of battle. Cannot apply to [Signature Move].`,
  },
  {
    id: 'fragile-equipment',
    name: 'Fragile Equipment',
    type: 'free',
    category: 'free',
    qualityType: ['static', 'attack'],
    dpCost: 0,
    maxRanks: 1,
    prerequisites: ['Weapon or Armor Increasing Quality'],
    description: 'Equipment may break but can deal extra damage. Check cannot be rerolled.',
    effect: `Attack ([Weapon] Tagged):
• Roll 1d6 on successful hit. On 1, weapon breaks and all [Weapon] attacks cannot be used for the battle. On 6, +Stage Bonus damage for that attack.

Armor (Applied to Digimon):
• Roll 1d6 when hit. On 1, armor breaks and no longer benefits from Armor-improving Qualities for the battle. On 6, +Stage Bonus Armor against that attack.`,
  },
  {
    id: 'inconsistent-size',
    name: 'Inconsistent Size',
    type: 'free',
    category: 'free',
    qualityType: 'trigger',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Random size upon evolution.',
    effect: `Upon evolution, roll 1d6:
• 1-2: Medium
• 3-4: Large
• 5-6: Huge
Size remains until end of combat and devolve. Size cannot be changed.`,
  },
  {
    id: 'violent-overwrite',
    name: 'Violent Overwrite',
    type: 'free',
    category: 'free',
    qualityType: 'trigger',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Random damage or healing each round.',
    effect: `At start of every round, roll 1d6:
• 1: Take unalterable damage equal to Stage Bonus +1.
• 6: Recover Wound Boxes equal to Stage Bonus.`,
  },
  {
    id: 'merciful-mode',
    name: 'Merciful Mode',
    type: 'free',
    category: 'free',
    qualityType: 'static',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Attacks are non-lethal by default.',
    effect: `All attacks are non-lethal by default. Must declare lethal intent to delete enemies. Cannot take Offensive Stance.`,
  },
  {
    id: 'positive-reinforcement',
    name: 'Positive Reinforcement',
    type: 'free',
    category: 'free',
    qualityType: ['static', 'trigger'],
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    exclusiveWith: ['berserker'],
    description: 'Mood meter affects stats based on combat performance.',
    effect: `Gain a Mood Meter (1d6), starting at 3.
• Land or dodge attack: +1 Mood
• Miss attack or get hit: -1 Mood

Mood Effects:
• Mood 5-6 (Good): +1 Dodge and Damage per point above 4 (e.g., Mood 6 = +2 Dodge/Damage)
• Mood 3-4 (Neutral): No effect
• Mood 1-2 (Poor): -1 Accuracy and Armor per point below 3 (e.g., Mood 2 = -1 Accuracy/Armor)

If Mood drops to 1, Partner may use Complex Action to set Mood to 4.`,
  },
  {
    id: 'mind-over-matter',
    name: 'Mind over Matter',
    type: 'free',
    category: 'free',
    qualityType: 'static',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Trade stats for Prodigious Skills.',
    effect: `-1 to all stats. Select two skills from a single Attribute Category (excluding Agility) to treat as Prodigious Skill. Both must come from the same category.

Example: If Body selected, choose two from Athletics, Endurance, or Feats of Strength.`,
  },
  {
    id: 'justice-is-blind',
    name: 'Justice is Blind',
    type: 'free',
    category: 'free',
    qualityType: 'static',
    dpCost: 0,
    maxRanks: 1,
    prerequisites: [],
    description: 'Blind Digimon with unique combat rules.',
    effect: `• Prodigious Skill: Perception for auditory checks and challenging Hide in Plain Sight (without demerit)
• Auto-fail any visual-based checks
• Melee attacks gain [Close Blast] for free, Ranged attacks gain [Cone] for free
• May have multiple instances of above tags, but cannot buy other [Area Attack] tags
• Cannot benefit from Selective Targeting
• Single-target attacks require Tamer Complex Direct (not counted as Bolstered)`,
  },

  // === NEGATIVE QUALITIES (Negative DP) - Section 3.16 ===
  {
    id: 'bulky',
    name: 'Bulky',
    type: 'negative',
    category: 'negative',
    qualityType: 'static',
    dpCost: -1,
    maxRanks: 3,
    prerequisites: [],
    description: 'Reduced movement speed.',
    effect: `Per Rank: Base Movement lowered by 3. Cannot take if Movement would drop to 1 or lower.`,
  },
  {
    id: 'vulnerable',
    name: 'Vulnerable',
    type: 'negative',
    category: 'negative',
    qualityType: 'static',
    dpCost: -2,
    maxRanks: 1,
    prerequisites: [],
    description: 'Negative effects last longer, positive effects shorter.',
    effect: `Incoming [Negative Effects] duration +1. Incoming [Positive Effects] duration -1.`,
  },
  {
    id: 'disobedient',
    name: 'Disobedient',
    type: 'negative',
    category: 'negative',
    qualityType: 'static',
    dpCost: -1,
    maxRanks: 1,
    prerequisites: [],
    description: 'Tamer Directs are less effective.',
    effect: `All base Tamer Directs suffer -2 demerit. Example: Tamer with 4 Charisma directing Accuracy gives +2 instead of +4.`,
  },
  {
    id: 'rebellious-stage',
    name: 'Rebellious Stage',
    type: 'negative',
    category: 'negative',
    qualityType: ['static', 'trigger'],
    dpCost: -1,
    maxRanks: 1,
    prerequisites: ['Disobedient'],
    description: 'May refuse to listen to Tamer.',
    effect: `Once per round, roll 1d6. On 1, Digimon refuses orders.

Tamer must make Charisma Check (Complex Action):
• TN 12 (Standard), 14 (Enhanced), 16 (Extreme)
• Pass: One Simple Action remains, control Digimon normally
• Fail: Digimon's next action counts as Complex Action`,
  },
  {
    id: 'full-action',
    name: 'Full Action',
    type: 'negative',
    category: 'negative',
    qualityType: 'attack',
    dpCost: -3,
    maxRanks: 1,
    prerequisites: ['Signature Move'],
    description: 'Signature Move requires Complex Action.',
    effect: `Gain use of [Full Action] tag, must apply to Signature Move. Makes the attack require a Complex Action instead of Simple Action.`,
  },
  {
    id: 'light-hit',
    name: 'Light Hit',
    type: 'negative',
    category: 'negative',
    qualityType: 'attack',
    dpCost: -1,
    maxRanks: 3,
    prerequisites: ['Armor Piercing Rank X'],
    description: 'Armor Piercing requires extra successes.',
    effect: `Must be attached to Attack with Armor Piercing. Per Rank: Attack needs X additional Successes for Armor Piercing to trigger.`,
  },
  {
    id: 'klutz',
    name: 'Klutz',
    type: 'negative',
    category: 'negative',
    qualityType: 'static',
    dpCost: -2,
    maxRanks: 1,
    prerequisites: ['Selective Targeting'],
    description: 'Area attacks may hit allies.',
    effect: `On [Area] Attack, roll 1d6 (ignores Selective Targeting):
• 5-6: Works as normal
• 3-4: May hit every Digimon present, including allies
• 1: Only damages allies and applies negative effects to them, while applying positive effects to enemies`,
  },
  {
    id: 'underwhelming',
    name: 'Underwhelming',
    type: 'negative',
    category: 'negative',
    qualityType: 'trigger',
    dpCost: -2,
    maxRanks: 2,
    prerequisites: ['Huge Power (Rank 1)', 'Huge Power (Rank 2)'],
    description: 'Must reroll successful dice. Only applies to [Damage] attacks.',
    effect: `Rank 1 (requires Huge Power): Huge Power always activates on first attack. Second attack must reroll all 5s, take second result.

Rank 2 (requires Huge Power Rank 2): First attack activates Huge Power (both ranks). Second attack must reroll all successful Accuracy dice, take second result.`,
  },
  {
    id: 'broadside',
    name: 'Broadside',
    type: 'negative',
    category: 'negative',
    qualityType: 'trigger',
    dpCost: -2,
    maxRanks: 2,
    prerequisites: ['Agility (Rank 1)', 'Agility (Rank 2)'],
    description: 'Must reroll successful dodge dice.',
    effect: `Rank 1 (requires Agility): After Agility triggers, must reroll all 5s on next dodge, take second result.

Rank 2 (requires Agility Rank 2): After Agility triggers (both ranks), must reroll all successful Dodge dice, take second result.`,
  },
  {
    id: 'decreased-derived-stat',
    name: 'Decreased Derived Stat',
    type: 'negative',
    category: 'negative',
    qualityType: 'static',
    dpCost: -1,
    maxRanks: 5,
    prerequisites: ['Improved Derived Stat'],
    description: 'Lower a Derived Stat.',
    effect: `Per Rank: Lower one Derived Stat by 1. Can only decrease Derived Stats not affected by Improved Derived Stat.`,
  },

  // ============================================================================
  // PURCHASABLE QUALITIES (Positive DP) - Sections 3.03 - 3.14
  // ============================================================================

  // === DATA OPTIMIZATION (Section 3.03) ===
  {
    id: 'data-optimization',
    name: 'Data Optimization',
    type: 'purchasable',
    category: 'data-optimization',
    qualityType: 'static',
    dpCost: 1, // Base cost, varies by choice
    maxRanks: 1,
    exclusiveChoices: true, // Can only take ONE choice total, not one of each
    prerequisites: [],
    description: 'Choose a combat role optimization. Can only take once.',
    effect: `Choose one optimization to define your Digimon's combat role. You may only take this quality once.`,
    choices: [
      {
        id: 'close-combat',
        name: 'Close Combat',
        dpCost: 1,
        effect: '+2 Accuracy with [Melee] attacks, -1 Accuracy with [Ranged] attacks.',
      },
      {
        id: 'ranged-striker',
        name: 'Ranged Striker',
        dpCost: 1,
        effect: '+2 Accuracy with [Ranged] attacks, -1 Dodge against [Melee] attacks.',
      },
      {
        id: 'guardian',
        name: 'Guardian',
        dpCost: 1,
        effect: '+2 Armor, -1 Base Movement.',
      },
      {
        id: 'brawler',
        name: 'Brawler',
        dpCost: 2,
        effect: '+2 to Clash checks, treated as one Size Class larger when Clashing. Gigantic Digimon get +4 instead.',
      },
      {
        id: 'speed-striker',
        name: 'Speed Striker',
        dpCost: 1,
        effect: '+2 Base Movement.',
      },
      {
        id: 'effect-warrior',
        name: 'Effect Warrior',
        dpCost: 2,
        effect: '+1 to base Spec Values, -2 Armor.',
      },
    ],
  },
  {
    id: 'data-specialization',
    name: 'Data Specialization',
    type: 'purchasable',
    category: 'data-specialization',
    qualityType: ['static', 'attack', 'trigger'],
    dpCost: 2,
    maxRanks: 2,
    singleRankPerChoice: true, // Each specialization can only be taken once
    prerequisites: ['Data Optimization'],
    stageRequirement: 'ultimate',
    description: 'Advanced specialization based on your Data Optimization. Rank 2 requires Ultra.',
    effect: `Choose a specialization from your Data Optimization tree. Rank 2 requires Ultra level.`,
    maxRanksByStage: { ultimate: 1, mega: 1, ultra: 2 },
    choices: [
      // Close Combat tree
      {
        id: 'fistful-of-force',
        name: 'Fistful of Force',
        dpCost: 2,
        effect: '[Melee] [Area] attacks scale as [Ranged]. Targets only get ½ RAM bonus to dodge.',
        prerequisites: ['close-combat'],
      },
      {
        id: 'flurry',
        name: 'Flurry',
        dpCost: 3,
        effect: 'Free additional [Melee] [Damage] attack once per round. Cannot be modified.',
        prerequisites: ['close-combat'],
      },
      // Ranged Striker tree
      {
        id: 'sniper',
        name: 'Sniper',
        dpCost: 2,
        effect: '[Sniper Stance]: No Accuracy penalties for Ranged attacks. Dodge penalty equal to opponent RAM vs Melee. Cannot target within 2m. Difficult terrain.',
        prerequisites: ['ranged-striker'],
      },
      {
        id: 'mobile-artillery',
        name: 'Mobile Artillery',
        dpCost: 3,
        effect: 'Add CPU to [Area] attack damage. -1 Base Movement.',
        prerequisites: ['ranged-striker'],
      },
      // Guardian tree
      {
        id: 'what-goes-around',
        name: 'What Goes Around',
        dpCost: 2,
        effect: 'When hit by [Melee], deal CPU damage to attacker (reduced by Armor, min 2).',
        prerequisites: ['guardian'],
      },
      {
        id: 'true-guardian',
        name: 'True Guardian',
        dpCost: 3,
        effect: 'Intercede bonus = distance traveled. [Area] allies behind take CPU×2 less damage, effects negated. -2 Accuracy.',
        prerequisites: ['guardian'],
      },
      // Brawler tree
      {
        id: 'power-throw',
        name: 'Power Throw',
        dpCost: 2,
        effect: 'Add CPU×2 to Accuracy when throwing targets.',
        prerequisites: ['brawler'],
      },
      {
        id: 'wrestlemania',
        name: 'Wrestlemania',
        dpCost: 3,
        effect: 'Free Clash once per round. Multiple with Multi-Grappler. -1 Damage, Armor, Health.',
        prerequisites: ['brawler'],
      },
      // Speed Striker tree
      {
        id: 'hit-and-run',
        name: 'Hit and Run',
        dpCost: 2,
        effect: '[Charge] attacks add RAM to Damage. Must move to gain bonus.',
        prerequisites: ['speed-striker'],
      },
      {
        id: 'uncatchable-target',
        name: 'Uncatchable Target',
        dpCost: 3,
        effect: '+3 Dodge. No stacking Dodge penalty from multiple attacks.',
        prerequisites: ['speed-striker'],
      },
      // Effect Warrior tree
      {
        id: 'black-mage',
        name: 'Black Mage',
        dpCost: 3,
        effect: 'On negative [Effect] hit, roll BIT pool. Assign unalterable damage to targets (once per round).',
        prerequisites: ['effect-warrior'],
      },
      {
        id: 'white-mage',
        name: 'White Mage',
        dpCost: 2,
        effect: 'On positive [Effect] hit, roll BIT pool. Heal Wound Boxes among targets (once per round).',
        prerequisites: ['effect-warrior'],
      },
    ],
  },
  {
    id: 'hybrid-drive',
    name: 'Hybrid Drive',
    type: 'purchasable',
    category: 'data-optimization',
    qualityType: 'static',
    dpCost: 3,
    maxRanks: 2,
    prerequisites: ['Data Optimization'],
    stageRequirement: 'ultimate',
    description: 'Access Data Specializations from adjacent optimization trees.',
    effect: `Purchase Data Specialization from adjacent trees (Close Combat ↔ Brawler ↔ Guardian, Speed Striker ↔ Close Combat, Ranged Striker ↔ Effect Warrior, etc.).`,
  },

  // === EXTRA MOVEMENT (Section 3.03a) ===
  {
    id: 'extra-movement',
    name: 'Extra Movement',
    type: 'purchasable',
    category: 'extra-movement',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 5,
    singleRankPerChoice: true, // Each movement type can only be taken once
    prerequisites: [],
    firstRankDiscountAtStage: { stage: 'champion', discount: 1 }, // Champion+ gets 1 DP discount
    description: 'Gain a new movement type. Champion+ gets 1 DP discount on first rank.',
    effect: `Choose a movement type. Move in that terrain at Speed score.`,
    choices: [
      { id: 'digger', name: 'Digger', dpCost: 1, effect: 'Burrow through dirt, snow, or sand at Movement speed.' },
      { id: 'swimmer', name: 'Swimmer', dpCost: 1, effect: 'Move through water at Movement speed.' },
      { id: 'flight', name: 'Flight', dpCost: 2, effect: 'Fly through the air.' },
      { id: 'wallclimber', name: 'Wallclimber', dpCost: 1, effect: 'Scale vertical surfaces (not ceilings).' },
      { id: 'jumper', name: 'Jumper', dpCost: 1, effect: 'Jump height and length equal to Movement.' },
    ],
  },
  {
    id: 'advanced-mobility',
    name: 'Advanced Mobility',
    type: 'purchasable',
    category: 'extra-movement',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 6,
    singleRankPerChoice: true, // Each advanced mobility can only be taken once
    prerequisites: ['Extra Movement'],
    description: 'Enhance an Extra Movement type.',
    effect: `Choose an Extra Movement type you have. Gain enhanced benefits.`,
    choices: [
      { id: 'adv-movement', name: 'Movement', dpCost: 2, effect: 'Speedy can now triple Base Movement (requires Speedy Rank 1).', prerequisites: ['speedy'] },
      { id: 'adv-flight', name: 'Flight', dpCost: 2, effect: 'Not slowed by harsh winds. Flight speed +RAM.', prerequisites: ['flight'] },
      { id: 'adv-digger', name: 'Digger', dpCost: 2, effect: 'Dig through most surfaces (soft metals = difficult terrain). Dig speed +RAM.', prerequisites: ['digger'] },
      { id: 'adv-swimmer', name: 'Swimmer', dpCost: 2, effect: 'Not slowed by harsh currents. Swim speed +RAM.', prerequisites: ['swimmer'] },
      { id: 'adv-wallclimber', name: 'Wallclimber', dpCost: 2, effect: 'Walk on ceilings. Cannot slip. Climb speed +RAM.', prerequisites: ['wallclimber'] },
      { id: 'adv-jumper', name: 'Jumper', dpCost: 2, effect: 'Jump height +CPU×5. Jump length +CPU.', prerequisites: ['jumper'] },
    ],
  },
  {
    id: 'speedy',
    name: 'Speedy',
    type: 'purchasable',
    category: 'extra-movement',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 7,
    // Max useful ranks = Base Movement / 2 (since +2 per rank, can't exceed 2× base)
    maxRanksByStage: {
      'fresh': 1,        // 2m base → max +2m = 1 rank
      'in-training': 2,  // 4m base → max +4m = 2 ranks
      'rookie': 3,       // 6m base → max +6m = 3 ranks
      'champion': 4,     // 8m base → max +8m = 4 ranks
      'ultimate': 5,     // 10m base → max +10m = 5 ranks
      'mega': 6,         // 12m base → max +12m = 6 ranks
      'ultra': 7,        // 14m base → max +14m = 7 ranks
    },
    prerequisites: [],
    description: '+2 Movement per rank. Cannot more than double Base Movement.',
    effect: `Per Rank: +2 Movement. Cannot exceed 2× Base Movement.`,
  },
  {
    id: 'teleport',
    name: 'Teleport',
    type: 'purchasable',
    category: 'extra-movement',
    qualityType: 'trigger',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Speedy Rank 3'],
    description: 'Instant teleportation with dodge ability.',
    effect: `Teleport Base Movement+2 meters (requires line of sight). Once per battle, teleport to avoid an attack (forfeit Simple Action next round). Does not trigger Counterattack.`,
  },
  {
    id: 'transporter',
    name: 'Transporter',
    type: 'purchasable',
    category: 'extra-movement',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Teleport'],
    description: 'Bring allies with Teleport.',
    effect: `Teleport adjacent allies with you. All transported allies forfeit one Simple Action. Teleport distance +2.`,
  },

  // === OFFENSIVE QUALITIES (Section 3.04) ===
  {
    id: 'armor-piercing',
    name: 'Armor Piercing',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    limitedTag: true,
    exclusiveOnSameAttackWith: ['certain-strike'], // Can't be on same attack unless Signature Move
    description: 'Ignore armor on one attack. Ranks limited by stage.',
    effect: `Choose one Attack. Ignores X×2 Armor (X = ranks). Cannot have both Armor Piercing and Certain Strike on same attack unless Signature Move.`,
    maxRanksByStage: { rookie: 1, champion: 2, ultimate: 3, mega: 3, ultra: 3 },
  },
  {
    id: 'charge-attack',
    name: 'Charge Attack',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: 'Move and attack as one Simple Action.',
    effect: `Apply [Charge] tag to a [Melee] attack. Attack and move in one Simple Action.`,
  },
  {
    id: 'mighty-blow',
    name: 'Mighty Blow',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    stageRequirement: 'champion',
    description: 'Stun on high damage.',
    effect: `[Mighty Blow] tag on [Melee] attack. If damage after armor ≥ target's Stage Bonus, inflict 1 round [Stun]. With secondary effect, need +2 damage. Cannot combine with [Poison].`,
  },
  {
    id: 'certain-strike',
    name: 'Certain Strike',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 2,
    prerequisites: [],
    limitedTag: true,
    exclusiveOnSameAttackWith: ['armor-piercing'], // Can't be on same attack unless Signature Move
    description: 'Automatic successes on one attack.',
    effect: `Choose one Attack. Gain 1 auto-success per 4 base Accuracy dice (max 2 per rank). Auto-successes deducted from rolled pool. Cannot combine with Armor Piercing unless Signature Move.`,
    maxRanksByStage: { rookie: 1, champion: 1, ultimate: 2, mega: 2, ultra: 2 },
  },
  {
    id: 'weapon',
    name: 'Weapon',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    limitedTag: true,
    exclusiveWith: ['instinct'],
    description: 'Bonus to weapon attacks. Ranks limited by stage.',
    effect: `[Weapon] tagged attacks gain +Rank to Accuracy and Damage. Can tag attacks up to Rank count.`,
    maxRanksByStage: { rookie: 1, champion: 2, ultimate: 3, mega: 3, ultra: 3 },
  },
  {
    id: 'slayer',
    name: 'Slayer',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: 'Bonus vs specific enemy type.',
    effect: `Choose a Family/Type. +RAM to Accuracy vs that type. If you match the type, take unalterable damage on miss = stages above Fresh.`,
  },
  {
    id: 'huge-power',
    name: 'Huge Power',
    type: 'purchasable',
    category: 'offensive',
    qualityType: ['trigger', 'attack'],
    dpCost: 2,
    maxRanks: 2,
    prerequisites: [],
    description: 'Reroll low dice on Accuracy.',
    effect: `Rank 1: Reroll 1s on Accuracy. Once per round for [Ranged], unlimited for [Melee]. Rank 2: Also reroll 2s. Once per round (any attack type). Rank 1 still triggers when using Rank 2.`,
  },
  {
    id: 'aggressive-flank',
    name: 'Aggressive Flank',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: 'Accuracy bonus when near allies.',
    effect: `+RAM to Accuracy when within ally's [Burst][Ranged] radius or both adjacent to same enemy.`,
  },
  {
    id: 'coordinated-assault',
    name: 'Coordinated Assault',
    type: 'purchasable',
    category: 'offensive',
    qualityType: 'trigger',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Aggressive Flank'],
    description: 'Mark a target for increased penalties.',
    effect: `Simple Action: Mark target. Marked targets take -3 Dodge per attack after first (instead of -1). Mark vanishes if user defeated. Affects Uncatchable Target.`,
  },
  {
    id: 'area-attack',
    name: 'Area Attack',
    type: 'purchasable',
    category: 'offensive',
    qualityType: ['trigger', 'attack'],
    dpCost: 2,
    maxRanks: 6, // Can take each type once (6 types available)
    singleRankPerChoice: true, // Each area type can only be taken once
    prerequisites: [],
    description: 'Add an area tag to an attack.',
    effect: `Apply an [Area Tag] to an Attack. Targets get +RAM to Dodge. Can use as single-target without penalty.`,
    choices: [
      { id: 'blast', name: 'Blast', effect: '[Ranged only] Circle at range. 3m diameter +BIT.', rangeRestriction: 'ranged' },
      { id: 'burst', name: 'Burst', effect: '[Melee/Ranged] Circle from user. 1m radius +BIT+1. User not targeted.' },
      { id: 'close-blast', name: 'Close Blast', effect: '[Melee/Ranged] Circle adjacent to user. 2m radius +BIT.' },
      { id: 'cone', name: 'Cone', effect: '[Melee/Ranged] Triangle from user. 3m length +BIT.' },
      { id: 'line', name: 'Line', effect: '[Melee/Ranged] Pillar from user. 5m length +BIT×2, 1m width (+1 per Size above Large). Can bounce.' },
      { id: 'pass', name: 'Pass', effect: '[Melee only] Charge in line, hit all targets. Move = Movement + up to RAM. Requires movement (unless has Charge).', rangeRestriction: 'melee' },
    ],
  },

  // === COUNTERATTACK QUALITIES (Section 3.04a) ===
  {
    id: 'counterattack',
    name: 'Counterattack',
    type: 'purchasable',
    category: 'counterattack',
    qualityType: ['trigger', 'attack'],
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: 'Free attack when enemy misses.',
    effect: `Once per combat, if enemy misses, make free single-target attack. Target rolls ½ Dodge.`,
  },
  {
    id: 'counterblow',
    name: 'Counterblow',
    type: 'purchasable',
    category: 'counterattack',
    qualityType: ['trigger', 'attack'],
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Counterattack'],
    description: 'Counter attack ignores half armor.',
    effect: `Choose one Attack for [Counter] tag. When Counterattacking with it, target has ½ Armor in addition to ½ Dodge.`,
  },
  {
    id: 'cross-counter',
    name: 'Cross Counter',
    type: 'purchasable',
    category: 'counterattack',
    qualityType: ['trigger', 'attack'],
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Counterattack'],
    exclusiveWith: ['combat-monster'],
    description: 'Counter melee without using once-per-fight.',
    effect: `If enemy misses [Melee], counter without expending once-per-fight use. Must take the missed attack without Dodge and with -Stage Bonus Armor. Does not trigger Counterblow.`,
  },

  // === STEALTH QUALITIES (Section 3.04b) ===
  {
    id: 'hide-in-plain-sight',
    name: 'Hide in Plain Sight',
    type: 'purchasable',
    category: 'stealth',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: 'Harder to spot.',
    effect: `Enemies take -RAM×2 penalty to Perception to spot you.`,
  },
  {
    id: 'shade-cloak',
    name: 'Shade Cloak',
    type: 'purchasable',
    category: 'stealth',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Hide in Plain Sight'],
    description: 'Extend hiding bonus to allies.',
    effect: `Allies in your [Burst][Ranged] radius gain your Hide in Plain Sight bonus.`,
  },
  {
    id: 'sneak-attack',
    name: 'Sneak Attack',
    type: 'purchasable',
    category: 'stealth',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Hide in Plain Sight'],
    description: 'Bonus damage from stealth.',
    effect: `If hidden (Stealth vs Perception), +RAM×2 to Accuracy and Damage on next attack. Once per combat (twice if Surprise Round).`,
  },
  {
    id: 'glamor',
    name: 'Glamor',
    type: 'purchasable',
    category: 'stealth',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Shade Cloak'],
    exclusiveWith: ['illusionary-overlay'],
    description: 'Disguise allies.',
    effect: `Apply illusion disguise to allies (Stealth TN 12+Stage Bonus). Allies lose Hide bonus while glamored. Dispelled by grab or failed Manipulate.`,
  },
  {
    id: 'illusionary-overlay',
    name: 'Illusionary Overlay',
    type: 'purchasable',
    category: 'stealth',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Shade Cloak'],
    exclusiveWith: ['glamor'],
    description: 'Create environmental illusions.',
    effect: `Complex Action: Create stationary illusion (specify effect when taking). Destroyed if attacked/moved through or user moves (Stage Bonus+1)×10m away.`,
  },
  {
    id: 'substitute',
    name: 'Substitute',
    type: 'purchasable',
    category: 'stealth',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Sneak Attack'],
    description: 'Escape hit with a decoy.',
    effect: `When dodge fails, Stealth vs attacker's Perception. Success: Forfeit 1/5 Wound Boxes (rounded down), avoid attack and effects. Resets Combat Monster count. 3 uses per combat. Need 1+ Wound Box.`,
  },

  // === DEFENSIVE QUALITIES (Section 3.05) ===
  {
    id: 'absolute-evasion',
    name: 'Absolute Evasion',
    type: 'purchasable',
    category: 'defensive',
    qualityType: 'static',
    dpCost: 3,
    maxRanks: 2,
    prerequisites: [],
    exclusiveWith: ['uncatchable-target'],
    description: 'Auto-successes on dodge that diminish.',
    effect: `1 auto-success per 4 base Dodge (max 2×Rank). Auto-successes reduce by 1 per dodge attempt. Resets each round. Pool reduced by auto-success count.`,
    maxRanksByStage: { rookie: 1, champion: 1, ultimate: 2, mega: 2, ultra: 2 },
  },
  {
    id: 'agility',
    name: 'Agility',
    type: 'purchasable',
    category: 'defensive',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 2,
    prerequisites: [],
    description: 'Reroll low dice on Dodge.',
    effect: `Rank 1: Reroll 1s on Dodge. Once per round. Rank 2: Also reroll 2s on Dodge. Once per round.`,
  },
  {
    id: 'combat-awareness',
    name: 'Combat Awareness',
    type: 'purchasable',
    category: 'defensive',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    description: 'First round bonuses.',
    effect: `Rank 1: +Ranks to Initiative (first round). Rank 2: +Ranks to Dodge (first round). Rank 3: +Ranks to Accuracy (first round). Treat Surprise Rounds as normal.`,
  },

  // === COMBAT MONSTER TREE (Section 3.05a) ===
  {
    id: 'combat-monster',
    name: 'Combat Monster',
    type: 'purchasable',
    category: 'combat-monster',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: 'Damage taken adds to next attack.',
    effect: `Damage taken adds to next successful attack's damage. Caps at Health stat. Resets on hit.`,
  },
  {
    id: 'berserker',
    name: 'Berserker',
    type: 'purchasable',
    category: 'combat-monster',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Combat Monster'],
    exclusiveWith: ['braveheart', 'positive-reinforcement'],
    description: 'Rage meter for bonuses and penalties.',
    effect: `Rage Meter (2d6, starts at 2). Activate as Simple Action. +1 Rage on hit/being hit. -4 Rage if round passes without. Per Rage: +1 Armor/Damage, -1 Accuracy/Dodge. At 12: GM control. Deactivate: TN 5+Rage Persuade check.`,
  },
  {
    id: 'boiling-blood',
    name: 'Boiling Blood',
    type: 'purchasable',
    category: 'combat-monster',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: ['Berserker'],
    description: 'Slower rage decay.',
    effect: `Per Rank: -1 to Rage decay (from -4 to -3/-2/-1).`,
  },
  {
    id: 'you-wont-like-me-when-im-angry',
    name: "You Won't Like Me When I'm Angry",
    type: 'purchasable',
    category: 'combat-monster',
    qualityType: 'static',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Boiling Blood'],
    description: 'Double rage meter capacity.',
    effect: `Rage Meter uses 4d6 (4-24 range). Adjust all calculations accordingly.`,
  },
  {
    id: 'braveheart',
    name: 'Braveheart',
    type: 'purchasable',
    category: 'combat-monster',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Combat Monster'],
    exclusiveWith: ['berserker', 'overwrite', 'undying-inforce'],
    description: 'Guard stance when low HP.',
    effect: `Below ½ Wound Boxes: Take [Brave Stance] as Simple Action. [Guard] (Simple): Armor ×1.5, Movement -Stage Bonus. If healed above ½, return to Neutral Stance.`,
  },
  {
    id: 'one-for-all',
    name: 'One for All',
    type: 'purchasable',
    category: 'combat-monster',
    qualityType: ['static', 'trigger'],
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Combat Monster', 'Braveheart'],
    stageRequirement: 'ultimate',
    description: 'Combat Monster shares with allies.',
    effect: `Combat Monster cap = Wound Box count. [Intercede] in [Brave Stance] triggers [Guts]: +1 Combat Monster per ally in Melee Burst. Allies in radius get same Combat Monster bonus for next attack.`,
  },

  // === BOOSTING QUALITIES (Section 3.06) ===
  {
    id: 'improved-derived-stat',
    name: 'Improved Derived Stat',
    type: 'purchasable',
    category: 'boosting',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 30, // Up to 10 per stat
    prerequisites: [],
    description: '+1 to a Derived Stat. Makes stat "trained".',
    effect: `+1 to Body, Agility, or Brains. "Trained" stats use ½ Derived Stat for Skill Checks instead of Spec Value.`,
  },
  {
    id: 'system-boost',
    name: 'System Boost',
    type: 'purchasable',
    category: 'boosting',
    qualityType: 'static',
    dpCost: 3,
    maxRanks: 9,
    prerequisites: [],
    description: '+1 to a Spec Value. Max 3 per stat, cannot exceed 2× base.',
    effect: `+1 to BIT, RAM, or CPU. Max 3 ranks per stat. Cannot exceed 2× Base Spec Value.`,
  },
  {
    id: 'prodigious-skill',
    name: 'Prodigious Skill',
    type: 'purchasable',
    category: 'boosting',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 15,
    prerequisites: ['Improved Derived Stat'],
    description: 'Use full Derived Stat for a specific skill.',
    effect: `Choose a Tamer skill (Feats of Strength, Stealth, Perception, etc.). Use full Derived Stat instead of ½. Requires Improved Derived Stat in the corresponding stat.`,
  },
  {
    id: 'instinct',
    name: 'Instinct',
    type: 'purchasable',
    category: 'boosting',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    exclusiveWith: ['weapon'],
    description: '+Rank to Dodge, Health, Base Movement. Ranks limited by stage.',
    effect: `Per Rank: +1 Dodge, Health, Base Movement.`,
    maxRanksByStage: { rookie: 1, champion: 2, ultimate: 3, mega: 3, ultra: 3 },
  },
  {
    id: 'reach',
    name: 'Reach',
    type: 'purchasable',
    category: 'boosting',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 3,
    prerequisites: [],
    description: 'Extended melee range.',
    effect: `[Melee] attacks and Clashes work at Rank×2 meters. [Area] origin can be within reach.`,
  },

  // === UTILITY QUALITIES (Section 3.07) ===
  {
    id: 'technician',
    name: 'Technician',
    type: 'purchasable',
    category: 'utility',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    description: 'Bonus to repair and code work.',
    effect: `Read Digicode. +4 per Rank to repair/decipher code and machinery.`,
  },
  {
    id: 'firewall',
    name: 'Firewall',
    type: 'purchasable',
    category: 'utility',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Technician Rank 1'],
    description: 'Bonus to protect code. Unlock more Technician ranks.',
    effect: `+Technician Rank to routing out intruders/protecting code. Can purchase 3 more Technician ranks.`,
  },
  {
    id: 'trojan',
    name: 'Trojan',
    type: 'purchasable',
    category: 'utility',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Technician Rank 1'],
    description: 'Bonus to infiltrate systems. Unlock more Technician ranks.',
    effect: `+Technician Rank to infiltrating protected areas. Can purchase 3 more Technician ranks.`,
  },
  {
    id: 'tracker',
    name: 'Tracker',
    type: 'purchasable',
    category: 'utility',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    description: 'Bonus to finding targets.',
    effect: `+4 to Perception for traps, enemies, trails. +2 per Rank with proper tracking tool.`,
  },
  {
    id: 'tumbler',
    name: 'Tumbler',
    type: 'purchasable',
    category: 'utility',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: 'Reduced fall/throw damage.',
    effect: `+RAM×2 damage reduction from falls/throws. With Advanced Mobility: Jumper, negate all fall damage.`,
  },
  {
    id: 'naturewalk',
    name: 'Naturewalk',
    type: 'purchasable',
    category: 'utility',
    qualityType: ['static', 'trigger'],
    dpCost: 1, // 1 DP per rank after first
    freeFirstRank: true, // First rank is free
    maxRanks: 2,
    singleRankPerChoice: true, // Each element can only be taken once
    prerequisites: [],
    description: 'At home in certain terrain. First rank free.',
    effect: `Choose an Element. No difficult terrain penalty in that environment. Element-specific bonuses (Fire: +2 Damage, can't be Burned; Water: breathe underwater, +2 Temp WB with Adv Swimmer; etc.).`,
    choices: [
      { id: 'fire', name: 'Fire', effect: 'Deserts, volcanic. Resist hot temps. +2 Damage in element. Cannot be [Burned].' },
      { id: 'water', name: 'Water', effect: 'Oceans, rivers. Breathe underwater. With Adv Swimmer: +2 Temp WB in water combat.' },
      { id: 'wind', name: 'Wind', effect: 'Mountains, open skies. Resist high winds. +2 Dodge in element.' },
      { id: 'ice', name: 'Ice', effect: 'Glaciers, tundra. Resist cold. +2 Armor in element.' },
      { id: 'thunder', name: 'Thunder', effect: 'Electric areas, factories. +1 Resistance vs [Paralysis].' },
      { id: 'wood', name: 'Wood', effect: 'Forests, swamps. [Poison] min duration 2 instead of 3.' },
      { id: 'earth', name: 'Earth', effect: 'Caves, canyons. With Adv Digger: +1 Armor Piercing rank.' },
      { id: 'darkness', name: 'Darkness', effect: 'Dim areas, cemeteries. See through darkness.' },
      { id: 'steel', name: 'Steel', effect: 'Cities, factories. +2 Movement in urban. +2 more with Adv Wallclimber/Jumper.' },
      { id: 'light', name: 'Light', effect: 'Holy grounds. +1 Resistance vs [Blind].' },
    ],
  },

  // === SUPPORT QUALITIES (Section 3.08) ===
  {
    id: 'quick-healer',
    name: 'Quick Healer',
    type: 'purchasable',
    category: 'support',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: 'Reroll 1s on Recovery checks.',
    effect: `Post-battle Recovery Check: Reroll 1s. (Roll Health, each success = 1 Wound Box recovered.)`,
  },
  {
    id: 'regenerator',
    name: 'Regenerator',
    type: 'purchasable',
    category: 'support',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: ['Quick Healer'],
    description: 'Guaranteed recovery.',
    effect: `+Rank guaranteed Wound Boxes on Recovery.`,
  },
  {
    id: 'second-wind',
    name: 'Second Wind',
    type: 'purchasable',
    category: 'support',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Quick Healer', 'Regenerator Rank 1'],
    description: 'Recovery during combat.',
    effect: `Make Recovery Check as Simple Action in combat. Cannot attack that turn. Not affected by Huge Power.`,
  },
  {
    id: 'resistant',
    name: 'Resistant',
    type: 'purchasable',
    category: 'support',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 3,
    prerequisites: [],
    description: 'Shorter effect durations.',
    effect: `Per Rank: -2 rounds on incoming [Effect] duration (min 1, min 3 for Poison).`,
  },
  {
    id: 'decisive-defenses',
    name: 'Decisive Defenses',
    type: 'purchasable',
    category: 'support',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Resistant Rank 3'],
    description: 'Resistant only affects negative effects.',
    effect: `Resistant no longer reduces positive effect duration.`,
  },
  {
    id: 'selective-targeting',
    name: 'Selective Targeting',
    type: 'purchasable',
    category: 'support',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: 'Area attacks don\'t hit allies.',
    effect: `[Area] attacks won't damage allies or give them negative effects. Enemies can't gain positive effects from your area attacks. In Clash targeting, enemy only gets own CPU to Armor.`,
  },
  {
    id: 'crybaby',
    name: 'Crybaby',
    type: 'purchasable',
    category: 'support',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: 'Allies intercede without penalty.',
    effect: `Once per combat, when targeted, an ally can Intercede without action penalty.`,
  },
  {
    id: 'pack-master',
    name: 'Pack Master',
    type: 'purchasable',
    category: 'support',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Crybaby'],
    description: 'Allies intercede from further away.',
    effect: `When targeted, ally within Stage Bonus meters can Intercede without action penalty.`,
  },

  // === SIGNATURE MOVE (Section 3.11) ===
  {
    id: 'signature-move',
    name: 'Signature Move',
    type: 'purchasable',
    category: 'signature-move',
    qualityType: ['trigger', 'attack'],
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: 'Powerful attack with cooldown.',
    effect: `Available Round 3+. [Damage] type: +Attacks to Accuracy and Damage. [Support] type: +2 to favored Spec Value. 2 full rounds cooldown. Cannot use with [Poison], [Hazard], [Revitalize], or Complex Action effects.`,
  },

  // === ATTACK EFFECTS (Section 3.09) ===
  // Positive [P], Non-Aligned [N/A], and Negative [N] effects
  // 1 DP Effects
  {
    id: 'effect-immobilize',
    name: 'Immobilize',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Reduces target movement.',
    effect: `Apply [Immobilize] tag to an attack. Target suffers movement penalty based on potency (BIT-based). Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-taunt',
    name: 'Taunt',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Forces target to attack you.',
    effect: `Apply [Taunt] tag to an attack. Target must focus attacks on you. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-fear',
    name: 'Fear',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Accuracy penalty on target.',
    effect: `Apply [Fear] tag to an attack. Target suffers accuracy penalty based on potency (BIT-based). Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-knockback',
    name: 'Knockback',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: '[N/A] Push target away.',
    effect: `Apply [Knockback] tag to an attack. Push target away from you based on potency.`,
  },
  {
    id: 'effect-pull',
    name: 'Pull',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: [],
    description: '[N/A] Pull target toward you.',
    effect: `Apply [Pull] tag to an attack. Pull target toward you based on potency.`,
  },
  // 2 DP Effects
  {
    id: 'effect-poison',
    name: 'Poison',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Damage over time, min 3 rounds.',
    effect: `Apply [Poison] tag to an attack. Target takes damage each round. Minimum duration 3 rounds (cannot be reduced below 3 by Resistant).`,
  },
  {
    id: 'effect-confuse',
    name: 'Confuse',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Random targeting.',
    effect: `Apply [Confuse] tag to an attack. Target may attack allies randomly. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-stun',
    name: 'Stun',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Target loses actions.',
    effect: `Apply [Stun] tag to an attack. Target loses actions. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-lifesteal',
    name: 'Lifesteal',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N/A] Heal from damage dealt.',
    effect: `Apply [Lifesteal] tag to an attack. Recover wound boxes equal to damage dealt (after armor).`,
  },
  {
    id: 'effect-vigor',
    name: 'Vigor',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Boost ally damage.',
    effect: `Apply [Vigor] tag to a support attack. Ally gains damage bonus. Single-target: Ally rolls Health for duration (guaranteed 1 round min).`,
  },
  {
    id: 'effect-fury',
    name: 'Fury',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Boost ally accuracy.',
    effect: `Apply [Fury] tag to a support attack. Ally gains accuracy bonus. Single-target: Ally rolls Health for duration (guaranteed 1 round min).`,
  },
  {
    id: 'effect-cleanse',
    name: 'Cleanse',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Remove negative effects.',
    effect: `Apply [Cleanse] tag to a support attack. Remove negative effects from ally. Sets effect durations to 1 (including Poison).`,
  },
  {
    id: 'effect-haste',
    name: 'Haste',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Grant extra action.',
    effect: `Apply [Haste] tag to a support attack. Ally gains extra simple action. Single-target: No Health roll required.`,
  },
  {
    id: 'effect-strengthen',
    name: 'Strengthen',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Boost ally armor.',
    effect: `Apply [Strengthen] tag to a support attack. Ally gains armor bonus. Single-target: Ally rolls Health for duration.`,
  },
  {
    id: 'effect-weaken',
    name: 'Weaken',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Reduce target armor.',
    effect: `Apply [Weaken] tag to an attack. Target suffers armor penalty. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-swiftness',
    name: 'Swiftness',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Boost ally dodge.',
    effect: `Apply [Swiftness] tag to a support attack. Ally gains dodge bonus. Single-target: Ally rolls Health for duration.`,
  },
  {
    id: 'effect-vigilance',
    name: 'Vigilance',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Boost ally movement.',
    effect: `Apply [Vigilance] tag to a support attack. Ally gains movement bonus. Single-target: Ally rolls Health for duration.`,
  },
  {
    id: 'effect-distract',
    name: 'Distract',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Reduce target dodge.',
    effect: `Apply [Distract] tag to an attack. Target suffers dodge penalty. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-exploit',
    name: 'Exploit',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Reduce target damage.',
    effect: `Apply [Exploit] tag to an attack. Target suffers damage penalty. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-pacify',
    name: 'Pacify',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Prevent target attacks.',
    effect: `Apply [Pacify] tag to an attack. Target cannot attack. Duration = leftover Accuracy successes.`,
  },
  // 3 DP Effects
  {
    id: 'effect-blind',
    name: 'Blind',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Severe accuracy/dodge penalty.',
    effect: `Apply [Blind] tag to an attack. Target suffers severe accuracy and dodge penalties. Duration = leftover Accuracy successes.`,
  },
  {
    id: 'effect-paralysis',
    name: 'Paralysis',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Target cannot act.',
    effect: `Apply [Paralysis] tag to an attack. Target cannot take actions. Duration = leftover Accuracy successes. Can break Overwrite state.`,
  },
  {
    id: 'effect-dot',
    name: 'DOT',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Damage over time (severe).',
    effect: `Apply [DOT] tag to an attack. Target takes significant damage each round. Can break Overwrite state.`,
  },
  {
    id: 'effect-shield',
    name: 'Shield',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Grant temporary wound boxes.',
    effect: `Apply [Shield] tag to a support attack. Ally gains temporary wound boxes. Single-target: No Health roll required. Cannot self-buff without [Area Attack].`,
  },
  {
    id: 'effect-regenerate',
    name: 'Regenerate',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[P] Heal over time.',
    effect: `Apply [Regenerate] tag to a support attack. Ally recovers wound boxes each round. Single-target: Ally rolls Health for duration.`,
  },
  {
    id: 'effect-lag',
    name: 'Lag',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Move target to end of initiative.',
    effect: `Apply [Lag] tag to an attack. Target moves to end of initiative order. Can break Overwrite state. Prevents Temporal InForce initiative adjustment.`,
  },
  {
    id: 'effect-burn',
    name: 'Burn',
    type: 'purchasable',
    category: 'attack-effects',
    qualityType: 'attack',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    description: '[N] Damage over time (fire).',
    effect: `Apply [Burn] tag to an attack. Target takes fire damage each round. Prevented by Naturewalk: Fire.`,
  },

  // === ADVANCED QUALITIES (Section 3.10) ===
  // Element Master Tree
  {
    id: 'element-master',
    name: 'Element Master',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Naturewalk'],
    description: 'Manipulate your element.',
    effect: `Manipulate natural sources of your Naturewalk element within [Burst] [Ranged] radius. Change terrain (difficult↔basic) as Simple Action. Move BIT×3 cubic meters of element. Pick one element if you have multiple Naturewalks.`,
  },
  {
    id: 'domain-control-treacherous-fire',
    name: 'Domain Control: Treacherous Fire',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Stationary] Fire/Water: Difficult terrain + Burn.',
    effect: `Create Stationary Domain (Complex Action). Duration: Stage Bonus rounds. Terrain is difficult; those within suffer [Burn] at BIT/2 potency. Cannot leave domain or it disperses.`,
  },
  {
    id: 'domain-control-volatile-element',
    name: 'Domain Control: Volatile Element',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Aura] Fire/Water: Attacks treated as Exploit.',
    effect: `Create Aura Domain (Complex Action). Duration: Stage Bonus rounds. All attacks treated as if target has [Exploit] with BIT/2 penalty. Disperses without elemental source.`,
  },
  {
    id: 'domain-control-shadow-vale',
    name: 'Domain Control: Shadow Vale',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Aura] Earth/Darkness: Fear at round start.',
    effect: `Create Aura Domain (Complex Action). Duration: Stage Bonus rounds. [Fear] applied to all at start of each round with BIT/2 accuracy penalty.`,
  },
  {
    id: 'domain-control-sapping-strength',
    name: 'Domain Control: Sapping Strength',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Stationary] Earth/Darkness: Lifesteal chance.',
    effect: `Create Stationary Domain (Complex Action). Roll 1d6 per target (up to BIT). On 5+, inflict [Lifesteal] stealing 1 WB. Not affected by Huge Power.`,
  },
  {
    id: 'domain-control-gusty-garden',
    name: 'Domain Control: Gusty Garden',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Aura] Wind/Ice: Difficult terrain + Knockback.',
    effect: `Create Aura Domain (Complex Action). Terrain is difficult (unless has Advanced Flight). [Knockback] of CPU applied at round start.`,
  },
  {
    id: 'domain-control-cleansing-mist',
    name: 'Domain Control: Cleansing Mist',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Aura] Wind/Ice: Cleanse all effects.',
    effect: `Create Aura Domain (Complex Action). [Cleanse] applied at entry and each round start. All effect durations set to 1, including Poison.`,
  },
  {
    id: 'domain-control-rejuvenating-light',
    name: 'Domain Control: Rejuvenating Light',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Stationary] Thunder/Light: Regenerate.',
    effect: `Create Stationary Domain (Complex Action). [Regenerate] applied to all at start of each round.`,
  },
  {
    id: 'domain-control-thunder-justice',
    name: 'Domain Control: Thunder Justice',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Aura] Thunder/Light: Paralysis chance.',
    effect: `Create Aura Domain (Complex Action). Roll 1d6 per target (up to BIT). On 5+, inflict [Paralysis] for that turn + movement debuff.`,
  },
  {
    id: 'domain-control-natural-limitation',
    name: 'Domain Control: Natural Limitation',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Stationary] Wood/Steel: Only your minions allowed.',
    effect: `Create Stationary Domain (Complex Action). Only your summoned minions may exist. Foreign minions contest 1d6 vs Controller each round; on fail, one minion removed permanently.`,
  },
  {
    id: 'domain-control-dg-dimension',
    name: 'Domain Control: DG Dimension',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Element Master'],
    description: '[Stationary] Wood/Steel: DOT on failed contest.',
    effect: `Create Stationary Domain (Complex Action). Roll 1d6 at start; targets (up to BIT/2) roll 1d6. If lower, [DOT] inflicted for 1 round. Re-contest every other round.`,
  },
  {
    id: 'adaptive-element',
    name: 'Adaptive Element',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'static',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Element Master', 'Domain Control'],
    description: 'Apply any domain type to your element.',
    effect: `Choose any Domain Control type (from any element category). Apply that domain with your Element Master element (flavor as appropriate).`,
  },

  // Conjurer and Summoner Tree
  {
    id: 'conjurer',
    name: 'Conjurer',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    exclusiveWith: ['summoner'],
    description: 'Create objects from nothing.',
    effect: `Summon Pool = BIT×3. 1 point per cubic meter. Objects have shared WB = BIT×4 (split among objects) + Stage Bonus each. Armor = BIT×2, no Dodge. Complex Action to summon. Can create Blocking Terrain. Cooldown: every other turn.`,
  },
  {
    id: 'summoner',
    name: 'Summoner',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: [],
    exclusiveWith: ['conjurer'],
    description: 'Create minions to fight.',
    effect: `Summon Pool = BIT×3. 2 points per minion (Medium size). Minions have shared WB = BIT×3 + Stage Bonus each. Accuracy/Damage = BIT+Stage Bonus. Armor = BIT. Can fly (Brains meters). Complex Action to attack/move. Cooldown: every other turn.`,
  },
  {
    id: 'mixed-summoner',
    name: 'Mixed Summoner',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'static',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Summoner', 'Conjurer'],
    description: 'Use both Summoner and Conjurer.',
    effect: `May take both Summoner and Conjurer. BIT treated as 1 lower for Summon Pool calculation.`,
  },
  {
    id: 'elemental-summoner',
    name: 'Elemental Summoner',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'static',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Summoner'],
    exclusiveWith: ['specialized-summoning'],
    description: 'Minions explode on death.',
    effect: `When minions are destroyed, they deal BIT damage in [Burst] [Ranged] radius (roll Accuracy). Affected by Selective Targeting, Mobile Artillery.`,
  },
  {
    id: 'specialized-summoning',
    name: 'Specialized Summoning',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Summoner'],
    stageRequirement: 'ultimate',
    exclusiveWith: ['elemental-summoner'],
    description: 'Create specialized minions.',
    effect: `Specialized minions cost 5 points. Choose one tactic: Vanguard (high damage, charge), Safeguard (high armor, intercede), or Recon (ranged, reconnaissance). Once per battle, cannot re-summon.`,
    choices: [
      { id: 'vanguard', name: 'Vanguard Tactics', effect: 'Damage = BIT×2, Accuracy = BIT, Armor = BIT+SB. Large/Huge size. Auto charge attack. Max 2 minions (cost 10 each).' },
      { id: 'safeguard', name: 'Safeguard Tactics', effect: 'Armor = BIT×2, Damage = BIT. Medium/Large size. Can intercede (Simple Action). 3 minions can negate one attack. Max 3 minions.' },
      { id: 'recon', name: 'Recon Tactics', effect: 'Accuracy = BIT×2, Armor = BIT. Small size. Ranged attacks. Sight-sharing (BIT−minions check). Max 4 minions.' },
    ],
  },

  // Mode Change Tree
  {
    id: 'mode-change',
    name: 'Mode Change',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 2,
    prerequisites: [],
    description: 'Swap stats as Simple Action.',
    effect: `Rank 1: Swap Armor↔Damage as Simple Action. Rank 2: Also swap Accuracy↔Dodge. Uses base stats only (not modified by qualities/stances).`,
  },
  {
    id: 'mode-change-x0',
    name: 'Mode Change X.0',
    type: 'purchasable',
    category: 'advanced',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 2,
    prerequisites: ['Mode Change'],
    description: 'Flexible stat swapping.',
    effect: `Rank 1: Swap any two stats (not Health) with any other two stats. Rank 2: Swap stats freely as you see fit. Can retroactively change Mode Change choices.`,
  },

  // === DIGIZOID ARMOR (Section 3.12a) ===
  {
    id: 'digizoid-armor',
    name: 'Digizoid Armor',
    type: 'purchasable',
    category: 'digizoid',
    qualityType: ['static', 'trigger'],
    dpCost: 1,
    maxRanks: 1,
    exclusiveChoices: true,
    prerequisites: [],
    stageRequirement: 'ultimate',
    description: 'Choose a Digizoid Armor type. Can only take one.',
    effect: `Choose one Digizoid Armor variant to enhance your Digimon's defenses.`,
    choices: [
      {
        id: 'chrome',
        name: 'Chrome',
        dpCost: 1,
        stageRequirement: 'ultimate',
        effect: `+2 Armor, +1 Health.`,
      },
      {
        id: 'black',
        name: 'Black',
        dpCost: 2,
        stageRequirement: 'mega',
        effect: `+2 Armor. Each round roll 1d6: 1-2: +4 Armor; 3-4: +4 Dodge; 5-6: +2 Armor and +2 Dodge.`,
      },
      {
        id: 'brown',
        name: 'Brown',
        dpCost: 3,
        stageRequirement: 'mega',
        effect: `+2 Armor, 1 automatic dodge success (like Absolute Evasion), +RAM to Clash avoidance/escape checks.`,
      },
      {
        id: 'blue',
        name: 'Blue',
        dpCost: 3,
        stageRequirement: 'mega',
        effect: `+2 Armor, +2 Dodge, +4 Base Movement.`,
      },
      {
        id: 'gold',
        name: 'Gold',
        dpCost: 2,
        stageRequirement: 'mega',
        effect: `+2 Armor, +1 Health. When hit by [Ranged] attack, attacker takes CPU×2 damage (reduced by their Armor, min 1).`,
      },
      {
        id: 'obsidian',
        name: 'Obsidian',
        dpCost: 2,
        stageRequirement: 'mega',
        effect: `+2 Armor, +1 Health. When hit by [Melee] attack, attacker takes CPU×2 damage (reduced by their Armor, min 1).`,
      },
      {
        id: 'red',
        name: 'Red',
        dpCost: 2,
        stageRequirement: 'mega',
        effect: `+4 Armor, +2 Health.`,
      },
    ],
  },

  // === DIGIZOID WEAPONRY (Section 3.12b) ===
  {
    id: 'digizoid-weapon',
    name: 'Digizoid Weaponry',
    type: 'purchasable',
    category: 'digizoid',
    qualityType: ['static', 'trigger'],
    dpCost: 1,
    maxRanks: 1,
    exclusiveChoices: true,
    prerequisites: ['Weapon Rank 1'],
    stageRequirement: 'ultimate',
    description: 'Choose a Digizoid Weaponry type. Can only take one.',
    effect: `Choose one Digizoid Weaponry variant to enhance your Digimon's [Weapon] attacks.`,
    choices: [
      { id: 'chrome', name: 'Chrome', dpCost: 1, stageRequirement: 'ultimate', effect: `[Weapon] attacks gain +2 Accuracy, +1 Damage.` },
      { id: 'black', name: 'Black', dpCost: 2, stageRequirement: 'mega', effect: `[Weapon] attacks gain +2 Accuracy. Each round roll 1d6: 1-2: +4 Damage; 3-4: +4 Accuracy; 5-6: +2 Damage and +2 Accuracy.` },
      { id: 'brown', name: 'Brown', dpCost: 3, stageRequirement: 'mega', effect: `+2 Dodge. [Weapon] attacks gain +2 Damage and 2 ranks of Reach.` },
      { id: 'blue', name: 'Blue', dpCost: 3, stageRequirement: 'mega', effect: `[Weapon] attacks gain +2 Accuracy, +2 Damage, and 1 automatic success.` },
      { id: 'gold', name: 'Gold', dpCost: 3, stageRequirement: 'mega', effect: `[Weapon] attacks gain +4 Accuracy, +1 Damage. [Ranged] [Weapon] attacks gain +5 meters base range.` },
      { id: 'obsidian', name: 'Obsidian', dpCost: 3, stageRequirement: 'mega', effect: `[Weapon] attacks gain +2 Accuracy, +2 Damage, and +1 rank Armor Piercing.` },
      { id: 'red', name: 'Red', dpCost: 3, stageRequirement: 'mega', effect: `[Weapon] attacks gain +6 Damage.` },
    ],
  },

  // === GAIN FORCE / INFORCE (Section 3.13) ===
  {
    id: 'overwrite',
    name: 'Overwrite',
    type: 'purchasable',
    category: 'gain-force',
    qualityType: ['static', 'attack', 'trigger'],
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Instinct Rank 1'],
    stageRequirement: 'ultimate',
    exclusiveWith: ['braveheart', 'undying-inforce', 'temporal-inforce', 'omniscient-inforce', 'digital-hazard', 'zero-unit'],
    description: 'Immune to cheap effects, take CPU damage/round.',
    effect: `Simple Action to activate. Take unalterable CPU damage each round. Immune to effects costing <3 DP. Broken by: DOT, Paralysis, Blind, Lag, Frenzy. Cannot be Suppressed. Cannot take Braveheart.`,
  },
  {
    id: 'undying-inforce',
    name: 'Undying InForce',
    type: 'purchasable',
    category: 'gain-force',
    qualityType: 'static',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Instinct Rank 1'],
    stageRequirement: 'mega',
    exclusiveWith: ['overwrite', 'temporal-inforce', 'omniscient-inforce', 'digital-hazard', 'zero-unit'],
    description: 'Passive regenerating Shield.',
    effect: `Passive [Shield] = CPU + Instinct ranks temp WB. After first damage, cap drops to ½ (rounded down). Every other round, refresh ¼ of Shield (rounded down).`,
  },
  {
    id: 'temporal-inforce',
    name: 'Temporal InForce',
    type: 'purchasable',
    category: 'gain-force',
    qualityType: ['trigger', 'attack'],
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Instinct Rank 1'],
    stageRequirement: 'mega',
    exclusiveWith: ['overwrite', 'undying-inforce', 'omniscient-inforce', 'digital-hazard', 'zero-unit'],
    description: 'Control initiative, reroll attacks.',
    effect: `Don't roll Initiative—choose your position after others roll. Every other turn, adjust position (unless Lagged). Once/battle: reroll Huge Power (if you have it).`,
  },
  {
    id: 'omniscient-inforce',
    name: 'Omniscient InForce',
    type: 'purchasable',
    category: 'gain-force',
    qualityType: 'trigger',
    dpCost: 2,
    maxRanks: 1,
    prerequisites: ['Instinct Rank 1'],
    stageRequirement: 'mega',
    exclusiveWith: ['overwrite', 'undying-inforce', 'temporal-inforce', 'digital-hazard', 'zero-unit'],
    description: 'Ready Actions, reroll dodges.',
    effect: `Once/round: declare [Ready Action]—if prediction true, act for free (e.g., "Intercede if X targeted"). Once/battle: reroll Agility (if you have it).`,
  },
  {
    id: 'digital-hazard',
    name: 'Digital Hazard',
    type: 'purchasable',
    category: 'gain-force',
    qualityType: ['trigger', 'attack'],
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Instinct Rank 1'],
    stageRequirement: 'mega',
    exclusiveWith: ['overwrite', 'undying-inforce', 'temporal-inforce', 'omniscient-inforce', 'zero-unit'],
    description: 'Automatic damage in burst radius.',
    effect: `Gain [Hazard] tag for one attack. Deals automatic damage (no Accuracy/Dodge roll) in Ranged Burst radius. Reduced by Armor. Cannot use Selective Targeting, Armor Piercing, Certain Strike, Charge Attack, or Mobile Artillery. Effects need 4+ damage to apply.`,
  },
  {
    id: 'zero-unit',
    name: 'Zero Unit',
    type: 'purchasable',
    category: 'gain-force',
    qualityType: ['trigger', 'attack'],
    dpCost: 3,
    maxRanks: 1,
    prerequisites: ['Instinct Rank 1'],
    stageRequirement: 'mega',
    exclusiveWith: ['overwrite', 'undying-inforce', 'temporal-inforce', 'omniscient-inforce', 'digital-hazard'],
    description: 'Powerful heal and revival.',
    effect: `Gain [Revitalize] tag (no Health roll needed). If target has WB: Simple Action, buff 2 stats (not Health) and heal BIT WB. If target at 0 or negative WB: Complex Action, give BIT WB, Tamer rolls Willpower (TN 18/20/22) to revive at highest stage; fail = Rookie revival. Once/battle for revival effect.`,
  },

  // === BURST POWER (Section 3.14) ===
  {
    id: 'burst-power',
    name: 'Burst Power',
    type: 'purchasable',
    category: 'burst-power',
    qualityType: 'trigger',
    dpCost: 1,
    maxRanks: 1,
    prerequisites: ['Mode Change X.0 Rank 2'],
    stageRequirement: 'mega',
    requiresGMApproval: true,
    description: 'Transform into Burst Mode.',
    effect: `GM Approval required. Create alternate stat build (reallocate DP spent on stats). Tamer rolls Bravery (TN 18/20/22). On success, enter Burst Mode for 3 turns. Heal 5 WB on entry. Available Round 3+. Once per session/day.`,
    choices: [
      { id: 'agility-future', name: 'Agility: The Future is Now', effect: '+5 Damage, +5 Accuracy, +5 Movement. Can buy second Digizoid Weaponry type.' },
      { id: 'agility-boiling', name: 'Agility: Boiling Power', effect: '+5 Damage, +5 Accuracy, +5 Movement. Charge Attack: +1 Damage per space moved (up to Tamer Agility).' },
      { id: 'body-vision', name: 'Body: One Vision', effect: '+5 Armor, +5 Accuracy, +5 Temp WB. Reflect half damage on attacks ≥½ your WB total.' },
      { id: 'body-dreamer', name: 'Body: The Biggest Dreamer', effect: '+5 Armor, +5 Accuracy, +5 Temp WB. Can buy second Digizoid Armor type.' },
      { id: 'charisma-butterfly', name: 'Charisma: Butter-Fly Effect', effect: '+5 Accuracy, +5 Dodge. Spend Burst Mode rounds to reset that many initiative turns.' },
      { id: 'charisma-light', name: 'Charisma: Be My Light', effect: '+5 Accuracy, +5 Dodge. Pick ally: your [P] Effects on them have BIT×2 potency, last 1 round, no roll needed.' },
      { id: 'intelligence-war', name: 'Intelligence: War Game', effect: '+5 Dodge, +5 Damage, +5m range. One Area Attack has ×2 range (Complex Action).' },
      { id: 'intelligence-beat', name: 'Intelligence: Beat Hit', effect: '+5 Dodge, +5 Damage, +5m range. Gain second [Signature Move] tag for another attack.' },
      { id: 'willpower-endless', name: 'Willpower: Endless Tale', effect: '+5 Damage, +5 Armor. At 0 WB, exit Burst Mode with 10 WB. Second Wind triggers free.' },
      { id: 'willpower-courage', name: 'Willpower: Those Who Inherit Courage', effect: '+5 Damage, +5 Armor. At 0 WB, all allies heal 5 WB and gain CPU Damage/Armor. You are removed from battle (cannot be Revitalized).' },
    ],
  },
]

// Negative Quality limits by stage
export const NEGATIVE_QUALITY_LIMITS: Record<string, number> = {
  'fresh': 0,
  'in-training': 0,
  'rookie': 1,
  'champion': 2,
  'ultimate': 3,
  'mega': 4,
  'ultra': 5,
}

// Get qualities by type
export function getQualitiesByType(type: QualityType): QualityTemplate[] {
  return QUALITY_DATABASE.filter((q) => q.type === type)
}

// Get free qualities
export function getFreeQualities(): QualityTemplate[] {
  return getQualitiesByType('free')
}

// Get negative qualities
export function getNegativeQualities(): QualityTemplate[] {
  return getQualitiesByType('negative')
}

// Get purchasable qualities
export function getPurchasableQualities(): QualityTemplate[] {
  return getQualitiesByType('purchasable')
}

// Get qualities by category
export function getQualitiesByCategory(category: QualityCategory): QualityTemplate[] {
  return QUALITY_DATABASE.filter((q) => q.category === category)
}

// Get max negative DP for a stage
export function getMaxNegativeDP(stage: string): number {
  return NEGATIVE_QUALITY_LIMITS[stage] || 0
}

// Compare stages (returns -1 if a < b, 0 if equal, 1 if a > b)
export function compareStages(a: DigimonStage, b: DigimonStage): number {
  const indexA = STAGE_ORDER.indexOf(a)
  const indexB = STAGE_ORDER.indexOf(b)
  if (indexA < indexB) return -1
  if (indexA > indexB) return 1
  return 0
}

// Check if a quality is available at a given stage
export function isQualityAvailableAtStage(quality: QualityTemplate, stage: DigimonStage): boolean {
  if (!quality.stageRequirement) return true
  return compareStages(stage, quality.stageRequirement) >= 0
}

// Get max ranks for a quality at a given stage
export function getMaxRanksAtStage(quality: QualityTemplate, stage: DigimonStage): number {
  if (quality.maxRanksByStage) {
    // Find the highest stage that's <= current stage and has a limit defined
    let maxRank = 0
    for (const stageKey of STAGE_ORDER) {
      if (compareStages(stageKey, stage) <= 0) {
        const limit = quality.maxRanksByStage[stageKey]
        if (limit !== undefined) {
          maxRank = limit
        }
      }
    }
    return Math.min(maxRank, quality.maxRanks)
  }
  return quality.maxRanks
}

// Calculate effective DP cost for a quality at a given rank
// Accounts for freeFirstRank (e.g., Naturewalk: first rank free, second costs 1 DP)
export function getEffectiveDPCost(
  quality: QualityTemplate,
  ranks: number,
  choiceDpCost?: number,
  stage?: DigimonStage,
  isFirstOfType?: boolean,
  eddySoulRules?: EddySoulRules
): number {
  let baseCost = choiceDpCost ?? quality.dpCost

  // EddySoul rule: Charge Attack costs 3 DP instead of 1
  if (eddySoulRules?.chargeAttackCosts3DP && quality.id === 'charge-attack') {
    baseCost = 3
  }

  if (quality.freeFirstRank) {
    // First rank is free, subsequent ranks cost dpCost each
    // ranks=1 -> 0, ranks=2 -> 1×dpCost, etc.
    return Math.max(0, ranks - 1) * baseCost
  }

  let totalCost = ranks * baseCost

  // Apply stage-based discount on first rank (e.g., Extra Movement at Champion+)
  if (quality.firstRankDiscountAtStage && stage && isFirstOfType) {
    const { stage: discountStage, discount } = quality.firstRankDiscountAtStage
    if (compareStages(stage, discountStage) >= 0) {
      totalCost = Math.max(0, totalCost - discount)
    }
  }

  return totalCost
}

// Check if prerequisites are met
export function arePrerequisitesMet(
  quality: QualityTemplate,
  currentQualities: Array<{ id: string; name: string; ranks?: number }>
): { met: boolean; missing: string[] } {
  const missing: string[] = []

  for (const prereq of quality.prerequisites) {
    // Parse prerequisite (may include "Rank X" requirement)
    const rankMatch = prereq.match(/^(.+?)\s+Rank\s+(\d+)$/i)

    if (rankMatch) {
      const prereqName = rankMatch[1]
      const requiredRank = parseInt(rankMatch[2], 10)

      const found = currentQualities.find(
        (q) => q.name.toLowerCase() === prereqName.toLowerCase() || q.id.toLowerCase() === prereqName.toLowerCase()
      )

      if (!found || (found.ranks || 1) < requiredRank) {
        missing.push(prereq)
      }
    } else {
      // Simple prerequisite (just name)
      const found = currentQualities.find(
        (q) => q.name.toLowerCase() === prereq.toLowerCase() || q.id.toLowerCase() === prereq.toLowerCase()
      )

      if (!found) {
        missing.push(prereq)
      }
    }
  }

  return { met: missing.length === 0, missing }
}

// Check if any exclusive qualities are already selected
export function hasExclusiveConflict(
  quality: QualityTemplate,
  currentQualities: Array<{ id: string }>
): { conflict: boolean; conflictingIds: string[] } {
  if (!quality.exclusiveWith || quality.exclusiveWith.length === 0) {
    return { conflict: false, conflictingIds: [] }
  }

  const conflictingIds = quality.exclusiveWith.filter((exId) => currentQualities.some((q) => q.id === exId))

  return { conflict: conflictingIds.length > 0, conflictingIds }
}

// Get all categories with their display names
export function getQualityCategories(): Array<{ id: QualityCategory; name: string }> {
  return [
    { id: 'data-optimization', name: 'Data Optimization' },
    { id: 'data-specialization', name: 'Data Specialization' },
    { id: 'extra-movement', name: 'Extra Movement' },
    { id: 'offensive', name: 'Offensive' },
    { id: 'counterattack', name: 'Counterattack' },
    { id: 'stealth', name: 'Stealth' },
    { id: 'defensive', name: 'Defensive' },
    { id: 'combat-monster', name: 'Combat Monster' },
    { id: 'boosting', name: 'Boosting' },
    { id: 'utility', name: 'Utility' },
    { id: 'support', name: 'Support' },
    { id: 'attack-effects', name: 'Attack Effects' },
    { id: 'advanced', name: 'Advanced' },
    { id: 'signature-move', name: 'Signature Move' },
    { id: 'digizoid', name: 'Digizoid' },
    { id: 'gain-force', name: 'Gain Force' },
    { id: 'burst-power', name: 'Burst Power' },
    { id: 'free', name: 'Free Qualities' },
    { id: 'negative', name: 'Negative Qualities' },
  ]
}

// Search qualities
export function searchQualities(query: string): QualityTemplate[] {
  const lower = query.toLowerCase()
  return QUALITY_DATABASE.filter(
    (q) =>
      q.name.toLowerCase().includes(lower) ||
      q.description.toLowerCase().includes(lower) ||
      q.effect.toLowerCase().includes(lower)
  )
}

// Helper to get quality type tags as array
export function getQualityTypeTags(qualityType: QualityTypeTag | QualityTypeTag[]): QualityTypeTag[] {
  return Array.isArray(qualityType) ? qualityType : [qualityType]
}

// Get quality by ID
export function getQualityById(id: string): QualityTemplate | undefined {
  return QUALITY_DATABASE.find((q) => q.id === id)
}

// Filter qualities for selection (checks stage, prerequisites, exclusivity)
export function getAvailableQualities(
  stage: DigimonStage,
  currentQualities: Array<{ id: string; name: string; ranks?: number }>,
  type?: QualityType,
  category?: QualityCategory
): QualityTemplate[] {
  let qualities = QUALITY_DATABASE

  // Filter by type if specified
  if (type) {
    qualities = qualities.filter((q) => q.type === type)
  }

  // Filter by category if specified
  if (category) {
    qualities = qualities.filter((q) => q.category === category)
  }

  // Filter by availability
  return qualities.filter((q) => {
    // Check stage requirement
    if (!isQualityAvailableAtStage(q, stage)) return false

    // Check if already at max ranks
    const existing = currentQualities.find((cq) => cq.id === q.id)
    if (existing) {
      const maxRanks = getMaxRanksAtStage(q, stage)
      if ((existing.ranks || 1) >= maxRanks) return false
    }

    // Check exclusive conflicts (but allow if quality is rankable and already owned)
    if (!existing) {
      const { conflict } = hasExclusiveConflict(q, currentQualities)
      if (conflict) return false
    }

    return true
  })
}
