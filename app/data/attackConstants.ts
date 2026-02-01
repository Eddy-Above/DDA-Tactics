// Attack-related constants used across Digimon forms
// Extracted from duplicate definitions in [id].vue and new.vue

/**
 * Effect alignment determines the resolution mechanics per game rules
 * P = Positive (uses ally Health roll for duration), N = Negative (uses enemy Dodge roll), NA = Non-Aligned
 * This is separate from which attack types an effect can be applied to (see EFFECT_ATTACK_TYPE_RESTRICTIONS)
 */
export const EFFECT_ALIGNMENT: Record<string, 'P' | 'N' | 'NA'> = {
  'Vigor': 'P',
  'Fury': 'P',
  'Cleanse': 'NA',
  'Haste': 'P',
  'Revitalize': 'P',
  'Shield': 'P',
  'Poison': 'N',
  'Confuse': 'N',
  'Stun': 'N',
  'Fear': 'N',
  'Immobilize': 'N',
  'Lifesteal': 'NA',
  'Knockback': 'NA',
  'Pull': 'NA',
  'Taunt': 'NA',
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
