<script setup lang="ts">
import {
  QUALITY_DATABASE,
  getFreeQualities,
  getNegativeQualities,
  getPurchasableQualities,
  getMaxNegativeDP,
  getQualityTypeTags,
  getQualityCategories,
  isQualityAvailableAtStage,
  getMaxRanksAtStage,
  getEffectiveDPCost,
  arePrerequisitesMet,
  hasExclusiveConflict,
  getQualityById,
  compareStages,
  type QualityTemplate,
  type QualityTypeTag,
  type QualityType,
  type QualityCategory,
} from '../data/qualities'
import type { DigimonStage, EddySoulRules } from '../types'

interface Quality {
  id: string
  name: string
  type: QualityTypeTag | QualityTypeTag[]
  dpCost: number
  description: string
  effect: string
  ranks?: number
  choiceId?: string
  choiceName?: string
}

interface Props {
  stage: DigimonStage
  currentQualities: Quality[]
  canAdd?: boolean // Whether adding new qualities is allowed (has DP remaining)
  availableDP?: number // How much DP is available for qualities (to grey out expensive ones)
  speedyMaxRanks?: number // Effective max ranks for Speedy based on base movement modifiers
  eddySoulRules?: EddySoulRules
}

const props = withDefaults(defineProps<Props>(), {
  canAdd: true,
  availableDP: Infinity,
  speedyMaxRanks: undefined, // Use stage-based default if not provided
})
const emit = defineEmits<{
  (e: 'add', quality: Quality): void
  (e: 'remove', index: number): void
  (e: 'updateRanks', index: number, ranks: number): void
}>()

const showSelector = ref(false)
const searchQuery = ref('')
const filterType = ref<'all' | 'free' | 'negative' | 'purchasable'>('all')
const filterCategory = ref<QualityCategory | 'all'>('all')

// For qualities with choices (sub-options)
const pendingQuality = ref<QualityTemplate | null>(null)
const showChoiceSelector = ref(false)

// Get all purchasable categories for the dropdown
const purchasableCategories = computed(() => {
  return getQualityCategories().filter(
    (cat) => cat.id !== 'free' && cat.id !== 'negative'
  )
})

const maxNegativeDP = computed(() => getMaxNegativeDP(props.stage))

const currentNegativeDP = computed(() => {
  return props.currentQualities
    .filter((q) => {
      const template = QUALITY_DATABASE.find((t) => t.id === q.id)
      return template?.type === 'negative'
    })
    .reduce((sum, q) => sum + Math.abs(q.dpCost), 0)
})

const currentPurchasableDP = computed(() => {
  const purchasableQualities = props.currentQualities.filter((q) => {
    const template = QUALITY_DATABASE.find((t) => t.id === q.id)
    return template?.type === 'purchasable'
  })

  // Track which quality IDs we've seen to determine "first of type"
  const seenIds = new Set<string>()

  return purchasableQualities.reduce((sum, q) => {
    const template = QUALITY_DATABASE.find((t) => t.id === q.id)
    if (!template) return sum + (q.dpCost * (q.ranks || 1))

    const isFirstOfType = !seenIds.has(q.id)
    seenIds.add(q.id)

    return sum + getEffectiveDPCost(template, q.ranks || 1, q.dpCost, props.stage, isFirstOfType, props.eddySoulRules)
  }, 0)
})

const hasFreeQuality = computed(() => {
  return props.currentQualities.some((q) => {
    const template = QUALITY_DATABASE.find((t) => t.id === q.id)
    return template?.type === 'free'
  })
})

// All qualities matching current filters (including unavailable ones)
const filteredQualities = computed(() => {
  let qualities = QUALITY_DATABASE

  // Filter by type
  if (filterType.value === 'free') {
    qualities = getFreeQualities()
  } else if (filterType.value === 'negative') {
    qualities = getNegativeQualities()
  } else if (filterType.value === 'purchasable') {
    qualities = getPurchasableQualities()
  }

  // Filter by category (only for purchasable)
  if (filterCategory.value !== 'all' && filterType.value === 'purchasable') {
    qualities = qualities.filter((q) => q.category === filterCategory.value)
  }

  // Search filter
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    qualities = qualities.filter(
      (q) =>
        q.name.toLowerCase().includes(query) ||
        q.description.toLowerCase().includes(query) ||
        q.effect.toLowerCase().includes(query)
    )
  }

  return qualities
})

