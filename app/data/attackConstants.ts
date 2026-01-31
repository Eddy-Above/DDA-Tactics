// Attack-related constants used across Digimon forms
// Extracted from duplicate definitions in [id].vue and new.vue

/**
 * Effect alignment determines which attack type an effect can be used with
 * P = Support only, N = Damage only, NA = Both
 */
export const EFFECT_ALIGNMENT: Record<string, 'P' | 'N' | 'NA'> = {
  'Vigor': 'P',
  'Fury': 'P',
  'Cleanse': 'P',
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
  const alignment = EFFECT_ALIGNMENT[effect]
  if (!alignment) return true // Unknown effects are allowed
  if (alignment === 'NA') return true // Both types allowed
  if (alignment === 'P' && attackType === 'support') return true
  if (alignment === 'N' && attackType === 'damage') return true
  return false
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
