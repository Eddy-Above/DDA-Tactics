import { computed, type Ref, type ComputedRef } from 'vue'
import { STAGE_CONFIG, type DigimonStage } from '../types'

/**
 * Form structure expected by the composable
 * This matches the reactive form object used in [id].vue and new.vue
 */
export interface DigimonDPForm {
  stage: DigimonStage
  baseStats: {
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }
  bonusStats: {
    accuracy: number
    damage: number
    dodge: number
    armor: number
    health: number
  }
  qualities: Array<{
    dpCost?: number
    ranks?: number
    [key: string]: unknown
  }>
  bonusDP: number
  bonusDPForQualities: number
}

/**
 * Composable for DP (Digimon Points) calculation logic
 * Handles the complex split between base DP and bonus DP, stats and qualities
 *
 * DDA 1.4 Rules:
 * - Base stats cost 1 DP per point from BASE DP pool
 * - Qualities cost from BASE DP pool OR bonus quality DP pool
 * - Bonus DP can be split between stats and qualities
 */
export function useDigimonDP(form: DigimonDPForm) {
  // Stage configuration (DP pool, etc.)
  const currentStageConfig = computed(() => STAGE_CONFIG[form.stage])

  // Base DP pool (from stage only - NOT including bonus DP)
  const baseDP = computed(() => currentStageConfig.value.dp)

  // DP spent on base stats (1 DP per point)
  const dpUsedOnStats = computed(() => {
    return Object.values(form.baseStats).reduce((a, b) => a + b, 0)
  })

  // DP spent on qualities (cost × ranks)
  const dpUsedOnQualities = computed(() => {
    return form.qualities.reduce((total, q) => total + (q.dpCost || 0) * (q.ranks || 1), 0)
  })

  // How much of quality spending comes from base DP (vs bonus DP for qualities)
  const qualitiesFromBaseDP = computed(() => {
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    return Math.min(dpUsedOnQualities.value, baseDPAvailableForQualities)
  })

  // Base DP used = stats + qualities (only qualities that fit in remaining base DP)
  const baseDPUsed = computed(() => {
    return dpUsedOnStats.value + qualitiesFromBaseDP.value
  })

  // Base DP remaining (can go negative if overspent)
  const baseDPRemaining = computed(() => {
    return baseDP.value - baseDPUsed.value
  })

  // Total bonus DP spent on stats
  const bonusStatsTotal = computed(() => {
    return Object.values(form.bonusStats).reduce((a, b) => a + b, 0)
  })

  // Bonus DP available for stats (excluding DP allocated to qualities)
  const bonusDPForStats = computed(() => {
    return Math.max(0, (form.bonusDP || 0) - (form.bonusDPForQualities || 0))
  })

  // Check if bonus stats overspent (using DP meant for qualities)
  const bonusStatsOverspent = computed(() => {
    return bonusStatsTotal.value > bonusDPForStats.value
  })

  // Total bonus DP allocated (stats + qualities)
  const bonusDPAllocated = computed(() => {
    return bonusStatsTotal.value + (form.bonusDPForQualities || 0)
  })

  // Bonus DP remaining
  const bonusDPRemaining = computed(() => {
    return (form.bonusDP || 0) - bonusDPAllocated.value
  })

  // Total DP budget for qualities (base DP after stats + bonus DP for qualities)
  const totalDPForQualities = computed(() => {
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    return baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
  })

  // Available DP for adding new qualities
  const availableDPForQualities = computed(() => {
    return Math.max(0, totalDPForQualities.value - dpUsedOnQualities.value)
  })

  // Can add more qualities?
  const canAddQualities = computed(() => {
    // Check 1: Is there room in the quality budget?
    const hasRoomInQualityBudget = dpUsedOnQualities.value < totalDPForQualities.value
    // Check 2: Is the bonus DP allocation valid (not over-allocated)?
    const bonusDPValid = bonusDPRemaining.value >= 0
    return hasRoomInQualityBudget && bonusDPValid
  })

  // Minimum bonus DP required for qualities (quality spending that exceeds base DP coverage)
  const minBonusDPForQualities = computed(() => {
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    return Math.max(0, dpUsedOnQualities.value - baseDPAvailableForQualities)
  })

  // Maximum bonus DP that can be allocated to qualities
  const maxBonusDPForQualities = computed(() => {
    return Math.max(minBonusDPForQualities.value, (form.bonusDP || 0) - bonusStatsTotal.value)
  })

  // Aliases for display compatibility
  const totalDP = baseDP
  const dpUsed = computed(() => dpUsedOnStats.value + dpUsedOnQualities.value)
  const dpRemaining = baseDPRemaining

  return {
    // Stage config
    currentStageConfig,

    // Base DP
    baseDP,
    dpUsedOnStats,
    dpUsedOnQualities,
    qualitiesFromBaseDP,
    baseDPUsed,
    baseDPRemaining,

    // Bonus DP
    bonusStatsTotal,
    bonusDPForStats,
    bonusStatsOverspent,
    bonusDPAllocated,
    bonusDPRemaining,

    // Quality budget
    totalDPForQualities,
    availableDPForQualities,
    canAddQualities,
    minBonusDPForQualities,
    maxBonusDPForQualities,

    // Display aliases
    totalDP,
    dpUsed,
    dpRemaining,
  }
}
