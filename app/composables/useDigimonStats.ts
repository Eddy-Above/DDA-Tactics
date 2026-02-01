/**
 * Digimon Stats Composable
 * Handles stat-related logic, DP calculations, and derived stats
 */

import { computed, type Ref, isRef, watch, reactive } from 'vue'
import type { DigimonStage, DigimonSize, DigimonFamily } from '../types/index'
import { STAGE_CONFIG, SIZE_CONFIG } from '../types/index'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../data/qualities'
import { useDigimonDP } from './useDigimonDP'

export interface DigimonFormData {
  baseStats: { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  bonusStats: { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  bonusDP: number
  bonusDPForQualities: number
  attacks?: any[]
  qualities?: Array<{ id: string; name?: string; ranks?: number; dpCost?: number; choiceId?: string }>
  stage: DigimonStage
  size: DigimonSize
  [key: string]: any // Allow other properties
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

export function useDigimonStats(form: Ref<any> | any) {
  // Handle both Ref and raw values
  const formRef = isRef(form) ? form : computed(() => form)

  // ========================
  // Stage Configuration
  // ========================
  const stages: DigimonStage[] = ['fresh', 'in-training', 'rookie', 'champion', 'ultimate', 'mega']
  const sizes: DigimonSize[] = ['tiny', 'small', 'medium', 'large', 'huge', 'gigantic']
  const attributes = ['vaccine', 'data', 'virus', 'free'] as const

  const families: DigimonFamily[] = [
    'dark-empire',
    'deep-savers',
    'dragons-roar',
    'jungle-troopers',
    'metal-empire',
    'nature-spirits',
    'nightmare-soldiers',
    'unknown',
    'virus-busters',
    'wind-guardians',
  ]

  const familyLabels: Record<DigimonFamily, string> = {
    'dark-empire': 'Dark Empire',
    'deep-savers': 'Deep Savers',
    'dragons-roar': "Dragon's Roar",
    'jungle-troopers': 'Jungle Troopers',
    'metal-empire': 'Metal Empire',
    'nature-spirits': 'Nature Spirits',
    'nightmare-soldiers': 'Nightmare Soldiers',
    'unknown': 'Unknown',
    'virus-busters': 'Virus Busters',
    'wind-guardians': 'Wind Guardians',
  }

  const currentStageConfig = computed(() => {
    if (!STAGE_CONFIG || !formRef.value.stage) return { stage: 'rookie', dp: 30, movement: 6, woundBonus: 2, brainsBonus: 0, attacks: 6, stageBonus: 0 }
    const config = STAGE_CONFIG[formRef.value.stage]
    if (!config) return { stage: 'rookie', dp: 30, movement: 6, woundBonus: 2, brainsBonus: 0, attacks: 6, stageBonus: 0 }
    return config
  })

  const currentSizeConfig = computed(() => {
    if (!SIZE_CONFIG || !formRef.value.size) return { size: 'medium', bodyBonus: 0, agilityBonus: 0, squares: '1x1', extra: '' }
    const config = SIZE_CONFIG[formRef.value.size]
    if (!config) return { size: 'medium', bodyBonus: 0, agilityBonus: 0, squares: '1x1', extra: '' }
    return config
  })

  // ========================
  // DP Calculations
  // ========================
  const {
    baseDP,
    dpUsedOnStats,
    dpUsedOnQualities,
    baseDPRemaining,
    bonusStatsTotal,
    bonusDPForStats,
    bonusDPRemaining,
    totalDPForQualities,
    availableDPForQualities,
    canAddQualities,
    minBonusDPForQualities,
    maxBonusDPForQualities,
    bonusStatsOverspent,
  } = useDigimonDP(formRef as any)

  // ========================
  // Derived Stats
  // ========================
  const derivedStats = computed(() => {
    const f = formRef.value
    const accuracy = f.baseStats.accuracy + (f.bonusStats?.accuracy || 0)
    const damage = f.baseStats.damage + (f.bonusStats?.damage || 0)
    const dodge = f.baseStats.dodge + (f.bonusStats?.dodge || 0)
    const armor = f.baseStats.armor + (f.bonusStats?.armor || 0)
    const health = f.baseStats.health + (f.bonusStats?.health || 0)
    const stageConfig = currentStageConfig.value
    const sizeConfig = currentSizeConfig.value

    const brains = Math.floor(accuracy / 2) + stageConfig.brainsBonus
    const body = Math.max(0, Math.floor((health + damage + armor) / 3) + sizeConfig.bodyBonus)
    const agility = Math.max(0, Math.floor((accuracy + dodge) / 2) + sizeConfig.agilityBonus)

    const bit = Math.floor(brains / 10) + stageConfig.stageBonus
    const cpu = Math.floor(body / 10) + stageConfig.stageBonus
    const ram = Math.floor(agility / 10) + stageConfig.stageBonus

    const stageBaseMovement = stageConfig.movement
    const qualities = f.qualities || []

    // Calculate effective base movement (after base movement modifiers)
    let effectiveBase = stageBaseMovement

    // Data Optimization modifiers
    const dataOpt = qualities.find((q) => q.id === 'data-optimization')
    if (dataOpt?.choiceId === 'speed-striker') effectiveBase += 2
    if (dataOpt?.choiceId === 'guardian') effectiveBase -= 1

    // Data Specialization modifiers
    const dataSpec = qualities.find((q) => q.id === 'data-specialization')
    if (dataSpec?.choiceId === 'mobile-artillery') effectiveBase -= 1

    // Negative quality modifiers
    const bulky = qualities.find((q) => q.id === 'bulky')
    if (bulky) effectiveBase -= (bulky.ranks || 0) * 3

    // Boosting quality modifiers
    const instinct = qualities.find((q) => q.id === 'instinct')
    if (instinct) effectiveBase += instinct.ranks || 0

    // Ensure minimum effective base of 1
    effectiveBase = Math.max(1, effectiveBase)

    // Apply Speedy bonus (capped at 2x or 3x effective base with Advanced Movement)
    const hasAdvMovement = qualities.some(
      (q) => q.id === 'advanced-mobility' && q.choiceId === 'adv-movement'
    )
    const speedyMaxMultiplier = hasAdvMovement ? 3 : 2
    const speedyCap = effectiveBase * speedyMaxMultiplier
    const speedyQuality = qualities.find((q) => q.id === 'speedy')
    const speedyRanks = speedyQuality?.ranks || 0
    const speedyBonus = Math.min(speedyRanks * 2, speedyCap)

    const movement = effectiveBase + speedyBonus

    return {
      brains,
      body,
      agility,
      bit,
      cpu,
      ram,
      woundBoxes: health + stageConfig.woundBonus,
      movement,
      baseMovement: effectiveBase,
      stageBonus: stageConfig.stageBonus,
    }
  })

  // Compute current Speedy max ranks based on effective base movement
  const currentSpeedyMaxRanks = computed(() => {
    const effectiveBase = derivedStats.value.baseMovement
    const hasAdvMovement = (formRef.value.qualities || []).some(
      (q) => q.id === 'advanced-mobility' && q.choiceId === 'adv-movement'
    )
    return getSpeedyMaxRanks(effectiveBase, hasAdvMovement)
  })

  // ========================
  // Watchers for Stat Constraints
  // ========================

  // Track previous stat values to revert changes that exceed limits
  const prevBonusStats = computed(() => ({ ...formRef.value.bonusStats }))
  const prevBaseStats = computed(() => ({ ...formRef.value.baseStats }))

  watch(
    () => formRef.value.bonusStats,
    (stats) => {
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      const max = bonusDPForStats.value
      if (total > max) {
        const form = formRef.value
        const prev = prevBonusStats.value
        for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
          if (stats[key] !== prev[key]) {
            form.bonusStats[key] = prev[key]
          }
        }
      }
    },
    { deep: true }
  )

  watch(
    () => formRef.value.baseStats,
    (stats) => {
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      const qualitiesFromBaseDP = Math.max(0, dpUsedOnQualities.value - (formRef.value.bonusDPForQualities || 0))
      const maxForStats = baseDP.value - qualitiesFromBaseDP
      if (total > maxForStats) {
        const form = formRef.value
        const prev = prevBaseStats.value
        for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
          if (stats[key] !== prev[key]) {
            form.baseStats[key] = prev[key]
          }
        }
      }
    },
    { deep: true }
  )

  return {
    // Config
    stages,
    sizes,
    attributes,
    families,
    familyLabels,
    currentStageConfig,
    currentSizeConfig,

    // DP Calculations
    baseDP,
    dpUsedOnStats,
    baseDPRemaining,
    bonusStatsTotal,
    bonusDPForStats,
    bonusDPRemaining,
    totalDPForQualities,
    availableDPForQualities,
    canAddQualities,
    minBonusDPForQualities,
    maxBonusDPForQualities,
    bonusStatsOverspent,

    // Derived Stats
    derivedStats,
    currentSpeedyMaxRanks,
  }
}
