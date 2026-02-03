/**
 * Digimon Form Composable
 * Extracted from duplicated digimon form pages (new.vue and [id].vue)
 * Orchestrates feature composables for stats, qualities, and attacks
 */

import { computed, ref, reactive, watch } from 'vue'
import type { Digimon } from '../server/db/schema'
import { STAGE_CONFIG, SIZE_CONFIG, type DigimonStage, type DigimonSize } from '../types/index'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../data/qualities'
import type { Attack } from './useAttackTags'
import { useDigimonStats } from './useDigimonStats'
import { useDigimonQualities } from './useDigimonQualities'
import { useDigimonAttacks } from './useDigimonAttacks'
import type { CreateDigimonData } from './useDigimon'

export interface DigimonFormData extends CreateDigimonData {
  bonusStats?: { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  bonusDPForQualities?: number
  evolvesFromId?: string | null
  evolutionPathIds?: string[]
  syncBonusDP?: boolean
}

/**
 * Calculate the effective base movement after all base movement modifiers
 * Used to determine true max ranks for Speedy quality
 */
function calculateEffectiveBaseMovement(
  stageBase: number,
  qualities: Array<{ id: string; ranks?: number; choiceId?: string }> = []
): number {
  let effective = stageBase

  // Data Optimization modifiers
  const dataOpt = qualities.find((q) => q.id === 'data-optimization')
  if (dataOpt?.choiceId === 'speed-striker') effective += 2
  if (dataOpt?.choiceId === 'guardian') effective -= 1

  // Data Specialization modifiers
  const dataSpec = qualities.find((q) => q.id === 'data-specialization')
  if (dataSpec?.choiceId === 'mobile-artillery') effective -= 1

  // Negative quality modifiers
  const bulky = qualities.find((q) => q.id === 'bulky')
  if (bulky) effective -= (bulky.ranks || 0) * 3

  // Boosting quality modifiers
  const instinct = qualities.find((q) => q.id === 'instinct')
  if (instinct) effective += instinct.ranks || 0

  return Math.max(1, effective)
}

/**
 * Get the max ranks allowed for Speedy based on effective base movement
 * Speedy can add up to 2x base (or 3x with Advanced Movement)
 * So max ranks = effective base / 2 (rounded up)
 */
function getSpeedyMaxRanks(
  effectiveBase: number,
  hasAdvancedMovement: boolean = false
): number {
  // Speedy: +2 per rank, capped at 2x base (or 3x with Advanced Movement)
  // Max useful ranks = base movement / 2
  return hasAdvancedMovement ? Math.ceil(effectiveBase / 2) : Math.floor(effectiveBase / 2)
}

export function useDigimonForm(initialData?: Partial<DigimonFormData>) {
  // ========================
  // Form State (Basic Info)
  // ========================
  const form = reactive<DigimonFormData>({
    name: initialData?.name || '',
    species: initialData?.species || '',
    stage: initialData?.stage || 'rookie',
    attribute: initialData?.attribute || 'data',
    family: initialData?.family || 'nature-spirits',
    type: initialData?.type || '',
    size: initialData?.size || 'medium',
    baseStats: initialData?.baseStats || { accuracy: 3, damage: 3, dodge: 3, armor: 3, health: 3 },
    bonusStats: initialData?.bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 },
    bonusDP: initialData?.bonusDP || 0,
    bonusDPForQualities: initialData?.bonusDPForQualities || 0,
    attacks: initialData?.attacks || [],
    qualities: initialData?.qualities || [],
    dataOptimization: initialData?.dataOptimization || '',
    partnerId: initialData?.partnerId || undefined,
    isEnemy: initialData?.isEnemy || false,
    notes: initialData?.notes || '',
    spriteUrl: initialData?.spriteUrl || '',
    evolvesFromId: initialData?.evolvesFromId || null,
    evolutionPathIds: initialData?.evolutionPathIds || [],
    syncBonusDP: initialData?.syncBonusDP ?? true,
  })

  // ========================
  // Collapsible UI State
  // ========================
  const basicInfoExpanded = ref(false)
  const baseStatsExpanded = ref(false)
  const bonusDPExpanded = ref(false)

  // ========================
  // Sprite Management
  // ========================
  const spriteError = ref(false)

  const handleSpriteError = () => {
    spriteError.value = true
  }

  watch(
    () => form.spriteUrl,
    () => {
      spriteError.value = false
    }
  )

  // ========================
  // Compose Feature Composables
  // ========================

  // 1. Create attacks composable (no dependencies)
  const attacksComposable = useDigimonAttacks(form)

  // 2. Create stats composable (no dependencies - dpUsedOnQualities comes from useDigimonDP internally)
  const statsComposable = useDigimonStats(form)

  // 3. Create qualities composable (with stats outputs + attack callback)
  const qualitiesComposable = useDigimonQualities({
    form,
    availableDPForQualities: statsComposable.availableDPForQualities,
    dpUsedOnStats: statsComposable.dpUsedOnStats,
    baseDP: statsComposable.baseDP,
    onRemoveAttacksForQuality: attacksComposable.removeAttacksForQuality,
  })

  // ========================
  // Cross-Cutting Watchers
  // ========================

  // Enforce bonus DP for qualities stays within valid range
  watch(
    () => form.bonusDPForQualities,
    (newVal) => {
      if (newVal != null) {
        if (newVal < statsComposable.minBonusDPForQualities.value) {
          form.bonusDPForQualities = statsComposable.minBonusDPForQualities.value
        } else if (newVal > statsComposable.maxBonusDPForQualities.value) {
          form.bonusDPForQualities = statsComposable.maxBonusDPForQualities.value
        }
      }
    }
  )

