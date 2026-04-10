<script setup lang="ts">
import { computed, watch } from 'vue'
import type { Digimon } from '~/server/db/schema'
import { useDigimonForm } from '~/composables/useDigimonForm'
import { useBaseStatRanges } from '~/composables/useBaseStatRanges'
import { BASE_STAT_RANGES } from '~/types'
import { STAGE_ORDER } from '~/data/qualities'

const props = defineProps<{
  source: 'library' | 'portal'
  mode: 'create' | 'edit'
}>()
const isEdit = props.mode === 'edit'
const isLibrary = props.source === 'library'

const route = useRoute()
const router = useRouter()
const { campaignId, eddySoulRules, houseRules, loadCampaign } = useCampaignContext()

const tamerId = computed(() => route.params.tamerId as string)
const recordId = computed(() => route.params.id as string)

const {
  digimonList,
  fetchDigimon,
  fetchDigimonById,
  createDigimon,
  updateDigimon,
  copyDigimon,
  loading,
  error,
  getPreviousStages,
  getNextStages,
  getEvolutionChain,
} = useDigimon()

const { tamers, fetchTamers } = useTamers()

const loadedDigimon = ref<Digimon | null>(null)
const initialLoading = ref(isEdit)
const loadError = ref<string | null>(null)
const copying = ref(false)

const linkedEvolvesFrom = ref<Digimon | null>(null)
const linkedEvolvesTo = ref<Digimon[]>([])

const {
  form,
  basicInfoExpanded,
  baseStatsExpanded,
  bonusDPExpanded,
  stages,
  sizes,
  availableSizes,
  attributes,
  families,
  familyLabels,
  currentStageConfig,
  currentSizeConfig,
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
  derivedStats,
  currentSpeedyMaxRanks,
  showCustomAttackForm,
  editingAttackIndex,
  newAttack,
  usedAttackTags,
  countAttacksWithTag,
  availableAttackTags,
  availableEffectTags,
  addTagToAttack,
  removeTagFromAttack,
  handleAddQuality,
  handleUpdateQualityRanks,
  removeQuality,
  addCustomAttack,
  removeAttack,
  editAttack,
  spriteError,
  handleSpriteError,
} = useDigimonForm(undefined, eddySoulRules)

const { statMin, statMax, isRangeActive } = useBaseStatRanges(
  () => form.stage,
  () => eddySoulRules.value
)

watch([() => form.stage, () => eddySoulRules.value?.baseStatRangesEnabled], () => {
  if (!eddySoulRules.value?.baseStatRangesEnabled) return
  const range = BASE_STAT_RANGES[form.stage]
  if (!range) return
  for (const key of ['accuracy', 'damage', 'dodge', 'armor', 'health'] as const) {
    if (form.baseStats[key] < range.min) form.baseStats[key] = range.min
    if (form.baseStats[key] > range.max) form.baseStats[key] = range.max
  }
})

const totalDP = computed(() => baseDP.value)
const dpUsed = computed(() => dpUsedOnStats.value + dpUsedOnQualities.value)
const systemBoostMaxRanks = computed(() => {
  const { baseBit, baseCpu, baseRam } = derivedStats.value
  return {
    bit: Math.min(3, baseBit),
    cpu: Math.min(3, baseCpu),
    ram: Math.min(3, baseRam),
  }
})
const bonusDPAllocated = computed(() => bonusStatsTotal.value + (form.bonusDPForQualities || 0))
const qualitiesFromBaseDP = computed(() => Math.max(0, dpUsedOnQualities.value - (form.bonusDPForQualities || 0)))

const digimonLinkBase = computed(() =>
  isLibrary
    ? `/campaigns/${campaignId.value}/library/digimon`
    : `/campaigns/${campaignId.value}/player/${tamerId.value}/digimon`
)

const backLink = computed(() =>
  isLibrary
    ? `/campaigns/${campaignId.value}/library/digimon`
    : `/campaigns/${campaignId.value}/player/${tamerId.value}`
)

const backLinkLabel = computed(() => isLibrary ? 'Back to Digimon' : 'Back to Dashboard')

const pageTitle = computed(() =>
  isEdit
    ? (isLibrary ? 'Edit Digimon' : 'Edit Partner Digimon')
    : (isLibrary ? 'New Digimon' : 'Create Partner Digimon')
)

const evolutionChain = computed(() => {
  if (!isEdit || !loadedDigimon.value || digimonList.value.length === 0) return null
  return getEvolutionChain(loadedDigimon.value, digimonList.value)
})

const ROW_HEIGHT = 88
const descendantsMinStage = computed(() => {
  const tree = evolutionChain.value?.descendantsTree
  if (!tree || tree.length === 0) return 0
  return Math.min(...tree.map(n => STAGE_ORDER.indexOf(n.digimon.stage as typeof STAGE_ORDER[number])))
})
function descendantOffset(node: { digimon: { stage: string } }): number {
  return (STAGE_ORDER.indexOf(node.digimon.stage as typeof STAGE_ORDER[number]) - descendantsMinStage.value) * ROW_HEIGHT
}

const linkedEvolvesToMinStage = computed(() => {
  if (linkedEvolvesTo.value.length === 0) return 0
  return Math.min(...linkedEvolvesTo.value.map(e => STAGE_ORDER.indexOf(e.stage as typeof STAGE_ORDER[number])))
})
function linkedEvolvesToOffset(evo: Digimon): number {
  return (STAGE_ORDER.indexOf(evo.stage as typeof STAGE_ORDER[number]) - linkedEvolvesToMinStage.value) * ROW_HEIGHT
}

