<script setup lang="ts">
import { diffCreationRules, extractCreationRules, type CreationRulesDiffEntry } from '~/utils/creationRules'

definePageMeta({
  layout: 'player',
  title: 'Player View',
})

const { campaignId, campaign, loadCampaign } = useCampaignContext()
const { tamers, fetchTamers } = useTamers()
const { parseBundleFile, importBundle } = useCharacterBundle()
const selectedTamerId = useCookie<string | null>(`player-tamer-id-${campaignId.value}`, { default: () => null })

const loading = ref(true)
const fileInputRef = ref<HTMLInputElement | null>(null)
const importLoading = ref(false)
const importError = ref<string | null>(null)
const rulesDiff = ref<CreationRulesDiffEntry[] | null>(null)

onMounted(async () => {
  await Promise.all([fetchTamers(campaignId.value), loadCampaign()])
  loading.value = false
})

function selectTamer(tamerId: string) {
  selectedTamerId.value = tamerId
}

function clearSelection() {
  selectedTamerId.value = null
}

function handleImportClick() {
  fileInputRef.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importLoading.value = true
  importError.value = null
  rulesDiff.value = null
  try {
    const parsed = await parseBundleFile(file)
    if (parsed.kind === 'legacy') {
      importError.value = 'This is a legacy export with no rules metadata — ask your GM to import it via the campaign library.'
      return
    }
    if (!parsed.bundle.tamer) {
      importError.value = 'This file contains only a digimon. Open your character and use "Import Digimon" there instead.'
      return
    }
    await loadCampaign()
    if (!campaign.value) {
      importError.value = 'Could not load campaign rules — try again.'
      return
    }
    // Warn + block: character rules must match the campaign's creation rules
    const diff = diffCreationRules(parsed.bundle.rules, extractCreationRules(campaign.value))
    if (diff.length > 0) {
      rulesDiff.value = diff
      return
    }
    const result = await importBundle(parsed.bundle, { campaignId: campaignId.value })
    if (result.errors.length > 0) {
      importError.value = `Imported with problems: ${result.errors.join('; ')}`
    }
    await fetchTamers(campaignId.value)
    if (result.tamerId && result.errors.length === 0) {
      selectedTamerId.value = result.tamerId
    }
  } catch (e) {
    importError.value = e instanceof Error ? e.message : 'Import failed'
  } finally {
    importLoading.value = false
    input.value = ''
  }
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
        :to="`/campaigns/${campaignId}/player/${selectedTamerId}`"
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

      <input
        ref="fileInputRef"
        type="file"
        accept=".json"
        class="hidden"
        @change="handleImportFile"
      />

      <div v-if="importError" class="mb-4 bg-red-900/30 border border-red-500 rounded-lg p-3 text-sm text-red-400">
        {{ importError }}
      </div>

      <div v-if="tamers.length === 0" class="text-center py-8">
        <div class="text-6xl mb-4">👤</div>
        <h2 class="text-xl font-semibold text-white mb-2">No Characters Available</h2>
        <p class="text-digimon-dark-400 mb-6">Create your Tamer to get started</p>
        <div class="flex justify-center gap-3">
          <NuxtLink
            :to="`/campaigns/${campaignId}/player/new`"
            class="inline-block bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
          >
            Create Your Character
          </NuxtLink>
          <button
            :disabled="importLoading"
            class="inline-block bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
            @click="handleImportClick"
          >
            {{ importLoading ? 'Importing...' : 'Import Character' }}
          </button>
        </div>
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
                Age {{ tamer.age }}
              </p>
            </div>
          </div>
        </button>

        <div class="text-center mt-2 flex items-center justify-center gap-4">
          <NuxtLink :to="`/campaigns/${campaignId}/player/new`" class="text-digimon-orange-400 hover:text-digimon-orange-300 text-sm">
            + Create New Character
          </NuxtLink>
          <button
            :disabled="importLoading"
            class="text-digimon-orange-400 hover:text-digimon-orange-300 disabled:opacity-50 text-sm"
            @click="handleImportClick"
          >
            {{ importLoading ? 'Importing...' : '⬆ Import Character' }}
          </button>
        </div>
      </div>
    </div>

    <RulesDiffModal
      v-if="rulesDiff"
      :diff="rulesDiff"
      source-label="Character"
      :target-label="campaign?.name || 'Campaign'"
      @close="rulesDiff = null"
    />
  </div>
</template>
