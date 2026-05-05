<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-6">
      <div>
        <NuxtLink :to="`/campaigns/${campaignId}/library`" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Maps</h1>
      </div>
      <NuxtLink
        :to="`/campaigns/${campaignId}/library/maps/new`"
        class="bg-digimon-orange-600 hover:bg-digimon-orange-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
      >
        + New Map
      </NuxtLink>
    </div>

    <div v-if="loading" class="text-center py-12 text-digimon-dark-400">Loading maps...</div>

    <div v-else-if="maps.length === 0" class="text-center py-16">
      <div class="text-5xl mb-4">🗺</div>
      <p class="text-digimon-dark-400">No maps yet. Create your first map!</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="map in maps"
        :key="map.id"
        class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700 p-5 hover:border-digimon-dark-500 transition-colors"
      >
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="font-semibold text-white text-lg">{{ map.name }}</h3>
            <p v-if="map.description" class="text-digimon-dark-400 text-sm mt-1">{{ map.description }}</p>
          </div>
          <span class="text-xs text-digimon-dark-500 bg-digimon-dark-700 px-2 py-1 rounded">
            {{ map.dimensions.width }}×{{ map.dimensions.depth }}
          </span>
        </div>

        <div class="text-xs text-digimon-dark-500 mb-4">
          {{ map.groundTiles.length }} ground tiles · {{ map.walls.length }} walls
        </div>

        <div class="flex gap-2 flex-wrap">
          <NuxtLink
            :to="`/campaigns/${campaignId}/library/maps/${map.id}`"
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
          >
            ✏ Edit
          </NuxtLink>
          <button
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
            @click="duplicateMap(map)"
          >
            ⧉ Duplicate
          </button>
          <button
            class="bg-red-900/30 hover:bg-red-900/60 text-red-400 px-3 py-1.5 rounded text-sm transition-colors"
            @click="confirmDelete(map.id, map.name)"
          >
            🗑 Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Delete confirm modal -->
    <Teleport to="body">
      <div v-if="deleteTarget" class="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
        <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-sm border border-red-800">
          <h3 class="text-white font-semibold mb-2">Delete "{{ deleteTarget.name }}"?</h3>
          <p class="text-digimon-dark-400 text-sm mb-4">This cannot be undone.</p>
          <div class="flex gap-3">
            <button class="flex-1 bg-digimon-dark-700 text-white rounded-lg py-2" @click="deleteTarget = null">Cancel</button>
            <button class="flex-1 bg-red-700 hover:bg-red-600 text-white rounded-lg py-2 font-semibold" @click="doDelete">Delete</button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useMap } from '~/composables/useMap'
import type { GameMap } from '~/types'

definePageMeta({ middleware: ['dm-access'] })

const route = useRoute()
const campaignId = computed(() => route.params.campaignId as string)
const { maps, loading, fetchMaps, createMap, deleteMap } = useMap()

await fetchMaps(campaignId.value)

const deleteTarget = ref<{ id: string; name: string } | null>(null)

function confirmDelete(id: string, name: string) {
  deleteTarget.value = { id, name }
}

async function doDelete() {
  if (!deleteTarget.value) return
  await deleteMap(deleteTarget.value.id)
  deleteTarget.value = null
}

async function duplicateMap(map: GameMap) {
  await createMap({
    name: `${map.name} (copy)`,
    description: map.description,
    campaignId: campaignId.value,
    dimensions: map.dimensions,
  })
}
</script>
