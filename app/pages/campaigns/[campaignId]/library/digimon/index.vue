<script setup lang="ts">
import { STAGE_CONFIG, type DigimonStage } from '~/types'

const STAGE_FILTERS = [
  { label: 'Baby',        value: 'fresh'       },
  { label: 'In-Training', value: 'in-training' },
  { label: 'Rookie',      value: 'rookie'      },
  { label: 'Champion',    value: 'champion'    },
  { label: 'Ultimate',    value: 'ultimate'    },
  { label: 'Mega',        value: 'mega'        },
  { label: 'Ultra',       value: 'ultra'       },
  { label: 'Dark Evo',    value: 'dark-evo'    },
]
import { getStageBadgeColor, getAttributeColor } from '~/utils/displayHelpers'

definePageMeta({
  title: 'Digimon',
})

const router = useRouter()
const { campaignId, eddySoulRules } = useCampaignContext()
const { digimonList, loading, error, fetchDigimon, deleteDigimon, copyDigimon, calculateDerivedStats: _calculateDerivedStats } = useDigimon()
const calculateDerivedStats = (digimon: any) => _calculateDerivedStats(digimon, eddySoulRules.value)
const { tamers, fetchTamers } = useTamers()
const { exportDigimon, importDigimon } = useLibraryImportExport()

const filter = ref<'all' | 'partners' | 'enemies'>('all')
const selectedTamerIds = ref<string[]>([])
const selectedStages = ref<string[]>([])
const currentPage = ref(1)
const PAGE_SIZE = 12

const fileInputRef = ref<HTMLInputElement | null>(null)
const importLoading = ref(false)
const importResult = ref<{ show: boolean; successful: number; failed: number; errors: Array<{ index: number; name: string; error: string }> } | null>(null)

const filteredDigimon = computed(() => {
  let list = digimonList.value
  if (filter.value === 'partners') {
    list = list.filter((d) => !d.isEnemy)
  } else if (filter.value === 'enemies') {
    list = list.filter((d) => d.isEnemy)
  }

  if (selectedTamerIds.value.length > 0) {
    list = list.filter((d) => d.partnerId && selectedTamerIds.value.includes(d.partnerId))
  }

  if (selectedStages.value.length > 0) {
    list = list.filter((d) => {
      if (selectedStages.value.includes(d.stage)) return true
      if (selectedStages.value.includes('dark-evo') && (d as any).isDarkEvolution) return true
      return false
    })
  }

  return list
})

const totalFilteredPages = computed(() => Math.max(1, Math.ceil(filteredDigimon.value.length / PAGE_SIZE)))

const paginatedDigimon = computed(() => {
  const start = (currentPage.value - 1) * PAGE_SIZE
  return filteredDigimon.value.slice(start, start + PAGE_SIZE)
})

watch(filter, (val) => {
  if (val !== 'partners') {
    selectedTamerIds.value = []
  }
})

watch([filter, selectedTamerIds, selectedStages], () => {
  currentPage.value = 1
})

function goToPage(newPage: number) {
  if (newPage < 1 || newPage > totalFilteredPages.value) return
  currentPage.value = newPage
}

const tamerMap = computed(() => {
  const map = new Map<string, string>()
  tamers.value.forEach((t) => map.set(t.id, t.name))
  return map
})

onMounted(async () => {
  await Promise.all([fetchDigimon({ campaignId: campaignId.value, pageSize: 500 }), fetchTamers(campaignId.value)])
})

async function handleDelete(id: string, name: string) {
  if (confirm(`Are you sure you want to delete ${name}?`)) {
    await deleteDigimon(id)
  }
}

async function handleCopy(digimon: typeof digimonList.value[0]) {
  const copy = await copyDigimon(digimon)
  if (copy) {
    router.push(`/campaigns/${campaignId.value}/library/digimon/${copy.id}`)
  }
}

function toggleStage(value: string) {
  const idx = selectedStages.value.indexOf(value)
  if (idx === -1) selectedStages.value.push(value)
  else selectedStages.value.splice(idx, 1)
}

function toggleTamer(id: string) {
  const idx = selectedTamerIds.value.indexOf(id)
  if (idx === -1) {
    selectedTamerIds.value.push(id)
  } else {
    selectedTamerIds.value.splice(idx, 1)
  }
}

