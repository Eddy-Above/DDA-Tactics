<script setup lang="ts">
import type { Digimon } from '../server/db/schema'
import type { DigimonStage } from '../types'

interface Props {
  modelValue: string[]
  stage?: DigimonStage | DigimonStage[]  // Filter by stage(s)
  excludeIds?: string[]  // Exclude certain Digimon
  placeholder?: string
  label?: string
  campaignId?: string
  excludeEnemies?: boolean
}

const props = withDefaults(defineProps<Props>(), {
  placeholder: 'Select Digimon...',
  excludeIds: () => [],
  modelValue: () => [],
})

const emit = defineEmits<{
  (e: 'update:modelValue', value: string[]): void
}>()

const isOpen = ref(false)
const searchQuery = ref('')
const allDigimon = ref<Digimon[]>([])
const loading = ref(false)

// Fetch all Digimon on mount
onMounted(async () => {
  loading.value = true
  try {
    const query: Record<string, string> = { pageSize: '500' }
    if (props.campaignId) query.campaignId = props.campaignId
    if (props.excludeEnemies) query.isEnemy = 'false'
    const envelope = await $fetch<{ data: Digimon[] }>('/api/digimon', { query })
    allDigimon.value = envelope.data
  } catch (e) {
    console.error('Failed to fetch Digimon:', e)
  } finally {
    loading.value = false
  }
})

// Filter Digimon based on stage and excludeIds
const filteredDigimon = computed(() => {
  let filtered = allDigimon.value

  // Filter by stage
  if (props.stage) {
    const stages = Array.isArray(props.stage) ? props.stage : [props.stage]
    filtered = filtered.filter((d) => stages.includes(d.stage as DigimonStage))
  }

  // Exclude certain IDs (but keep already selected ones visible)
  if (props.excludeIds && props.excludeIds.length > 0) {
    filtered = filtered.filter(
      (d) => !props.excludeIds!.includes(d.id) || props.modelValue.includes(d.id)
    )
  }

  // Apply search
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    filtered = filtered.filter(
      (d) =>
        d.name.toLowerCase().includes(query)
    )
  }

  return filtered
})

// Get selected Digimon details
const selectedDigimon = computed(() => {
  return allDigimon.value.filter((d) => props.modelValue.includes(d.id))
})

function toggleDigimon(id: string) {
  const current = [...props.modelValue]
  const index = current.indexOf(id)
  if (index >= 0) {
    current.splice(index, 1)
  } else {
    current.push(id)
  }
  emit('update:modelValue', current)
}

function removeDigimon(id: string) {
  const current = props.modelValue.filter((i) => i !== id)
  emit('update:modelValue', current)
}

// Close dropdown when clicking outside
function handleClickOutside(event: MouseEvent) {
  const target = event.target as HTMLElement
  if (!target.closest('.digimon-multi-selector')) {
    isOpen.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<template>
  <div class="digimon-multi-selector relative">
    <label v-if="label" class="block text-sm text-digimon-dark-400 mb-1">{{ label }}</label>

    <!-- Selected chips -->
    <div
      v-if="selectedDigimon.length > 0"
      class="flex flex-wrap gap-2 mb-2"
    >
      <div
        v-for="d in selectedDigimon"
        :key="d.id"
        class="flex items-center gap-1 bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-1"
      >
        <div class="w-6 h-6 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
          <img
            v-if="d.spriteUrl"
            :src="d.spriteUrl"
            :alt="d.name"
            class="max-w-full max-h-full object-contain"
          />
          <span v-else class="text-xs">{{ d.isEnemy ? '👹' : '🦖' }}</span>
        </div>
        <span class="text-white text-sm">{{ d.name }}</span>
        <button
          type="button"
          class="text-digimon-dark-400 hover:text-red-400 ml-1"
          @click="removeDigimon(d.id)"
        >
          &times;
        </button>
      </div>
    </div>

    <!-- Trigger button -->
    <div
      class="flex items-center gap-2 bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
             cursor-pointer hover:border-digimon-dark-500 transition-colors"
      @click="isOpen = !isOpen"
    >
      <span class="text-digimon-dark-400 text-sm">{{ placeholder }}</span>
      <span class="ml-auto text-digimon-dark-400">▼</span>
    </div>

    <!-- Dropdown -->
    <div
      v-if="isOpen"
      class="absolute z-50 top-full left-0 right-0 mt-1 bg-digimon-dark-800 border border-digimon-dark-600
             rounded-lg shadow-xl max-h-64 overflow-hidden"
    >
      <!-- Search -->
      <div class="p-2 border-b border-digimon-dark-600">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search Digimon..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-1.5
                 text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
          @click.stop
        />
      </div>

      <!-- Options list -->
      <div class="overflow-y-auto max-h-48">
        <div v-if="loading" class="p-4 text-center text-digimon-dark-400 text-sm">
          Loading...
        </div>
        <div v-else-if="filteredDigimon.length === 0" class="p-4 text-center text-digimon-dark-400 text-sm">
          No Digimon found
        </div>
        <button
          v-for="d in filteredDigimon"
          v-else
          :key="d.id"
          type="button"
          class="w-full flex items-center gap-2 px-3 py-2 hover:bg-digimon-dark-700 transition-colors text-left"
          :class="{ 'bg-digimon-orange-500/20': modelValue.includes(d.id) }"
          @click="toggleDigimon(d.id)"
        >
          <div class="w-5 h-5 rounded border border-digimon-dark-500 flex items-center justify-center shrink-0">
            <span v-if="modelValue.includes(d.id)" class="text-digimon-orange-400">✓</span>
          </div>
          <div class="w-8 h-8 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
            <img
              v-if="d.spriteUrl"
              :src="d.spriteUrl"
              :alt="d.name"
              class="max-w-full max-h-full object-contain"
            />
            <span v-else class="text-sm">{{ d.isEnemy ? '👹' : '🦖' }}</span>
          </div>
          <div class="flex-1 min-w-0">
            <div class="text-white text-sm font-medium truncate">{{ d.name }}</div>
            <div class="text-xs text-digimon-dark-400 truncate">{{ d.stage }}</div>
          </div>
        </button>
      </div>
    </div>
  </div>
</template>
