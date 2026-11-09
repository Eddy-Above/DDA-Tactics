/**
 * Digimon DP Calculation Composable
 * Extracted from duplicated digimon form pages
 * Handles all DP budget calculations following DDA 1.4 rules
 */

import { computed, isRef } from 'vue'
import type { Ref } from 'vue'
import { STAGE_CONFIG } from '../types/index'
import type { EddySoulRules } from '../types/index'
import { QUALITY_DATABASE, getEffectiveDPCost } from '../data/qualities'
import type { DigimonFormData } from './useDigimonForm'

export function useDigimonDP(form: Ref<DigimonFormData> | DigimonFormData, eddySoulRules?: Ref<EddySoulRules | undefined> | (() => EddySoulRules | undefined)) {
  // Handle both Ref and reactive objects
  const formValue = computed(() => isRef(form) ? form.value : form)
  const rulesValue = computed(() => {
    if (!eddySoulRules) return undefined
    if (typeof eddySoulRules === 'function') return eddySoulRules()
    return isRef(eddySoulRules) ? eddySoulRules.value : undefined
  })

  // Stage configuration
  const currentStageConfig = computed(() => {
    if (!STAGE_CONFIG || !formValue.value.stage) {
      return { stage: 'rookie' as const, dp: 25, movement: 6, woundBonus: 2, brainsBonus: 3, attacks: 2, stageBonus: 1 }
    }
    const config = STAGE_CONFIG[formValue.value.stage as keyof typeof STAGE_CONFIG]
    if (!config) {
      return { stage: 'rookie' as const, dp: 25, movement: 6, woundBonus: 2, brainsBonus: 3, attacks: 2, stageBonus: 1 }
    }
    return config
  })

  // Base DP pool (from stage only - NOT including bonus DP)
  const baseDP = computed(() => {
    return currentStageConfig.value.dp
  })

  // DP used on base stats
  const dpUsedOnStats = computed(() => {
    return Object.values(formValue.value.baseStats).reduce((a, b) => a + b, 0)
  })

  // DP used on qualities
  const dpUsedOnQualities = computed(() => {
    const seenIds = new Set<string>()
    return formValue.value.qualities.reduce((total, q) => {
      const template = QUALITY_DATABASE.find((t) => t.id === q.id)
      const baseCost = (q.dpCost || 0) as number
      if (!template) return total + baseCost * (q.ranks || 1)
      const firstOfType = !seenIds.has(q.id)
      seenIds.add(q.id)
      const cost = getEffectiveDPCost(template, q.ranks || 1, baseCost, formValue.value.stage, firstOfType, rulesValue.value)
      return total + cost
    }, 0)
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
    if (!formValue.value.bonusStats) return 0
    return Object.values(formValue.value.bonusStats).reduce((a, b) => a + b, 0)
  })

  // Bonus DP available for stats (excluding DP allocated to qualities)
  const bonusDPForStats = computed(() => {
    return Math.max(0, (formValue.value.bonusDP || 0) - (formValue.value.bonusDPForQualities || 0))
  })

  // Bonus DP remaining
  const bonusDPRemaining = computed(() => {
    return Math.max(0, (formValue.value.bonusDP || 0) - bonusStatsTotal.value - (formValue.value.bonusDPForQualities || 0))
  })

  // Total DP for qualities (base available + bonus allocated)
  const totalDPForQualities = computed(() => {
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    return baseDPAvailableForQualities + (formValue.value.bonusDPForQualities || 0)
  })

  // Available DP for qualities
  const availableDPForQualities = computed(() => {
    return Math.max(0, totalDPForQualities.value - dpUsedOnQualities.value)
  })

  // Can add qualities check
  const canAddQualities = computed(() => {
    const hasRoomInQualityBudget = dpUsedOnQualities.value < totalDPForQualities.value
    const bonusDPValid = bonusDPRemaining.value >= 0
    return hasRoomInQualityBudget && bonusDPValid
  })

  // Minimum bonus DP per category (EddySoul rule: floor(10% of bonusDP), only when bonusDP >= 10)
  const minBonusDPPerCategory = computed(() => {
    if (!rulesValue.value?.bonusDPMinPerCategory) return 0
    const bonusDP = formValue.value.bonusDP || 0
    if (bonusDP < 10) return 0
    return Math.floor(bonusDP * 0.10)
  })

  // Minimum bonus DP required for qualities
  const minBonusDPForQualities = computed(() => {
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    const overflowMin = Math.max(0, dpUsedOnQualities.value - baseDPAvailableForQualities)
    return Math.max(overflowMin, minBonusDPPerCategory.value)
  })

  // Maximum bonus DP that can be allocated to qualities
  const maxBonusDPForQualities = computed(() => {
    const statsTotal = formValue.value.bonusStats ? bonusStatsTotal.value : 0
    return Math.max(minBonusDPForQualities.value, (formValue.value.bonusDP || 0) - statsTotal)
  })

  // Check if bonus stats are overspent
  const bonusStatsOverspent = computed(() => bonusStatsTotal.value > bonusDPForStats.value)

  // For display compatibility
  const totalDP = computed(() => baseDP.value)
  const dpUsed = computed(() => dpUsedOnStats.value + dpUsedOnQualities.value)
  const dpRemaining = computed(() => baseDPRemaining.value)

  return {
    baseDP,
    dpUsedOnStats,
    dpUsedOnQualities,
    qualitiesFromBaseDP,
    baseDPUsed,
    baseDPRemaining,
    bonusStatsTotal,
    bonusDPForStats,
    bonusDPRemaining,
    totalDPForQualities,
    availableDPForQualities,
    canAddQualities,
    minBonusDPPerCategory,
    minBonusDPForQualities,
    maxBonusDPForQualities,
    bonusStatsOverspent,
    totalDP,
    dpUsed,
    dpRemaining,
  }
}
