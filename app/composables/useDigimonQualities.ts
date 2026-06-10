/**
 * Digimon Qualities Composable
 * Handles quality CRUD operations, rank validation, and DP budget checking
 */

import { computed, type Ref, isRef } from 'vue'
import type { DigimonFormData } from './useDigimonForm'
import type { EddySoulRules } from '../types/index'
import { QUALITY_DATABASE, getEffectiveDPCost, STAGE_ORDER } from '../data/qualities'

export interface UseDigimonQualitiesOptions {
  form: Ref<any> | any
  availableDPForQualities: Ref<number> | number
  dpUsedOnStats: Ref<number> | number
  baseDP: Ref<number> | number
  eddySoulRules?: Ref<EddySoulRules | undefined>
  onRemoveAttacksForQuality?: (qualityId: string, qualityName: string) => void
}

export function useDigimonQualities(options: UseDigimonQualitiesOptions) {
  // Handle both Ref and raw values
  const formRef = isRef(options.form) ? options.form : computed(() => options.form)
  const availableDPRef = isRef(options.availableDPForQualities)
    ? options.availableDPForQualities
    : computed(() => options.availableDPForQualities)
  const dpUsedOnStatsRef = isRef(options.dpUsedOnStats)
    ? options.dpUsedOnStats
    : computed(() => options.dpUsedOnStats)
  const baseDPRef = isRef(options.baseDP)
    ? options.baseDP
    : computed(() => options.baseDP)

  // ========================
  // Quality DP Usage Calculation
  // ========================
  const dpUsedOnQualities = computed(() => {
    const f = formRef.value
    return (f.qualities || []).reduce((total: number, q: any) => {
      const template = QUALITY_DATABASE.find((t) => t.id === q.id)
      const baseCost = (q.dpCost || 0) as number
      if (!template) return total + baseCost * (q.ranks || 1)
      const cost = getEffectiveDPCost(template, q.ranks || 1, baseCost, f.stage, true, options.eddySoulRules?.value)
      return total + cost
    }, 0)
  })

  // Boss-quality DP usage (qualities with category === 'boss')
  const dpUsedOnBossQualities = computed(() => {
    const f = formRef.value
    return (f.qualities || []).reduce((total: number, q: any) => {
      const template = QUALITY_DATABASE.find((t) => t.id === q.id)
      if (!template || template.category !== 'boss') return total
      const baseCost = (q.dpCost || 0) as number
      const cost = getEffectiveDPCost(template, q.ranks || 1, baseCost, f.stage, true, options.eddySoulRules?.value)
      return total + cost
    }, 0)
  })

  // DP cap for 'boss' category qualities. Dark Digivolutions (not also flagged as enemy/NPC)
  // are capped by stage; true NPC/enemy bosses have unrestricted access.
  const bossQualityDPCap = computed(() => {
    const f = formRef.value
    if (f.isDarkEvolution && !f.isEnemy) {
      return Math.max(0, STAGE_ORDER.indexOf(f.stage) - 1)
    }
    return Infinity
  })

  // ========================
  // Quality CRUD Operations
  // ========================

  const handleAddQuality = (quality: any) => {
    const template = QUALITY_DATABASE.find((t) => t.id === quality.id)
    const baseCost = (quality.dpCost || 0) as number
    let qualityCost: number
    if (template) {
      qualityCost = getEffectiveDPCost(template, quality.ranks || 1, baseCost, formRef.value.stage, true, options.eddySoulRules?.value)
    } else {
      qualityCost = baseCost * (quality.ranks || 1)
    }
    const baseDPAvailableForQualities = Math.max(0, baseDPRef.value - dpUsedOnStatsRef.value)
    const totalDPForQualitiesVal = baseDPAvailableForQualities + (formRef.value.bonusDPForQualities || 0)
    const newTotalUsed = dpUsedOnQualities.value + qualityCost

    if (qualityCost > 0 && newTotalUsed > totalDPForQualitiesVal) {
      return
    }

    if (template?.category === 'boss' && dpUsedOnBossQualities.value + qualityCost > bossQualityDPCap.value) {
      return
    }

    const f = formRef.value
    f.qualities = [...(f.qualities || []), quality]
  }

  const handleUpdateQualityRanks = (index: number, ranks: number) => {
    const f = formRef.value
    if (!f.qualities || !f.qualities[index]) return
    f.qualities = f.qualities.map((q: any, i: number) => (i === index ? { ...q, ranks } : q))
  }

  const removeQuality = (index: number) => {
    const f = formRef.value
    const qualityToRemove = f.qualities?.[index]
    if (!qualityToRemove) return

    f.qualities = f.qualities?.filter((_: any, i: number) => i !== index) || []

    // Notify attacks composable to remove related attacks
    if (options.onRemoveAttacksForQuality) {
      options.onRemoveAttacksForQuality(qualityToRemove.id, qualityToRemove.name || '')
    }
  }

  return {
    // Computed
    dpUsedOnQualities,
    dpUsedOnBossQualities,
    bossQualityDPCap,

    // Operations
    handleAddQuality,
    handleUpdateQualityRanks,
    removeQuality,
  }
}
