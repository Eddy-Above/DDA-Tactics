<template>
  <div class="flex flex-col" style="height:100vh;overflow:hidden;">
    <!-- Minimal header bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-digimon-dark-900 border-b border-digimon-dark-700 flex-shrink-0">
      <div class="flex items-center gap-3">
        <NuxtLink :to="`/campaigns/${campaignId}/library/maps`" class="text-digimon-dark-400 hover:text-white text-sm">← Maps</NuxtLink>
        <h1 class="text-white font-semibold text-sm">{{ mapData?.name }}</h1>
        <span class="text-digimon-dark-500 text-xs" v-if="mapData">
          {{ mapData.dimensions.width }}×{{ mapData.dimensions.depth }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <span class="text-digimon-dark-400 text-xs">Changes auto-saved</span>
        <NuxtLink :to="`/campaigns/${campaignId}/library/maps`" class="bg-digimon-dark-700 text-white px-3 py-1.5 rounded-lg text-sm">Close</NuxtLink>
      </div>
    </div>

    <!-- Full-screen editor canvas -->
    <div class="flex-1 overflow-hidden">
      <EncounterMap
        v-if="mapData && fakeEncounter"
        :encounter="fakeEncounter as any"
        :is-dm="true"
        :editor-mode="true"
        :my-tamer-id="null"
        :tamer-map="{}"
        :digimon-map="{}"
        :selected-attack="null"
        @encounter-updated="() => {}"
        @positions-updated="() => {}"
      />
      <div v-else class="flex items-center justify-center h-full text-digimon-dark-400">
        Loading map editor...
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMap } from '~/composables/useMap'
import type { GameMap, Vec3, DestructibleState } from '~/types'

definePageMeta({ middleware: ['dm-access'], layout: false })

const route = useRoute()
const campaignId = computed(() => route.params.campaignId as string)
const mapId = computed(() => route.params.mapId as string)

const { fetchMap } = useMap()
const mapData = ref<GameMap | null>(null)

mapData.value = await fetchMap(mapId.value)

// Create a minimal fake encounter so EncounterMap can render the map
const fakeEncounter = computed(() => {
  if (!mapData.value) return null
  return {
    id: 'editor',
    name: 'Map Editor',
    description: '',
    round: 0,
    phase: 'setup',
    participants: [],
    turnOrder: [],
    currentTurnIndex: 0,
    battleLog: [],
    hazards: [],
    mapId: mapData.value.id,
    participantPositions: {} as Record<string, Vec3>,
    destructibleStates: [] as DestructibleState[],
    createdAt: new Date(),
    updatedAt: new Date(),
  }
})

</script>