// Get detailed availability status for a quality
function getFullQualityStatus(template: QualityTemplate): { canSelect: boolean; reasons: string[] } {
  const reasons: string[] = []
  const hasAnyOfThisQuality = props.currentQualities.some((cq) => cq.id === template.id)

  // Check if there's DP available for purchasable qualities (adding new or increasing ranks)
  if (template.type === 'purchasable') {
    if (!props.canAdd) {
      reasons.push('No DP remaining for qualities')
    } else if (getTemplateDPCost(template) > props.availableDP) {
      reasons.push(`Costs ${getTemplateDPCost(template)} DP (${props.availableDP} available)`)
    }
  }

  // Check stage requirement
  if (!isQualityAvailableAtStage(template, props.stage)) {
    reasons.push(`Requires ${template.stageRequirement || 'higher'} stage`)
  }

  // For qualities WITH choices, check availability based on exclusiveChoices flag
  // For qualities WITHOUT choices, check max ranks normally
  if (!template.choices || template.choices.length === 0) {
    const existing = props.currentQualities.find((cq) => cq.id === template.id)
    if (existing) {
      let maxRanks = getMaxRanksAtStage(template, props.stage)
      // EddySoul: Huge Power Rank 2 requires Ultimate+
      if (props.eddySoulRules?.hugePowerOncePerTurn && template.id === 'huge-power') {
        const isUltimatePlus = compareStages(props.stage, 'ultimate') >= 0
        if (!isUltimatePlus) maxRanks = Math.min(maxRanks, 1)
      }
      // EddySoul: Agility Rank 2 requires Ultimate+
      if (props.eddySoulRules?.agilityRank2RequiresUltimate && template.id === 'agility') {
        const isUltimatePlus = compareStages(props.stage, 'ultimate') >= 0
        if (!isUltimatePlus) maxRanks = Math.min(maxRanks, 1)
      }
      if ((existing.ranks || 1) >= maxRanks) {
        reasons.push(`Already at max ranks (${maxRanks})`)
      }
    }
  } else if (template.exclusiveChoices) {
    // For exclusive choices (like Data Optimization), can only take ONE choice total
    if (hasAnyOfThisQuality) {
      reasons.push('Can only select one option')
    }
  } else {
    // For non-exclusive choices, check both:
    // 1. Can't pick the same choice twice
    // 2. Total choices can't exceed maxRanks
    const takenChoices = props.currentQualities.filter((cq) => cq.id === template.id)
    const takenChoiceIds = takenChoices.map((cq) => cq.choiceId)
    const availableChoices = template.choices.filter((c) => !takenChoiceIds.includes(c.id))
    const maxRanks = getMaxRanksAtStage(template, props.stage)

    if (takenChoices.length >= maxRanks) {
      // Already at max ranks (e.g., Naturewalk: 2 elements max)
      reasons.push(`Already at max (${maxRanks} choices)`)
    } else if (availableChoices.length === 0) {
      reasons.push('All options already selected')
    }
  }

  // Can only have one free quality
  if (template.type === 'free' && hasFreeQuality.value && !hasAnyOfThisQuality) {
    reasons.push('Already have a free quality')
  }

  // Check negative DP limit
  if (template.type === 'negative' && !hasAnyOfThisQuality) {
    const newTotal = currentNegativeDP.value + Math.abs(template.dpCost)
    if (newTotal > maxNegativeDP.value) {
      reasons.push(`Would exceed negative DP limit (${currentNegativeDP.value}/${maxNegativeDP.value})`)
    }
  }

  // Check prerequisites
  const prereqCheck = arePrerequisitesMet(template, props.currentQualities)
  if (!prereqCheck.met) {
    reasons.push(`Missing: ${prereqCheck.missing.join(', ')}`)
  }

  // Check exclusive conflicts
  if (!hasAnyOfThisQuality) {
    const exclusiveCheck = hasExclusiveConflict(template, props.currentQualities)
    if (exclusiveCheck.conflict) {
      const conflictNames = exclusiveCheck.conflictingIds
        .map((id) => getQualityById(id)?.name || id)
        .join(', ')
      reasons.push(`Conflicts with: ${conflictNames}`)
    }
  }

  return { canSelect: reasons.length === 0, reasons }
}

// Get what would be locked off if this quality is picked
function getWouldLockOff(template: QualityTemplate): string[] {
  if (!template.exclusiveWith || template.exclusiveWith.length === 0) {
    return []
  }

  // Return names of qualities that would be locked off (that aren't already picked)
  return template.exclusiveWith
    .filter((exId) => !props.currentQualities.some((q) => q.id === exId))
    .map((exId) => getQualityById(exId)?.name || exId)
}

