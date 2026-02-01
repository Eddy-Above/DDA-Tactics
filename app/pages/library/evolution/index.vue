<script setup lang="ts">
import type { EvolutionLine } from '../../../server/db/schema'
import type { EvolutionChainEntry } from '../../../composables/useEvolution'
import type { DigimonStage } from '../../../types'
import { getStageColor } from '../../../utils/displayHelpers'

definePageMeta({
  title: 'Evolution Lines',
})

const {
  evolutionLines,
  loading,
  error,
  fetchEvolutionLines,
  deleteEvolutionLine,
  getCurrentStage,
  canEvolve,
} = useEvolution()

const { tamers, fetchTamers } = useTamers()

onMounted(async () => {
  await Promise.all([fetchEvolutionLines(), fetchTamers()])
})

const tamerMap = computed(() => {
  const map = new Map<string, string>()
  tamers.value.forEach((t) => map.set(t.id, t.name))
  return map
})

async function handleDelete(id: string, name: string) {
  if (confirm(`Are you sure you want to delete "${name}"?`)) {
    await deleteEvolutionLine(id)
  }
}

// Helper to safely get chain as array (handle JSON string if needed)
function getChainArray(chain: any): EvolutionChainEntry[] {
  if (typeof chain === 'string') {
    try {
      return JSON.parse(chain) as EvolutionChainEntry[]
    } catch {
      return []
    }
  }
  return chain as EvolutionChainEntry[] || []
}

// Build tree levels for visualization
function getChainLevels(chain: EvolutionChainEntry[]): EvolutionChainEntry[][] {
  if (chain.length === 0) return []

  const levels: EvolutionChainEntry[][] = []
  const visited = new Set<number>()
  const indexMap = new Map(chain.map((entry, idx) => [idx, entry]))

  // Find roots
  const roots = chain.map((entry, idx) => ({ entry, idx }))
    .filter(({ entry }) => entry.evolvesFromIndex === null)

  if (roots.length === 0) return [chain] // Fallback to flat display

  // BFS to build levels
  let currentLevel = roots.map(({ idx }) => idx)

  while (currentLevel.length > 0) {
    const levelEntries = currentLevel.map(idx => chain[idx])
    levels.push(levelEntries)

    currentLevel.forEach(idx => visited.add(idx))

    // Find children of current level
    const nextLevel: number[] = []
    currentLevel.forEach(parentIdx => {
      chain.forEach((entry, idx) => {
        if (!visited.has(idx) && entry.evolvesFromIndex === parentIdx) {
          nextLevel.push(idx)
        }
      })
    })

    currentLevel = nextLevel
  }

  return levels
}

</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <NuxtLink to="/library" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Back to Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Evolution Lines</h1>
        <p class="text-digimon-dark-400">Manage digivolution chains for your Digimon</p>
      </div>
      <NuxtLink
        to="/library/evolution/new"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors"
      >
        + New Evolution Line
      </NuxtLink>
    </div>

    <div v-if="loading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading evolution lines...</div>
    </div>

    <div v-else-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else-if="evolutionLines.length === 0" class="text-center py-12">
      <div class="text-6xl mb-4">⬆️</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Evolution Lines Yet</h2>
      <p class="text-digimon-dark-400 mb-4">Create your first evolution line to track digivolution</p>
      <NuxtLink
        to="/library/evolution/new"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors inline-block"
      >
        Create Evolution Line
      </NuxtLink>
    </div>

    <div v-else class="grid gap-4">
      <NuxtLink
        v-for="line in evolutionLines"
        :key="line.id"
        :to="`/library/evolution/${line.id}`"
        class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
               hover:border-digimon-orange-500 transition-all group"
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h2 class="font-display text-xl font-semibold text-white group-hover:text-digimon-orange-400 transition-colors">
                {{ line.name }}
              </h2>
              <span v-if="line.partnerId && tamerMap.get(line.partnerId)" class="text-sm text-digimon-dark-400">
                Partner of {{ tamerMap.get(line.partnerId) }}
              </span>
            </div>

            <!-- Evolution chain visualization - horizontal with vertical sibling stacking -->
            <div class="flex items-center gap-2 flex-wrap mb-3">
              <template v-for="(level, levelIndex) in getChainLevels(getChainArray(line.chain))" :key="levelIndex">
                <!-- Entries at this level (stacked vertically) -->
                <div class="flex flex-col gap-1">
                  <div
                    v-for="(entry, entryIndex) in level"
                    :key="`${levelIndex}-${entryIndex}`"
                    :class="[
                      'px-3 py-1 rounded-lg text-sm font-medium border',
                      getChainArray(line.chain).indexOf(entry) === line.currentStageIndex
                        ? 'bg-digimon-orange-500/20 border-digimon-orange-500 text-digimon-orange-400'
                        : getChainArray(line.chain).indexOf(entry) < line.currentStageIndex
                          ? 'bg-green-900/20 border-green-500/30 text-green-400'
                          : 'bg-digimon-dark-700 border-digimon-dark-600 text-digimon-dark-400',
                    ]"
                  >
                    <span :class="getStageColor(entry.stage)">{{ entry.species }}</span>
                  </div>
                </div>
                <!-- Arrow between levels -->
                <span v-if="levelIndex < getChainLevels(getChainArray(line.chain)).length - 1" class="text-digimon-dark-500">
                  →
                </span>
              </template>
            </div>

            <!-- Current stage info -->
            <div class="text-sm text-digimon-dark-400">
              <span>Current: </span>
              <span :class="getStageColor(getCurrentStage(line)?.stage || 'rookie')">
                {{ getCurrentStage(line)?.species || 'Unknown' }}
              </span>
              <span class="mx-2">•</span>
              <span :class="canEvolve(line).canEvolve ? 'text-green-400' : 'text-yellow-400'">
                {{ canEvolve(line).reason }}
              </span>
            </div>

            <!-- Unlock Status -->
            <div class="flex gap-4 mt-2 text-xs text-digimon-dark-400">
              <span>
                Unlocked:
                <span class="text-digimon-orange-400">
                  {{ getChainArray(line.chain).filter((e) => e.isUnlocked).length }}/{{ getChainArray(line.chain).length }}
                </span>
              </span>
            </div>
          </div>

          <button
            class="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50
                   text-red-400 rounded transition-colors opacity-0 group-hover:opacity-100"
            @click.prevent="handleDelete(line.id, line.name)"
          >
            Delete
          </button>
        </div>
      </NuxtLink>
    </div>
  </div>
</template>
