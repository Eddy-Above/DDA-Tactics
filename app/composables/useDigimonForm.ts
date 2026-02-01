/**
 * Digimon Form Composable
 * Extracted from duplicated digimon form pages (new.vue and [id].vue)
 * Manages all form state, calculations, and operations for creating/editing Digimon
 */

import type { Digimon } from '../server/db/schema'
import { STAGE_CONFIG, SIZE_CONFIG, type DigimonStage, type DigimonSize, type DigimonFamily } from '../types/index'
import { QUALITY_DATABASE, getMaxRanksAtStage } from '../data/qualities'
import { getTagPatternForQuality } from '../data/attackConstants'
import { useDigimonDP, type DigimonFormData } from './useDigimonDP'
import { useAttackTags, type Attack, type NewAttack } from './useAttackTags'

export interface CreateDigimonData {
  name: string
  species: string
  stage: DigimonStage
  attribute: 'vaccine' | 'data' | 'virus' | 'free'
  family: DigimonFamily
  type?: string
  size: DigimonSize
  baseStats: { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  attacks?: Attack[]
  qualities?: Array<{ id: string; name: string; ranks?: number; dpCost?: number; choiceId?: string }>
  dataOptimization?: string
  bonusDP?: number
  bonusStats?: { accuracy: number; damage: number; dodge: number; armor: number; health: number }
  bonusDPForQualities?: number
  partnerId?: string
  isEnemy?: boolean
  notes?: string
  spriteUrl?: string
  evolvesFromId?: string | null
  evolutionPathIds?: string[]
  syncBonusDP?: boolean
}

export function useDigimonForm(initialData?: Partial<CreateDigimonData>) {
  // ========================
  // Form State
  // ========================
  const form = reactive<CreateDigimonData>({
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
  // Collapsible Sections
  // ========================
  const basicInfoExpanded = ref(false)
  const baseStatsExpanded = ref(false)

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
    if (!STAGE_CONFIG || !form.stage) return { stage: 'rookie', dp: 30, movement: 6, woundBonus: 2, brainsBonus: 0, attacks: 6, stageBonus: 0 }
    return STAGE_CONFIG[form.stage]
  })
  const currentSizeConfig = computed(() => {
    if (!SIZE_CONFIG || !form.size) return { size: 'medium', bodyBonus: 0, agilityBonus: 0, squares: '1x1', extra: '' }
    return SIZE_CONFIG[form.size]
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
  } = useDigimonDP(form as any)

  // ========================
  // Attack Management
  // ========================
  const showCustomAttackForm = ref(false)
  const editingAttackIndex = ref(-1)

  const newAttack = reactive<NewAttack>({
    name: '',
    range: 'melee',
    type: 'damage',
    tags: [],
    effect: undefined,
    description: '',
  })

  const { usedAttackTags, countAttacksWithTag, isTagAlreadyUsed, availableAttackTags, usedEffects, availableEffectTags, addTagToAttack, removeTagFromAttack } = useAttackTags(form as any, newAttack as any)

  // ========================
  // Derived Stats
  // ========================
  const derivedStats = computed(() => {
    const accuracy = form.baseStats.accuracy + (form.bonusStats?.accuracy || 0)
    const damage = form.baseStats.damage + (form.bonusStats?.damage || 0)
    const dodge = form.baseStats.dodge + (form.bonusStats?.dodge || 0)
    const armor = form.baseStats.armor + (form.bonusStats?.armor || 0)
    const health = form.baseStats.health + (form.bonusStats?.health || 0)
    const stageConfig = currentStageConfig.value
    const sizeConfig = currentSizeConfig.value

    const brains = Math.floor(accuracy / 2) + stageConfig.brainsBonus
    const body = Math.max(0, Math.floor((health + damage + armor) / 3) + sizeConfig.bodyBonus)
    const agility = Math.max(0, Math.floor((accuracy + dodge) / 2) + sizeConfig.agilityBonus)

    const bit = Math.floor(brains / 10) + stageConfig.stageBonus
    const cpu = Math.floor(body / 10) + stageConfig.stageBonus
    const ram = Math.floor(agility / 10) + stageConfig.stageBonus

    const baseMovement = stageConfig.movement
    const speedyQuality = (form.qualities || []).find((q) => q.id === 'speedy')
    const speedyRanks = speedyQuality?.ranks || 0
    const speedyBonus = speedyRanks * 2
    const maxSpeedyBonus = baseMovement
    const movement = baseMovement + Math.min(speedyBonus, maxSpeedyBonus)

    return {
      brains,
      body,
      agility,
      bit,
      cpu,
      ram,
      woundBoxes: health + stageConfig.woundBonus,
      movement,
      baseMovement,
      stageBonus: stageConfig.stageBonus,
    }
  })

  // ========================
  // Quality Management
  // ========================
  const handleAddQuality = (quality: any) => {
    const qualityCost = (quality.dpCost || 0) * (quality.ranks || 1)
    const baseDPAvailableForQualities = Math.max(0, baseDP.value - dpUsedOnStats.value)
    const totalDPForQualitiesVal = baseDPAvailableForQualities + (form.bonusDPForQualities || 0)
    const newTotalUsed = dpUsedOnQualities.value + qualityCost

    if (newTotalUsed > totalDPForQualitiesVal) {
      return
    }

    form.qualities = [...(form.qualities || []), quality]
  }

  const handleUpdateQualityRanks = (index: number, ranks: number) => {
    if (!form.qualities || !form.qualities[index]) return
    form.qualities = form.qualities.map((q, i) => (i === index ? { ...q, ranks } : q))
  }

  const removeQuality = (index: number) => {
    const qualityToRemove = form.qualities?.[index]
    if (!qualityToRemove) return

    form.qualities = form.qualities?.filter((_, i) => i !== index) || []

    const tagPattern = getTagPatternForQuality(qualityToRemove.id)
    if (tagPattern) {
      form.attacks = form.attacks?.filter((attack) => {
        const hasTag = attack.tags.some((t) => t.startsWith(tagPattern))
        return !hasTag
      }) || []
    }

    if (qualityToRemove.id.startsWith('effect-')) {
      const effectName = qualityToRemove.name
      form.attacks = form.attacks?.filter((attack) => {
        return attack.effect !== effectName
      }) || []
    }
  }

  // ========================
  // Attack CRUD Operations
  // ========================
  const addCustomAttack = () => {
    if (!newAttack.name) return

    const attackData: Attack = {
      id: editingAttackIndex.value >= 0 ? form.attacks![editingAttackIndex.value].id : `attack-${Date.now()}`,
      name: newAttack.name,
      range: newAttack.range,
      type: newAttack.type,
      tags: [...newAttack.tags],
      effect: newAttack.effect || undefined,
      description: newAttack.description,
    }

    if (editingAttackIndex.value >= 0) {
      form.attacks = form.attacks?.map((attack, i) => (i === editingAttackIndex.value ? attackData : attack)) || []
    } else {
      form.attacks = [...(form.attacks || []), attackData]
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
    form.attacks = form.attacks?.filter((_, i) => i !== index) || []
  }

  const editAttack = (index: number) => {
    const attack = form.attacks?.[index]
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
  // Watchers for Constraints
  // ========================

  // Enforce bonus DP for qualities stays within valid range
  watch(
    () => form.bonusDPForQualities,
    (newVal) => {
      if (newVal < minBonusDPForQualities.value) {
        form.bonusDPForQualities = minBonusDPForQualities.value
      } else if (newVal > maxBonusDPForQualities.value) {
        form.bonusDPForQualities = maxBonusDPForQualities.value
      }
    }
  )

  // Enforce when bonus stats change
  watch(
    () => bonusStatsTotal.value,
    () => {
      if (form.bonusDPForQualities > maxBonusDPForQualities.value) {
        form.bonusDPForQualities = maxBonusDPForQualities.value
      }
    }
  )

  // Enforce when quality spending changes
  watch(
    () => minBonusDPForQualities.value,
    (newMin) => {
      if (form.bonusDPForQualities < newMin) {
        form.bonusDPForQualities = newMin
      }
    }
  )

  // Track previous stat values to revert changes that exceed limits
  const prevBonusStats = ref({ ...form.bonusStats })
  const prevBaseStats = ref({ ...form.baseStats })

  watch(
    () => form.bonusStats,
    (stats) => {
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      const max = bonusDPForStats.value
      if (total > max) {
        for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
          if (stats[key] !== prevBonusStats.value[key]) {
            form.bonusStats[key] = prevBonusStats.value[key]
          }
        }
      } else {
        prevBonusStats.value = { ...stats }
      }
    },
    { deep: true }
  )

  watch(
    () => form.baseStats,
    (stats) => {
      const total = Object.values(stats).reduce((a, b) => a + b, 0)
      const qualitiesFromBaseDP = Math.max(0, dpUsedOnQualities.value - (form.bonusDPForQualities || 0))
      const maxForStats = baseDP.value - qualitiesFromBaseDP
      if (total > maxForStats) {
        for (const key of Object.keys(stats) as (keyof typeof stats)[]) {
          if (stats[key] !== prevBaseStats.value[key]) {
            form.baseStats[key] = prevBaseStats.value[key]
          }
        }
      } else {
        prevBaseStats.value = { ...stats }
      }
    },
    { deep: true }
  )

  // Watch for attack type changes - clear invalid effects
  watch(
    () => newAttack.type,
    (newType) => {
      if (newAttack.effect) {
        const EFFECT_ALIGNMENT: Record<string, 'P' | 'N' | 'NA'> = {
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
        const alignment = EFFECT_ALIGNMENT[newAttack.effect]
        if (alignment === 'P' && newType !== 'support') {
          newAttack.effect = ''
        } else if (alignment === 'N' && newType !== 'damage') {
          newAttack.effect = ''
        }
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

  // Watch for stage changes - adjust quality ranks and attack tags
  watch(
    () => form.stage,
    (newStage) => {
      if (!form.qualities) return

      form.qualities = form.qualities.map((quality) => {
        const template = QUALITY_DATABASE.find((t) => t.id === quality.id)
        if (!template) return quality

        const maxRanks = getMaxRanksAtStage(template, newStage)
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

  return {
    // State
    form,
    basicInfoExpanded,
    baseStatsExpanded,
    showCustomAttackForm,
    editingAttackIndex,
    newAttack,
    spriteError,

    // Configuration
    stages,
    sizes,
    attributes,
    families,
    familyLabels,
    currentStageConfig,
    currentSizeConfig,

    // DP and calculations
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
    derivedStats,

    // Attack tags
    usedAttackTags,
    countAttacksWithTag,
    isTagAlreadyUsed,
    availableAttackTags,
    usedEffects,
    availableEffectTags,
    addTagToAttack,
    removeTagFromAttack,

    // Operations
    handleAddQuality,
    handleUpdateQualityRanks,
    removeQuality,
    addCustomAttack,
    removeAttack,
    editAttack,
    handleSpriteError,
  }
}