function selectQuality(template: QualityTemplate) {
  // Check if this quality already exists (for adding ranks)
  const existingIndex = props.currentQualities.findIndex((q) => q.id === template.id && !template.choices)

  if (existingIndex >= 0) {
    // Add a rank
    const existing = props.currentQualities[existingIndex]
    const newRanks = (existing.ranks || 1) + 1
    emit('updateRanks', existingIndex, newRanks)
    showSelector.value = false
  } else if (template.choices && template.choices.length > 0) {
    // Quality has choices - show choice selector
    pendingQuality.value = template
    showChoiceSelector.value = true
  } else {
    // Add new quality without choices
    const quality: Quality = {
      id: template.id,
      name: template.name,
      type: template.qualityType,
      dpCost: getTemplateDPCost(template),
      description: template.description,
      effect: template.effect,
      ranks: 1,
    }
    emit('add', quality)
    showSelector.value = false
  }
}

function selectChoice(template: QualityTemplate, choice: NonNullable<QualityTemplate['choices']>[0]) {
  // Check if this specific choice already exists
  const existingIndex = props.currentQualities.findIndex(
    (q) => q.id === template.id && q.choiceId === choice.id
  )

  if (existingIndex >= 0 && !template.singleRankPerChoice) {
    // Add a rank to existing choice (only if not singleRankPerChoice)
    const existing = props.currentQualities[existingIndex]
    const newRanks = (existing.ranks || 1) + 1
    emit('updateRanks', existingIndex, newRanks)
  } else if (existingIndex < 0) {
    // Add new quality with this choice
    const quality: Quality = {
      id: template.id,
      name: template.name,
      type: template.qualityType,
      dpCost: choice.dpCost ?? getTemplateDPCost(template),
      description: template.description,
      effect: choice.effect,
      ranks: 1,
      choiceId: choice.id,
      choiceName: choice.name,
    }
    emit('add', quality)
  }

  // Reset choice selector
  pendingQuality.value = null
  showChoiceSelector.value = false
  showSelector.value = false
}

function cancelChoiceSelection() {
  pendingQuality.value = null
  showChoiceSelector.value = false
}

function getTypeColor(qualityType: QualityTypeTag) {
  switch (qualityType) {
    case 'static':
      return 'bg-blue-900/30 text-blue-400'
    case 'trigger':
      return 'bg-yellow-900/30 text-yellow-400'
    case 'attack':
      return 'bg-red-900/30 text-red-400'
    default:
      return 'bg-digimon-dark-600 text-digimon-dark-300'
  }
}

function getCostColor(template: QualityTemplate) {
  if (template.type === 'free') return 'bg-green-900/30 text-green-400'
  if (template.type === 'negative') return 'bg-purple-900/30 text-purple-400'
  return 'bg-digimon-orange-900/30 text-digimon-orange-400'
}

function getTemplateDPCost(template: QualityTemplate): number {
  if (props.eddySoulRules?.chargeAttackCosts3DP && template.id === 'charge-attack') return 3
  return template.dpCost
}

function getCostDisplay(template: QualityTemplate) {
  if (template.type === 'free') return 'Free'
  if (template.type === 'negative') return `${template.dpCost} DP`
  if (template.freeFirstRank) return `Free 1st, +${getTemplateDPCost(template)}/rank`
  if (template.firstRankDiscountAtStage) {
    const { stage: discountStage, discount } = template.firstRankDiscountAtStage
    const stageName = discountStage.charAt(0).toUpperCase() + discountStage.slice(1)
    return `+${getTemplateDPCost(template)} DP (${stageName}+: -${discount})`
  }
  return `+${getTemplateDPCost(template)} DP`
}

function formatQualityTypes(qualityType: QualityTypeTag | QualityTypeTag[]): string {
  const tags = getQualityTypeTags(qualityType)
  return tags.map((t) => t.charAt(0).toUpperCase()).join(', ')
}

function getQualityStatus(template: QualityTemplate): { canSelect: boolean; reason?: string } {
  const status = getFullQualityStatus(template)
  if (!status.canSelect) {
    return { canSelect: false, reason: status.reasons[0] }
  }

  // Check if GM approval required
  if (template.requiresGMApproval) {
    return { canSelect: true, reason: 'Requires GM approval' }
  }

  return { canSelect: true }
}

function getCurrentQualityTemplate(quality: Quality): QualityTemplate | undefined {
  return QUALITY_DATABASE.find((t) => t.id === quality.id)
}