  // Enforce when bonus stats change
  watch(
    () => statsComposable.bonusStatsTotal.value,
    () => {
      if ((form.bonusDPForQualities ?? 0) > statsComposable.maxBonusDPForQualities.value) {
        form.bonusDPForQualities = statsComposable.maxBonusDPForQualities.value
      }
    }
  )

  // Enforce when quality spending changes
  watch(
    () => statsComposable.minBonusDPForQualities.value,
    (newMin) => {
      if ((form.bonusDPForQualities ?? 0) < newMin) {
        form.bonusDPForQualities = newMin
      }
    }
  )

  // Auto-validate Speedy ranks when max changes
  watch(
    () => statsComposable.currentSpeedyMaxRanks.value,
    (newMax) => {
      const speedyQuality = (form.qualities || []).find((q) => q.id === 'speedy')
      if (speedyQuality && (speedyQuality.ranks || 1) > newMax) {
        speedyQuality.ranks = newMax
      }
    }
  )

  // Watch for stage changes - adjust quality ranks and attack tags
  watch(
    () => form.stage,
    (newStage) => {
      if (!form.qualities) return

      form.qualities = form.qualities.map((quality) => {
        const template = QUALITY_DATABASE.find((t) => t.id === quality.id)
        if (!template) return quality

        let maxRanks: number
        // Special handling for Speedy - base max on effective base movement, not stage base
        if (quality.id === 'speedy') {
          const stageBase = STAGE_CONFIG[newStage].movement
          const effectiveBase = calculateEffectiveBaseMovement(stageBase, form.qualities)
          const hasAdvMovement = form.qualities?.some(
            (q) => q.id === 'advanced-mobility' && q.choiceId === 'adv-movement'
          )
          maxRanks = getSpeedyMaxRanks(effectiveBase, hasAdvMovement)
        } else {
          maxRanks = getMaxRanksAtStage(template, newStage)
        }

        if ((quality.ranks || 1) > maxRanks) {
          return { ...quality, ranks: maxRanks }
        }
        return quality
      })

      if (form.attacks) {
        form.attacks = form.attacks.map((attack) => {
          const updatedTags = attack.tags.map((tag) => {
            const rankMatch = tag.match(/^(.+?)\s+(\d+)$/)
            if (rankMatch) {
              const tagName = rankMatch[1]
              const qualityId = tagName.toLowerCase().replace(/\s+/g, '-')
              const quality = form.qualities?.find((q) => q.id === qualityId)
              if (quality) {
                const template = QUALITY_DATABASE.find((t) => t.id === qualityId)
                if (template) {
                  const maxRanks = getMaxRanksAtStage(template, newStage)
                  const newRank = Math.min(quality.ranks || 1, maxRanks)
                  return `${tagName} ${newRank}`
                }
              }
            }
            return tag
          })
          return { ...attack, tags: updatedTags }
        })
      }
    }
  )

  // ========================
  // Re-export Everything
  // ========================
  return {
    // Form & UI state
    form,
    basicInfoExpanded,
    baseStatsExpanded,
    bonusDPExpanded,
    spriteError,
    handleSpriteError,

    // Stats composable exports (23 total)
    stages: statsComposable.stages,
    sizes: statsComposable.sizes,
    attributes: statsComposable.attributes,
    families: statsComposable.families,
    familyLabels: statsComposable.familyLabels,
    currentStageConfig: statsComposable.currentStageConfig,
    currentSizeConfig: statsComposable.currentSizeConfig,
    baseDP: statsComposable.baseDP,
    dpUsedOnStats: statsComposable.dpUsedOnStats,
    baseDPRemaining: statsComposable.baseDPRemaining,
    bonusStatsTotal: statsComposable.bonusStatsTotal,
    bonusDPForStats: statsComposable.bonusDPForStats,
    bonusDPRemaining: statsComposable.bonusDPRemaining,
    totalDPForQualities: statsComposable.totalDPForQualities,
    availableDPForQualities: statsComposable.availableDPForQualities,
    canAddQualities: statsComposable.canAddQualities,
    minBonusDPForQualities: statsComposable.minBonusDPForQualities,
    maxBonusDPForQualities: statsComposable.maxBonusDPForQualities,
    bonusStatsOverspent: statsComposable.bonusStatsOverspent,
    derivedStats: statsComposable.derivedStats,
    currentSpeedyMaxRanks: statsComposable.currentSpeedyMaxRanks,

    // Qualities composable exports (4 total)
    dpUsedOnQualities: qualitiesComposable.dpUsedOnQualities,
    handleAddQuality: qualitiesComposable.handleAddQuality,
    handleUpdateQualityRanks: qualitiesComposable.handleUpdateQualityRanks,
    removeQuality: qualitiesComposable.removeQuality,

    // Attacks composable exports (14 total)
    showCustomAttackForm: attacksComposable.showCustomAttackForm,
    editingAttackIndex: attacksComposable.editingAttackIndex,
    newAttack: attacksComposable.newAttack,
    usedAttackTags: attacksComposable.usedAttackTags,
    countAttacksWithTag: attacksComposable.countAttacksWithTag,
    isTagAlreadyUsed: attacksComposable.isTagAlreadyUsed,
    availableAttackTags: attacksComposable.availableAttackTags,
    usedEffects: attacksComposable.usedEffects,
    availableEffectTags: attacksComposable.availableEffectTags,
    addTagToAttack: attacksComposable.addTagToAttack,
    removeTagFromAttack: attacksComposable.removeTagFromAttack,
    addCustomAttack: attacksComposable.addCustomAttack,
    removeAttack: attacksComposable.removeAttack,
    editAttack: attacksComposable.editAttack,
  }
}
