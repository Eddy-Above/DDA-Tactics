<script setup lang="ts">
import type { Digimon } from '../../../server/db/schema'
import { useDigimonForm } from '../../../composables/useDigimonForm'

definePageMeta({
  title: 'Edit Digimon',
})

const route = useRoute()
const router = useRouter()
const { digimonList, fetchDigimonById, updateDigimon, copyDigimon, loading, error, getPreviousStages, getNextStages, getEvolutionChain } = useDigimon()
const { tamers, fetchTamers } = useTamers()

onMounted(async () => {
  fetchTamers()
  await loadDigimon()
})

const digimon = ref<Digimon | null>(null)
const initialLoading = ref(true)
const copying = ref(false)

// Evolution preview state
const linkedEvolvesFrom = ref<Digimon | null>(null)
const linkedEvolvesTo = ref<Digimon[]>([])

// Use the extracted form composable - will be initialized once digimon is loaded
const {
  form,
  basicInfoExpanded,
  baseStatsExpanded,
  stages,
  sizes,
  attributes,
  families,
  familyLabels,
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
  minBonusDPForQualities,
  maxBonusDPForQualities,
  derivedStats,
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
} = useDigimonForm()

async function loadDigimon() {
  try {
    const id = route.params.id as string
    const data = await fetchDigimonById(id)
    if (data) {
      digimon.value = data
      // Populate form with loaded data
      Object.assign(form, {
        name: data.name,
        species: data.species,
        stage: data.stage,
        attribute: data.attribute,
        family: data.family,
        type: data.type,
        size: data.size,
        baseStats: data.baseStats,
        bonusStats: data.bonusStats || { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 },
        bonusDP: data.bonusDP || 0,
        bonusDPForQualities: data.bonusDPForQualities || 0,
        attacks: data.attacks || [],
        qualities: data.qualities || [],
        dataOptimization: data.dataOptimization || '',
        partnerId: data.partnerId || null,
        isEnemy: data.isEnemy || false,
        notes: data.notes || '',
        spriteUrl: data.spriteUrl || '',
        evolvesFromId: data.evolvesFromId || null,
        evolutionPathIds: data.evolutionPathIds || [],
        syncBonusDP: data.syncBonusDP ?? true,
      })
    }
  } finally {
    initialLoading.value = false
  }
}

// Sync partnerId and bonus DP from linked evolution when link is added
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

