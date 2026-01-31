import { computed, watch, type Ref } from 'vue'
import { EFFECT_ALIGNMENT, TAG_RESTRICTIONS, isEffectValidForType, isTagValidForAttack } from '../data/attackConstants'

/**
 * Attack structure
 */
export interface Attack {
  id: string
  name: string
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[]
  effect?: string
  description: string
}

/**
 * Quality structure (minimal for tag logic)
 */
export interface Quality {
  id: string
  name: string
  ranks?: number
  choiceId?: string
  [key: string]: unknown
}

/**
 * New attack being edited
 */
export interface NewAttack {
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[]
  effect?: string
}

/**
 * Tag rule with availability state
 */
export interface AttackTagRule {
  id: string
  name: string
  description: string
  rangeRestriction?: 'melee' | 'ranged'
  typeRestriction?: 'damage' | 'support'
  conflictsWith?: string[]
  allowedWithSignature?: string[]
  disabled: boolean
  disabledReason?: string
}

/**
 * Effect tag with availability state
 */
export interface EffectTag {
  id: string
  name: string
  alignment: 'P' | 'N' | 'NA'
  disabled: boolean
  disabledReason?: string
}

/**
 * Normalize a tag name to a quality ID
 * e.g., "Weapon 2" -> "weapon", "Charge Attack" -> "charge-attack"
 */
export function normalizeTagToQualityId(tag: string): string {
  return tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '')
}

/**
 * Composable for attack tag and effect management
 * Handles tag availability, conflicts, restrictions, and watchers
 */
