<script setup lang="ts">
definePageMeta({
  title: 'Encounters',
  middleware: ['campaign-access', 'dm-access'],
})

const { campaignId } = useCampaignContext()
const { encounters, loading, error, fetchEncounters, createEncounter, duplicateEncounter, updateEncounter, deleteEncounter } = useEncounters()

const showNewModal = ref(false)
const newEncounterName = ref('')
const newEncounterDescription = ref('')
const newDayLoading = ref(false)
const duplicateSource = ref<{ id: string; name: string } | null>(null)
const duplicating = ref(false)
const togglingVisibilityId = ref<string | null>(null)

onMounted(() => {
  fetchEncounters(campaignId.value)
})

async function handleNewDay() {
  if (!confirm('Start a new day? This will reset daily abilities for all tamers.')) return
  newDayLoading.value = true
  try {
    const result = await $fetch<{ message: string; tamersReset: number; healedAllWounds: boolean }>(`/api/campaigns/${campaignId.value}/new-day`, { method: 'POST' })
    const healed = result.healedAllWounds ? ' All wounds healed.' : ''
    alert(`${result.message} (${result.tamersReset} tamer(s) reset)${healed}`)
  } catch (e: any) {
    alert(e?.data?.message || 'Failed to start new day')
  } finally {
    newDayLoading.value = false
  }
}

async function handleCreate() {
  if (!newEncounterName.value.trim()) return
  const created = await createEncounter(newEncounterName.value, newEncounterDescription.value, campaignId.value)
  if (created) {
    showNewModal.value = false
    newEncounterName.value = ''
    newEncounterDescription.value = ''
  }
}

async function handleDelete(id: string, name: string) {
  if (confirm(`Are you sure you want to delete "${name}"?`)) {
    await deleteEncounter(id)
  }
}

async function handleDuplicate(mode: 'fresh' | 'snapshot', name: string) {
  if (!duplicateSource.value || duplicating.value) return
  duplicating.value = true
  try {
    const copy = await duplicateEncounter(duplicateSource.value.id, { mode, name })
    duplicateSource.value = null
    if (copy) await navigateTo(`/campaigns/${campaignId.value}/encounters/${copy.id}`)
  } finally {
    duplicating.value = false
  }
}

// Players see nothing of an encounter until this is on — it's what lets a GM stage the
// next fight while the current one is still running.
async function toggleVisibility(id: string, current: boolean) {
  if (togglingVisibilityId.value) return
  togglingVisibilityId.value = id
  try {
    await updateEncounter(id, { visibleToPlayers: !current } as any)
  } finally {
    togglingVisibilityId.value = null
  }
}

