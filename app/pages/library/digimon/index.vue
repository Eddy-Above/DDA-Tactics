<script setup lang="ts">
import { STAGE_CONFIG, type DigimonStage } from '../../../types'
import { getStageBadgeColor, getAttributeColor } from '../../../utils/displayHelpers'

definePageMeta({
  title: 'Digimon',
})

const router = useRouter()
const { digimonList, loading, error, fetchDigimon, deleteDigimon, copyDigimon, calculateDerivedStats } = useDigimon()
const { tamers, fetchTamers } = useTamers()

const filter = ref<'all' | 'partners' | 'enemies'>('all')
const selectedTamerIds = ref<string[]>([])

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

  return list
})

watch(filter, (val) => {
  if (val !== 'partners') {
    selectedTamerIds.value = []
  }
})

const tamerMap = computed(() => {
  const map = new Map<string, string>()
  tamers.value.forEach((t) => map.set(t.id, t.name))
  return map
})

onMounted(async () => {
  await Promise.all([fetchDigimon(), fetchTamers()])
})

async function handleDelete(id: string, name: string) {
  if (confirm(`Are you sure you want to delete ${name}?`)) {
    await deleteDigimon(id)
  }
}

async function handleCopy(digimon: typeof digimonList.value[0]) {
  const copy = await copyDigimon(digimon)
  if (copy) {
    router.push(`/library/digimon/${copy.id}`)
  }
}

function toggleTamer(id: string) {
  const idx = selectedTamerIds.value.indexOf(id)
  if (idx === -1) {
    selectedTamerIds.value.push(id)
  } else {
    selectedTamerIds.value.splice(idx, 1)
  }
}

</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="flex justify-between items-center mb-8">
      <div>
        <NuxtLink to="/library" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
          &larr; Back to Library
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white">Digimon</h1>
        <p class="text-digimon-dark-400">Manage partner and enemy Digimon</p>
      </div>
      <NuxtLink
        to="/library/digimon/new"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors"
      >
        + New Digimon
      </NuxtLink>
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
        to="/library/digimon/new"
        class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg
               font-semibold transition-colors inline-block"
      >
        Create Digimon
      </NuxtLink>
    </div>

    <div v-else class="grid gap-4">
      <div
        v-for="digimon in filteredDigimon"
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
                {{ digimon.species }}
                <span v-if="digimon.partnerId && tamerMap.get(digimon.partnerId)" class="ml-2">
                  &bull; Partner of <span class="text-digimon-orange-400">{{ tamerMap.get(digimon.partnerId) }}</span>
                </span>
                <span v-if="digimon.isEnemy" class="ml-2 text-red-400">&bull; Enemy</span>
              </div>

              <div class="grid grid-cols-5 gap-4">
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">ACC</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.accuracy + (digimon.bonusStats?.accuracy || 0) }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">DMG</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.damage + (digimon.bonusStats?.damage || 0) }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">DOD</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.dodge + (digimon.bonusStats?.dodge || 0) }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">ARM</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.armor + (digimon.bonusStats?.armor || 0) }}</div>
                </div>
                <div class="text-center">
                  <div class="text-xs text-digimon-dark-400">HP</div>
                  <div class="font-semibold text-white">{{ digimon.baseStats.health + (digimon.bonusStats?.health || 0) }}</div>
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
              :to="`/library/digimon/${digimon.id}`"
              class="px-3 py-1.5 text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600
                     text-white rounded transition-colors"
            >
              Edit
            </NuxtLink>
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
  </div>
</template>
