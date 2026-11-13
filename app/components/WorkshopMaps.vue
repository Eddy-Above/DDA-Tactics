<template>
  <section class="mb-10">
    <div class="flex justify-between items-center mb-6">
      <div>
        <h2 class="font-display text-2xl font-semibold text-white">Maps</h2>
      </div>
      <div class="flex gap-2 items-center">
        <input ref="importFileInput" type="file" accept=".json" class="hidden" @change="handleImport">
        <button
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          :disabled="importing"
          @click="importFileInput?.click()"
        >
          Import
        </button>
        <button
          v-if="visibleMaps.length > 0"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
          @click="exportMaps(visibleMaps)"
        >
          Export All
        </button>
        <NuxtLink
          :to="'/workshop/maps/new'"
          class="bg-digimon-orange-600 hover:bg-digimon-orange-700 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
        >
          + New Map
        </NuxtLink>
      </div>
    </div>

    <p class="text-digimon-dark-400 mb-4">Build and share maps with everyone. Export a map to import it into a campaign library or make your own copy.</p>
    <p v-if="error || actionError" role="alert" class="text-red-400 mb-4">{{ error || actionError }}</p>
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

    <div v-else-if="visibleMaps.length === 0" class="text-center py-16">
      <div class="text-5xl mb-4">🗺</div>
      <p class="text-digimon-dark-400">No maps yet. Create your first map!</p>
    </div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="map in visibleMaps"
        :key="map.id"
        class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700 p-5 hover:border-digimon-dark-500 transition-colors"
      >
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="font-semibold text-white text-lg">{{ map.name }} <span v-if="map.hidden" class="text-xs text-purple-300">Hidden</span></h3>
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
            v-if="canModify(map)"
            :to="`/workshop/maps/${map.id}`"
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
          >
            ✏ Edit
          </NuxtLink>
          <button
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
            @click="toggleHidden(map)"
            v-if="isMine(map)"
          >
            {{ map.hidden ? 'Unhide' : 'Hide' }}
          </button>
          <button
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
            @click="exportMap(map)"
          >
            ↓ Export
          </button>
          <button
            class="bg-red-900/30 hover:bg-red-900/60 text-red-400 px-3 py-1.5 rounded text-sm transition-colors"
            v-if="canModify(map)"
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
  </section>
</template>

<script setup lang="ts">
import { useMap } from '~/composables/useMap'
import { useLibraryImportExport } from '~/composables/useLibraryImportExport'
import type { GameMap } from '~/types'

const props = defineProps<{ onlyMine: boolean }>()
const { user, initialized, fetchMe } = useAuth()
function isMine(map: GameMap) { return !!user.value && map.ownerId === user.value.id }
function canModify(map: GameMap) { return !map.ownerId || isMine(map) }
const visibleMaps = computed(() => props.onlyMine ? maps.value.filter(isMine) : maps.value)

const { maps, loading, error, fetchMaps, updateMap, deleteMap } = useMap()
const { exportMap, exportMaps, importMaps } = useLibraryImportExport()

onMounted(async () => {
  if (!initialized.value) await fetchMe()
  await fetchMaps()
})

const actionError = ref('')
const importing = ref(false)
const deleteTarget = ref<{ id: string; name: string } | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
const importResult = ref<{ successful: number; failed: number; errors: Array<{ index: number; name: string; error: string }> } | null>(null)

function confirmDelete(id: string, name: string) {
  deleteTarget.value = { id, name }
}

async function doDelete() {
  if (!deleteTarget.value) return
  const map = maps.value.find(map => map.id === deleteTarget.value!.id)
  if (!map || !canModify(map)) return
  try { await deleteMap(deleteTarget.value.id); deleteTarget.value = null }
  catch (e: any) { actionError.value = e.message ?? 'Delete failed' }
}

async function toggleHidden(map: GameMap) {
  if (!isMine(map)) return
  try { await updateMap(map.id, { hidden: !map.hidden }) }
  catch (e: any) { actionError.value = e.message ?? 'Visibility update failed' }
}

async function handleImport(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importing.value = true
  try {
    importResult.value = await importMaps(file)
    if (importResult.value.successful > 0) await fetchMaps()
  } catch (e: any) { actionError.value = e.message ?? 'Import failed' }
  finally {
    importing.value = false
    if (importFileInput.value) importFileInput.value.value = ''
  }
}
</script>