function getPhaseColor(phase: string) {
  const colors: Record<string, string> = {
    setup: 'bg-blue-900/30 text-blue-400',
    combat: 'bg-red-900/30 text-red-400',
    ended: 'bg-gray-900/30 text-gray-400',
  }
  return colors[phase] || 'bg-gray-900/30 text-gray-400'
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <h1 class="font-display text-3xl font-bold text-white">Encounters</h1>
        <p class="text-digimon-dark-400">Manage combat encounters for your sessions</p>
      </div>
      <div class="flex gap-2">
        <button
          :disabled="newDayLoading"
          :class="[
            'px-4 py-2 rounded-lg font-semibold transition-colors',
            newDayLoading ? 'bg-digimon-dark-600 text-digimon-dark-400 cursor-not-allowed' : 'bg-blue-700 hover:bg-blue-600 text-white'
          ]"
          @click="handleNewDay"
        >
          {{ newDayLoading ? 'Resetting...' : 'New Day' }}
        </button>
        <button
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
                 font-semibold transition-colors"
          @click="showNewModal = true"
        >
          + New Encounter
        </button>
      </div>
    </div>

    <div v-if="loading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading encounters...</div>
    </div>

    <div v-else-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else-if="encounters.length === 0" class="text-center py-12">
      <div class="text-6xl mb-4">⚔️</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Encounters Yet</h2>
      <p class="text-digimon-dark-400 mb-4">Create your first encounter to start tracking combat</p>
      <button
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors"
        @click="showNewModal = true"
      >
        Create Encounter
      </button>
    </div>

    <div v-else class="grid gap-4">
      <NuxtLink
        v-for="encounter in encounters"
        :key="encounter.id"
        :to="`/campaigns/${campaignId}/encounters/${encounter.id}`"
        class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
               hover:border-digimon-orange-500 transition-all group"
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h2 class="font-display text-xl font-semibold text-white group-hover:text-digimon-orange-400 transition-colors">
                {{ encounter.name }}
              </h2>
              <span :class="['text-xs px-2 py-0.5 rounded uppercase font-semibold', getPhaseColor(encounter.phase)]">
                {{ encounter.phase }}
              </span>
              <button
                :disabled="togglingVisibilityId === encounter.id"
                :class="[
                  'text-xs px-2 py-0.5 rounded font-semibold border transition-colors disabled:opacity-50',
                  (encounter as any).visibleToPlayers
                    ? 'bg-green-900/30 border-green-600 text-green-400 hover:bg-green-900/50'
                    : 'bg-digimon-dark-700 border-digimon-dark-600 text-digimon-dark-400 hover:text-white'
                ]"
                :title="(encounter as any).visibleToPlayers
                  ? 'Players can see this encounter and receive its prompts. Click to hide.'
                  : 'Hidden from players — they see nothing of it and receive no prompts. Click to publish.'"
                @click.prevent="toggleVisibility(encounter.id, !!(encounter as any).visibleToPlayers)"
              >
                {{ (encounter as any).visibleToPlayers ? '👁 Visible' : '🚫 Hidden' }}
              </button>
            </div>
            <p v-if="encounter.description" class="text-digimon-dark-400 text-sm mb-3">
              {{ encounter.description }}
            </p>
            <div class="flex gap-4 text-sm text-digimon-dark-400">
              <span>{{ (encounter.participants as unknown[])?.length || 0 }} participants</span>
              <span v-if="encounter.phase === 'combat'">Round {{ encounter.round }}</span>
              <span class="text-digimon-dark-500">
                Created {{ new Date(encounter.createdAt).toLocaleDateString() }}
              </span>
            </div>
          </div>
          <div class="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-digimon-dark-200 rounded transition-colors"
              title="Create a copy of this encounter"
              @click.prevent="duplicateSource = { id: encounter.id, name: encounter.name }"
            >
              ⧉ Duplicate
            </button>
            <button
              class="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50
                     text-red-400 rounded transition-colors"
              @click.prevent="handleDelete(encounter.id, encounter.name)"
            >
              Delete
            </button>
          </div>
        </div>
      </NuxtLink>
    </div>

    <DuplicateEncounterModal
      v-if="duplicateSource"
      :encounter-name="duplicateSource.name"
      :busy="duplicating"
      @confirm="handleDuplicate"
      @cancel="duplicateSource = null"
    />

    <!-- New Encounter Modal -->
    <Teleport to="body">
      <div
        v-if="showNewModal"
        class="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
        @click.self="showNewModal = false"
      >
        <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border border-digimon-dark-700">
          <h2 class="font-display text-xl font-semibold text-white mb-4">New Encounter</h2>
          <form @submit.prevent="handleCreate">
            <div class="mb-4">
              <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
              <input
                v-model="newEncounterName"
                type="text"
                required
                placeholder="e.g., Forest Ambush"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div class="mb-6">
              <label class="block text-sm text-digimon-dark-400 mb-1">Description (optional)</label>
              <textarea
                v-model="newEncounterDescription"
                rows="3"
                placeholder="Brief description of the encounter..."
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                       text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
              />
            </div>
            <div class="flex gap-3">
              <button
                type="submit"
                class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2
                       rounded-lg font-semibold transition-colors"
              >
                Create
              </button>
              <button
                type="button"
                class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2
                       rounded-lg font-semibold transition-colors"
                @click="showNewModal = false"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