function getDisplayCost(quality: Quality, index?: number): string {
  const template = getCurrentQualityTemplate(quality)
  if (!template) return `${quality.dpCost} DP`

  if (template.type === 'free') return 'Free'
  if (template.type === 'negative') {
    const total = Math.abs(quality.dpCost) * (quality.ranks || 1)
    return `-${total} DP`
  }

  // Check if this is the first instance of this quality for stage-based discount
  const isFirstOfType = index !== undefined
    ? props.currentQualities.findIndex((q) => q.id === quality.id) === index
    : true

  const total = getEffectiveDPCost(template, quality.ranks || 1, quality.dpCost, props.stage, isFirstOfType, props.eddySoulRules)
  if (total === 0) return 'Free'
  return `+${total} DP`
}

function getDisplayCostClass(quality: Quality): string {
  const template = getCurrentQualityTemplate(quality)
  if (!template) return 'bg-digimon-dark-600 text-digimon-dark-300'

  if (template.type === 'free') return 'bg-green-900/30 text-green-400'
  if (template.type === 'negative') return 'bg-purple-900/30 text-purple-400'
  return 'bg-digimon-orange-900/30 text-digimon-orange-400'
}

function getQualityMaxRanks(quality: Quality): number {
  // Special handling for Speedy - use effective base if provided
  if (quality.id === 'speedy' && props.speedyMaxRanks !== undefined) {
    return props.speedyMaxRanks
  }
  const template = getCurrentQualityTemplate(quality)
  if (!template) return 1
  let maxRanks = getMaxRanksAtStage(template, props.stage)
  // EddySoul: Huge Power Rank 2 requires Ultimate+
  if (props.eddySoulRules?.hugePowerOncePerTurn && quality.id === 'huge-power') {
    const isUltimatePlus = compareStages(props.stage, 'ultimate') >= 0
    if (!isUltimatePlus) maxRanks = Math.min(maxRanks, 1)
  }
  // EddySoul: Agility Rank 2 requires Ultimate+
  if (props.eddySoulRules?.agilityRank2RequiresUltimate && quality.id === 'agility') {
    const isUltimatePlus = compareStages(props.stage, 'ultimate') >= 0
    if (!isUltimatePlus) maxRanks = Math.min(maxRanks, 1)
  }
  return maxRanks
}

function qualityHasSingleRankPerChoice(quality: Quality): boolean {
  const template = getCurrentQualityTemplate(quality)
  return template?.singleRankPerChoice === true
}

// Check if a quality with choices has reached its max ranks (total choices)
function isAtMaxChoices(template: QualityTemplate): boolean {
  if (!template.choices || template.choices.length === 0) return false
  const takenCount = props.currentQualities.filter((q) => q.id === template.id).length
  const maxRanks = getMaxRanksAtStage(template, props.stage)
  return takenCount >= maxRanks
}

// Data Optimization adjacency ring for Hybrid Drive
// Close Combat ↔ Speed Striker ↔ Ranged Striker ↔ Effect Warrior ↔ Guardian ↔ Brawler ↔ Close Combat
const DATA_OPT_ADJACENCY: Record<string, string[]> = {
  'close-combat': ['speed-striker', 'brawler'],
  'speed-striker': ['close-combat', 'ranged-striker'],
  'ranged-striker': ['speed-striker', 'effect-warrior'],
  'effect-warrior': ['ranged-striker', 'guardian'],
  'guardian': ['effect-warrior', 'brawler'],
  'brawler': ['guardian', 'close-combat'],
}

