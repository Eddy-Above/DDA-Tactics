<script setup lang="ts">
definePageMeta({
  title: 'Tamers',
})

const { tamers, loading, error, fetchTamers, deleteTamer, calculateDerivedStats } = useTamers()

onMounted(() => {
  fetchTamers()
})

async function handleDelete(id: string, name: string) {
  if (confirm(`Are you sure you want to delete ${name}?`)) {
    await deleteTamer(id)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <NuxtLink to="/library" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Back to Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Tamers</h1>
        <p class="text-digimon-dark-400">Manage human characters in your campaign</p>
      </div>
      <NuxtLink
        to="/library/tamers/new"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors"
      >
        + New Tamer
      </NuxtLink>
    </div>

    <div v-if="loading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading tamers...</div>
    </div>

    <div v-else-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else-if="tamers.length === 0" class="text-center py-12">
      <div class="text-6xl mb-4">👤</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Tamers Yet</h2>
      <p class="text-digimon-dark-400 mb-4">Create your first tamer to get started</p>
      <NuxtLink
        to="/library/tamers/new"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors inline-block"
      >
        Create Tamer
      </NuxtLink>
    </div>

    <div v-else class="grid gap-4">
      <div
        v-for="tamer in tamers"
        :key="tamer.id"
        class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
               hover:border-digimon-dark-600 transition-colors"
      >
        <div class="flex justify-between items-start gap-4">
          <!-- Portrait -->
          <div class="w-16 h-16 bg-digimon-dark-700 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
            <img
              v-if="tamer.spriteUrl"
              :src="tamer.spriteUrl"
              :alt="tamer.name"
              class="w-full h-full object-cover"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
            <span v-else class="text-2xl text-digimon-dark-500">👤</span>
          </div>

          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h2 class="font-display text-xl font-semibold text-white">{{ tamer.name }}</h2>
              <span class="text-sm px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-300">
                Age {{ tamer.age }}
              </span>
              <span
                :class="[
                  'text-xs px-2 py-0.5 rounded uppercase font-semibold',
                  tamer.campaignLevel === 'standard' && 'bg-green-900/30 text-green-400',
                  tamer.campaignLevel === 'enhanced' && 'bg-blue-900/30 text-blue-400',
                  tamer.campaignLevel === 'extreme' && 'bg-purple-900/30 text-purple-400',
                ]"
              >
                {{ tamer.campaignLevel }}
              </span>
            </div>

            <div class="grid grid-cols-5 gap-4 mt-4">
              <div
                v-for="(value, attr) in tamer.attributes"
                :key="attr"
                class="text-center"
              >
                <div class="text-xs text-digimon-dark-400 uppercase">{{ attr }}</div>
                <div class="text-lg font-semibold text-white">{{ value }}</div>
              </div>
            </div>

            <div class="flex gap-4 mt-4 text-sm text-digimon-dark-400">
              <span>Wounds: {{ calculateDerivedStats(tamer).woundBoxes }}</span>
              <span>Speed: {{ calculateDerivedStats(tamer).speed }}</span>
              <span>Inspiration: {{ tamer.inspiration }}</span>
            </div>
          </div>

          <div class="flex gap-2">
            <NuxtLink
              :to="`/library/tamers/${tamer.id}`"
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-white rounded transition-colors"
            >
              Edit
            </NuxtLink>
            <button
              class="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50
                     text-red-400 rounded transition-colors"
              @click="handleDelete(tamer.id, tamer.name)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
