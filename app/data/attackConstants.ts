// Attack-related constants used across Digimon forms
// Extracted from duplicate definitions in [id].vue and new.vue

/**
 * Effect alignment determines the resolution mechanics per game rules
 * P = Positive (uses ally Health roll for duration), N = Negative (uses enemy Dodge roll), NA = Non-Aligned
 * This is separate from which attack types an effect can be applied to (see EFFECT_ATTACK_TYPE_RESTRICTIONS)
 */
export const EFFECT_ALIGNMENT: Record<string, 'P' | 'N' | 'NA'> = {
  // Positive [P] — buffs for allies
  'Vigor': 'P',
  'Fury': 'P',
  'Haste': 'P',
  'Revitalize': 'P',
  'Shield': 'P',
  'Strengthen': 'P',
  'Vigilance': 'P',
  'Swiftness': 'P',
  'Regenerate': 'P',
  // Negative [N] — debuffs on enemies
  'Poison': 'N',
  'Confuse': 'N',
  'Stun': 'N',
  'Fear': 'N',
  'Immobilize': 'N',
  'Weaken': 'N',
  'Distract': 'N',
  'Exploit': 'N',
  'Pacify': 'N',
  'Blind': 'N',
  'Paralysis': 'N',
  'DOT': 'N',
  'Lag': 'N',
  'Burn': 'N',
  // Non-Aligned [NA]
  'Cleanse': 'NA',
  'Lifesteal': 'NA',
  'Knockback': 'NA',
  'Pull': 'NA',
  'Taunt': 'NA',
}

/**
 * P effects that skip the Health roll on single-target (guaranteed duration 1)
 */
export const SPECIAL_P_EFFECTS = new Set(['Shield', 'Haste', 'Purify', 'Revitalize'])

/**
 * Instant effects — resolve once on hit, no duration tracking needed
 */
export const INSTANT_EFFECTS = new Set(['Knockback', 'Pull', 'Lifesteal'])

/**
 * Permanent effects — no round duration; persist until replaced or removed by game event
 */
export const PERMANENT_EFFECTS = new Set(['Shield'])

/**
 * Duration caps/floors per effect
 */
export const EFFECT_DURATION_LIMITS: Record<string, { min?: number; max?: number }> = {
  'Haste': { max: 1 },
  'Poison': { min: 3 },
  'Burn': { max: 3 },
  'DOT': { max: 3 },
}

/**
 * Mutually exclusive effects — most recent overrides the previous
 */
export const MUTUALLY_EXCLUSIVE_EFFECTS: [string, string][] = [
  ['Burn', 'Poison'],
]

/**
 * Which spec stat drives each effect's potency.
 * Used when applying effects to store the numeric potency value.
 */
export const EFFECT_POTENCY_STAT: Record<string, 'bit' | 'ram' | 'cpu'> = {
  // Attacker BIT-based
  'Immobilize': 'bit',  // Movement penalty = user's BIT x2
  'Fear': 'bit',        // Accuracy penalty vs user = user's BIT
  'Vigor': 'bit',       // Dodge bonus = user's BIT, Movement bonus = user's BIT x2
  'Fury': 'bit',        // Accuracy + Damage bonus = user's BIT
  'Strengthen': 'bit',  // Damage + Armor bonus = user's BIT
  'Swiftness': 'bit',   // Dodge + Accuracy bonus = user's BIT
  'Vigilance': 'bit',   // Dodge + Armor bonus = user's BIT
  'Weaken': 'bit',      // Damage + Armor penalty = user's BIT
  'Distract': 'bit',    // Dodge + Accuracy penalty = user's BIT
  'Exploit': 'bit',     // Armor + Dodge penalty = user's BIT
  'Pacify': 'bit',      // Damage + Accuracy penalty = user's BIT
  'Blind': 'bit',       // Accuracy + Dodge penalty = user's BIT
  'Paralysis': 'bit',   // Dodge penalty = user's BIT, difficult terrain
  'Shield': 'bit',      // Temp wound boxes = user's BIT (x3 as complex action)
  'Regenerate': 'bit',  // Heal per round = user's BIT
  'Cleanse': 'bit',     // Duration reduction = user's BIT
  'Lag': 'bit',         // Initiative roll = 1d[user's BIT]
  // Attacker CPU-based
  'Knockback': 'cpu',   // Push distance = user's CPU + Stage Bonus
  'Pull': 'cpu',        // Pull distance = user's CPU + Stage Bonus
  'Taunt': 'cpu',       // Accuracy penalty for not attacking user = user's CPU x2
  'Lifesteal': 'cpu',   // Heal amount = user's CPU
}

