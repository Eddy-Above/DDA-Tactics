<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-6">
      <div>
        <NuxtLink :to="`/campaigns/${campaignId}/library`" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Maps</h1>
      </div>
      <div class="flex gap-2 items-center">
        <input ref="importFileInput" type="file" accept=".json" class="hidden" @change="handleImport">
        <button
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          @click="importFileInput?.click()"
        >
          Import
        </button>
        <button
          v-if="maps.length > 0"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          @click="exportMaps(maps)"
        >
          Export All
        </button>
        <NuxtLink
          :to="`/campaigns/${campaignId}/library/maps/new`"
          class="bg-digimon-orange-600 hover:bg-digimon-orange-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
        >
          + New Map
        </NuxtLink>
      </div>
    </div>

    <!-- Import result feedback -->
    <div v-if="importResult" class="mb-4 p-4 rounded-lg" :class="importResult.failed > 0 ? 'bg-red-900/30 border border-red-700' : 'bg-green-900/30 border border-green-700'">
      <p class="text-sm font-semibold" :class="importResult.failed > 0 ? 'text-red-300' : 'text-green-300'">
        Imported {{ importResult.successful }} map{{ importResult.successful !== 1 ? 's' : '' }}<span v-if="importResult.failed > 0">, {{ importResult.failed }} failed</span>
      </p>
      <ul v-if="importResult.errors.length > 0" class="mt-2 space-y-1">
        <li v-for="err in importResult.errors" :key="err.index" class="text-xs text-red-400">
          {{ err.name || `Entry ${err.index}` }}: {{ err.error }}
        </li>
      </ul>
      <button class="mt-2 text-xs text-digimon-dark-400 hover:text-white" @click="importResult = null">Dismiss</button>
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
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
            @click="exportMap(map)"
          >
            ↓ Export
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
import { useLibraryImportExport } from '~/composables/useLibraryImportExport'
import type { GameMap } from '~/types'

definePageMeta({ middleware: ['dm-access'] })

const route = useRoute()
const campaignId = computed(() => route.params.campaignId as string)
const { maps, loading, fetchMaps, createMap, deleteMap } = useMap()
const { exportMap, exportMaps, importMaps } = useLibraryImportExport()

await fetchMaps(campaignId.value)

const deleteTarget = ref<{ id: string; name: string } | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
const importResult = ref<{ successful: number; failed: number; errors: Array<{ index: number; name: string; error: string }> } | null>(null)

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

async function handleImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importResult.value = await importMaps(file, campaignId.value)
  if (importFileInput.value) importFileInput.value.value = ''
  if (importResult.value.successful > 0) {
    await fetchMaps(campaignId.value)
  }
}
</script>
