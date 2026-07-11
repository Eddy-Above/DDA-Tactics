<script setup lang="ts">
definePageMeta({
  title: 'Character Workshop',
})

const { tamers, loading: tamersLoading, fetchTamers, deleteTamer, calculateDerivedStats } = useTamers()
const { digimonList, loading: digimonLoading, fetchDigimon, deleteDigimon } = useDigimon()
const { exportCharacterBundle, exportDigimonBundle, parseBundleFile, importBundle } = useCharacterBundle()

const fileInputRef = ref<HTMLInputElement | null>(null)
const importLoading = ref(false)
const importFeedback = ref<{ tone: 'success' | 'warning' | 'error'; message: string; errors: string[] } | null>(null)

const loading = computed(() => tamersLoading.value || digimonLoading.value)

const tamerNameById = computed(() => {
  const map: Record<string, string> = {}
  for (const t of tamers.value) map[t.id] = t.name
  return map
})

async function loadAll() {
  await Promise.all([
    fetchTamers(undefined, { sandbox: true }),
    fetchDigimon({ sandbox: true, pageSize: 500 }),
  ])
}

onMounted(loadAll)

function levelLabel(rules?: { level?: string } | null) {
  const level = rules?.level ?? 'standard'
  return level.charAt(0).toUpperCase() + level.slice(1)
}

function levelColor(rules?: { level?: string } | null) {
  switch (rules?.level) {
    case 'enhanced': return 'text-yellow-400'
    case 'extreme': return 'text-red-400'
    default: return 'text-green-400'
  }
}

async function handleDeleteTamer(id: string, name: string) {
  if (confirm(`Delete ${name}? Their partner digimon stay in the workshop.`)) {
    await deleteTamer(id)
    await loadAll()
  }
}

async function handleDeleteDigimon(id: string, name: string) {
  if (confirm(`Delete ${name}?`)) {
    await deleteDigimon(id)
    await loadAll()
  }
}

function handleImportClick() {
  fileInputRef.value?.click()
}

