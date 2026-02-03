/**
 * Digimon Qualities Composable
 * Handles quality CRUD operations, rank validation, and DP budget checking
 */

import { computed, type Ref, isRef } from 'vue'
import type { DigimonFormData } from './useDigimonForm'
import { QUALITY_DATABASE, getEffectiveDPCost } from '../data/qualities'

export interface UseDigimonQualitiesOptions {
  form: Ref<any> | any
  availableDPForQualities: Ref<number> | number
  dpUsedOnStats: Ref<number> | number
  baseDP: Ref<number> | number
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
      const cost = getEffectiveDPCost(template, q.ranks || 1, baseCost, f.stage, true)
      return total + cost
    }, 0)
  })

  // ========================
  // Quality CRUD Operations
  // ========================

  const handleAddQuality = (quality: any) => {
    const template = QUALITY_DATABASE.find((t) => t.id === quality.id)
    const baseCost = (quality.dpCost || 0) as number
    let qualityCost: number
    if (template) {
      qualityCost = getEffectiveDPCost(template, quality.ranks || 1, baseCost, formRef.value.stage, true)
    } else {
      qualityCost = baseCost * (quality.ranks || 1)
    }
    const baseDPAvailableForQualities = Math.max(0, baseDPRef.value - dpUsedOnStatsRef.value)
    const totalDPForQualitiesVal = baseDPAvailableForQualities + (formRef.value.bonusDPForQualities || 0)
    const newTotalUsed = dpUsedOnQualities.value + qualityCost

    if (newTotalUsed > totalDPForQualitiesVal) {
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

    // Operations
    handleAddQuality,
    handleUpdateQualityRanks,
    removeQuality,
  }
}
