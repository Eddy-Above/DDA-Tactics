<script setup lang="ts">
import type { DigimonStage } from '../../../types'
import { getStageColor } from '../../../utils/displayHelpers'
import type { EvolutionChainEntry } from '../../../composables/useEvolution'
import type { Digimon } from '../../../server/db/schema'

definePageMeta({
  title: 'New Evolution Line',
})

const router = useRouter()
const { createEvolutionLine, loading, error } = useEvolution()
const { tamers, fetchTamers } = useTamers()
const { digimonList, fetchDigimon } = useDigimon()

onMounted(async () => {
  await Promise.all([fetchTamers(), fetchDigimon()])
})

const form = reactive({
  name: '',
  description: '',
  partnerId: '',
  chain: [] as EvolutionChainEntry[],
})

const selectedBaseDigimon = ref<Digimon | null>(null)

// Get available partner Digimon that can be bases (have no prevolution or are the root)
const baseDigimonOptions = computed(() => {
  // Show Digimon that either:
  // 1. Don't have an evolvesFromId (root of evolution line)
  // 2. Or can start an evolution line (have evolutionPathIds)
  return digimonList.value.filter((d) => {
    const hasEvolutionPaths = d.evolutionPathIds && d.evolutionPathIds.length > 0
    const canBeLast = d.evolutionPathIds?.length === 0
    return d.partnerId || (hasEvolutionPaths || canBeLast)
  })
})

// Build evolution chain from selected base Digimon
function buildEvolutionChain(baseDigimon: Digimon): EvolutionChainEntry[] {
  const chain: EvolutionChainEntry[] = []

  // Walk backward to find the root
  let current = baseDigimon
  const visited = new Set<string>()

  // First, go back to the root
  while (current.evolvesFromId && !visited.has(current.id)) {
    visited.add(current.id)
    const parent = digimonList.value.find((d) => d.id === current.evolvesFromId)
    if (!parent) break
    current = parent
  }

  // Now walk forward from root, building tree structure
  buildForwardChain(current, chain, new Set<string>(), null)

  return chain
}

// Recursively build chain going forward - includes ALL branches with parent tracking
function buildForwardChain(
  digimon: Digimon,
  chain: EvolutionChainEntry[],
  visited: Set<string>,
  parentIndex: number | null
) {
  if (visited.has(digimon.id)) return

  visited.add(digimon.id)

  // Add this digimon to chain
  const currentIndex = chain.length
  chain.push({
    stage: digimon.stage as DigimonStage,
    species: digimon.species,
    digimonId: digimon.id,
    isUnlocked: parentIndex === null, // Root is unlocked, rest locked
    evolvesFromIndex: parentIndex,
  })

  // Get all evolution paths
  const evolutions = digimon.evolutionPathIds || []

  // Recursively add ALL evolution paths (entire tree)
  evolutions.forEach((evolutionId) => {
    const nextDigimon = digimonList.value.find((d) => d.id === evolutionId)
    if (nextDigimon) {
      buildForwardChain(nextDigimon, chain, visited, currentIndex)
    }
  })
}

function selectBaseDigimon(digimon: Digimon) {
  selectedBaseDigimon.value = digimon

  // Build the chain (includes entire tree with all branches)
  const chain = buildEvolutionChain(digimon)
  form.chain = chain

  // Auto-fill name
  if (!form.name) {
    form.name = `${digimon.species} Line`
  }

  // Auto-fill partner if the Digimon has one
  if (digimon.partnerId && !form.partnerId) {
    form.partnerId = digimon.partnerId
  }
}

function resetChain() {
  selectedBaseDigimon.value = null
  form.chain = []
}

async function handleSubmit() {
  if (!form.name.trim() || form.chain.length === 0) {
    return
  }

  const created = await createEvolutionLine({
    name: form.name,
    description: form.description,
    chain: form.chain,
    partnerId: form.partnerId || undefined,
  })

  if (created) {
    router.push('/library/evolution')
  }
}

