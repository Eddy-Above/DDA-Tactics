/**
 * Attack Tags Management Composable
 * Extracted from duplicated digimon form pages
 * Handles attack tag validation, restrictions, and management
 */

import { EFFECT_ALIGNMENT, TAG_RESTRICTIONS, getTagPatternForQuality } from '../data/attackConstants'

export type Attack = {
  id: string
  name: string
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[]
  effect?: string
  description: string
}

export type NewAttack = {
  name: string
  range: 'melee' | 'ranged'
  type: 'damage' | 'support'
  tags: string[]
  effect?: string
  description: string
}

export interface AttackTagRule {
  id: string
  name: string
  description: string
  rangeRestriction?: 'melee' | 'ranged'
  typeRestriction?: 'damage' | 'support'
  conflictsWith?: string[]
  allowedWithSignature?: string[]
}

interface DigimonFormQuality {
  id: string
  name: string
  ranks?: number
  choiceId?: string
}

interface DigimonFormData {
  attacks?: Attack[]
  qualities?: DigimonFormQuality[]
}

export function useAttackTags(form: Ref<DigimonFormData>, newAttack: Ref<NewAttack>) {
  // Get tags already used by existing attacks
  const usedAttackTags = computed(() => {
    const used = new Set<string>()
    for (const attack of form.value.attacks || []) {
      for (const tag of attack.tags) {
        const normalized = tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '')
        used.add(normalized)
      }
    }
    return used
  })

  // Count how many attacks have a specific tag
  const countAttacksWithTag = (qualityId: string): number => {
    let count = 0
    for (const attack of form.value.attacks || []) {
      for (const tag of attack.tags) {
        const normalized = tag.toLowerCase().replace(/\s+\d+$/, '').replace(/\s+/g, '-').replace(/:/g, '')
        if (normalized === qualityId) {
          count++
        }
      }
    }
    return count
  }

  // Check if a quality-based tag is already used on another attack
  const isTagAlreadyUsed = (qualityId: string): boolean => {
    return usedAttackTags.value.has(qualityId)
  }

  // Get available attack tags based on owned qualities AND current attack state
  const availableAttackTags = computed(() => {
    const tags: Array<AttackTagRule & { disabled: boolean; disabledReason?: string }> = []
    const currentRange = newAttack.value.range
    const currentTags = newAttack.value.tags
    const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

    for (const quality of form.value.qualities || []) {
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
          disabledReason: atMaxUses
            ? `Already applied to ${weaponRank} attack${weaponRank > 1 ? 's' : ''} (max for rank ${weaponRank})`
            : undefined,
        })
      }

      if (quality.id === 'armor-piercing') {
        const alreadyUsed = isTagAlreadyUsed('armor-piercing')
        const hasCertainStrike = currentTags.some((t) => t.includes('Certain Strike'))
        const blocked = alreadyUsed || (hasCertainStrike && !hasSignatureMove)
        tags.push({
          id: 'armor-piercing',
          name: `Armor Piercing ${quality.ranks || 1}`,
          description: `Ignores ${(quality.ranks || 1) * 2} Armor`,
          conflictsWith: ['certain-strike'],
          disabled: blocked,
          disabledReason: alreadyUsed
            ? 'Already used on another attack'
            : blocked
              ? 'Cannot combine with Certain Strike (unless Signature Move)'
              : undefined,
        })
      }

      if (quality.id === 'certain-strike') {
        const alreadyUsed = isTagAlreadyUsed('certain-strike')
        const hasArmorPiercing = currentTags.some((t) => t.includes('Armor Piercing'))
        const blocked = alreadyUsed || (hasArmorPiercing && !hasSignatureMove)
        tags.push({
          id: 'certain-strike',
          name: `Certain Strike ${quality.ranks || 1}`,
          description: 'Auto-successes on accuracy',
          conflictsWith: ['armor-piercing'],
          disabled: blocked,
          disabledReason: alreadyUsed
            ? 'Already used on another attack'
            : blocked
              ? 'Cannot combine with Armor Piercing (unless Signature Move)'
              : undefined,
        })
      }

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
          disabledReason: alreadyUsed
            ? 'Already used on another attack'
            : blocked
              ? 'Cannot combine with Poison, Hazard, Revitalize, or Ammo'
              : undefined,
        })
      }

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

      if (quality.id === 'area-attack') {
        const choiceId = quality.choiceId
        if (!choiceId || choiceId === 'blast') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-blast')
          const blocked = alreadyUsed || currentRange !== 'ranged'
          tags.push({
            id: 'area-blast',
            name: 'Area Attack: Blast',
            description: `Circle at range (3m +BIT diameter)`,
            rangeRestriction: 'ranged',
            disabled: blocked,
            disabledReason: alreadyUsed
              ? 'Already used on another attack'
              : blocked
                ? 'Requires [Ranged] attack'
                : undefined,
          })
        }
        if (!choiceId || choiceId === 'pass') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-pass')
          const blocked = alreadyUsed || currentRange !== 'melee'
          tags.push({
            id: 'area-pass',
            name: 'Area Attack: Pass',
            description: 'Charge through enemies in a line',
            rangeRestriction: 'melee',
            disabled: blocked,
            disabledReason: alreadyUsed
              ? 'Already used on another attack'
              : blocked
                ? 'Requires [Melee] attack'
                : undefined,
          })
        }
        if (!choiceId || choiceId === 'burst') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-burst')
          tags.push({
            id: 'area-burst',
            name: 'Area Attack: Burst',
            description: 'Circle from user',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
        if (!choiceId || choiceId === 'close-blast') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-close-blast')
          tags.push({
            id: 'area-close-blast',
            name: 'Area Attack: Close Blast',
            description: 'Circle adjacent to user',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
        if (!choiceId || choiceId === 'cone') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-cone')
          tags.push({
            id: 'area-cone',
            name: 'Area Attack: Cone',
            description: 'Triangle from user',
            disabled: alreadyUsed,
            disabledReason: alreadyUsed ? 'Already used on another attack' : undefined,
          })
        }
        if (!choiceId || choiceId === 'line') {
          const alreadyUsed = isTagAlreadyUsed('area-attack-line')
          tags.push({
            id: 'area-line',
            name: 'Area Attack: Line',
            description: 'Pillar from user',
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
    for (const attack of form.value.attacks || []) {
      if (attack.effect) {
        used.add(attack.effect.toLowerCase())
      }
    }
    return used
  })

  // Get available effect tags based on owned qualities AND attack type
  const availableEffectTags = computed(() => {
    const currentType = newAttack.value.type
    const currentTags = newAttack.value.tags
    const hasSignatureMove = currentTags.some((t) => t.includes('Signature Move'))

    const effectAlignment: Record<string, 'P' | 'N' | 'NA'> = {
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
    const signatureRestricted = ['effect-poison', 'effect-hazard', 'effect-revitalize']

    return (form.value.qualities || [])
      .filter((q) => q.id.startsWith('effect-'))
      .map((q) => {
        const alignment = effectAlignment[q.id] || 'NA'
        const effectName = q.name
        const alreadyUsed = usedEffects.value.has(effectName.toLowerCase())
        let disabled = alreadyUsed
        let disabledReason: string | undefined = alreadyUsed ? 'Already used on another attack' : undefined

        if (!disabled && alignment === 'P' && currentType !== 'support') {
          disabled = true
          disabledReason = 'Requires [Support] attack'
        } else if (!disabled && alignment === 'N' && currentType !== 'damage') {
          disabled = true
          disabledReason = 'Requires [Damage] attack'
        }
        if (!disabled && hasSignatureMove && signatureRestricted.includes(q.id)) {
          disabled = true
          disabledReason = 'Cannot use with Signature Move'
        }

        return { id: q.id.replace('effect-', ''), name: q.name, alignment, disabled, disabledReason }
      })
  })

  const addTagToAttack = (tagName: string) => {
    if (!newAttack.value.tags.includes(tagName)) {
      newAttack.value.tags = [...newAttack.value.tags, tagName]
    }
  }

  const removeTagFromAttack = (tagName: string) => {
    newAttack.value.tags = newAttack.value.tags.filter((t) => t !== tagName)
  }

  return {
    usedAttackTags,
    countAttacksWithTag,
    isTagAlreadyUsed,
    availableAttackTags,
    usedEffects,
    availableEffectTags,
    addTagToAttack,
    removeTagFromAttack,
  }
}