async function handleImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  importLoading.value = true
  importFeedback.value = null
  try {
    const parsed = await parseBundleFile(file)
    if (parsed.kind === 'legacy') {
      importFeedback.value = {
        tone: 'error',
        message: 'This is a legacy export with no rules metadata. Import it via a campaign\'s DM library instead.',
        errors: [],
      }
      return
    }
    // Sandbox adopts the bundle's own rules — no parity check needed here
    const result = await importBundle(parsed.bundle, { sandbox: true })
    const importedCount = (result.tamerId ? 1 : 0) + result.digimonIds.length
    importFeedback.value = {
      tone: result.errors.length > 0 ? 'warning' : 'success',
      message: `Imported ${importedCount} record${importedCount === 1 ? '' : 's'}${result.evolutionLineIds.length > 0 ? ` and ${result.evolutionLineIds.length} evolution line${result.evolutionLineIds.length === 1 ? '' : 's'}` : ''}.`,
      errors: result.errors,
    }
    await loadAll()
  } catch (e) {
    importFeedback.value = {
      tone: 'error',
      message: e instanceof Error ? e.message : 'Import failed',
      errors: [],
    }
  } finally {
    importLoading.value = false
    input.value = ''
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-start mb-8 gap-4 flex-wrap">
      <div>
        <NuxtLink to="/" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Back to Campaigns
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Character Workshop</h1>
        <p class="text-digimon-dark-400 max-w-2xl">
          A shared sandbox for experimenting with tamer and digimon builds under any rules — no campaign needed.
          Each character remembers the rules it was built with; export it to bring it into a campaign with matching rules.
        </p>
      </div>
      <div class="flex gap-2 flex-wrap">
        <button
          :disabled="importLoading"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 disabled:opacity-50 text-white
                 px-4 py-2 rounded-lg font-semibold transition-colors"
          @click="handleImportClick"
        >
          {{ importLoading ? 'Importing...' : 'Import Bundle' }}
        </button>
        <NuxtLink
          to="/workshop/tamers/new"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          + New Tamer
        </NuxtLink>
        <NuxtLink
          to="/workshop/digimon/new"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          + New Digimon
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

    <div
      v-if="importFeedback"
      class="mb-6 rounded-lg p-4 border"
      :class="{
        'bg-green-900/30 border-green-500': importFeedback.tone === 'success',
        'bg-yellow-900/30 border-yellow-500': importFeedback.tone === 'warning',
        'bg-red-900/30 border-red-500': importFeedback.tone === 'error',
      }"
    >
      <p
        :class="{
          'text-green-400': importFeedback.tone === 'success',
          'text-yellow-400': importFeedback.tone === 'warning',
          'text-red-400': importFeedback.tone === 'error',
        }"
      >
        {{ importFeedback.message }}
      </p>
      <ul v-if="importFeedback.errors.length" class="mt-2 text-sm text-red-300 space-y-1">
        <li v-for="(e, i) in importFeedback.errors" :key="i">&bull; {{ e }}</li>
      </ul>
    </div>

    <div v-if="loading && tamers.length === 0 && digimonList.length === 0" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading workshop...</div>
    </div>

    <template v-else>
      <!-- Tamers -->
      <section class="mb-10">
        <h2 class="font-display text-2xl font-semibold text-white mb-4">Tamers</h2>
        <div v-if="tamers.length === 0" class="bg-digimon-dark-800/50 border border-digimon-dark-700 rounded-xl p-8 text-center">
          <div class="text-4xl mb-2">👤</div>
          <p class="text-digimon-dark-400">No workshop tamers yet — create one to start experimenting.</p>
        </div>
        <div v-else class="grid gap-4">
          <div
            v-for="tamer in tamers"
            :key="tamer.id"
            class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
                   hover:border-digimon-dark-600 transition-colors"
          >
            <div class="flex justify-between items-start gap-4">
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
                <div class="flex items-center gap-3 mb-2 flex-wrap">
                  <h3 class="font-display text-xl font-semibold text-white">{{ tamer.name }}</h3>
                  <span class="text-sm px-2 py-0.5 rounded bg-digimon-dark-700 text-digimon-dark-300">
                    Age {{ tamer.age }}
                  </span>
                  <span class="text-sm font-medium" :class="levelColor(tamer.creationRules)">
                    {{ levelLabel(tamer.creationRules) }}
                  </span>
                </div>
                <div class="flex gap-4 text-sm text-digimon-dark-400">
                  <span>Wounds: {{ calculateDerivedStats(tamer, tamer.creationRules?.eddySoulRules).woundBoxes }}</span>
                  <span>Speed: {{ calculateDerivedStats(tamer, tamer.creationRules?.eddySoulRules).speed }}</span>
                  <span>Inspiration: {{ tamer.inspiration }}</span>
                </div>
              </div>

              <div class="flex gap-2">
                <NuxtLink
                  :to="`/workshop/tamers/${tamer.id}`"
                  class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                         text-white rounded transition-colors"
                >
                  Edit
                </NuxtLink>
                <button
                  class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                         text-white rounded transition-colors"
                  @click="exportCharacterBundle(tamer)"
                >
                  Export
                </button>
                <button
                  class="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50
                         text-red-400 rounded transition-colors"
                  @click="handleDeleteTamer(tamer.id, tamer.name)"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <!-- Digimon -->
      <section>
        <h2 class="font-display text-2xl font-semibold text-white mb-4">Digimon</h2>
        <div v-if="digimonList.length === 0" class="bg-digimon-dark-800/50 border border-digimon-dark-700 rounded-xl p-8 text-center">
          <div class="text-4xl mb-2">🥚</div>
          <p class="text-digimon-dark-400">No workshop digimon yet — create one to start experimenting.</p>
        </div>
        <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="d in digimonList"
            :key="d.id"
            class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700
                   hover:border-digimon-dark-600 transition-colors"
          >
            <div class="flex justify-between items-start gap-4">
              <div class="w-14 h-14 bg-digimon-dark-700 rounded-lg overflow-hidden flex-shrink-0 flex items-center justify-center">
                <img
                  v-if="d.spriteUrl"
                  :src="d.spriteUrl"
                  :alt="d.name"
                  class="w-full h-full object-contain"
                  @error="($event.target as HTMLImageElement).style.display = 'none'"
                />
                <span v-else class="text-2xl text-digimon-dark-500">🥚</span>
              </div>

              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h3 class="font-display text-lg font-semibold text-white truncate">{{ d.name }}</h3>
                  <span class="text-xs font-medium" :class="levelColor(d.creationRules)">
                    {{ levelLabel(d.creationRules) }}
                  </span>
                </div>
                <p class="text-sm text-digimon-dark-400 capitalize">
                  {{ d.stage }} · {{ d.attribute }}
                  <span v-if="d.isEnemy" class="text-red-400"> · Enemy</span>
                </p>
                <p v-if="d.partnerId && tamerNameById[d.partnerId]" class="text-xs text-digimon-dark-500">
                  Partner of {{ tamerNameById[d.partnerId] }}
                </p>
              </div>

              <div class="flex flex-col gap-1.5 items-stretch">
                <NuxtLink
                  :to="`/workshop/digimon/${d.id}`"
                  class="px-3 py-1 text-sm text-center bg-digimon-dark-700 hover:bg-digimon-dark-600
                         text-white rounded transition-colors"
                >
                  Edit
                </NuxtLink>
                <button
                  class="px-3 py-1 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                         text-white rounded transition-colors"
                  @click="exportDigimonBundle(d)"
                >
                  Export
                </button>
                <button
                  class="px-3 py-1 text-sm bg-red-900/30 hover:bg-red-900/50
                         text-red-400 rounded transition-colors"
                  @click="handleDeleteDigimon(d.id, d.name)"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </template>
  </div>
</template>
