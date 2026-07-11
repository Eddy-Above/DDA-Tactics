<script setup lang="ts">
import { diffCreationRules, extractCreationRules, type CreationRulesDiffEntry } from '~/utils/creationRules'

definePageMeta({
  title: 'Tamers',
})

const { campaignId, campaign, eddySoulRules, loadCampaign } = useCampaignContext()
const { tamers, loading, error, fetchTamers, deleteTamer, calculateDerivedStats } = useTamers()
const { importTamers } = useLibraryImportExport()
const { exportCharacterBundle, parseBundleFile, importBundle } = useCharacterBundle()

const fileInputRef = ref<HTMLInputElement | null>(null)
const importLoading = ref(false)
const importResult = ref<{ show: boolean; successful: number; failed: number; errors: Array<{ index: number; name: string; error: string }> } | null>(null)
const rulesDiff = ref<CreationRulesDiffEntry[] | null>(null)

onMounted(() => {
  fetchTamers(campaignId.value)
  loadCampaign()
})

async function handleDelete(id: string, name: string) {
  if (confirm(`Are you sure you want to delete ${name}?`)) {
    await deleteTamer(id)
  }
}

async function handleExport(tamer: (typeof tamers.value)[number]) {
  await loadCampaign()
  await exportCharacterBundle(tamer, campaign.value ? extractCreationRules(campaign.value) : undefined)
}

function handleImportClick() {
  fileInputRef.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importLoading.value = true
  importResult.value = null
  rulesDiff.value = null
  try {
    const parsed = await parseBundleFile(file)
    if (parsed.kind === 'legacy') {
      // Legacy rules-less array export: DM-only import path, parity unverifiable
      if (!confirm('This is a legacy export with no rules metadata — rule parity with this campaign cannot be verified. Import anyway?')) {
        return
      }
      const result = await importTamers(file, campaignId.value)
      importResult.value = { show: true, ...result }
    } else {
      await loadCampaign()
      const diff = campaign.value
        ? diffCreationRules(parsed.bundle.rules, extractCreationRules(campaign.value))
        : []
      if (diff.length > 0) {
        rulesDiff.value = diff
        return
      }
      const result = await importBundle(parsed.bundle, { campaignId: campaignId.value })
      importResult.value = {
        show: true,
        successful: (result.tamerId ? 1 : 0) + result.digimonIds.length,
        failed: result.errors.length,
        errors: result.errors.map((message, i) => ({ index: i, name: '', error: message })),
      }
    }
    await fetchTamers(campaignId.value)
  } catch (e) {
    importResult.value = {
      show: true,
      successful: 0,
      failed: 1,
      errors: [{ index: 0, name: '', error: e instanceof Error ? e.message : 'Import failed' }],
    }
  } finally {
    importLoading.value = false
    input.value = ''
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <NuxtLink :to="`/campaigns/${campaignId}/library`" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Back to Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Tamers</h1>
        <p class="text-digimon-dark-400">Manage human characters in your campaign</p>
      </div>
      <div class="flex gap-2">
        <button
          :disabled="importLoading"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50 text-white
                 px-4 py-2 rounded-lg font-semibold transition-colors"
          @click="handleImportClick"
        >
          {{ importLoading ? 'Importing...' : 'Import' }}
        </button>
        <NuxtLink
          :to="`/campaigns/${campaignId}/library/tamers/new`"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          + New Tamer
        </NuxtLink>
      </div>
    </div>

    <input
      ref="fileInputRef"
      type="file"
      accept=".json"
      class="hidden"
      @change="handleImportFile"
    />

    <RulesDiffModal
      v-if="rulesDiff"
      :diff="rulesDiff"
      source-label="Character"
      :target-label="campaign?.name || 'Campaign'"
      @close="rulesDiff = null"
    />

    <div
      v-if="importResult?.show"
      class="mb-6 rounded-lg p-4"
      :class="importResult.failed > 0 ? 'bg-yellow-900/30 border border-yellow-500' : 'bg-green-900/30 border border-green-500'"
    >
      <p :class="importResult.failed > 0 ? 'text-yellow-400' : 'text-green-400'">
        Imported {{ importResult.successful }} tamer{{ importResult.successful === 1 ? '' : 's' }}{{ importResult.failed > 0 ? `, ${importResult.failed} failed` : '' }}.
      </p>
      <ul v-if="importResult.errors.length" class="mt-2 text-sm text-red-300 space-y-1">
        <li v-for="(e, i) in importResult.errors" :key="i">
          &bull; Item {{ e.index + 1 }}{{ e.name ? ` (${e.name})` : '' }}: {{ e.error }}
        </li>
      </ul>
    </div>

    <div v-if="loading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading tamers...</div>
    </div>

    <div v-else-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else-if="tamers.length === 0" class="text-center py-12">
      <div class="text-6xl mb-4">👤</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Tamers Yet</h2>
      <p class="text-digimon-dark-400 mb-4">Create your first tamer to get started</p>
      <NuxtLink
        :to="`/campaigns/${campaignId}/library/tamers/new`"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors inline-block"
      >
        Create Tamer
      </NuxtLink>
    </div>

    <div v-else class="grid gap-4">
      <div
        v-for="tamer in tamers"
        :key="tamer.id"
        class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
               hover:border-digimon-dark-600 transition-colors"
      >
        <div class="flex justify-between items-start gap-4">
          <!-- Portrait -->
          <div class="w-16 h-16 bg-digimon-dark-700 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
            <img
              v-if="tamer.spriteUrl"
              :src="tamer.spriteUrl"
              :alt="tamer.name"
              class="w-full h-full object-cover"
              @error="($event.target as HTMLImageElement).style.display = 'none'"
            />
            <span v-else class="text-2xl text-digimon-dark-500">👤</span>
          </div>

          <div class="flex-1">
            <div class="flex items-center gap-3 mb-2">
              <h2 class="font-display text-xl font-semibold text-white">{{ tamer.name }}</h2>
              <span class="text-sm px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-300">
                Age {{ tamer.age }}
              </span>
            </div>

            <div class="grid grid-cols-5 gap-4 mt-4">
              <div
                v-for="(value, attr) in tamer.attributes"
                :key="attr"
                class="text-center"
              >
                <div class="text-xs text-digimon-dark-400 uppercase">{{ attr }}</div>
                <div class="text-lg font-semibold text-white">{{ value }}</div>
              </div>
            </div>

            <div class="flex gap-4 mt-4 text-sm text-digimon-dark-400">
              <span>Wounds: {{ calculateDerivedStats(tamer, eddySoulRules).woundBoxes }}</span>
              <span>Speed: {{ calculateDerivedStats(tamer, eddySoulRules).speed }}</span>
              <span>Inspiration: {{ tamer.inspiration }}</span>
            </div>
          </div>

          <div class="flex gap-2">
            <NuxtLink
              :to="`/campaigns/${campaignId}/library/tamers/${tamer.id}`"
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-white rounded transition-colors"
            >
              Edit
            </NuxtLink>
            <button
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-white rounded transition-colors"
              title="Download as a character bundle (partner digimon, evolution lines, and campaign rules included)"
              @click="handleExport(tamer)"
            >
              Export
            </button>
            <button
              class="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50
                     text-red-400 rounded transition-colors"
              @click="handleDelete(tamer.id, tamer.name)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
