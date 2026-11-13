<template>
  <div class="flex flex-col" style="height:100vh;overflow:hidden;">
    <!-- Minimal header bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-digimon-dark-900 border-b border-digimon-dark-700 flex-shrink-0">
      <div class="flex items-center gap-3">
        <NuxtLink :to="'/workshop'" class="text-digimon-dark-400 hover:text-white text-sm">← Maps</NuxtLink>
        <h1 class="text-white font-semibold text-sm">{{ mapData?.name }}</h1>
        <span class="text-digimon-dark-500 text-xs" v-if="mapData">
          {{ mapData.dimensions.width }}×{{ mapData.dimensions.depth }}
        </span>
      </div>
      <div class="flex items-center gap-2">
        <NuxtLink :to="'/workshop'" class="bg-digimon-dark-700 text-white px-3 py-1.5 rounded-lg text-sm">Close</NuxtLink>
      </div>
    </div>

    <!-- Full-screen editor canvas -->
    <div class="flex-1 min-h-0 min-w-0 overflow-hidden">
      <EncounterMap
        v-if="mapData && fakeEncounter"
        :encounter="fakeEncounter as any"
        :is-dm="true"
        :editor-mode="true"
        :initial-map="mapData"
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

definePageMeta({ layout: false })

const route = useRoute()
const mapId = computed(() => route.params.mapId as string)

const { fetchMap } = useMap()
const mapData = ref<GameMap | null>(null)

mapData.value = await fetchMap(mapId.value)
if (!mapData.value || mapData.value.campaignId) throw createError({ statusCode: 404, message: 'Workshop map not found' })
const { user, fetchMe, initialized } = useAuth()
if (!initialized.value) await fetchMe()
if (mapData.value.ownerId && mapData.value.ownerId !== user.value?.id) throw createError({ statusCode: 403, message: 'You do not own this map. Export it and import a copy to edit.' })

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