async function loadDigimon() {
  try {
    const [data] = await Promise.all([
      fetchDigimonById(recordId.value),
      fetchDigimon({ campaignId: campaignId.value }),
    ])
    if (!data) {
      loadError.value = 'Digimon not found'
      return
    }
    if (!isLibrary && data.partnerId !== tamerId.value) {
      loadError.value = 'You can only edit your own partner Digimon'
      return
    }
    loadedDigimon.value = data
    Object.assign(form, {
      name: data.name,
      nickname: data.nickname ?? '',
      stage: data.stage,
      attribute: data.attribute,
      family: data.family,
      type: data.type,
      size: data.size || 'medium',
      baseStats: { ...data.baseStats },
      bonusStats: { ...(data.bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }) },
      bonusDP: data.bonusDP || 0,
      bonusDPForQualities: data.bonusDPForQualities || 0,
      attacks: data.attacks ? [...data.attacks] : [],
      qualities: data.qualities ? [...data.qualities] : [],
      dataOptimization: data.dataOptimization || '',
      partnerId: data.partnerId || null,
      isEnemy: (data as any).isEnemy || false,
      isDarkEvolution: (data as any).isDarkEvolution || false,
      notes: data.notes || '',
      spriteUrl: data.spriteUrl || '',
      evolvesFromId: data.evolvesFromId || null,
      evolutionPathIds: Array.isArray(data.evolutionPathIds) ? data.evolutionPathIds : [],
      syncBonusDP: data.syncBonusDP ?? true,
    })
    basicInfoExpanded.value = false
    baseStatsExpanded.value = false
  } finally {
    initialLoading.value = false
  }
}

function handleAddAttack(attack: any) {
  form.attacks = [...(form.attacks || []), attack]
}

onMounted(async () => {
  await loadCampaign()
  if (isLibrary) fetchTamers(campaignId.value)
  if (!isLibrary) form.partnerId = tamerId.value
  basicInfoExpanded.value = !isEdit
  if (isEdit) await loadDigimon()
})

watch(() => form.evolvesFromId, async (newId) => {
  if (newId) {
    const linkedDigimon = await fetchDigimonById(newId)
    if (linkedDigimon) {
      linkedEvolvesFrom.value = linkedDigimon
      if (linkedDigimon.partnerId && !form.partnerId) {
        form.partnerId = linkedDigimon.partnerId
      }
      if (form.syncBonusDP && linkedDigimon.bonusDP) {
        form.bonusDP = linkedDigimon.bonusDP
        form.bonusStats = linkedDigimon.bonusStats ? { ...linkedDigimon.bonusStats } : { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }
        form.bonusDPForQualities = linkedDigimon.bonusDPForQualities || 0
      }
    }
  } else {
    linkedEvolvesFrom.value = null
  }
})

watch(() => form.evolutionPathIds, async (newIds) => {
  const ids = Array.isArray(newIds) ? newIds : []
  if (ids.length === 0) {
    linkedEvolvesTo.value = []
    return
  }
  const fetched: Digimon[] = []
  for (const id of ids) {
    const d = await fetchDigimonById(id)
    if (d) fetched.push(d)
  }
  linkedEvolvesTo.value = fetched

  if (!form.evolvesFromId && fetched.length > 0) {
    const linkedDigimon = fetched[0]
    if (linkedDigimon.partnerId && !form.partnerId) {
      form.partnerId = linkedDigimon.partnerId
    }
    if (form.syncBonusDP && linkedDigimon.bonusDP) {
      form.bonusDP = linkedDigimon.bonusDP
      form.bonusStats = linkedDigimon.bonusStats ? { ...linkedDigimon.bonusStats } : { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }
      form.bonusDPForQualities = linkedDigimon.bonusDPForQualities || 0
    }
  }
}, { deep: true })

async function handleSubmit() {
  if (isEdit) {
    if (!loadedDigimon.value) return
    const data = {
      name: form.name,
      nickname: form.nickname || null,
      stage: form.stage,
      attribute: form.attribute,
      family: form.family,
      type: form.type || undefined,
      size: form.size,
      baseStats: form.baseStats,
      bonusStats: form.bonusStats,
      bonusDP: form.bonusDP,
      bonusDPForQualities: form.bonusDPForQualities,
      attacks: form.attacks,
      qualities: form.qualities,
      dataOptimization: form.dataOptimization || undefined,
      partnerId: isLibrary ? (form.partnerId || null) : tamerId.value,
      isEnemy: isLibrary ? form.isEnemy : false,
      isDarkEvolution: form.isDarkEvolution,
      notes: form.notes,
      spriteUrl: form.spriteUrl || undefined,
      evolvesFromId: form.evolvesFromId || undefined,
      evolutionPathIds: form.evolutionPathIds,
      syncBonusDP: form.syncBonusDP,
    }
    await updateDigimon(loadedDigimon.value.id, data)
    router.push(backLink.value)
  } else {
    const data: any = {
      name: form.name,
      nickname: form.nickname || undefined,
      stage: form.stage,
      attribute: form.attribute,
      family: form.family,
      type: form.type || undefined,
      size: form.size,
      baseStats: form.baseStats,
      attacks: form.attacks,
      qualities: form.qualities,
      dataOptimization: form.dataOptimization || undefined,
      bonusDP: form.bonusDP || 0,
      partnerId: isLibrary ? (form.partnerId || null) : tamerId.value,
      isEnemy: isLibrary ? form.isEnemy : false,
      isDarkEvolution: form.isDarkEvolution,
      notes: form.notes,
      spriteUrl: form.spriteUrl || undefined,
    }
    if (form.bonusDP > 0) {
      data.bonusStats = form.bonusStats
      data.bonusDPForQualities = form.bonusDPForQualities
    }
    if (form.evolvesFromId) data.evolvesFromId = form.evolvesFromId
    if (form.evolutionPathIds.length > 0) data.evolutionPathIds = form.evolutionPathIds
    if (form.evolvesFromId || form.evolutionPathIds.length > 0) data.syncBonusDP = form.syncBonusDP

    const created = await createDigimon({ ...data, campaignId: campaignId.value })
    if (created) {
      router.push(backLink.value)
    }
  }
}