// Also sync from evolutionPathIds
watch(() => form.evolutionPathIds, async (newIds) => {
  if (newIds.length > 0) {
    const fetched: Digimon[] = []
    for (const id of newIds) {
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
  } else {
    linkedEvolvesTo.value = []
  }
}, { deep: true })

async function handleSubmit() {
  if (!digimon.value) return

  const data = {
    name: form.name,
    species: form.species,
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
    partnerId: form.partnerId || undefined,
    isEnemy: form.isEnemy,
    notes: form.notes,
    spriteUrl: form.spriteUrl || undefined,
    evolvesFromId: form.evolvesFromId || undefined,
    evolutionPathIds: form.evolutionPathIds,
    syncBonusDP: form.syncBonusDP,
  }

  await updateDigimon(digimon.value.id, data)
  router.push('/library/digimon')
}

async function handleCopy() {
  if (!digimon.value) return
  copying.value = true
  const newDigimon = await copyDigimon(digimon.value.id)
  if (newDigimon) {
    router.push(`/library/digimon/${newDigimon.id}`)
  }
  copying.value = false
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/library/digimon" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Digimon
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Edit Digimon</h1>
    </div>

    <div v-if="initialLoading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading digimon...</div>
    </div>

    <div v-else-if="!digimon" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">Digimon Not Found</h2>
      <NuxtLink
        to="/library/digimon"
        class="text-digimon-orange-400 hover:text-digimon-orange-300"
      >
        Return to Digimon list
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
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Species</label>
            <input
              v-model="form.species"
              type="text"
              required
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
              <option v-for="size in sizes" :key="size" :value="size" class="capitalize">
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
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
          <div>
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
          <div class="flex items-end">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="form.isEnemy"
                type="checkbox"
                class="w-5 h-5 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                       text-digimon-orange-500 focus:ring-digimon-orange-500"
              />
              <span class="text-white">This is an enemy Digimon</span>
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
          <div>
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
          <div>
            <span class="text-digimon-dark-400">Attacks:</span>
            <span class="text-white ml-1">{{ currentStageConfig.attacks }}</span>
          </div>
        </div>
      </div>

      <!-- Base Stats (Collapsible) -->
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700">
        <button
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

        <div v-show="baseStatsExpanded" class="px-6 pb-6">
        <div class="grid grid-cols-5 gap-4">
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Accuracy</label>
            <input
              v-model.number="form.baseStats.accuracy"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Damage</label>
            <input
              v-model.number="form.baseStats.damage"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Dodge</label>
            <input
              v-model.number="form.baseStats.dodge"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Armor</label>
            <input
              v-model.number="form.baseStats.armor"
              type="number"
              min="1"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2">Health</label>
            <input
              v-model.number="form.baseStats.health"
              type="number"
              min="1"
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
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Wound Boxes</div>
              <div class="text-lg font-bold text-red-400">{{ derivedStats.woundBoxes }}</div>
            </div>
            <div class="bg-digimon-dark-700 rounded-lg p-3 text-center">
              <div class="text-xs text-digimon-dark-400 mb-1">Movement</div>
              <div class="text-lg font-bold text-blue-400">{{ derivedStats.movement }}m</div>
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

      <!-- Bonus DP Section -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
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
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Damage</label>
              <input
                v-model.number="form.bonusStats.damage"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Dodge</label>
              <input
                v-model.number="form.bonusStats.dodge"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Armor</label>
              <input
                v-model.number="form.bonusStats.armor"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="text-center">
              <label class="block text-xs text-digimon-dark-400 mb-1">Health</label>
              <input
                v-model.number="form.bonusStats.health"
                type="number"
                min="0"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                       text-white text-center focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
          </div>
        </div>

        <div v-if="form.syncBonusDP && (form.evolvesFromId || form.evolutionPathIds.length > 0)" class="mt-4 p-3 bg-cyan-900/20 border border-cyan-500/30 rounded-lg">
          <p class="text-sm text-cyan-400">
            Bonus DP and stat allocations will sync to all linked evolution forms when you save.
          </p>
        </div>
      </div>

      <!-- Attacks -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">
          Attacks ({{ form.attacks.length }} / {{ currentStageConfig.attacks }})
        </h2>

        <!-- Custom attack toggle -->
        <div v-if="form.attacks.length < currentStageConfig.attacks || showCustomAttackForm" class="mb-4">
          <button
            v-if="!showCustomAttackForm && form.attacks.length < currentStageConfig.attacks"
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
          :current-attacks="form.attacks"
          :current-qualities="form.qualities"
          :base-stats="form.baseStats"
          :bonus-stats="form.bonusStats"
          :data-optimization="form.dataOptimization"
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
          :current-qualities="form.qualities"
          :can-add="canAddQualities"
          :available-d-p="availableDPForQualities"
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
              :exclude-ids="digimon ? [digimon.id] : []"
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
              :exclude-ids="digimon ? [digimon.id] : []"
              label="Evolves To"
              placeholder="Select evolutions..."
            />
            <p v-if="getNextStages(form.stage).length === 0" class="text-xs text-digimon-dark-500 mt-1">
              No later stages available (already at Ultra)
            </p>
          </div>
        </div>

        <!-- Evolution Chain Preview -->
        <div v-if="digimon && digimonList.length > 0" class="mt-6 pt-4 border-t border-digimon-dark-600">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Evolution Chain</h3>
          <div class="flex items-center gap-2 flex-wrap">
            <!-- Ancestors -->
            <template v-for="(ancestor, index) in getEvolutionChain(digimon, digimonList).ancestors" :key="ancestor.id">
              <NuxtLink
                :to="`/library/digimon/${ancestor.id}`"
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
              <span class="text-digimon-dark-500 self-center">→</span>
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
            <template v-if="getEvolutionChain(digimon, digimonList).descendantsTree.length > 0">
              <span class="text-digimon-dark-500 self-center">→</span>
              <div :class="getEvolutionChain(digimon, digimonList).descendantsTree.length > 1 ? 'flex flex-col gap-2' : ''">
                <EvolutionTreeBranch
                  v-for="node in getEvolutionChain(digimon, digimonList).descendantsTree"
                  :key="node.digimon.id"
                  :node="node"
                  link-base="/library/digimon"
                />
              </div>
            </template>

            <!-- No links message -->
            <span
              v-if="getEvolutionChain(digimon, digimonList).ancestors.length === 0 && getEvolutionChain(digimon, digimonList).descendants.length === 0"
              class="text-digimon-dark-500 text-sm ml-2"
            >
              No evolution links yet
            </span>
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
          {{ loading ? 'Saving...' : 'Save Changes' }}
        </button>
        <button
          type="button"
          :disabled="copying"
          class="bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
          @click="handleCopy"
        >
          {{ copying ? 'Copying...' : 'Copy' }}
        </button>
        <NuxtLink
          to="/library/digimon"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