/**
 * Effects whose potency comes from the TARGET's spec stats (not the attacker's).
 * When applying these, calculate potency from the target's derived stats.
 */
export const EFFECT_TARGET_POTENCY: Record<string, { stat: 'cpu' | 'bit' | 'ram', formula?: string }> = {
  'Poison': { stat: 'cpu' },                              // Damage per round = target's CPU
  'Confuse': { stat: 'cpu', formula: 'max(cpu, bit)' },   // Penalty = target's CPU or BIT (whichever higher)
  'DOT': { stat: 'ram' },                                 // Dodge bonus = target's RAM
}

/**
 * Maps each effect to the combat stat modifiers it applies.
 * Value of 1 = adds potency, -1 = subtracts potency.
 * Effects not listed here have no stat modifiers (e.g. Stun, Haste, Shield, Poison).
 */
export const EFFECT_STAT_MODIFIERS: Record<string, { accuracy?: number; damage?: number; dodge?: number; armor?: number }> = {
  // Buffs
  'Fury': { accuracy: 1, damage: 1 },
  'Strengthen': { damage: 1, armor: 1 },
  'Swiftness': { dodge: 1, accuracy: 1 },
  'Vigilance': { dodge: 1, armor: 1 },
  'Vigor': { dodge: 1 },
  // Debuffs
  'Weaken': { damage: -1, armor: -1 },
  'Distract': { dodge: -1, accuracy: -1 },
  'Exploit': { armor: -1, dodge: -1 },
  'Pacify': { damage: -1, accuracy: -1 },
  'Blind': { accuracy: -1, dodge: -1 },
  'Paralysis': { dodge: -1 },
}

/**
 * Calculate total stat modifiers from a participant's active effects.
 * Returns net bonuses/penalties to accuracy, damage, dodge, and armor.
 */
export function getEffectStatModifiers(activeEffects: { name: string; potency?: number }[]): { accuracy: number; damage: number; dodge: number; armor: number } {
  const mods = { accuracy: 0, damage: 0, dodge: 0, armor: 0 }
  for (const effect of activeEffects) {
    const def = EFFECT_STAT_MODIFIERS[effect.name]
    if (!def || !effect.potency) continue
    if (def.accuracy) mods.accuracy += def.accuracy * effect.potency
    if (def.damage) mods.damage += def.damage * effect.potency
    if (def.dodge) mods.dodge += def.dodge * effect.potency
    if (def.armor) mods.armor += def.armor * effect.potency
  }
  return mods
}

/**
 * Determines the resolution type for an effect on an attack.
 * Used to route the attack through the correct resolution path.
 */
export function getEffectResolutionType(
  effectName: string | undefined,
  attackTags: string[],
  attackType: 'damage' | 'support'
): 'positive-auto' | 'positive-health' | 'negative' | 'damage-negative' | 'cleanse' | 'instant' | 'no-effect' {
  if (!effectName) return 'no-effect'

  if (INSTANT_EFFECTS.has(effectName)) return 'instant'
  if (effectName === 'Cleanse') return 'cleanse'

  const alignment = EFFECT_ALIGNMENT[effectName]

  if (alignment === 'P') {
    const isAoe = attackTags.some(t => t.startsWith('Area Attack'))
    if (!isAoe && SPECIAL_P_EFFECTS.has(effectName)) {
      return 'positive-auto'
    }
    return 'positive-health'
  }

  if (alignment === 'N' || alignment === 'NA') {
    // Taunt is NA but targets enemies like an N effect
    return attackType === 'support' ? 'negative' : 'damage-negative'
  }

  // Unknown alignment — treat as negative for safety
  return attackType === 'support' ? 'negative' : 'damage-negative'
}

