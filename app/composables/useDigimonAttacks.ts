/**
 * Digimon Attacks Composable
 * Handles attack CRUD operations, tag management, and attack form state
 */

import { computed, type Ref, isRef, watch, reactive, ref } from 'vue'
import { getTagPatternForQuality, isEffectValidForType } from '../data/attackConstants'
import { useAttackTags, type Attack, type NewAttack } from './useAttackTags'
import type { DigimonFormData } from './useDigimonStats'

export function useDigimonAttacks(form: Ref<any> | any) {
  // Handle both Ref and raw values
  const formRef = isRef(form) ? form : computed(() => form)

  // ========================
  // UI State
  // ========================
  const showCustomAttackForm = ref(false)
  const editingAttackIndex = ref(-1)

  // ========================
  // New Attack State
  // ========================
  const newAttack = reactive<NewAttack>({
    name: '',
    range: 'melee',
    type: 'damage',
    tags: [],
    effect: undefined,
    description: '',
  })

  // ========================
  // Attack Tags Management
  // ========================
  const { usedAttackTags, countAttacksWithTag, isTagAlreadyUsed, availableAttackTags, usedEffects, availableEffectTags, addTagToAttack, removeTagFromAttack } = useAttackTags(formRef as any, newAttack as any)

  // ========================
  // Attack CRUD Operations
  // ========================
  const addCustomAttack = () => {
    if (!newAttack.name) return

    const f = formRef.value
    const attackData: Attack = {
      id: editingAttackIndex.value >= 0 ? f.attacks![editingAttackIndex.value].id : `attack-${Date.now()}`,
      name: newAttack.name,
      range: newAttack.range,
      type: newAttack.type,
      tags: [...newAttack.tags],
      effect: newAttack.effect || undefined,
      description: newAttack.description,
    }

    if (editingAttackIndex.value >= 0) {
      f.attacks = f.attacks?.map((attack: any, i: number) => (i === editingAttackIndex.value ? attackData : attack)) || []
    } else {
      f.attacks = [...(f.attacks || []), attackData]
    }

    newAttack.name = ''
    newAttack.range = 'melee'
    newAttack.type = 'damage'
    newAttack.tags = []
    newAttack.effect = ''
    newAttack.description = ''
    editingAttackIndex.value = -1
    showCustomAttackForm.value = false
  }

  const removeAttack = (index: number) => {
    const f = formRef.value
    f.attacks = f.attacks?.filter((_: any, i: number) => i !== index) || []
  }

  const editAttack = (index: number) => {
    const f = formRef.value
    const attack = f.attacks?.[index]
    if (!attack) return

    newAttack.name = attack.name
    newAttack.range = attack.range
    newAttack.type = attack.type
    newAttack.tags = [...attack.tags]
    newAttack.effect = attack.effect || ''
    newAttack.description = attack.description

    editingAttackIndex.value = index
    showCustomAttackForm.value = true
  }

  // ========================
  // Callback for Qualities Composable
  // ========================
  /**
   * Remove attacks that depend on a removed quality
   * Called by useDigimonQualities when a quality is removed
   */
  const removeAttacksForQuality = (qualityId: string, qualityName: string) => {
    const f = formRef.value
    const tagPattern = getTagPatternForQuality(qualityId)

    if (tagPattern) {
      f.attacks = f.attacks?.filter((attack: any) => {
        const hasTag = attack.tags.some((t: string) => t.startsWith(tagPattern))
        return !hasTag
      }) || []
    }

    if (qualityId.startsWith('effect-')) {
      f.attacks = f.attacks?.filter((attack) => {
        return attack.effect !== qualityName
      }) || []
    }
  }

  // ========================
  // Watchers for Attack Constraints
  // ========================

  // Watch for attack type changes - clear invalid effects
  watch(
    () => newAttack.type,
    (newType) => {
      if (newAttack.effect && !isEffectValidForType(newAttack.effect, newType)) {
        newAttack.effect = '' // Auto-clear invalid effect when type changes
      }

      // Handle tag restrictions based on attack type
      if (newType === 'damage') {
        newAttack.tags = newAttack.tags.filter((tag) => !tag.includes('Revitalize'))
      } else if (newType === 'support') {
        newAttack.tags = newAttack.tags.filter(
          (tag) => !tag.includes('Poison') && !tag.includes('Hazard')
        )
      }
    }
  )

  // Watch for attack range changes - clear invalid tags
  watch(
    () => newAttack.range,
    (newRange) => {
      newAttack.tags = newAttack.tags.filter((tag) => {
        const TAG_RESTRICTIONS: Record<string, any> = {}
        const restriction = TAG_RESTRICTIONS[tag]
        if (restriction?.range && restriction.range !== newRange) {
          return false
        }
        return true
      })
    }
  )

  // Watch for attack type changes - clear invalid tags
  watch(
    () => newAttack.type,
    (newType) => {
      newAttack.tags = newAttack.tags.filter((tag) => {
        const TAG_RESTRICTIONS: Record<string, any> = {}
        const restriction = TAG_RESTRICTIONS[tag]
        if (restriction?.type && restriction.type !== newType) {
          return false
        }
        return true
      })
    }
  )

  return {
    // State
    showCustomAttackForm,
    editingAttackIndex,
    newAttack,

    // From useAttackTags
    usedAttackTags,
    countAttacksWithTag,
    isTagAlreadyUsed,
    availableAttackTags,
    usedEffects,
    availableEffectTags,
    addTagToAttack,
    removeTagFromAttack,

    // Operations
    addCustomAttack,
    removeAttack,
    editAttack,

    // Callback for qualities
    removeAttacksForQuality,
  }
}