// Check if a choice's prerequisites are met (for Data Specialization tree and Advanced Mobility)
// For example, "Fistful of Force" requires Data Optimization: Close Combat
// And "Adv Swimmer" requires Extra Movement: Swimmer
// Hybrid Drive allows access to adjacent Data Optimization trees
function isChoicePrereqMet(choice: NonNullable<QualityTemplate['choices']>[0]): { met: boolean; missing: string[] } {
  if (!choice.prerequisites || choice.prerequisites.length === 0) {
    return { met: true, missing: [] }
  }

  const missing: string[] = []

  // Check if user has Hybrid Drive (allows access to adjacent Data Optimization trees)
  const hasHybridDrive = props.currentQualities.some((q) => q.id === 'hybrid-drive')

  // Get user's Data Optimization choice if they have one
  const userDataOpt = props.currentQualities.find((q) => q.id === 'data-optimization')
  const userDataOptTree = userDataOpt?.choiceId

  // Get adjacent trees if user has Hybrid Drive
  const adjacentTrees = hasHybridDrive && userDataOptTree ? DATA_OPT_ADJACENCY[userDataOptTree] || [] : []

  for (const prereqId of choice.prerequisites) {
    // Check if user has an Extra Movement with this choiceId (for Advanced Mobility)
    const hasExtraMovement = props.currentQualities.some(
      (q) => q.id === 'extra-movement' && q.choiceId === prereqId
    )

    // Check if user has a Data Optimization with this choiceId (for Data Specialization)
    const hasDataOpt = props.currentQualities.some(
      (q) => q.id === 'data-optimization' && q.choiceId === prereqId
    )

    // Check if Hybrid Drive grants access to this tree (adjacent tree)
    const hasHybridAccess = hasHybridDrive && adjacentTrees.includes(prereqId)

    // Check if user has a standalone quality with this id (e.g., 'speedy')
    const hasStandaloneQuality = props.currentQualities.some(
      (q) => q.id === prereqId
    )

    if (!hasExtraMovement && !hasDataOpt && !hasHybridAccess && !hasStandaloneQuality) {
      // Get a friendly name for the missing prerequisite
      // First try Extra Movement
      const extraMovementTemplate = QUALITY_DATABASE.find((q) => q.id === 'extra-movement')
      const extraMovementChoice = extraMovementTemplate?.choices?.find((c) => c.id === prereqId)
      if (extraMovementChoice) {
        missing.push(`Extra Movement: ${extraMovementChoice.name}`)
        continue
      }

      // Then try Data Optimization
      const dataOptTemplate = QUALITY_DATABASE.find((q) => q.id === 'data-optimization')
      const dataOptChoice = dataOptTemplate?.choices?.find((c) => c.id === prereqId)
      if (dataOptChoice) {
        // If user has Hybrid Drive but this isn't an adjacent tree, mention that
        if (hasHybridDrive && userDataOptTree) {
          missing.push(`Data Optimization: ${dataOptChoice.name} (not adjacent to your tree)`)
        } else {
          missing.push(`Data Optimization: ${dataOptChoice.name}`)
        }
        continue
      }

      // Finally try standalone quality
      const standaloneTemplate = QUALITY_DATABASE.find((q) => q.id === prereqId)
      if (standaloneTemplate) {
        missing.push(standaloneTemplate.name)
        continue
      }

      // Fallback to raw prereqId
      missing.push(prereqId)
    }
  }

  return { met: missing.length === 0, missing }
}

// Check if a choice's per-choice stage requirement is met
function isChoiceStageAvailable(choice: NonNullable<QualityTemplate['choices']>[0]): boolean {
  if (!choice.stageRequirement) return true
  return compareStages(props.stage, choice.stageRequirement) >= 0
}
</script>