async function handleCopy() {
  if (!loadedDigimon.value) return
  copying.value = true
  const newDigimon = await copyDigimon(loadedDigimon.value.id)
  if (newDigimon) {
    router.push(`${digimonLinkBase.value}/${newDigimon.id}`)
  }
  copying.value = false
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink :to="backLink" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; {{ backLinkLabel }}
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">{{ pageTitle }}</h1>
    </div>

    <div v-if="initialLoading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading digimon...</div>
    </div>

    <div v-else-if="loadError" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">{{ loadError }}</h2>
      <NuxtLink :to="backLink" class="text-digimon-orange-400 hover:text-digimon-orange-300">
        {{ isLibrary ? 'Return to Digimon list' : 'Return to Dashboard' }}
      </NuxtLink>
    </div>

    <form v-else class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info (Collapsible) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <button
          type="button"
          class="w-full flex justify-between items-center p-6 text-left hover:bg-digimon-dark-700/30 transition-colors rounded-xl"
          @click="basicInfoExpanded = !basicInfoExpanded"
        >
          <div class="flex items-center gap-3">
            <span :class="['transition-transform', basicInfoExpanded ? 'rotate-90' : '']">&#9654;</span>
            <h2 class="font-display text-xl font-semibold text-white">Basic Information</h2>
          </div>
          <span class="text-sm text-digimon-dark-400">
            {{ form.name || 'Unnamed' }} · {{ form.stage }} · {{ form.attribute }}
          </span>
        </button>

        <div v-show="basicInfoExpanded" class="px-6 pb-6">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
              <input
                v-model="form.name"
                type="text"
                required
                placeholder="e.g., Agumon"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Nickname <span class="text-digimon-dark-500">(optional)</span></label>
              <input
                v-model="form.nickname"
                type="text"
                placeholder="e.g., Blaze"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Stage</label>
              <select
                v-model="form.stage"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none capitalize"
              >
                <option v-for="stage in stages" :key="stage" :value="stage" class="capitalize">
                  {{ stage }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Attribute</label>
              <select
                v-model="form.attribute"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none capitalize"
              >
                <option v-for="attr in attributes" :key="attr" :value="attr" class="capitalize">
                  {{ attr }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Size</label>
              <select
                v-model="form.size"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none capitalize"
              >
                <option v-for="size in availableSizes" :key="size" :value="size" class="capitalize">
                  {{ size }}
                </option>
              </select>
              <div v-if="currentSizeConfig.bodyBonus !== 0 || currentSizeConfig.agilityBonus !== 0" class="text-xs text-digimon-dark-500 mt-1">
                Body {{ currentSizeConfig.bodyBonus >= 0 ? '+' : '' }}{{ currentSizeConfig.bodyBonus }},
                Agility {{ currentSizeConfig.agilityBonus >= 0 ? '+' : '' }}{{ currentSizeConfig.agilityBonus }}
              </div>
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Family</label>
              <select
                v-model="form.family"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              >
                <option v-for="fam in families" :key="fam" :value="fam">
                  {{ familyLabels[fam] }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Type</label>
              <input
                v-model="form.type"
                type="text"
                placeholder="e.g., Reptile"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
            <div v-if="isLibrary">
              <label class="block text-sm text-digimon-dark-400 mb-1">Partner Tamer (Optional)</label>
              <select
                v-model="form.partnerId"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              >
                <option value="">No Partner (Wild/Enemy)</option>
                <option v-for="tamer in tamers" :key="tamer.id" :value="tamer.id">
                  {{ tamer.name }}
                </option>
              </select>
            </div>
            <div class="flex items-end gap-6">
              <label v-if="isLibrary" class="flex items-center gap-2 cursor-pointer">
                <input
                  v-model="form.isEnemy"
                  type="checkbox"
                  class="w-5 h-5 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                         text-digimon-orange-500 focus:ring-digimon-orange-500"
                />
                <span class="text-white">This is an enemy Digimon</span>
              </label>
              <label class="flex items-center gap-2 cursor-pointer">
                <input
                  v-model="form.isDarkEvolution"
                  type="checkbox"
                  class="w-5 h-5 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                         text-digimon-orange-500 focus:ring-digimon-orange-500"
                />
                <span class="text-white">Dark Digivolution</span>
              </label>
            </div>
          </div>
        </div>
      </div>

      <!-- Stage Info -->
      <div class="bg-digimon-dark-700/50 rounded-xl p-4 border border-digimon-dark-600">
        <h3 class="font-semibold text-digimon-orange-400 mb-2 capitalize">{{ form.stage }} Stage Stats</h3>
        <div class="grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
          <div>
            <span class="text-digimon-dark-400">Base DP:</span>
            <span class="text-white ml-1">{{ currentStageConfig.dp }}</span>
          </div>
          <div v-if="isEdit">
            <span class="text-digimon-dark-400">Total DP:</span>
            <span class="text-white ml-1 font-semibold">{{ totalDP }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Movement:</span>
            <span class="text-white ml-1">{{ currentStageConfig.movement }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Wound Bonus:</span>
            <span class="text-white ml-1">+{{ currentStageConfig.woundBonus }}</span>
          </div>
          <div v-if="!isEdit">
            <span class="text-digimon-dark-400">Brains Bonus:</span>
            <span class="text-white ml-1">+{{ currentStageConfig.brainsBonus }}</span>
          </div>
          <div>
            <span class="text-digimon-dark-400">Attacks:</span>
            <span class="text-white ml-1">{{ currentStageConfig.attacks }}</span>
          </div>
        </div>
      </div>

      <!-- Base Stats (collapsible in edit, flat in create) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <!-- Edit: collapsible toggle -->
        <button
          v-if="isEdit"
          type="button"
          class="w-full flex justify-between items-center p-6 text-left hover:bg-digimon-dark-700/30 transition-colors rounded-xl"
          @click="baseStatsExpanded = !baseStatsExpanded"
        >
          <div class="flex items-center gap-3">
            <span :class="['transition-transform', baseStatsExpanded ? 'rotate-90' : '']">&#9654;</span>
            <h2 class="font-display text-xl font-semibold text-white">Base Stats</h2>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span
              :class="[
                'text-sm px-3 py-1 rounded',
                baseDPRemaining === 0 && 'bg-green-900/30 text-green-400',
                baseDPRemaining > 0 && 'bg-yellow-900/30 text-yellow-400',
                baseDPRemaining < 0 && 'bg-red-900/30 text-red-400',
              ]"
            >
              {{ baseDPRemaining }} Base DP remaining
            </span>
            <span class="text-xs text-digimon-dark-400">
              Stats: {{ dpUsedOnStats }} DP | Qualities: {{ qualitiesFromBaseDP }} DP
            </span>
          </div>
        </button>
        <!-- Create: flat header -->
        <div v-else class="flex justify-between items-center p-6 pb-0">
          <h2 class="font-display text-xl font-semibold text-white">Base Stats</h2>
          <div class="flex flex-col items-end gap-1">
            <span
              :class="[
                'text-sm px-3 py-1 rounded',
                baseDPRemaining === 0 && 'bg-green-900/30 text-green-400',
                baseDPRemaining > 0 && 'bg-yellow-900/30 text-yellow-400',
                baseDPRemaining < 0 && 'bg-red-900/30 text-red-400',
              ]"
            >
              {{ baseDPRemaining }} DP remaining
            </span>
            <span class="text-xs text-digimon-dark-400">
              Stats: {{ dpUsedOnStats }} | Qualities: {{ dpUsedOnQualities }} | Total: {{ dpUsed }} / {{ totalDP }}
            </span>
          </div>
        </div>

        <div v-show="!isEdit || baseStatsExpanded" class="px-6 pb-6">
          <p v-if="isRangeActive" class="text-xs text-digimon-dark-400 mb-2">
            Per-stat range: {{ statMin }} - {{ statMax }}
          </p>
          <div class="grid grid-cols-5 gap-4">
            <div class="text-center">
              <label class="block text-sm text-digimon-dark-400 mb-2">Accuracy</label>
              <input
                v-model.number="form.baseStats.accuracy"
                type="number"
                :min="statMin"
                :max="statMax"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-sm text-digimon-dark-400 mb-2">Damage</label>
              <input
                v-model.number="form.baseStats.damage"
                type="number"
                :min="statMin"
                :max="statMax"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-sm text-digimon-dark-400 mb-2">Dodge</label>
              <input
                v-model.number="form.baseStats.dodge"
                type="number"
                :min="statMin"
                :max="statMax"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-sm text-digimon-dark-400 mb-2">Armor</label>
              <input
                v-model.number="form.baseStats.armor"
                type="number"
                :min="statMin"
                :max="statMax"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-sm text-digimon-dark-400 mb-2">Health</label>
              <input
                v-model.number="form.baseStats.health"
                type="number"
                :min="statMin"
                :max="statMax"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <!-- Derived Stats Display -->
          <div class="mt-6 pt-4 border-t border-digimon-dark-600">
            <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Derived Stats</h3>

            <!-- Primary Derived Stats + Spec Values -->
            <div class="grid grid-cols-3 md:grid-cols-6 gap-3">
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Brains</div>
                <div class="text-lg font-bold text-cyan-400">{{ derivedStats.brains }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Body</div>
                <div class="text-lg font-bold text-orange-400">{{ derivedStats.body }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Agility</div>
                <div class="text-lg font-bold text-green-400">{{ derivedStats.agility }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">BIT</div>
                <div class="text-lg font-bold text-cyan-400">{{ derivedStats.bit }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">CPU</div>
                <div class="text-lg font-bold text-orange-400">{{ derivedStats.cpu }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">RAM</div>
                <div class="text-lg font-bold text-green-400">{{ derivedStats.ram }}</div>
              </div>
            </div>

            <!-- Combat Stats -->
            <div class="grid grid-cols-3 md:grid-cols-6 gap-3 mt-3">
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Wound Boxes</div>
                <div class="text-lg font-bold text-red-400">{{ derivedStats.woundBoxes }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Movement</div>
                <div class="text-lg font-bold text-blue-400">{{ derivedStats.movement }}m</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Range</div>
                <div class="text-lg font-bold text-cyan-400">{{ derivedStats.range }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Eff. Limit</div>
                <div class="text-lg font-bold text-cyan-400">{{ derivedStats.effectiveLimit }}m</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Stage Bonus</div>
                <div class="text-lg font-bold text-purple-400">+{{ derivedStats.stageBonus }}</div>
              </div>
              <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
                <div class="text-xs text-digimon-dark-400 mb-1">Initiative</div>
                <div class="text-lg font-bold text-yellow-400">3d6 + {{ derivedStats.agility }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Bonus DP (flat in edit, collapsible in create) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <!-- Create: collapsible toggle -->
        <button
          v-if="!isEdit"
          type="button"
          class="w-full flex justify-between items-center p-6 text-left hover:bg-digimon-dark-700/30 transition-colors rounded-xl"
          @click="bonusDPExpanded = !bonusDPExpanded"
        >
          <div class="flex items-center gap-3">
            <span :class="['transition-transform', bonusDPExpanded ? 'rotate-90' : '']">&#9654;</span>
            <h2 class="font-display text-xl font-semibold text-white">Bonus DP</h2>
          </div>
          <div
            :class="[
              'text-sm px-3 py-1 rounded',
              bonusDPAllocated === form.bonusDP
                ? 'bg-green-900/30 text-green-400'
                : bonusDPAllocated > form.bonusDP
                  ? 'bg-red-900/30 text-red-400'
                  : 'bg-yellow-900/30 text-yellow-400',
            ]"
          >
            {{ bonusDPAllocated }} / {{ form.bonusDP }} allocated
          </div>
        </button>
        <!-- Edit: flat header -->
        <div v-else class="flex justify-between items-center p-6 pb-0">
          <h2 class="font-display text-xl font-semibold text-white">Bonus DP</h2>
          <div
            :class="[
              'text-sm px-3 py-1 rounded',
              bonusDPAllocated === form.bonusDP
                ? 'bg-green-900/30 text-green-400'
                : bonusDPAllocated > form.bonusDP
                  ? 'bg-red-900/30 text-red-400'
                  : 'bg-yellow-900/30 text-yellow-400',
            ]"
          >
            {{ bonusDPAllocated }} / {{ form.bonusDP }} allocated
          </div>
        </div>

        <div v-show="isEdit || bonusDPExpanded" class="px-6 pb-6">
          <!-- Sync checkbox for evolution chains -->
          <label
            v-if="form.evolvesFromId || form.evolutionPathIds.length > 0"
            class="flex items-center gap-2 cursor-pointer mb-4"
          >
            <input
              v-model="form.syncBonusDP"
              type="checkbox"
              class="w-4 h-4 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                     text-digimon-orange-500 focus:ring-digimon-orange-500"
            />
            <span class="text-sm text-digimon-dark-300">Sync across evolutions</span>
          </label>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Total Bonus DP</label>
              <input
                v-model.number="form.bonusDP"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              />
              <p class="text-xs text-digimon-dark-500 mt-1">XP earned, GM rewards, etc.</p>
            </div>
            <div>
              <label class="block text-sm text-digimon-dark-400 mb-1">Allocated to Qualities</label>
              <input
                v-model.number="form.bonusDPForQualities"
                type="number"
                :min="minBonusDPForQualities"
                :max="maxBonusDPForQualities"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              />
              <p class="text-xs text-digimon-dark-500 mt-1">
                {{ minBonusDPForQualities > 0 ? `Min ${minBonusDPForQualities} required` : '' }}
                {{ minBonusDPForQualities > 0 && maxBonusDPForQualities < (form.bonusDP || 0) ? ' · ' : '' }}
                {{ maxBonusDPForQualities < (form.bonusDP || 0) ? `Max ${maxBonusDPForQualities} (stats using ${bonusStatsTotal})` : '' }}
              </p>
            </div>
          </div>

          <!-- Bonus Stats Allocation -->
          <div class="border-t border-digimon-dark-600 pt-4">
            <div class="flex justify-between items-center mb-3">
              <h3 :class="['text-sm font-semibold', bonusStatsOverspent ? 'text-red-400' : 'text-digimon-dark-300']">
                Bonus Stats ({{ bonusStatsTotal }} / {{ bonusDPForStats }} DP)
                <span v-if="bonusStatsOverspent" class="text-red-400">⚠️</span>
              </h3>
            </div>
            <div class="grid grid-cols-5 gap-3">
              <div class="text-center">
                <label class="block text-xs text-digimon-dark-400 mb-1">Accuracy</label>
                <input
                  v-model.number="form.bonusStats.accuracy"
                  type="number"
                  :min="minBonusDPPerCategory"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                         text-white text-center focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div class="text-center">
                <label class="block text-xs text-digimon-dark-400 mb-1">Damage</label>
                <input
                  v-model.number="form.bonusStats.damage"
                  type="number"
                  :min="minBonusDPPerCategory"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                         text-white text-center focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div class="text-center">
                <label class="block text-xs text-digimon-dark-400 mb-1">Dodge</label>
                <input
                  v-model.number="form.bonusStats.dodge"
                  type="number"
                  :min="minBonusDPPerCategory"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                         text-white text-center focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div class="text-center">
                <label class="block text-xs text-digimon-dark-400 mb-1">Armor</label>
                <input
                  v-model.number="form.bonusStats.armor"
                  type="number"
                  :min="minBonusDPPerCategory"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                         text-white text-center focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
              <div class="text-center">
                <label class="block text-xs text-digimon-dark-400 mb-1">Health</label>
                <input
                  v-model.number="form.bonusStats.health"
                  type="number"
                  :min="minBonusDPPerCategory"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                         text-white text-center focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
            </div>
            <p v-if="minBonusDPPerCategory > 0" class="text-xs text-digimon-dark-500 mt-2">Min {{ minBonusDPPerCategory }} per stat (EddySoul rule)</p>
          </div>

          <div v-if="form.syncBonusDP && (form.evolvesFromId || form.evolutionPathIds.length > 0)" class="mt-4 p-3 bg-cyan-900/20 border border-cyan-500/30 rounded-lg">
            <p class="text-sm text-cyan-400">
              Bonus DP and stat allocations will sync to all linked evolution forms when you save.
            </p>
          </div>
        </div>
      </div>

      <!-- Attacks -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">
          Attacks ({{ (form.attacks?.length || 0) }} / {{ currentStageConfig.attacks }})
        </h2>

        <!-- Custom attack toggle -->
        <div v-if="(form.attacks?.length || 0) < currentStageConfig.attacks || showCustomAttackForm" class="mb-4">
          <button
            v-if="!showCustomAttackForm"
            type="button"
            class="w-full border-2 border-dashed border-digimon-dark-600 rounded-lg p-4
                   text-digimon-dark-400 hover:border-digimon-dark-500 hover:text-digimon-dark-300
                   transition-colors"
            @click="showCustomAttackForm = true"
          >
            + Create Custom Attack
          </button>

          <!-- Custom attack form -->
          <div v-else class="border border-digimon-dark-600 rounded-lg p-4 bg-digimon-dark-750">
            <div class="flex justify-between items-center mb-3">
              <h3 class="text-sm font-semibold text-digimon-dark-300">
                {{ editingAttackIndex >= 0 ? 'Edit Attack' : 'Create Custom Attack' }}
              </h3>
              <button
                type="button"
                class="text-digimon-dark-400 hover:text-white text-sm"
                @click="showCustomAttackForm = false; editingAttackIndex = -1"
              >
                Cancel
              </button>
            </div>
            <!-- Name -->
            <div>
              <label class="text-xs text-digimon-dark-400">Attack Name</label>
              <input
                v-model="newAttack.name"
                type="text"
                placeholder="Attack name"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none mt-1"
              />
            </div>

            <!-- Range and Type (DDA 1.4 core tags) -->
            <div class="grid grid-cols-2 gap-3 mt-3">
              <div>
                <label class="text-xs text-digimon-dark-400">[Range]</label>
                <select
                  v-model="newAttack.range"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                         text-white text-sm focus:border-digimon-orange-500 focus:outline-none mt-1"
                >
                  <option value="melee">[Melee] - Adjacent</option>
                  <option value="ranged">[Ranged] - {{ derivedStats.ram }}m (RAM)</option>
                </select>
                <p v-if="newAttack.range === 'ranged'" class="text-xs text-blue-400 mt-1">
                  Range: {{ derivedStats.ram }}m (based on RAM stat)
                </p>
                <p v-else class="text-xs text-red-400 mt-1">
                  Range: Adjacent targets only
                </p>
              </div>
              <div>
                <label class="text-xs text-digimon-dark-400">[Type]</label>
                <select
                  v-model="newAttack.type"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                         text-white text-sm focus:border-digimon-orange-500 focus:outline-none mt-1"
                >
                  <option value="damage">[Damage]</option>
                  <option value="support">[Support]</option>
                </select>
                <p class="text-xs text-digimon-dark-500 mt-1">
                  {{ newAttack.type === 'damage' ? 'Deals damage to enemies' : 'Buffs allies or debuffs enemies' }}
                </p>
              </div>
            </div>

            <!-- Quality-based Tags -->
            <div class="mt-3">
              <label class="text-xs text-digimon-dark-400">Tags (from owned qualities)</label>
              <div v-if="availableAttackTags.length === 0" class="text-xs text-digimon-dark-500 mt-1">
                No attack-modifying qualities owned. Add qualities like Weapon, Armor Piercing, Area Attack, etc.
              </div>
              <div v-else class="flex flex-wrap gap-2 mt-1">
                <button
                  v-for="tag in availableAttackTags"
                  :key="tag.id"
                  type="button"
                  :disabled="tag.disabled"
                  :class="[
                    'text-xs px-2 py-1 rounded transition-colors relative group',
                    tag.disabled
                      ? 'bg-digimon-dark-700 text-digimon-dark-500 cursor-not-allowed opacity-50'
                      : newAttack.tags.includes(tag.name)
                        ? 'bg-digimon-orange-500 text-white'
                        : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
                  ]"
                  :title="tag.disabled ? tag.disabledReason : tag.description"
                  @click="!tag.disabled && (newAttack.tags.includes(tag.name) ? removeTagFromAttack(tag.name) : addTagToAttack(tag.name))"
                >
                  {{ tag.name }}
                  <span v-if="tag.rangeRestriction" class="ml-1 text-digimon-dark-500">[{{ tag.rangeRestriction === 'melee' ? 'M' : 'R' }}]</span>
                  <!-- Tooltip for disabled reason -->
                  <span
                    v-if="tag.disabled && tag.disabledReason"
                    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-red-900/90 text-red-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                  >
                    {{ tag.disabledReason }}
                  </span>
                </button>
              </div>
              <div v-if="newAttack.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
                <span class="text-xs text-digimon-dark-400">Selected:</span>
                <span
                  v-for="tag in newAttack.tags"
                  :key="tag"
                  class="text-xs bg-digimon-orange-500/20 text-digimon-orange-400 px-2 py-0.5 rounded flex items-center gap-1"
                >
                  {{ tag }}
                  <button type="button" class="text-red-400 hover:text-red-300" @click="removeTagFromAttack(tag)">&times;</button>
                </span>
              </div>
            </div>

            <!-- Effect (from effect qualities) -->
            <div class="mt-3">
              <label class="text-xs text-digimon-dark-400">Effect (optional)</label>
              <div v-if="availableEffectTags.length === 0" class="text-xs text-digimon-dark-500 mt-1">
                Add effect qualities (Poison, Paralysis, etc.) to enable attack effects.
              </div>
              <div v-else class="flex flex-wrap gap-2 mt-1">
                <button
                  v-for="effect in availableEffectTags"
                  :key="effect.id"
                  type="button"
                  :disabled="effect.disabled"
                  :class="[
                    'text-xs px-2 py-1 rounded transition-colors relative group',
                    effect.disabled
                      ? 'bg-digimon-dark-700 text-digimon-dark-500 cursor-not-allowed opacity-50'
                      : newAttack.effect?.toLowerCase() === effect.name.toLowerCase()
                        ? 'bg-purple-500 text-white'
                        : 'bg-digimon-dark-600 text-digimon-dark-300 hover:bg-digimon-dark-500'
                  ]"
                  :title="effect.disabled ? effect.disabledReason : `${effect.alignment === 'P' ? '[Support only]' : effect.alignment === 'N' ? '[Damage only]' : '[Any type]'}`"
                  @click="!effect.disabled && (newAttack.effect = newAttack.effect?.toLowerCase() === effect.name.toLowerCase() ? '' : effect.name)"
                >
                  {{ effect.name }}
                  <span class="ml-1 text-digimon-dark-500">
                    [{{ effect.alignment === 'P' ? 'S' : effect.alignment === 'N' ? 'D' : '±' }}]
                  </span>
                  <!-- Tooltip for disabled reason -->
                  <span
                    v-if="effect.disabled && effect.disabledReason"
                    class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-red-900/90 text-red-200 text-xs rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10"
                  >
                    {{ effect.disabledReason }}
                  </span>
                </button>
              </div>
              <p class="text-xs text-digimon-dark-500 mt-1">
                [S] = Support only, [D] = Damage only, [±] = Any type
              </p>
            </div>

            <!-- Description -->
            <div class="mt-3">
              <label class="text-xs text-digimon-dark-400">Description (flavor text)</label>
              <textarea
                v-model="newAttack.description"
                rows="2"
                placeholder="Describe the attack's appearance and style..."
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none resize-none mt-1"
              />
            </div>
            <button
              type="button"
              class="mt-3 bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded text-sm"
              @click="addCustomAttack"
            >
              {{ editingAttackIndex >= 0 ? 'Update Attack' : 'Add Custom Attack' }}
            </button>
          </div>
        </div>

        <!-- Attack Selector from Database -->
        <AttackSelector
          :stage="form.stage"
          :max-attacks="currentStageConfig.attacks"
          :current-attacks="form.attacks || []"
          :current-qualities="form.qualities || []"
          :base-stats="form.baseStats"
          :bonus-stats="form.bonusStats"
          :data-optimization="form.dataOptimization"
          :eddy-soul-rules="eddySoulRules"
          :digimon-range="derivedStats.range"
          :effective-limit="derivedStats.effectiveLimit"
          @add="handleAddAttack"
          @remove="removeAttack"
          @edit="editAttack"
        />
      </div>

      <!-- Qualities -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Qualities</h2>
        <QualitySelector
          :stage="form.stage"
          :current-qualities="form.qualities || []"
          :can-add="canAddQualities"
          :available-d-p="availableDPForQualities"
          :speedy-max-ranks="currentSpeedyMaxRanks"
          :system-boost-max-ranks="systemBoostMaxRanks"
          :eddy-soul-rules="eddySoulRules"
          :house-rules="houseRules"
          @add="handleAddQuality"
          @remove="removeQuality"
          @update-ranks="handleUpdateQualityRanks"
        />
      </div>

      <!-- Sprite -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Sprite / Image</h2>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Sprite URL</label>
            <input
              v-model="form.spriteUrl"
              type="url"
              placeholder="https://example.com/digimon-sprite.png"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
            <p class="text-xs text-digimon-dark-500 mt-1">
              Enter a URL to a sprite or image. Common sources: Wikimon, DigimonWiki
            </p>
          </div>
          <div class="flex items-center justify-center">
            <div
              v-if="form.spriteUrl && !spriteError"
              class="w-32 h-32 bg-digimon-dark-700 rounded-lg overflow-hidden flex items-center justify-center"
            >
              <img
                :src="form.spriteUrl"
                :alt="form.name || 'Digimon sprite'"
                class="max-w-full max-h-full object-contain"
                @error="handleSpriteError"
              />
            </div>
            <div
              v-else
              class="w-32 h-32 bg-digimon-dark-700 rounded-lg flex items-center justify-center text-digimon-dark-500"
            >
              <span v-if="spriteError" class="text-red-400 text-xs text-center px-2">Failed to load image</span>
              <span v-else class="text-4xl">?</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Notes -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Notes</h2>
        <textarea
          v-model="form.notes"
          rows="4"
          placeholder="Evolution requirements, special abilities, personality..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                 text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
      </div>

      <!-- Evolution Links -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Evolution Links</h2>
        <p class="text-sm text-digimon-dark-400 mb-4">
          Link this Digimon to its pre-evolution and evolutions. Changes sync automatically.
        </p>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
          <!-- Evolves From -->
          <div>
            <DigimonSelector
              v-model="form.evolvesFromId"
              :stage="getPreviousStages(form.stage)"
              :exclude-ids="loadedDigimon ? [loadedDigimon.id] : []"
              :campaign-id="campaignId"
              :exclude-enemies="!isLibrary"
              label="Evolves From"
              placeholder="Select pre-evolution..."
            />
            <p v-if="getPreviousStages(form.stage).length === 0" class="text-xs text-digimon-dark-500 mt-1">
              No earlier stages available (already at Fresh)
            </p>
          </div>

          <!-- Evolves To -->
          <div>
            <DigimonMultiSelector
              v-model="form.evolutionPathIds"
              :stage="getNextStages(form.stage)"
              :exclude-ids="loadedDigimon ? [loadedDigimon.id] : []"
              :campaign-id="campaignId"
              :exclude-enemies="!isLibrary"
              label="Evolves To"
              placeholder="Select evolutions..."
            />
            <p v-if="getNextStages(form.stage).length === 0" class="text-xs text-digimon-dark-500 mt-1">
              No later stages available (already at Ultra)
            </p>
          </div>
        </div>

        <!-- Edit: full evolution chain -->
        <div v-if="isEdit && evolutionChain" class="mt-6 pt-4 border-t border-digimon-dark-600">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Evolution Chain</h3>
          <div class="flex flex-col items-center">
            <!-- Ancestors -->
            <template v-for="(ancestor, index) in evolutionChain.ancestors" :key="ancestor.id">
              <NuxtLink
                :to="`${digimonLinkBase}/${ancestor.id}`"
                class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
              >
                <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                  <img
                    v-if="ancestor.spriteUrl"
                    :src="ancestor.spriteUrl"
                    :alt="ancestor.name"
                    class="max-w-full max-h-full object-contain"
                  />
                  <span v-else class="text-sm">🦖</span>
                </div>
                <div>
                  <div class="text-white text-sm font-medium">{{ ancestor.name }}</div>
                  <div class="text-xs text-digimon-dark-400 capitalize">{{ ancestor.stage }}</div>
                </div>
              </NuxtLink>
              <div class="w-px h-4 bg-digimon-dark-500"></div>
            </template>

            <!-- Current (highlighted) -->
            <div class="flex items-center gap-2 bg-digimon-orange-500/20 border border-digimon-orange-500 rounded-lg px-3 py-2">
              <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                <img
                  v-if="form.spriteUrl"
                  :src="form.spriteUrl"
                  :alt="form.name"
                  class="max-w-full max-h-full object-contain"
                />
                <span v-else class="text-sm">🦖</span>
              </div>
              <div>
                <div class="text-digimon-orange-400 text-sm font-medium">{{ form.name || 'Current' }}</div>
                <div class="text-xs text-digimon-dark-400 capitalize">{{ form.stage }}</div>
              </div>
            </div>

            <!-- Descendants (tree structure with hierarchy) -->
            <template v-if="evolutionChain.descendantsTree.length > 0">
              <template v-if="evolutionChain.descendantsTree.length === 1">
                <div class="w-px h-4 bg-digimon-dark-500"></div>
                <EvolutionTreeBranch :node="evolutionChain.descendantsTree[0]" :link-base="digimonLinkBase" />
              </template>
              <template v-else>
                <div class="flex flex-col items-center">
                  <div class="w-px h-3 bg-digimon-dark-500"></div>
                  <div class="flex">
                    <div
                      v-for="(node, i) in evolutionChain.descendantsTree"
                      :key="node.digimon.id"
                      class="flex flex-col items-center px-2"
                    >
                      <div class="relative w-full" :style="{ height: (16 + descendantOffset(node)) + 'px' }">
                        <div
                          class="absolute top-0 h-px bg-digimon-dark-500"
                          :class="i === 0 ? 'left-1/2 -right-2' : i === evolutionChain.descendantsTree.length - 1 ? '-left-2 right-1/2' : '-inset-x-2'"
                        ></div>
                        <div class="absolute left-1/2 top-px bottom-0 w-px bg-digimon-dark-500"></div>
                      </div>
                      <EvolutionTreeBranch :node="node" :link-base="digimonLinkBase" />
                    </div>
                  </div>
                </div>
              </template>
            </template>

            <!-- No links message -->
            <span
              v-if="evolutionChain.ancestors.length === 0 && evolutionChain.descendants.length === 0"
              class="text-digimon-dark-500 text-sm"
            >
              No evolution links yet
            </span>
          </div>
        </div>

        <!-- Create: simple evolution preview -->
        <div v-else-if="!isEdit && (linkedEvolvesFrom || linkedEvolvesTo.length > 0)" class="mt-6 pt-4 border-t border-digimon-dark-600">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Evolution Chain Preview</h3>
          <div class="flex flex-col items-center">
            <!-- Evolves From -->
            <template v-if="linkedEvolvesFrom">
              <NuxtLink
                :to="`${digimonLinkBase}/${linkedEvolvesFrom.id}`"
                class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
              >
                <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                  <img
                    v-if="linkedEvolvesFrom.spriteUrl"
                    :src="linkedEvolvesFrom.spriteUrl"
                    :alt="linkedEvolvesFrom.name"
                    class="max-w-full max-h-full object-contain"
                  />
                  <span v-else class="text-sm">🦖</span>
                </div>
                <div>
                  <div class="text-white text-sm font-medium">{{ linkedEvolvesFrom.name }}</div>
                  <div class="text-xs text-digimon-dark-400 capitalize">{{ linkedEvolvesFrom.stage }}</div>
                </div>
              </NuxtLink>
              <div class="w-px h-4 bg-digimon-dark-500"></div>
            </template>

            <!-- Current (New Digimon being created) -->
            <div class="flex items-center gap-2 bg-digimon-orange-500/20 border border-digimon-orange-500 rounded-lg px-3 py-2">
              <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                <img
                  v-if="form.spriteUrl"
                  :src="form.spriteUrl"
                  :alt="form.name"
                  class="max-w-full max-h-full object-contain"
                />
                <span v-else class="text-sm">🦖</span>
              </div>
              <div>
                <div class="text-digimon-orange-400 text-sm font-medium">{{ form.name || 'New Digimon' }}</div>
                <div class="text-xs text-digimon-dark-400 capitalize">{{ form.stage }}</div>
              </div>
            </div>

            <!-- Evolves To -->
            <template v-if="linkedEvolvesTo.length > 0">
              <template v-if="linkedEvolvesTo.length === 1">
                <div class="w-px h-4 bg-digimon-dark-500"></div>
                <NuxtLink
                  :to="`${digimonLinkBase}/${linkedEvolvesTo[0].id}`"
                  class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
                >
                  <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                    <img v-if="linkedEvolvesTo[0].spriteUrl" :src="linkedEvolvesTo[0].spriteUrl" :alt="linkedEvolvesTo[0].name" class="max-w-full max-h-full object-contain" />
                    <span v-else class="text-sm">🦖</span>
                  </div>
                  <div>
                    <div class="text-white text-sm font-medium">{{ linkedEvolvesTo[0].name }}</div>
                    <div class="text-xs text-digimon-dark-400 capitalize">{{ linkedEvolvesTo[0].stage }}</div>
                  </div>
                </NuxtLink>
              </template>
              <template v-else>
                <div class="flex flex-col items-center">
                  <div class="w-px h-3 bg-digimon-dark-500"></div>
                  <div class="flex">
                    <div
                      v-for="(evo, i) in linkedEvolvesTo"
                      :key="evo.id"
                      class="flex flex-col items-center px-2"
                    >
                      <div class="relative w-full" :style="{ height: (16 + linkedEvolvesToOffset(evo)) + 'px' }">
                        <div
                          class="absolute top-0 h-px bg-digimon-dark-500"
                          :class="i === 0 ? 'left-1/2 -right-2' : i === linkedEvolvesTo.length - 1 ? '-left-2 right-1/2' : '-inset-x-2'"
                        ></div>
                        <div class="absolute left-1/2 top-px bottom-0 w-px bg-digimon-dark-500"></div>
                      </div>
                      <NuxtLink
                        :to="`${digimonLinkBase}/${evo.id}`"
                        class="flex items-center gap-2 bg-digimon-dark-700 rounded-lg px-3 py-2 hover:bg-digimon-dark-600 transition-colors"
                      >
                        <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
                          <img v-if="evo.spriteUrl" :src="evo.spriteUrl" :alt="evo.name" class="max-w-full max-h-full object-contain" />
                          <span v-else class="text-sm">🦖</span>
                        </div>
                        <div>
                          <div class="text-white text-sm font-medium">{{ evo.name }}</div>
                          <div class="text-xs text-digimon-dark-400 capitalize">{{ evo.stage }}</div>
                        </div>
                      </NuxtLink>
                    </div>
                  </div>
                </div>
              </template>
            </template>
          </div>
        </div>
      </div>

      <!-- Error message -->
      <div v-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
        {{ error }}
      </div>

      <!-- Submit -->
      <div class="flex gap-4">
        <button
          type="submit"
          :disabled="loading"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
        >
          {{ loading ? (isEdit ? 'Saving...' : 'Creating...') : (isEdit ? 'Save Changes' : 'Create Digimon') }}
        </button>
        <button
          v-if="isLibrary && isEdit"
          type="button"
          :disabled="copying"
          class="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
          @click="handleCopy"
        >
          {{ copying ? 'Copying...' : 'Copy' }}
        </button>
        <NuxtLink
          :to="backLink"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
