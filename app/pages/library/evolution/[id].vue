<script setup lang="ts">
import type { EvolutionLine, Digimon } from '../../../server/db/schema'
import type { EvolutionChainEntry, EvolutionProgress } from '../../../composables/useEvolution'
import type { DigimonStage } from '../../../types'
import { getStageColor } from '../../../utils/displayHelpers'

definePageMeta({
  title: 'Evolution Line',
})

const route = useRoute()
const router = useRouter()

const {
  fetchEvolutionLine,
  updateEvolutionLine,
  evolve,
  devolve,
  addBattlesWon,
  addXP,
  increaseBond,
  collectItem,
  getCurrentStage,
  getNextStage,
  canEvolve,
  linkDigimonToChainEntry,
  loading,
  error,
} = useEvolution()

const { digimonList, fetchDigimon } = useDigimon()
const { tamers, fetchTamers } = useTamers()

const evolutionLine = ref<EvolutionLine | null>(null)
const initialLoading = ref(true)

const tamerMap = computed(() => {
  const map = new Map<string, string>()
  tamers.value.forEach((t) => map.set(t.id, t.name))
  return map
})

onMounted(async () => {
  await Promise.all([
    fetchTamers(),
    fetchDigimon(),
    (async () => {
      const line = await fetchEvolutionLine(route.params.id as string)
      evolutionLine.value = line
    })(),
  ])
  initialLoading.value = false
})

// Get linked Digimon for a chain entry
function getLinkedDigimon(entry: EvolutionChainEntry): Digimon | null {
  if (!entry.digimonId) return null
  return digimonList.value.find((d) => d.id === entry.digimonId) || null
}

// Handle linking a Digimon to a chain entry
async function handleLinkDigimon(index: number, digimonId: string | null) {
  if (!evolutionLine.value) return
  const updated = await linkDigimonToChainEntry(evolutionLine.value.id, index, digimonId)
  if (updated) {
    evolutionLine.value = updated
  }
}

// Computed values
const chain = computed(() => (evolutionLine.value?.chain as EvolutionChainEntry[]) || [])
const progress = computed(() => (evolutionLine.value?.evolutionProgress as EvolutionProgress) || {
  battlesWon: 0,
  xpEarned: 0,
  bondLevel: 0,
  itemsCollected: [],
})
const currentStage = computed(() => evolutionLine.value ? getCurrentStage(evolutionLine.value) : null)
const nextStage = computed(() => evolutionLine.value ? getNextStage(evolutionLine.value) : null)
const evolutionStatus = computed(() => evolutionLine.value ? canEvolve(evolutionLine.value) : { canEvolve: false, reason: '' })

// Progress update modals
const showProgressModal = ref(false)
const progressType = ref<'battles' | 'xp' | 'bond' | 'item'>('battles')
const progressValue = ref(1)
const itemName = ref('')

async function handleUpdateProgress() {
  if (!evolutionLine.value) return

  let updated: EvolutionLine | null = null

  switch (progressType.value) {
    case 'battles':
      updated = await addBattlesWon(evolutionLine.value.id, progressValue.value)
      break
    case 'xp':
      updated = await addXP(evolutionLine.value.id, progressValue.value)
      break
    case 'bond':
      updated = await increaseBond(evolutionLine.value.id, progressValue.value)
      break
    case 'item':
      if (itemName.value) {
        updated = await collectItem(evolutionLine.value.id, itemName.value)
      }
      break
  }

  if (updated) {
    evolutionLine.value = updated
    showProgressModal.value = false
    progressValue.value = 1
    itemName.value = ''
  }
}

async function handleEvolve() {
  if (!evolutionLine.value || !evolutionStatus.value.canEvolve) return

  if (confirm(`Evolve to ${nextStage.value?.species}?`)) {
    const updated = await evolve(evolutionLine.value.id)
    if (updated) {
      evolutionLine.value = updated
    }
  }
}