<template>
  <div class="space-y-4">
    <!-- Summary -->
    <div class="flex flex-wrap gap-4 text-sm">
      <div>
        <span class="text-digimon-dark-400">Free Quality:</span>
        <span :class="hasFreeQuality ? 'text-green-400' : 'text-digimon-dark-500'" class="ml-1">
          {{ hasFreeQuality ? '1/1' : '0/1' }}
        </span>
      </div>
      <div>
        <span class="text-digimon-dark-400">Negative DP:</span>
        <span class="text-purple-400 ml-1">{{ currentNegativeDP }}/{{ maxNegativeDP }}</span>
      </div>
      <div>
        <span class="text-digimon-dark-400">Purchased DP:</span>
        <span class="text-digimon-orange-400 ml-1">{{ currentPurchasableDP }}</span>
      </div>
    </div>

    <!-- Current Qualities -->
    <div v-if="currentQualities.length > 0" class="space-y-2">
      <div
        v-for="(quality, index) in currentQualities"
        :key="`${quality.id}-${quality.choiceId || ''}-${index}`"
        class="bg-digimon-dark-700 rounded-lg p-3 flex justify-between items-start"
      >
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-semibold text-white">{{ quality.name }}</span>
            <span v-if="quality.choiceName" class="text-xs bg-cyan-900/30 text-cyan-400 px-2 py-0.5 rounded">
              {{ quality.choiceName }}
            </span>
            <!-- Rank controls for multi-rank qualities (not for singleRankPerChoice like Naturewalk) -->
            <template v-if="getQualityMaxRanks(quality) > 1 && !qualityHasSingleRankPerChoice(quality)">
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="w-6 h-6 bg-digimon-dark-600 hover:bg-digimon-dark-500 rounded text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="(quality.ranks || 1) <= 1"
                  @click="emit('updateRanks', index, (quality.ranks || 1) - 1)"
                >
                  -
                </button>
                <span class="text-xs text-digimon-dark-300 min-w-[60px] text-center">
                  Rank {{ quality.ranks || 1 }}/{{ getQualityMaxRanks(quality) }}
                </span>
                <button
                  type="button"
                  class="w-6 h-6 bg-digimon-dark-600 hover:bg-digimon-dark-500 rounded text-white text-sm font-bold disabled:opacity-50 disabled:cursor-not-allowed"
                  :disabled="(quality.ranks || 1) >= getQualityMaxRanks(quality) || !canAdd"
                  :title="!canAdd ? 'No DP remaining' : undefined"
                  @click="emit('updateRanks', index, (quality.ranks || 1) + 1)"
                >
                  +
                </button>
              </div>
            </template>
            <template v-for="tag in getQualityTypeTags(quality.type)" :key="tag">
              <span :class="['text-xs px-2 py-0.5 rounded uppercase', getTypeColor(tag)]">
                {{ tag }}
              </span>
            </template>
            <span :class="['text-xs px-2 py-0.5 rounded', getDisplayCostClass(quality)]">
              {{ getDisplayCost(quality, index) }}
            </span>
          </div>
          <p class="text-sm text-digimon-dark-400 mt-1">{{ quality.description }}</p>
          <p class="text-xs text-digimon-dark-300 mt-2 whitespace-pre-line">{{ quality.effect }}</p>
        </div>
        <button type="button" class="text-red-400 hover:text-red-300 text-sm ml-2" @click="emit('remove', index)">
          Remove
        </button>
      </div>
    </div>

    <!-- Add Quality Button -->
    <div v-if="!showSelector">
      <button
        type="button"
        :disabled="!canAdd"
        :class="[
          'w-full border-2 border-dashed rounded-lg p-4 transition-colors',
          canAdd
            ? 'border-digimon-dark-600 text-digimon-dark-400 hover:border-digimon-dark-500 hover:text-digimon-dark-300'
            : 'border-red-900/50 text-red-400/50 cursor-not-allowed'
        ]"
        @click="canAdd && (showSelector = true)"
      >
        {{ canAdd ? '+ Add Quality' : 'No DP remaining for qualities' }}
      </button>
    </div>

    <!-- Quality Selector -->
    <div v-else class="border border-digimon-dark-600 rounded-lg p-4 bg-digimon-dark-750">
      <div class="flex justify-between items-center mb-4">
        <h4 class="font-semibold text-white">Select Quality</h4>
        <button type="button" class="text-digimon-dark-400 hover:text-white" @click="showSelector = false">
          ✕
        </button>
      </div>

      <!-- Search and filters -->
      <div class="space-y-2 mb-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search qualities..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2 text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
        />
        <div class="flex gap-2">
          <select
            v-model="filterType"
            class="flex-1 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2 text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
          >
            <option value="all">All Types</option>
            <option value="free">Free (0 DP)</option>
            <option value="negative">Negative (-DP)</option>
            <option value="purchasable">Purchasable (+DP)</option>
          </select>
          <select
            v-if="filterType === 'purchasable'"
            v-model="filterCategory"
            class="flex-1 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2 text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
          >
            <option value="all">All Categories</option>
            <option v-for="cat in purchasableCategories" :key="cat.id" :value="cat.id">
              {{ cat.name }}
            </option>
          </select>
        </div>
      </div>

      <!-- Quality list -->
      <div class="max-h-80 overflow-y-auto space-y-2">
        <template v-for="quality in filteredQualities" :key="quality.id">
          <!-- Selectable quality -->
          <button
            v-if="getFullQualityStatus(quality).canSelect"
            type="button"
            class="w-full text-left bg-digimon-dark-700 hover:bg-digimon-dark-600 rounded-lg p-3 transition-colors"
            @click="selectQuality(quality)"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-white">{{ quality.name }}</span>
              <span class="text-xs px-2 py-0.5 rounded uppercase bg-digimon-dark-600 text-digimon-dark-300">
                [{{ formatQualityTypes(quality.qualityType) }}]
              </span>
              <span :class="['text-xs px-2 py-0.5 rounded', getCostColor(quality)]">
                {{ getCostDisplay(quality) }}
              </span>
              <span v-if="quality.maxRanks > 1" class="text-xs text-digimon-dark-400">
                ({{ getMaxRanksAtStage(quality, stage) }} ranks max)
              </span>
              <span v-if="quality.stageRequirement" class="text-xs text-cyan-400/70">
                {{ quality.stageRequirement }}+
              </span>
              <span v-if="quality.requiresGMApproval" class="text-xs text-yellow-500">
                GM approval
              </span>
            </div>
            <p class="text-xs text-digimon-dark-400 mt-1">{{ quality.description }}</p>
            <p v-if="quality.prerequisites.length > 0" class="text-xs text-yellow-400/70 mt-1">
              Requires: {{ quality.prerequisites.join(', ') }}
            </p>
            <p v-if="quality.limitedTag" class="text-xs text-blue-400/70 mt-1">
              [LIMITED] - {{ quality.id === 'weapon' ? 'Can tag attacks equal to rank count' : 'Applies to one attack only' }}
            </p>
            <!-- Show what would be locked off -->
            <p v-if="getWouldLockOff(quality).length > 0" class="text-xs text-orange-400/70 mt-1">
              Locks off: {{ getWouldLockOff(quality).join(', ') }}
            </p>
          </button>

          <!-- Unavailable quality -->
          <div
            v-else
            class="w-full text-left bg-digimon-dark-800 rounded-lg p-3 opacity-60"
          >
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-digimon-dark-400">{{ quality.name }}</span>
              <span class="text-xs px-2 py-0.5 rounded uppercase bg-digimon-dark-700 text-digimon-dark-500">
                [{{ formatQualityTypes(quality.qualityType) }}]
              </span>
              <span class="text-xs px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-500">
                {{ getCostDisplay(quality) }}
              </span>
              <span v-if="quality.maxRanks > 1" class="text-xs text-digimon-dark-500">
                ({{ getMaxRanksAtStage(quality, stage) }} ranks max)
              </span>
            </div>
            <p class="text-xs text-digimon-dark-500 mt-1">{{ quality.description }}</p>
            <!-- Show all reasons why unavailable -->
            <div class="mt-1 space-y-0.5">
              <p v-for="reason in getFullQualityStatus(quality).reasons" :key="reason" class="text-xs text-red-400/80">
                {{ reason }}
              </p>
            </div>
          </div>
        </template>

        <div v-if="filteredQualities.length === 0" class="text-center py-4 text-digimon-dark-400">
          No qualities match your search
        </div>
      </div>

      <!-- Choice Selector Modal -->
      <div
        v-if="showChoiceSelector && pendingQuality"
        class="fixed inset-0 bg-black/60 flex items-center justify-center z-50"
        @click.self="cancelChoiceSelection"
      >
        <div class="bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg p-6 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h4 class="font-semibold text-white text-lg">{{ pendingQuality.name }}</h4>
              <p class="text-sm text-digimon-dark-400 mt-1">{{ pendingQuality.description }}</p>
            </div>
            <button
              type="button"
              class="text-digimon-dark-400 hover:text-white text-xl"
              @click="cancelChoiceSelection"
            >
              ✕
            </button>
          </div>

          <p class="text-sm text-cyan-400 mb-4">Select a sub-option:</p>

          <!-- Show max reached message if applicable -->
          <div v-if="pendingQuality && isAtMaxChoices(pendingQuality)" class="mb-4 p-3 bg-yellow-900/20 border border-yellow-600/30 rounded-lg">
            <p class="text-sm text-yellow-400">
              Maximum choices reached ({{ getMaxRanksAtStage(pendingQuality, stage) }})
            </p>
          </div>

          <div class="space-y-2">
            <template v-for="choice in pendingQuality?.choices" :key="choice.id">
              <!-- Check if this choice is already taken -->
              <template v-if="currentQualities.some((q) => q.id === pendingQuality?.id && q.choiceId === choice.id)">
                <!-- Already owned -->
                <div class="w-full text-left bg-digimon-dark-800 border border-digimon-dark-700 rounded-lg p-4 opacity-50">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-digimon-dark-400">{{ choice.name }}</span>
                    <span class="text-xs px-2 py-0.5 rounded bg-green-900/30 text-green-400">Already owned</span>
                  </div>
                  <p class="text-sm text-digimon-dark-500 whitespace-pre-line">{{ choice.effect }}</p>
                </div>
              </template>
              <!-- Check if choice prerequisites are met (for Data Specialization tree) -->
              <template v-else-if="!isChoicePrereqMet(choice).met">
                <!-- Missing prerequisite -->
                <div class="w-full text-left bg-digimon-dark-800 border border-digimon-dark-700 rounded-lg p-4 opacity-50">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-digimon-dark-400">{{ choice.name }}</span>
                    <span
                      v-if="choice.dpCost !== undefined && choice.dpCost !== pendingQuality?.dpCost"
                      class="text-xs px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-500"
                    >
                      +{{ choice.dpCost }} DP
                    </span>
                  </div>
                  <p class="text-sm text-digimon-dark-500 whitespace-pre-line">{{ choice.effect }}</p>
                  <p class="text-xs text-red-400 mt-2">
                    Requires: {{ isChoicePrereqMet(choice).missing.join(', ') }}
                  </p>
                </div>
              </template>
              <!-- Check if choice has a per-choice stage requirement not met -->
              <template v-else-if="!isChoiceStageAvailable(choice)">
                <div class="w-full text-left bg-digimon-dark-800 border border-digimon-dark-700 rounded-lg p-4 opacity-50">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-digimon-dark-400">{{ choice.name }}</span>
                    <span
                      v-if="choice.dpCost !== undefined && choice.dpCost !== pendingQuality?.dpCost"
                      class="text-xs px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-500"
                    >
                      +{{ choice.dpCost }} DP
                    </span>
                  </div>
                  <p class="text-sm text-digimon-dark-500 whitespace-pre-line">{{ choice.effect }}</p>
                  <p class="text-xs text-red-400 mt-2">
                    Requires {{ choice.stageRequirement }} stage
                  </p>
                </div>
              </template>
              <!-- Check if max choices reached (for qualities like Naturewalk with maxRanks limit) -->
              <template v-else-if="pendingQuality && isAtMaxChoices(pendingQuality)">
                <!-- Max choices reached -->
                <div class="w-full text-left bg-digimon-dark-800 border border-digimon-dark-700 rounded-lg p-4 opacity-50">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-digimon-dark-400">{{ choice.name }}</span>
                    <span
                      v-if="choice.dpCost !== undefined && choice.dpCost !== pendingQuality?.dpCost"
                      class="text-xs px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-500"
                    >
                      +{{ choice.dpCost }} DP
                    </span>
                  </div>
                  <p class="text-sm text-digimon-dark-500 whitespace-pre-line">{{ choice.effect }}</p>
                </div>
              </template>
              <!-- Check if choice DP cost exceeds available budget -->
              <template v-else-if="(choice.dpCost ?? pendingQuality?.dpCost ?? 0) > availableDP">
                <!-- Not enough DP -->
                <div class="w-full text-left bg-digimon-dark-800 border border-digimon-dark-700 rounded-lg p-4 opacity-50">
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-digimon-dark-400">{{ choice.name }}</span>
                    <span
                      v-if="choice.dpCost !== undefined && choice.dpCost !== pendingQuality?.dpCost"
                      class="text-xs px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-500"
                    >
                      +{{ choice.dpCost }} DP
                    </span>
                  </div>
                  <p class="text-sm text-digimon-dark-500 whitespace-pre-line">{{ choice.effect }}</p>
                  <p class="text-xs text-red-400 mt-2">
                    Costs {{ choice.dpCost ?? pendingQuality?.dpCost ?? 0 }} DP ({{ availableDP }} available)
                  </p>
                </div>
              </template>
              <!-- Available choice -->
              <template v-else>
                <button
                  v-if="pendingQuality"
                  type="button"
                  class="w-full text-left bg-digimon-dark-700 hover:bg-digimon-dark-600 border border-digimon-dark-600 hover:border-cyan-500/50 rounded-lg p-4 transition-colors"
                  @click="selectChoice(pendingQuality, choice)"
                >
                  <div class="flex items-center gap-2 mb-2">
                    <span class="font-semibold text-white">{{ choice.name }}</span>
                    <span
                      v-if="choice.dpCost !== undefined && choice.dpCost !== pendingQuality?.dpCost"
                      class="text-xs px-2 py-0.5 rounded bg-digimon-orange-900/30 text-digimon-orange-400"
                    >
                      +{{ choice.dpCost }} DP
                    </span>
                  </div>
                  <p class="text-sm text-digimon-dark-300 whitespace-pre-line">{{ choice.effect }}</p>
                </button>
              </template>
            </template>
          </div>

          <div class="mt-4 pt-4 border-t border-digimon-dark-600">
            <button
              type="button"
              class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-300 rounded-lg py-2 transition-colors"
              @click="cancelChoiceSelection"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
