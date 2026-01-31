<script setup lang="ts">
definePageMeta({
  layout: 'player',
  title: 'Player View',
})

const { tamers, fetchTamers } = useTamers()
const selectedTamerId = useCookie<string | null>('player-tamer-id', { default: () => null })

const loading = ref(true)

onMounted(async () => {
  await fetchTamers()
  loading.value = false
})

function selectTamer(tamerId: string) {
  selectedTamerId.value = tamerId
}

function clearSelection() {
  selectedTamerId.value = null
}
</script>

<template>
  <div class="min-h-screen bg-digimon-dark-900 flex items-center justify-center p-4">
    <div v-if="loading" class="text-center">
      <div class="text-digimon-dark-400">Loading...</div>
    </div>

    <!-- If already selected a tamer, redirect to their view -->
    <div v-else-if="selectedTamerId" class="w-full max-w-md">
      <NuxtLink
        :to="`/player/${selectedTamerId}`"
        class="block bg-digimon-dark-800 rounded-xl p-8 border border-digimon-dark-700 text-center
               hover:border-digimon-orange-500 transition-colors"
      >
        <div class="text-4xl mb-4">🎮</div>
        <h2 class="font-display text-xl font-semibold text-white mb-2">Continue as Player</h2>
        <p class="text-digimon-dark-400 text-sm">Click to open your player dashboard</p>
      </NuxtLink>
      <button
        class="mt-4 w-full text-digimon-dark-400 hover:text-white text-sm"
        @click="clearSelection"
      >
        Switch Character
      </button>
    </div>

    <!-- Tamer selection -->
    <div v-else class="w-full max-w-lg">
      <div class="text-center mb-8">
        <h1 class="font-display text-3xl font-bold text-white mb-2">Player View</h1>
        <p class="text-digimon-dark-400">Select your character to continue</p>
      </div>

      <div v-if="tamers.length === 0" class="text-center py-8">
        <div class="text-6xl mb-4">👤</div>
        <h2 class="text-xl font-semibold text-white mb-2">No Characters Available</h2>
        <p class="text-digimon-dark-400 mb-6">Create your Tamer to get started</p>
        <NuxtLink
          to="/player/new"
          class="inline-block bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          Create Your Character
        </NuxtLink>
      </div>

      <div v-else class="grid gap-4">
        <button
          v-for="tamer in tamers"
          :key="tamer.id"
          class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
                 hover:border-digimon-orange-500 transition-all text-left group"
          @click="selectTamer(tamer.id)"
        >
          <div class="flex items-center gap-4">
            <div class="w-16 h-16 bg-digimon-dark-700 rounded-full overflow-hidden flex items-center justify-center">
              <img
                v-if="tamer.spriteUrl"
                :src="tamer.spriteUrl"
                :alt="tamer.name"
                class="w-full h-full object-cover"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <span v-else class="text-3xl text-digimon-dark-500">👤</span>
            </div>
            <div>
              <h2 class="font-display text-xl font-semibold text-white group-hover:text-digimon-orange-400 transition-colors">
                {{ tamer.name }}
              </h2>
              <p class="text-digimon-dark-400 text-sm">
                Age {{ tamer.age }} • {{ tamer.campaignLevel }} campaign
              </p>
            </div>
          </div>
        </button>

        <div class="text-center mt-2">
          <NuxtLink to="/player/new" class="text-digimon-orange-400 hover:text-digimon-orange-300 text-sm">
            + Create New Character
          </NuxtLink>
        </div>
      </div>
    </div>
  </div>
</template>