async function handleDevolve() {
  if (!evolutionLine.value || evolutionLine.value.currentStageIndex <= 0) return

  if (confirm('Devolve to previous stage?')) {
    const updated = await devolve(evolutionLine.value.id)
    if (updated) {
      evolutionLine.value = updated
    }
  }
}

function getStageBgColor(stage: DigimonStage): string {
  const colors: Record<DigimonStage, string> = {
    fresh: 'bg-digimon-stage-fresh/20',
    'in-training': 'bg-digimon-stage-intraining/20',
    rookie: 'bg-digimon-stage-rookie/20',
    champion: 'bg-digimon-stage-champion/20',
    ultimate: 'bg-digimon-stage-ultimate/20',
    mega: 'bg-digimon-stage-mega/20',
    ultra: 'bg-digimon-stage-ultra/20',
  }
  return colors[stage] || 'bg-gray-500/20'
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div v-if="initialLoading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading evolution line...</div>
    </div>

    <div v-else-if="!evolutionLine" class="text-center py-12">
      <div class="text-6xl mb-4">❌</div>
      <h2 class="text-xl font-semibold text-white mb-2">Evolution Line Not Found</h2>
      <NuxtLink to="/library/evolution" class="text-digimon-orange-400 hover:text-digimon-orange-300">
        Return to Evolution Lines
      </NuxtLink>
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex justify-between items-start mb-8">
        <div>
          <NuxtLink to="/library/evolution" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
            &larr; Back to Evolution Lines
          </NuxtLink>
          <h1 class="font-display text-3xl font-bold text-white">{{ evolutionLine.name }}</h1>
          <p v-if="evolutionLine.partnerId && tamerMap.get(evolutionLine.partnerId)" class="text-digimon-dark-400">
            Partner of {{ tamerMap.get(evolutionLine.partnerId) }}
          </p>
        </div>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <!-- Evolution Chain Visualization -->
        <div class="lg:col-span-2">
          <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
            <h2 class="font-display text-xl font-semibold text-white mb-6">Evolution Chain</h2>

            <div class="space-y-4">
              <div
                v-for="(entry, index) in chain"
                :key="index"
                :class="[
                  'relative rounded-xl p-4 border-2 transition-all',
                  index === evolutionLine.currentStageIndex
                    ? 'border-digimon-orange-500 shadow-lg shadow-digimon-orange-500/20'
                    : index < evolutionLine.currentStageIndex
                      ? 'border-green-500/50 bg-green-900/10'
                      : 'border-digimon-dark-600',
                ]"
              >
                <!-- Connector line -->
                <div
                  v-if="index > 0"
                  class="absolute -top-4 left-8 w-0.5 h-4"
                  :class="index <= evolutionLine.currentStageIndex ? 'bg-green-500' : 'bg-digimon-dark-600'"
                />

                <div class="flex items-center gap-4">
                  <!-- Stage indicator / Linked Digimon sprite -->
                  <div
                    v-if="getLinkedDigimon(entry)?.spriteUrl"
                    class="w-16 h-16 rounded-lg overflow-hidden bg-digimon-dark-600 shrink-0 border-2"
                    :class="[
                      index === evolutionLine.currentStageIndex
                        ? 'border-digimon-orange-500'
                        : index < evolutionLine.currentStageIndex
                          ? 'border-green-500'
                          : 'border-digimon-dark-500',
                    ]"
                  >
                    <img
                      :src="getLinkedDigimon(entry)!.spriteUrl!"
                      :alt="getLinkedDigimon(entry)!.name"
                      class="w-full h-full object-contain"
                    />
                  </div>
                  <div
                    v-else
                    :class="[
                      'w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold shrink-0',
                      index === evolutionLine.currentStageIndex
                        ? 'bg-digimon-orange-500 text-white'
                        : index < evolutionLine.currentStageIndex
                          ? 'bg-green-500 text-white'
                          : getStageBgColor(entry.stage) + ' ' + getStageColor(entry.stage),
                    ]"
                  >
                    {{ index < evolutionLine.currentStageIndex ? '✓' : index + 1 }}
                  </div>

                  <!-- Stage info -->
                  <div class="flex-1">
                    <div class="flex items-center gap-3 flex-wrap">
                      <h3 class="text-xl font-semibold text-white">{{ entry.species }}</h3>
                      <span :class="['text-sm capitalize', getStageColor(entry.stage)]">
                        {{ entry.stage }}
                      </span>
                      <span v-if="index === evolutionLine.currentStageIndex" class="text-xs bg-digimon-orange-500 text-white px-2 py-0.5 rounded">
                        Current
                      </span>
                    </div>

                    <!-- Linked Digimon info -->
                    <div v-if="getLinkedDigimon(entry)" class="mt-2 flex items-center gap-2">
                      <span class="text-sm text-cyan-400">Linked:</span>
                      <NuxtLink
                        :to="`/library/digimon/${entry.digimonId}`"
                        class="text-sm text-white hover:text-digimon-orange-400 underline"
                      >
                        {{ getLinkedDigimon(entry)!.name }}
                      </NuxtLink>
                      <button
                        type="button"
                        class="text-xs text-red-400 hover:text-red-300"
                        @click="handleLinkDigimon(index, null)"
                      >
                        (unlink)
                      </button>
                    </div>
                    <div v-else class="mt-2">
                      <DigimonSelector
                        :model-value="null"
                        :stage="entry.stage"
                        placeholder="Link Digimon sheet..."
                        @update:model-value="handleLinkDigimon(index, $event)"
                      />
                    </div>

                    <!-- Requirements for next evolution -->
                    <div v-if="entry.requirements && index > evolutionLine.currentStageIndex" class="mt-2">
                      <div class="text-sm text-digimon-dark-400">
                        <span class="text-yellow-400">Requirements:</span>
                        {{ entry.requirements.description }}
                      </div>

                      <!-- Progress bar for requirements -->
                      <div v-if="entry.requirements.type !== 'special' && entry.requirements.type !== 'item' && index === evolutionLine.currentStageIndex + 1" class="mt-2">
                        <div class="h-2 bg-digimon-dark-600 rounded-full overflow-hidden">
                          <div
                            class="h-full bg-digimon-orange-500 transition-all"
                            :style="{
                              width: `${Math.min(100, (
                                entry.requirements.type === 'battles' ? progress.battlesWon :
                                entry.requirements.type === 'xp' ? progress.xpEarned :
                                entry.requirements.type === 'bond' ? progress.bondLevel : 0
                              ) / (entry.requirements.value || 1) * 100)}%`
                            }"
                          />
                        </div>
                        <div class="text-xs text-digimon-dark-400 mt-1">
                          {{
                            entry.requirements.type === 'battles' ? progress.battlesWon :
                            entry.requirements.type === 'xp' ? progress.xpEarned :
                            entry.requirements.type === 'bond' ? progress.bondLevel : 0
                          }} / {{ entry.requirements.value }}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Sidebar -->
        <div class="space-y-4">
          <!-- Current Status -->
          <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
            <h3 class="font-display text-lg font-semibold text-white mb-4">Current Status</h3>

            <div class="space-y-4">
              <div>
                <div class="text-sm text-digimon-dark-400">Current Form</div>
                <div :class="['text-xl font-semibold', getStageColor(currentStage?.stage || 'rookie')]">
                  {{ currentStage?.species || 'Unknown' }}
                </div>
              </div>

              <div v-if="nextStage">
                <div class="text-sm text-digimon-dark-400">Next Evolution</div>
                <div :class="['text-lg', getStageColor(nextStage.stage)]">
                  {{ nextStage.species }}
                </div>
                <div :class="['text-sm mt-1', evolutionStatus.canEvolve ? 'text-green-400' : 'text-yellow-400']">
                  {{ evolutionStatus.reason }}
                </div>
              </div>
              <div v-else class="text-green-400 text-sm">
                Maximum evolution reached!
              </div>

              <!-- Evolution buttons -->
              <div class="flex gap-2 pt-2">
                <button
                  :disabled="!evolutionStatus.canEvolve || loading"
                  class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                         text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                  @click="handleEvolve"
                >
                  ⬆️ Evolve
                </button>
                <button
                  :disabled="evolutionLine.currentStageIndex <= 0 || loading"
                  class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50
                         text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                  @click="handleDevolve"
                >
                  ⬇️ Devolve
                </button>
              </div>
            </div>
          </div>

          <!-- Progress Tracker -->
          <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
            <h3 class="font-display text-lg font-semibold text-white mb-4">Progress</h3>

            <div class="space-y-3">
              <div class="flex justify-between items-center">
                <span class="text-digimon-dark-400">Battles Won</span>
                <span class="text-white font-semibold">{{ progress.battlesWon }}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-digimon-dark-400">XP Earned</span>
                <span class="text-white font-semibold">{{ progress.xpEarned }}</span>
              </div>
              <div class="flex justify-between items-center">
                <span class="text-digimon-dark-400">Bond Level</span>
                <span class="text-white font-semibold">{{ progress.bondLevel }}</span>
              </div>
              <div v-if="progress.itemsCollected.length > 0">
                <span class="text-digimon-dark-400 text-sm">Items Collected:</span>
                <div class="flex flex-wrap gap-1 mt-1">
                  <span
                    v-for="item in progress.itemsCollected"
                    :key="item"
                    class="text-xs bg-digimon-dark-700 text-white px-2 py-0.5 rounded"
                  >
                    {{ item }}
                  </span>
                </div>
              </div>

              <button
                class="w-full mt-2 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2
                       rounded-lg font-semibold transition-colors"
                @click="showProgressModal = true"
              >
                + Add Progress
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Progress Modal -->
      <Teleport to="body">
        <div
          v-if="showProgressModal"
          class="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
          @click.self="showProgressModal = false"
        >
          <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border border-digimon-dark-700">
            <h2 class="font-display text-xl font-semibold text-white mb-4">Add Progress</h2>

            <div class="space-y-4">
              <div>
                <label class="block text-sm text-digimon-dark-400 mb-2">Progress Type</label>
                <div class="grid grid-cols-2 gap-2">
                  <button
                    v-for="type in (['battles', 'xp', 'bond', 'item'] as const)"
                    :key="type"
                    :class="[
                      'px-3 py-2 rounded-lg font-medium transition-colors capitalize',
                      progressType === type
                        ? 'bg-digimon-orange-500 text-white'
                        : 'bg-digimon-dark-700 text-digimon-dark-400 hover:text-white',
                    ]"
                    @click="progressType = type"
                  >
                    {{ type }}
                  </button>
                </div>
              </div>

              <div v-if="progressType !== 'item'">
                <label class="block text-sm text-digimon-dark-400 mb-1">Amount</label>
                <input
                  v-model.number="progressValue"
                  type="number"
                  min="1"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>

              <div v-else>
                <label class="block text-sm text-digimon-dark-400 mb-1">Item Name</label>
                <input
                  v-model="itemName"
                  type="text"
                  placeholder="e.g., Crest of Courage"
                  class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                         text-white focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div class="flex gap-3 mt-6">
              <button
                :disabled="loading || (progressType === 'item' && !itemName)"
                class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                       text-white px-4 py-2 rounded-lg font-semibold transition-colors"
                @click="handleUpdateProgress"
              >
                {{ loading ? 'Adding...' : 'Add' }}
              </button>
              <button
                class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2
                       rounded-lg font-semibold transition-colors"
                @click="showProgressModal = false"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      </Teleport>
    </template>
  </div>
</template>
