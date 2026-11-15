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

    <div v-if="duplicateError" role="alert" class="mb-4 rounded-lg border border-red-700 bg-red-900/30 p-4 text-sm text-red-300">{{ duplicateError }}</div>

    <div v-if="loading || initialLoading" role="status" class="text-center py-12 text-digimon-dark-400">Loading maps...</div>

    <div v-else-if="initialLoadError" role="alert" class="text-red-300 py-8">Maps could not be loaded. Reload this page to try again.</div>

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
        <div class="flex justify-between items-start gap-3 mb-3">
          <div class="flex-1 min-w-0">
            <form v-if="renameTarget?.id === map.id" class="space-y-2" @submit.prevent="saveRename">
              <label :for="`map-name-${map.id}`" class="block text-sm text-digimon-dark-300">Map name</label>
              <input
                :id="`map-name-${map.id}`"
                v-model="renameName"
                v-focus
                type="text"
                required
                maxlength="1000"
                :disabled="renameSaving"
                :aria-describedby="renameError ? `map-name-error-${map.id}` : undefined"
                :aria-invalid="renameError ? true : undefined"
                class="w-full rounded border border-digimon-dark-500 bg-digimon-dark-900 px-3 py-2 text-white"
                @keydown.esc.prevent="cancelRename"
              >
              <p v-if="renameError" :id="`map-name-error-${map.id}`" role="alert" class="text-sm text-red-300">{{ renameError }}</p>
              <div class="flex gap-2">
                <button type="submit" :disabled="renameSaving || !renameName.trim()" class="rounded bg-digimon-orange-600 px-3 py-1.5 text-sm text-white disabled:opacity-50">{{ renameSaving ? 'Saving…' : 'Save' }}</button>
                <button type="button" :disabled="renameSaving" class="rounded bg-digimon-dark-700 px-3 py-1.5 text-sm text-white disabled:opacity-50" @click="cancelRename">Cancel</button>
              </div>
            </form>
            <h3 v-else class="font-semibold text-white text-lg break-words">{{ map.name }}</h3>
            <p v-if="map.description" class="text-digimon-dark-400 text-sm mt-1">{{ map.description }}</p>
          </div>
          <span class="text-xs text-digimon-dark-500 bg-digimon-dark-700 px-2 py-1 rounded">
            {{ mapContentSizeLabel(map) }}
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
            v-if="renameTarget?.id !== map.id"
            type="button"
            :disabled="renameSaving"
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors disabled:opacity-50"
            @click="startRename(map)"
          >Rename</button>
          <button
            class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-digimon-dark-200 px-3 py-1.5 rounded text-sm transition-colors"
            :disabled="duplicatingMapIds.has(map.id)"
            @click="duplicateMap(map)"
          >
            {{ duplicatingMapIds.has(map.id) ? 'Duplicating…' : '⧉ Duplicate' }}
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
import { computed, ref, watch } from 'vue'
import { mapContentSizeLabel } from '~/utils/mapContentBounds'
import { requestErrorMessage } from '~/utils/requestError'
import { useMap } from '~/composables/useMap'
import { useLibraryImportExport } from '~/composables/useLibraryImportExport'
import type { GameMap } from '~/types'

definePageMeta({ middleware: ['dm-access'] })

const route = useRoute()
const campaignId = computed(() => route.params.campaignId as string)
const { maps, loading, fetchMaps, updateMap, duplicateMap: duplicateSavedMap, deleteMap } = useMap()
const { exportMap, exportMaps, importMaps } = useLibraryImportExport()

// Forward the viewer's cookies during SSR and hydrate from that same result.
// A setup-only $fetch ran twice, so a failed unauthenticated SSR request could
// render the empty state while the browser hydrated a populated grid.
const requestFetch = useRequestFetch()
const { data: initialMaps, error: initialLoadError, pending: initialLoading } = await useAsyncData(
  () => `campaign-maps:${campaignId.value}`,
  () => requestFetch<GameMap[]>('/api/maps', { query: { campaignId: campaignId.value } }),
  { lazy: true },
)
watch(initialMaps, value => { maps.value = value ?? [] }, { immediate: true })

const deleteTarget = ref<{ id: string; name: string } | null>(null)
const renameTarget = ref<{ id: string; name: string } | null>(null)
const renameName = ref('')
const renameSaving = ref(false)
const renameError = ref('')
const vFocus = { mounted(input: HTMLInputElement) { input.focus(); input.select() } }
const duplicatingMapIds = ref(new Set<string>())
const duplicateError = ref('')
const importFileInput = ref<HTMLInputElement | null>(null)
const importResult = ref<{ successful: number; failed: number; errors: Array<{ index: number; name: string; error: string }> } | null>(null)

function startRename(map: GameMap) {
  if (renameSaving.value) return
  renameTarget.value = { id: map.id, name: map.name }
  renameName.value = map.name
  renameError.value = ''
}

function cancelRename() {
  if (renameSaving.value) return
  renameTarget.value = null
  renameName.value = ''
  renameError.value = ''
}

async function saveRename() {
  if (!renameTarget.value || renameSaving.value) return
  const name = renameName.value.trim()
  if (!name || name.length > 1000) {
    renameError.value = 'Enter a map name between 1 and 1,000 characters.'
    return
  }
  if (name === renameTarget.value.name) { cancelRename(); return }
  renameSaving.value = true
  renameError.value = ''
  try {
    await updateMap(renameTarget.value.id, { name })
    renameTarget.value = null
    renameName.value = ''
  } catch (error) {
    renameError.value = requestErrorMessage(error, 'Map could not be renamed. Please try again.')
  } finally {
    renameSaving.value = false
  }
}

function confirmDelete(id: string, name: string) {
  deleteTarget.value = { id, name }
}

async function doDelete() {
  if (!deleteTarget.value) return
  await deleteMap(deleteTarget.value.id)
  deleteTarget.value = null
}

async function duplicateMap(map: GameMap) {
  if (duplicatingMapIds.value.has(map.id)) return
  duplicatingMapIds.value.add(map.id)
  duplicateError.value = ''
  try {
    await duplicateSavedMap(map.id)
  } catch (error) {
    duplicateError.value = requestErrorMessage(error, 'Map could not be duplicated. Please try again.')
  } finally {
    duplicatingMapIds.value.delete(map.id)
  }
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