/**
 * Attack type restrictions define which attack types each effect can be applied to
 * Based on Attack Effects Glossary rules:
 * - 'damage': Effect can only be applied to [Damage] attacks
 * - 'support': Effect can only be applied to [Support] attacks
 * - 'both': Effect can be applied to either attack type
 */
export const EFFECT_ATTACK_TYPE_RESTRICTIONS: Record<string, 'damage' | 'support' | 'both'> = {
  // Support-only effects (all [P] buffs)
  'Vigor': 'support',
  'Fury': 'support',
  'Cleanse': 'both',
  'Haste': 'support',
  'Revitalize': 'support',
  'Shield': 'support',
  'Strengthen': 'support',
  'Vigilance': 'support',
  'Swiftness': 'support',

  // Damage-only effects (require dealing damage or explicitly stated)
  'Lifesteal': 'damage',
  'DOT': 'damage',
  'Burn': 'damage',

  // Both types allowed (all other effects)
  'Poison': 'both',
  'Confuse': 'both',
  'Stun': 'both',
  'Fear': 'both',
  'Immobilize': 'both',
  'Taunt': 'both',
  'Knockback': 'both',
  'Pull': 'both',
  'Weaken': 'both',
  'Distract': 'both',
  'Exploit': 'both',
  'Pacify': 'both',
  'Blind': 'both',
  'Paralysis': 'both',
  'Lag': 'both',
}

/**
 * Tag restrictions define which attack range/type a tag requires
 */
export const TAG_RESTRICTIONS: Record<string, { range?: 'melee' | 'ranged'; type?: 'damage' | 'support' }> = {
  'Charge Attack': { range: 'melee' },
  'Mighty Blow': { range: 'melee' },
  'Area Attack: Pass': { range: 'melee' },
  'Area Attack: Blast': { range: 'ranged' },
}

/**
 * Maps quality IDs to their corresponding attack tag display names
 * Used for filtering attacks when qualities are removed
 */
export const QUALITY_TO_TAG_PATTERN: Record<string, string> = {
  'weapon': 'Weapon',
  'armor-piercing': 'Armor Piercing',
  'certain-strike': 'Certain Strike',
  'charge-attack': 'Charge Attack',
  'mighty-blow': 'Mighty Blow',
  'signature-move': 'Signature Move',
  'ammo': 'Ammo',
  'area-attack': 'Area Attack',
}

/**
 * Get the tag pattern for a quality ID
 * @param qualityId - The quality ID (e.g., 'weapon', 'armor-piercing')
 * @returns The tag pattern string or null if not found
 */
export function getTagPatternForQuality(qualityId: string): string | null {
  return QUALITY_TO_TAG_PATTERN[qualityId] || null
}

/**
 * Check if an effect is valid for a given attack type
 * @param effect - The effect name
 * @param attackType - The attack type ('damage' or 'support')
 * @returns true if the effect is valid for the attack type
 */
export function isEffectValidForType(effect: string, attackType: 'damage' | 'support'): boolean {
  const restriction = EFFECT_ATTACK_TYPE_RESTRICTIONS[effect]
  if (!restriction) return true // Unknown effects are allowed
  if (restriction === 'both') return true
  return restriction === attackType
}

/**
 * Check if a tag is valid for a given attack range and type
 * @param tag - The tag name
 * @param range - The attack range ('melee' or 'ranged')
 * @param type - The attack type ('damage' or 'support')
 * @returns true if the tag is valid
 */
export function isTagValidForAttack(
  tag: string,
  range: 'melee' | 'ranged',
  type: 'damage' | 'support'
): boolean {
  const restriction = TAG_RESTRICTIONS[tag]
  if (!restriction) return true
  if (restriction.range && restriction.range !== range) return false
  if (restriction.type && restriction.type !== type) return false
  return true
}

export const BASIC_ATTACKS = [
  {
    id: 'basic-melee',
    name: 'Basic Melee Attack',
    range: 'melee' as const,
    type: 'damage' as const,
    tags: [] as string[],
    description: 'A simple melee strike with no special properties.',
  },
  {
    id: 'basic-ranged',
    name: 'Basic Ranged Attack',
    range: 'ranged' as const,
    type: 'damage' as const,
    tags: [] as string[],
    description: 'A basic ranged attack with no special properties.',
  },
]