export function useAttackTags(
  attacks: Ref<Attack[]>,
  qualities: Ref<Quality[]>,
  newAttack: NewAttack
) {
  // Get tags already used by existing attacks
  const usedAttackTags = computed(() => {
    const used = new Set<string>()
    for (const attack of attacks.value) {
      for (const tag of attack.tags) {
        const normalized = normalizeTagToQualityId(tag)
        used.add(normalized)
      }
    }
    return used
  })

  // Count how many attacks have a specific tag
  function countAttacksWithTag(qualityId: string): number {
    let count = 0
    for (const attack of attacks.value) {
      for (const tag of attack.tags) {
        const normalized = normalizeTagToQualityId(tag)
        if (normalized === qualityId) {
          count++
        }
      }
    }
    return count
  }

  // Check if a quality-based tag is already used on another attack
  function isTagAlreadyUsed(qualityId: string): boolean {
    return usedAttackTags.value.has(qualityId)
  }

  // Get available tags based on owned qualities AND current attack state
  const availableAttackTags = computed((): AttackTagRule[] => {
    const tags: AttackTagRule[] = []
    const currentRange = newAttack.range
    const currentType = newAttack.type
    const currentTags = newAttack.tags
    const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

    for (const quality of qualities.value) {
      // Weapon - can be applied to a number of attacks equal to its rank
      if (quality.id === 'weapon') {
        const weaponRank = quality.ranks || 1
        const weaponUsedCount = countAttacksWithTag('weapon')
        const atMaxUses = weaponUsedCount >= weaponRank
        tags.push({
          id: 'weapon',
          name: `Weapon ${weaponRank}`,
          description: `+${weaponRank} Accuracy and Damage (${weaponUsedCount}/${weaponRank} attacks tagged)`,
          disabled: atMaxUses,
          disabledReason: atMaxUses ? `Already applied to ${weaponRank} attack${weaponRank > 1 ? 's' : ''} (max for rank ${weaponRank})` : undefined,
        })
      }

      // Armor Piercing - conflicts with Certain Strike (unless Signature Move)
      if (quality.id === 'armor-piercing') {
        const alreadyUsed = isTagAlreadyUsed('armor-piercing')
        const hasCertainStrike = currentTags.some((t) => t.includes('Certain Strike'))
        const blocked = alreadyUsed || (hasCertainStrike && !hasSignatureMove)
        tags.push({
          id: 'armor-piercing',
          name: `Armor Piercing ${quality.ranks || 1}`,
          description: `Ignores ${(quality.ranks || 1) * 2} Armor`,
          conflictsWith: ['certain-strike'],
          allowedWithSignature: ['certain-strike'],
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Certain Strike (unless Signature Move)' : undefined,
        })
      }

      // Certain Strike - conflicts with Armor Piercing (unless Signature Move)
      if (quality.id === 'certain-strike') {
        const alreadyUsed = isTagAlreadyUsed('certain-strike')
        const hasArmorPiercing = currentTags.some((t) => t.includes('Armor Piercing'))
        const blocked = alreadyUsed || (hasArmorPiercing && !hasSignatureMove)
        tags.push({
          id: 'certain-strike',
          name: `Certain Strike ${quality.ranks || 1}`,
          description: 'Auto-successes on accuracy',
          conflictsWith: ['armor-piercing'],
          allowedWithSignature: ['armor-piercing'],
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Armor Piercing (unless Signature Move)' : undefined,
        })
      }

      // Charge Attack - MELEE ONLY
      if (quality.id === 'charge-attack') {
        const alreadyUsed = isTagAlreadyUsed('charge-attack')
        const blocked = alreadyUsed || currentRange !== 'melee'
        tags.push({
          id: 'charge-attack',
          name: 'Charge Attack',
          description: 'Move and attack as one Simple Action',
          rangeRestriction: 'melee',
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Melee] attack' : undefined,
        })
      }

      // Mighty Blow - MELEE ONLY
      if (quality.id === 'mighty-blow') {
        const alreadyUsed = isTagAlreadyUsed('mighty-blow')
        const blocked = alreadyUsed || currentRange !== 'melee'
        tags.push({
          id: 'mighty-blow',
          name: 'Mighty Blow',
          description: 'Stun on high damage',
          rangeRestriction: 'melee',
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Melee] attack' : undefined,
        })
      }

      // Signature Move - restrictions with certain effects
      if (quality.id === 'signature-move') {
        const alreadyUsed = isTagAlreadyUsed('signature-move')
        const hasPoison = currentTags.some((t) => t.includes('Poison'))
        const hasHazard = currentTags.some((t) => t.includes('Hazard'))
        const hasRevitalize = currentTags.some((t) => t.includes('Revitalize'))
        const hasAmmo = currentTags.some((t) => t.includes('Ammo'))
        const blocked = alreadyUsed || hasPoison || hasHazard || hasRevitalize || hasAmmo
        tags.push({
          id: 'signature-move',
          name: 'Signature Move',
          description: 'Powerful attack (available Round 3+, 2 round cooldown)',
          disabled: blocked,
          disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Cannot combine with Poison, Hazard, Revitalize, or Ammo' : undefined,
        })
      }

      // Ammo - requires other tags, cannot combine with Signature Move
      if (quality.id === 'ammo') {
        const alreadyUsed = isTagAlreadyUsed('ammo')
        const hasSignature = currentTags.some((t) => t.includes('Signature Move'))
        const hasEnoughTags = currentTags.length >= 1
        const blocked = alreadyUsed || hasSignature || !hasEnoughTags
        let reason: string | undefined
        if (alreadyUsed) reason = 'Already used on another attack'
        else if (hasSignature) reason = 'Cannot combine with Signature Move'
        else if (!hasEnoughTags) reason = 'Requires at least 1 other tag first'
        tags.push({
          id: 'ammo',
          name: 'Ammo',
          description: 'Use attack up to 5 times consecutively (then unavailable for battle)',
          disabled: blocked,
          disabledReason: reason,
        })
      }

      // Area Attack options (with range restrictions)
      if (quality.id === 'area-attack') {
        const choiceId = quality.choiceId
        // Blast - RANGED ONLY
        if (!choiceId || choiceId === 'blast') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-blast')
          const blocked = alreadyUsed || currentRange !== 'ranged'
          tags.push({
            id: 'area-blast',
            name: 'Area Attack: Blast',
            description: 'Circle at range (3m +BIT diameter)',
            rangeRestriction: 'ranged',
            disabled: blocked,
            disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Ranged] attack' : undefined,
          })
        }
        // Pass - MELEE ONLY
        if (!choiceId || choiceId === 'pass') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-pass')
          const blocked = alreadyUsed || currentRange !== 'melee'
          tags.push({
            id: 'area-pass',
            name: 'Area Attack: Pass',
            description: 'Charge through enemies in a line',
            rangeRestriction: 'melee',
            disabled: blocked,
            disabledReason: alreadyUsed ? 'Already used on another attack' : blocked ? 'Requires [Melee] attack' : undefined,
          })
        }
        // Burst, Close Blast, Cone, Line - both ranges allowed
        if (!choiceId || choiceId === 'burst') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-burst')
          tags.push({
            id: 'area-burst',
            name: 'Area Attack: Burst',
            description: 'Circle from user (1m +BIT+1 radius)',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
        if (!choiceId || choiceId === 'close-blast') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-close-blast')
          tags.push({
            id: 'area-close-blast',
            name: 'Area Attack: Close Blast',
            description: 'Circle adjacent to user (2m +BIT radius)',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
        if (!choiceId || choiceId === 'cone') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-cone')
          tags.push({
            id: 'area-cone',
            name: 'Area Attack: Cone',
            description: 'Triangle from user (3m +BIT length)',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
        if (!choiceId || choiceId === 'line') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-line')
          tags.push({
            id: 'area-line',
            name: 'Area Attack: Line',
            description: 'Pillar from user (5m +BIT×2 length)',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
      }
    }

    return tags
  })

  // Get effects already used by existing attacks
  const usedEffects = computed(() => {
    const used = new Set<string>()
    for (const attack of attacks.value) {
      if (attack.effect) {
        used.add(attack.effect.toLowerCase())
      }
    }
    return used
  })

  // Effect alignment for quality IDs
  const effectQualityAlignment: Record<string, 'P' | 'N' | 'NA'> = {
    'effect-vigor': 'P',
    'effect-fury': 'P',
    'effect-cleanse': 'P',
    'effect-haste': 'P',
    'effect-revitalize': 'P',
    'effect-shield': 'P',
    'effect-poison': 'N',
    'effect-confuse': 'N',
    'effect-stun': 'N',
    'effect-fear': 'N',
    'effect-immobilize': 'N',
    'effect-taunt': 'N',
    'effect-lifesteal': 'NA',
    'effect-knockback': 'NA',
    'effect-pull': 'NA',
  }

  // Signature Move restrictions
  const signatureRestrictedEffects = ['effect-poison', 'effect-hazard', 'effect-revitalize']

  // Get available effect tags based on owned qualities AND attack type
  const availableEffectTags = computed((): EffectTag[] => {
    const currentType = newAttack.type
    const currentTags = newAttack.tags
    const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

    return qualities.value
      .filter((q) => q.id.startsWith('effect-'))
      .map((q) => {
        const alignment = effectQualityAlignment[q.id] || 'NA'
        const effectName = q.name
        const alreadyUsed = usedEffects.value.has(effectName.toLowerCase())
        let disabled = alreadyUsed
        let disabledReason: string | undefined = alreadyUsed ? 'Already used on another attack' : undefined

        // Check type restriction
        if (!disabled && alignment === 'P' && currentType !== 'support') {
          disabled = true
          disabledReason = 'Requires [Support] attack'
        } else if (!disabled && alignment === 'N' && currentType !== 'damage') {
          disabled = true
          disabledReason = 'Requires [Damage] attack'
        }

        // Check Signature Move restriction
        if (!disabled && hasSignatureMove && signatureRestrictedEffects.includes(q.id)) {
          disabled = true
          disabledReason = 'Cannot use with Signature Move'
        }

        return {
          id: q.id.replace('effect-', ''),
          name: q.name,
          alignment,
          disabled,
          disabledReason,
        }
      })
  })

  // Tag manipulation functions
  function addTagToAttack(tagName: string) {
    if (!newAttack.tags.includes(tagName)) {
      newAttack.tags = [...newAttack.tags, tagName]
    }
  }

  function removeTagFromAttack(tagName: string) {
    newAttack.tags = newAttack.tags.filter((t) => t !== tagName)
  }

  // Setup watchers for clearing invalid tags/effects
  function setupAttackWatchers() {
    // Watch for attack type changes - clear invalid effects
    watch(() => newAttack.type, (newType) => {
      if (newAttack.effect) {
        const alignment = EFFECT_ALIGNMENT[newAttack.effect]
        if (alignment === 'P' && newType !== 'support') {
          newAttack.effect = ''
        } else if (alignment === 'N' && newType !== 'damage') {
          newAttack.effect = ''
        }
      }
    })

    // Watch for attack range changes - clear invalid tags
    watch(() => newAttack.range, (newRange) => {
      newAttack.tags = newAttack.tags.filter((tag) => {
        const restriction = TAG_RESTRICTIONS[tag]
        if (restriction?.range && restriction.range !== newRange) {
          return false
        }
        return true
      })
    })

    // Watch for attack type changes - clear invalid tags
    watch(() => newAttack.type, (newType) => {
      newAttack.tags = newAttack.tags.filter((tag) => {
        const restriction = TAG_RESTRICTIONS[tag]
        if (restriction?.type && restriction.type !== newType) {
          return false
        }
        return true
      })
    })
  }

  return {
    // Computed properties
    usedAttackTags,
    availableAttackTags,
    usedEffects,
    availableEffectTags,

    // Functions
    countAttacksWithTag,
    isTagAlreadyUsed,
    addTagToAttack,
    removeTagFromAttack,
    setupAttackWatchers,
    normalizeTagToQualityId,
  }
}
