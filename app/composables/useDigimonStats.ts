/**
 * Digimon Stats Composable
 * Handles stat-related logic, DP calculations, and derived stats
 */

import { computed, type Ref, isRef, watch, reactive } from 'vue'
import type { DigimonStage, DigimonSize, DigimonFamily, EddySoulRules } from '../types/index'
import { STAGE_CONFIG, SIZE_CONFIG } from '../types/index'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../data/qualities'
import { useDigimonDP } from './useDigimonDP'
import type { DigimonFormData } from './useDigimonForm'
import { calculateEffectiveBaseMovement, getSpeedyMaxRanks } from '../utils/movementQualities'

export function useDigimonStats(form: Ref<DigimonFormData> | DigimonFormData, eddySoulRules?: Ref<EddySoulRules | undefined>) {
  // Handle both Ref and raw values
  const formRef = computed(() => isRef(form) ? form.value : form)

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

  // Filtered sizes: when hugeSizeRequiresMega is enabled, restrict huge/gigantic by stage
  const availableSizes = computed(() => {
    if (!eddySoulRules?.value?.hugeSizeRequiresMega) return sizes
    const stage = formRef.value.stage
    const isUltimatePlus = ['ultimate', 'mega', 'ultra'].includes(stage)
    const isMegaPlus = ['mega', 'ultra'].includes(stage)

    // Huge requires Ultimate+, Gigantic requires Mega+
    return sizes.filter(s => {
      if (s === 'gigantic') return isMegaPlus
      if (s === 'huge') return isUltimatePlus
      return true
    })
  })

  // Auto-reset size if it becomes unavailable
  watch(availableSizes, (newSizes) => {
    if (!newSizes.includes(formRef.value.size)) {
      formRef.value.size = 'large'
    }
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
    minBonusDPPerCategory,
    minBonusDPForQualities,
    maxBonusDPForQualities,
    bonusStatsOverspent,
  } = useDigimonDP(formRef, eddySoulRules)

  // ========================
  // Derived Stats
  // ========================
  const derivedStats = computed(() => {
    const f = formRef.value
    const stageConfig = currentStageConfig.value
    const sizeConfig = currentSizeConfig.value
    const qualities = f.qualities || []

    // Apply quality bonuses before computing derived stats
    const instinct = qualities.find((q) => q.id === 'instinct')
    const instinctRanks = instinct?.ranks || 0

    let accuracy = f.baseStats.accuracy + (f.bonusStats?.accuracy || 0)
    let damage = f.baseStats.damage + (f.bonusStats?.damage || 0)
    const instinctBoostsArmor = eddySoulRules?.value?.instinctBoostsDodgeArmorSpeed
    let dodge = f.baseStats.dodge + (f.bonusStats?.dodge || 0) + instinctRanks
    let armor = f.baseStats.armor + (f.bonusStats?.armor || 0) + (instinctBoostsArmor ? instinctRanks : 0)
    let health = f.baseStats.health + (f.bonusStats?.health || 0) + (instinctBoostsArmor ? 0 : instinctRanks)

    // Dark Digivolution: +2 to all base stats
    if ((f as any).isDarkEvolution) {
      accuracy += 2; damage += 2; dodge += 2; armor += 2; health += 2
    }

    const dataOpt = qualities.find((q) => q.id === 'data-optimization')
    if (dataOpt?.choiceId === 'guardian') armor += 2
    if (dataOpt?.choiceId === 'effect-warrior') armor -= 2

    // Digizoid Armor stat bonuses
    const digizoidArmor = qualities.find((q) => q.id === 'digizoid-armor')
    if (digizoidArmor) {
      const cid = digizoidArmor.choiceId
      if (cid === 'red') armor += 4
      else armor += 2
      if (cid === 'chrome' || cid === 'gold' || cid === 'obsidian') health += 1
      if (cid === 'red') health += 2
      if (cid === 'blue') dodge += 2
    }

    let brains = Math.floor(accuracy / 2) + stageConfig.brainsBonus
    let body = Math.max(0, Math.floor((health + damage + armor) / 3) + sizeConfig.bodyBonus)
    let agility = Math.max(0, Math.floor((accuracy + dodge) / 2) + sizeConfig.agilityBonus)

    for (const ids of qualities.filter((q: any) => q.id === 'improved-derived-stat')) {
      const r = ids.ranks || 1
      if (ids.choiceId === 'body') body += r
      else if (ids.choiceId === 'agility') agility += r
      else if (ids.choiceId === 'brains') brains += r
    }

    let bit = Math.floor(brains / 10) + stageConfig.stageBonus
    let cpu = Math.floor(body / 10) + stageConfig.stageBonus
    let ram = Math.floor(agility / 10) + stageConfig.stageBonus
    if (dataOpt?.choiceId === 'effect-warrior') { bit += 1; cpu += 1; ram += 1 }
    const baseBit = bit, baseCpu = cpu, baseRam = ram
    for (const sb of qualities.filter((q: any) => q.id === 'system-boost')) {
      const r = sb.ranks || 1
      if (sb.choiceId === 'bit') bit = Math.min(bit + r, baseBit * 2)
      else if (sb.choiceId === 'cpu') cpu = Math.min(cpu + r, baseCpu * 2)
      else if (sb.choiceId === 'ram') ram = Math.min(ram + r, baseRam * 2)
    }

    const stageBaseMovement = stageConfig.movement

    const effectiveBase = calculateEffectiveBaseMovement(stageBaseMovement, qualities)

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

    const range = Math.floor((accuracy + brains) / 2) + bit
    const effectiveLimit = Math.floor(accuracy / 2) + brains + bit

    return {
      brains,
      body,
      agility,
      bit,
      cpu,
      ram,
      baseBit,
      baseCpu,
      baseRam,
      woundBoxes: health + stageConfig.woundBonus,
      movement,
      baseMovement: effectiveBase,
      stageBonus: stageConfig.stageBonus,
      range,
      effectiveLimit,
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
    availableSizes,
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
    minBonusDPPerCategory,
    minBonusDPForQualities,
    maxBonusDPForQualities,
    bonusStatsOverspent,

    // Derived Stats
    derivedStats,
    currentSpeedyMaxRanks,
  }
}