function handleImportClick() {
  fileInputRef.value?.click()
}

async function handleImportFile(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  importLoading.value = true
  importResult.value = null
  const result = await importDigimon(file, campaignId.value)
  importResult.value = { show: true, ...result }
  await fetchDigimon({ campaignId: campaignId.value, pageSize: 500 })
  importLoading.value = false
  ;(event.target as HTMLInputElement).value = ''
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <NuxtLink :to="`/campaigns/${campaignId}/library`" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Back to Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Digimon</h1>
        <p class="text-digimon-dark-400">Manage partner and enemy Digimon</p>
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
          :to="`/campaigns/${campaignId}/library/digimon/new`"
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
      v-if="importResult?.show"
      class="mb-6 rounded-lg p-4"
      :class="importResult.failed > 0 ? 'bg-yellow-900/30 border border-yellow-500' : 'bg-green-900/30 border border-green-500'"
    >
      <p :class="importResult.failed > 0 ? 'text-yellow-400' : 'text-green-400'">
        Imported {{ importResult.successful }} digimon{{ importResult.failed > 0 ? `, ${importResult.failed} failed` : '' }}.
      </p>
      <ul v-if="importResult.errors.length" class="mt-2 text-sm text-red-300 space-y-1">
        <li v-for="(e, i) in importResult.errors" :key="i">
          &bull; Item {{ e.index + 1 }}{{ e.name ? ` (${e.name})` : '' }}: {{ e.error }}
        </li>
      </ul>
    </div>

    <!-- Filter tabs -->
    <div class="flex gap-2 mb-6">
      <button
        v-for="f in (['all', 'partners', 'enemies'] as const)"
        :key="f"
        :class="[
          'px-4 py-2 rounded-lg font-medium transition-colors capitalize',
          filter === f
            ? 'bg-digimon-orange-500 text-white'
            : 'bg-digimon-dark-800 text-digimon-dark-400 hover:text-white',
        ]"
        @click="filter = f"
      >
        {{ f }}
      </button>
    </div>

    <!-- Stage sub-filter -->
    <div class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="sf in STAGE_FILTERS"
        :key="sf.value"
        :class="[
          'px-3 py-1.5 rounded-lg text-sm font-medium transition-colors',
          selectedStages.includes(sf.value)
            ? 'bg-digimon-orange-500 text-white'
            : 'bg-digimon-dark-800 text-digimon-dark-400 hover:text-white',
        ]"
        @click="toggleStage(sf.value)"
      >
        {{ sf.label }}
      </button>
    </div>

    <!-- Tamer filter (only visible when Partners tab is selected) -->
    <div v-if="filter === 'partners' && tamers.length > 0" class="mb-6 flex flex-wrap gap-2">
      <button
        v-for="tamer in tamers"
        :key="tamer.id"
        :class="[
          'px-4 py-2 rounded-lg font-medium transition-colors',
          selectedTamerIds.includes(tamer.id)
            ? 'bg-digimon-orange-500 text-white'
            : 'bg-digimon-dark-800 text-digimon-dark-400 hover:text-white',
        ]"
        @click="toggleTamer(tamer.id)"
      >
        {{ tamer.name }}
      </button>
    </div>

    <div v-if="loading" class="text-center py-12">
      <div class="text-digimon-dark-400">Loading digimon...</div>
    </div>

    <div v-else-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
      {{ error }}
    </div>

    <div v-else-if="filteredDigimon.length === 0" class="text-center py-12">
      <div class="text-6xl mb-4">🦖</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Digimon Yet</h2>
      <p class="text-digimon-dark-400 mb-4">Create your first digimon to get started</p>
      <NuxtLink
        :to="`/campaigns/${campaignId}/library/digimon/new`"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors inline-block"
      >
        Create Digimon
      </NuxtLink>
    </div>

    <div v-else class="grid gap-4">
      <div
        v-for="digimon in paginatedDigimon"
        :key="digimon.id"
        class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
               hover:border-digimon-dark-600 transition-colors"
      >
        <div class="flex justify-between items-start">
          <div class="flex gap-4 flex-1">
            <!-- Sprite -->
            <div
              class="w-20 h-20 bg-digimon-dark-700 rounded-lg flex items-center justify-center text-3xl shrink-0 overflow-hidden"
            >
              <img
                v-if="digimon.spriteUrl"
                :src="digimon.spriteUrl"
                :alt="digimon.name"
                class="max-w-full max-h-full object-contain"
                @error="($event.target as HTMLImageElement).style.display = 'none'"
              />
              <span v-else>{{ digimon.isEnemy ? '👹' : '🦖' }}</span>
            </div>

            <div class="flex-1">
              <div class="flex items-center gap-3 mb-1">
                <h2 class="font-display text-xl font-semibold text-white">{{ digimon.name }}</h2>
                <span :class="['text-xs px-2 py-0.5 rounded uppercase font-semibold', getStageBadgeColor(digimon.stage as DigimonStage)]">
                  {{ digimon.stage }}
                </span>
                <span :class="['text-xs uppercase', getAttributeColor(digimon.attribute)]">
                  {{ digimon.attribute }}
                </span>
              </div>

              <div class="text-sm text-digimon-dark-400 mb-3">
                {{ digimon.nickname }}
                <span v-if="digimon.partnerId && tamerMap.get(digimon.partnerId)" class="ml-2">
                  &bull; Partner of <span class="text-digimon-orange-400">{{ tamerMap.get(digimon.partnerId) }}</span>
                </span>
                <span v-if="digimon.isEnemy" class="ml-2 text-red-400">&bull; Enemy</span>
              </div>

              <div class="grid grid-cols-5 gap-4">
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">ACC</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.accuracy + ((digimon as any).bonusStats?.accuracy || 0) + ((digimon as any).isDarkEvolution ? 2 : 0) }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">DMG</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.damage + ((digimon as any).bonusStats?.damage || 0) + ((digimon as any).isDarkEvolution ? 2 : 0) }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">DOD</div>
                  <div class="font-semibold text-white">{{ calculateDerivedStats(digimon).dodge }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">ARM</div>
                  <div class="font-semibold text-white">{{ calculateDerivedStats(digimon).armor }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">HP</div>
                  <div class="font-semibold text-white">{{ calculateDerivedStats(digimon).health }}</div>
                </div>
              </div>

              <div class="flex gap-4 mt-3 text-sm text-digimon-dark-400">
                <span>Wounds: {{ calculateDerivedStats(digimon).woundBoxes }}</span>
                <span>Move: {{ calculateDerivedStats(digimon).movement }}</span>
                <span>DP: {{ STAGE_CONFIG[digimon.stage as DigimonStage].dp }}</span>
                <span>Bonus DP: {{ digimon.bonusDP || 0 }}</span>
              </div>
            </div>
          </div>

          <div class="flex gap-2">
            <NuxtLink
              :to="`/campaigns/${campaignId}/library/digimon/${digimon.id}`"
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-white rounded transition-colors"
            >
              Edit
            </NuxtLink>
            <button
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-white rounded transition-colors"
              @click="exportDigimon([digimon])"
            >
              Export
            </button>
            <button
              class="px-3 py-1.5 text-sm bg-cyan-900/30 hover:bg-cyan-900/50
                     text-cyan-400 rounded transition-colors"
              @click="handleCopy(digimon)"
            >
              Copy
            </button>
            <button
              class="px-3 py-1.5 text-sm bg-red-900/30 hover:bg-red-900/50
                     text-red-400 rounded transition-colors"
              @click="handleDelete(digimon.id, digimon.name)"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="!loading && !error && totalFilteredPages > 1" class="flex items-center justify-center gap-4 mt-6">
      <button
        class="bg-digimon-dark-800 hover:bg-digimon-dark-700 disabled:opacity-40 disabled:cursor-not-allowed
               text-white px-4 py-2 rounded-lg border border-digimon-dark-700 transition-colors"
        :disabled="currentPage <= 1"
        @click="goToPage(currentPage - 1)"
      >
        &larr; Prev
      </button>
      <span class="text-digimon-dark-400 text-sm">
        Page {{ currentPage }} of {{ totalFilteredPages }}
      </span>
      <button
        class="bg-digimon-dark-800 hover:bg-digimon-dark-700 disabled:opacity-40 disabled:cursor-not-allowed
               text-white px-4 py-2 rounded-lg border border-digimon-dark-700 transition-colors"
        :disabled="currentPage >= totalFilteredPages"
        @click="goToPage(currentPage + 1)"
      >
        Next &rarr;
      </button>
    </div>
  </div>
</template>
