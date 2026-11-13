<template>
  <section class="mb-10">
    <div class="flex justify-between items-center mb-4">
      <div>
        <h2 class="font-display text-2xl font-semibold text-white">Maps</h2>
      </div>
      <div class="flex gap-2 items-center">
        <input ref="importFileInput" type="file" accept=".json" class="hidden" @change="handleImport">
        <button
          v-if="visibleMaps.length > 0"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-3 py-1 rounded text-sm transition-colors"
          @click="exportMaps(visibleMaps)"
        >
          Export All
        </button>

      </div>
    </div>

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

    <div v-if="visibleMaps.length === 0" class="bg-digimon-dark-800/50 border border-digimon-dark-700 rounded-xl p-8 text-center">
      <div class="text-4xl mb-2">&#128506;</div>
      <p class="text-digimon-dark-400">
        {{ onlyMine ? "You don't own any workshop maps yet." : 'No workshop maps yet - create one to start building.' }}
      </p>
    </div>
    <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div v-for="map in visibleMaps" :key="map.id" class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700 hover:border-digimon-dark-600 transition-colors">
        <div class="flex justify-between items-start gap-4">
          <div class="w-14 h-14 bg-digimon-dark-700 rounded-lg flex-shrink-0 flex items-center justify-center">
            <span aria-hidden="true" class="text-2xl text-digimon-dark-500">&#128506;</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <h3 class="font-display text-lg font-semibold text-white truncate">{{ map.name }}</h3>
              <span v-if="map.hidden" title="Only you can see this map" class="text-xs px-1.5 py-0.5 rounded bg-purple-900/40 border border-purple-500/50 text-purple-300">Hidden</span>
            </div>
            <p v-if="map.description" class="text-sm text-digimon-dark-400 break-words">{{ map.description }}</p>
            <p class="text-xs text-digimon-dark-500">{{ mapContentSizeLabel(map) }}</p>
            <p class="text-xs text-digimon-dark-500">{{ map.groundTiles.length }} ground tiles &middot; {{ map.walls.length }} walls</p>
          </div>
          <div class="flex flex-col gap-1.5 items-stretch">
            <NuxtLink v-if="canModify(map)" :to="`/workshop/maps/${map.id}`" class="px-3 py-1 text-sm text-center bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white rounded transition-colors">Edit</NuxtLink>
            <span v-else title="Owned by another account - you can't edit this map" class="px-3 py-1 text-sm text-center bg-digimon-dark-800 text-digimon-dark-500 rounded cursor-not-allowed">Edit</span>
            <button class="px-3 py-1 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white rounded transition-colors" @click="exportMap(map)">Export</button>
            <button v-if="isMine(map)" :title="map.hidden ? 'Make visible to everyone' : 'Hide from other users'" class="px-3 py-1 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white rounded transition-colors" @click="toggleHidden(map)">{{ map.hidden ? 'Unhide' : 'Hide' }}</button>
            <button :disabled="!canModify(map)" :title="!canModify(map) ? 'Owned by another account' : ''" class="px-3 py-1 text-sm bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-red-900/30 text-red-400 rounded transition-colors" @click="confirmDelete(map.id, map.name)">Delete</button>
          </div>
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
import { mapContentSizeLabel } from '~/utils/mapContentBounds'
import type { useMap } from '~/composables/useMap'
import { useLibraryImportExport } from '~/composables/useLibraryImportExport'
import type { GameMap } from '~/types'

const props = defineProps<{ onlyMine: boolean; store: ReturnType<typeof useMap> }>()
const { user } = useAuth()
function isMine(map: GameMap) { return !!user.value && map.ownerId === user.value.id }
function canModify(map: GameMap) { return !map.ownerId || isMine(map) }
const visibleMaps = computed(() => props.onlyMine ? maps.value.filter(isMine) : maps.value)

const { maps, error, fetchMaps, updateMap, deleteMap } = props.store
const { exportMap, exportMaps, importMaps } = useLibraryImportExport()

const actionError = ref('')
const importing = ref(false)
const deleteTarget = ref<{ id: string; name: string } | null>(null)
const importFileInput = ref<HTMLInputElement | null>(null)
defineExpose({ openImport: () => { if (!importing.value) importFileInput.value?.click() } })

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