// Get linked Digimon for chain entry display
function getLinkedDigimon(digimonId: string): Digimon | null {
  return digimonList.value.find((d) => d.id === digimonId) || null
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/library/evolution" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Evolution Lines
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">New Evolution Line</h1>
      <p class="text-digimon-dark-400">Auto-detect evolution chains from your Digimon library</p>
    </div>

    <form class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Basic Information</h2>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Line Name</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g., Agumon Line"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Partner Tamer (Optional)</label>
            <select
              v-model="form.partnerId"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            >
              <option value="">No Partner</option>
              <option v-for="tamer in tamers" :key="tamer.id" :value="tamer.id">
                {{ tamer.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="mt-4">
          <label class="block text-sm text-digimon-dark-400 mb-1">Description (Optional)</label>
          <textarea
            v-model="form.description"
            rows="2"
            placeholder="Notes about this evolution line..."
            class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                   text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
          />
        </div>
      </div>

      <!-- Select Base Digimon -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Select Base Digimon</h2>
        <p class="text-digimon-dark-400 text-sm mb-4">
          Choose a Digimon from your library to auto-detect its evolution chain.
        </p>

        <div v-if="selectedBaseDigimon" class="mb-4 bg-digimon-dark-700 rounded-lg p-4 flex items-center gap-4">
          <div v-if="selectedBaseDigimon.spriteUrl" class="w-16 h-16 rounded-lg overflow-hidden bg-digimon-dark-600 shrink-0">
            <img
              :src="selectedBaseDigimon.spriteUrl"
              :alt="selectedBaseDigimon.name"
              class="w-full h-full object-contain"
            />
          </div>
          <div>
            <h3 class="text-white font-semibold">{{ selectedBaseDigimon.name }}</h3>
            <p class="text-digimon-dark-400 text-sm">{{ selectedBaseDigimon.species }} ({{ selectedBaseDigimon.stage }})</p>
          </div>
          <button
            type="button"
            class="ml-auto text-digimon-orange-400 hover:text-digimon-orange-300 text-sm"
            @click="resetChain"
          >
            Change
          </button>
        </div>

        <div v-if="!selectedBaseDigimon" class="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-96 overflow-y-auto">
          <button
            v-for="digimon in baseDigimonOptions"
            :key="digimon.id"
            type="button"
            class="text-left p-3 bg-digimon-dark-700 hover:bg-digimon-dark-600 rounded-lg transition-colors"
            @click="selectBaseDigimon(digimon)"
          >
            <div class="flex items-center gap-2">
              <span v-if="digimon.spriteUrl" class="w-8 h-8 bg-digimon-dark-600 rounded flex items-center justify-center shrink-0">
                <img :src="digimon.spriteUrl" :alt="digimon.name" class="max-w-full max-h-full object-contain" />
              </span>
              <div>
                <div class="text-white text-sm font-semibold">{{ digimon.name }}</div>
                <div class="text-digimon-dark-400 text-xs">{{ digimon.species }}</div>
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Evolution Chain Preview -->
      <div v-if="form.chain.length > 0" class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Evolution Chain Preview</h2>

        <div class="space-y-3">
          <div
            v-for="(entry, index) in form.chain"
            :key="index"
            class="bg-digimon-dark-700 rounded-lg p-4 flex items-center gap-4"
          >
            <div v-if="getLinkedDigimon(entry.digimonId)?.spriteUrl" class="w-12 h-12 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
              <img
                :src="getLinkedDigimon(entry.digimonId)!.spriteUrl!"
                :alt="entry.species"
                class="max-w-full max-h-full object-contain"
              />
            </div>

            <div class="flex-1">
              <div class="flex items-center gap-3">
                <span class="text-2xl font-semibold">{{ index + 1 }}.</span>
                <span :class="['font-semibold capitalize', getStageColor(entry.stage)]">
                  {{ entry.stage }}
                </span>
                <span class="text-white">{{ entry.species }}</span>
                <span v-if="index === 0" class="text-xs bg-digimon-orange-500 text-white px-2 py-0.5 rounded">
                  Unlocked
                </span>
                <span v-else class="text-xs bg-digimon-dark-600 text-digimon-dark-400 px-2 py-0.5 rounded">
                  Locked
                </span>
              </div>
            </div>

            <span v-if="index < form.chain.length - 1" class="text-digimon-dark-500 text-2xl">→</span>
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
          :disabled="loading || form.chain.length === 0"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
        >
          {{ loading ? 'Creating...' : 'Create Evolution Line' }}
        </button>
        <NuxtLink
          to="/library/evolution"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
