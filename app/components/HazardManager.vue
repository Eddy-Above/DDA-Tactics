<script setup lang="ts">
import { HAZARD_DATABASE, type HazardTemplate } from '../data/hazards'
import { NATUREWALK_ELEMENTS, NATUREWALK_ENVIRONMENT_ID, getNaturewalkEnvironmentSettings } from '~/utils/naturewalk'
import type { ElementType } from '~/types'

interface Hazard {
  id: string
  name: string
  description: string
  effect: string
  affectedArea: string
  duration: number | null
  naturewalkEnvironment?: { elements: ElementType[]; useMapTerrain: boolean }
}

interface Props {
  hazards: Hazard[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'add', hazard: Hazard): void
  (e: 'remove', id: string): void
  (e: 'update', hazard: Hazard): void
}>()

const showSelector = ref(false)
const showCustomForm = ref(false)
const searchQuery = ref('')
const filterCategory = ref<'all' | HazardTemplate['category']>('all')

const categories = ['terrain', 'weather', 'digital', 'trap', 'other'] as const

const availableHazards = computed(() => {
  let hazards = HAZARD_DATABASE

  if (filterCategory.value !== 'all') {
    hazards = hazards.filter((h) => h.category === filterCategory.value)
  }

  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase()
    hazards = hazards.filter(
      (h) =>
        h.name.toLowerCase().includes(query) ||
        h.description.toLowerCase().includes(query) ||
        h.effect.toLowerCase().includes(query)
    )
  }

  // Exclude already added hazards
  const currentIds = props.hazards.map((h) => h.id)
  return hazards.filter((h) => !currentIds.includes(h.id))
})

// Custom hazard form
const customHazard = reactive({
  name: '',
  description: '',
  effect: '',
  affectedArea: '',
  duration: null as number | null,
})

const naturewalkEnvironment = computed(() => getNaturewalkEnvironmentSettings(props.hazards))
function setNaturewalkEnvironment(element: ElementType | null, enabled: boolean) {
  const settings = naturewalkEnvironment.value
  const next = element === null ? { ...settings, useMapTerrain: enabled }
    : { ...settings, elements: enabled ? [...new Set([...settings.elements, element])] : settings.elements.filter(value => value !== element) }
  const hazard: Hazard = {
    id: NATUREWALK_ENVIRONMENT_ID, name: 'Naturewalk Environment', description: 'GM-designated environments for Naturewalk benefits.',
    effect: [next.useMapTerrain ? 'Map terrain applies.' : '', next.elements.length ? `Qualifying elements: ${next.elements.join(', ')}.` : ''].filter(Boolean).join(' ') || 'No qualifying environments.',
    affectedArea: 'Encounter', duration: null, naturewalkEnvironment: next,
  }
  if (props.hazards.some(value => value.id === hazard.id)) emit('update', hazard)
  else emit('add', hazard)
}

function selectHazard(template: HazardTemplate) {
  const hazard: Hazard = {
    id: template.id,
    name: template.name,
    description: template.description,
    effect: template.effect,
    affectedArea: template.affectedArea,
    duration: template.duration,
  }
  emit('add', hazard)
}

function addCustomHazard() {
  if (!customHazard.name || !customHazard.effect) return

  const hazard: Hazard = {
    id: `custom-${Date.now()}`,
    name: customHazard.name,
    description: customHazard.description,
    effect: customHazard.effect,
    affectedArea: customHazard.affectedArea || 'Varies',
    duration: customHazard.duration,
  }
  emit('add', hazard)

  // Reset form
  customHazard.name = ''
  customHazard.description = ''
  customHazard.effect = ''
  customHazard.affectedArea = ''
  customHazard.duration = null
  showCustomForm.value = false
}

function decrementDuration(hazard: Hazard) {
  if (hazard.duration === null) return

  if (hazard.duration <= 1) {
    emit('remove', hazard.id)
  } else {
    emit('update', {
      ...hazard,
      duration: hazard.duration - 1,
    })
  }
}

function getSeverityColor(severity: HazardTemplate['severity']) {
  switch (severity) {
    case 'minor':
      return 'bg-green-900/30 text-green-400'
    case 'moderate':
      return 'bg-yellow-900/30 text-yellow-400'
    case 'severe':
      return 'bg-red-900/30 text-red-400'
    default:
      return 'bg-digimon-dark-600 text-digimon-dark-300'
  }
}

function getCategoryIcon(category: HazardTemplate['category']) {
  switch (category) {
    case 'terrain':
      return '🏔️'
    case 'weather':
      return '🌧️'
    case 'digital':
      return '💻'
    case 'trap':
      return '⚠️'
    case 'other':
      return '✨'
    default:
      return '❓'
  }
}
</script>

<template>
  <div class="space-y-4">
    <fieldset class="rounded-lg bg-digimon-dark-700 p-4 space-y-3">
      <legend class="font-semibold">Naturewalk environment</legend>
      <p class="text-sm text-digimon-dark-300">Map elements apply automatically. Select additional environments that qualify for this encounter.</p>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" :checked="naturewalkEnvironment.useMapTerrain" @change="setNaturewalkEnvironment(null, ($event.target as HTMLInputElement).checked)"> Use map terrain</label>
      <div class="flex flex-wrap gap-x-4 gap-y-2">
        <label v-for="element in NATUREWALK_ELEMENTS" :key="element" class="flex items-center gap-2 text-sm capitalize">
          <input type="checkbox" :checked="naturewalkEnvironment.elements.includes(element)" @change="setNaturewalkEnvironment(element, ($event.target as HTMLInputElement).checked)">{{ element }}
        </label>
      </div>
    </fieldset>
    <!-- Active Hazards -->
    <div v-if="hazards.length > 0" class="space-y-3">
      <div
        v-for="hazard in hazards"
        :key="hazard.id"
        class="bg-digimon-dark-700 rounded-lg p-4 border-l-4 border-yellow-500"
      >
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <div class="flex items-center gap-2 flex-wrap">
              <span class="font-semibold text-white">{{ hazard.name }}</span>
              <span
                v-if="hazard.duration !== null"
                class="text-xs px-2 py-0.5 rounded bg-digimon-dark-600 text-digimon-dark-300"
              >
                {{ hazard.duration }} round{{ hazard.duration !== 1 ? 's' : '' }} left
              </span>
              <span v-else class="text-xs px-2 py-0.5 rounded bg-digimon-dark-600 text-digimon-dark-300">
                Permanent
              </span>
            </div>
            <p v-if="hazard.description" class="text-sm text-digimon-dark-400 mt-1">
              {{ hazard.description }}
            </p>
            <div class="mt-2 bg-digimon-dark-800 rounded p-2">
              <p class="text-sm text-yellow-400">{{ hazard.effect }}</p>
              <p class="text-xs text-digimon-dark-400 mt-1">Area: {{ hazard.affectedArea }}</p>
            </div>
          </div>
          <div class="flex gap-2 ml-3">
            <button
              v-if="hazard.duration !== null"
              type="button"
              class="text-xs bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white px-2 py-1 rounded"
              title="Reduce duration by 1"
              @click="decrementDuration(hazard)"
            >
              -1 Round
            </button>
            <button
              type="button"
              class="text-red-400 hover:text-red-300 text-sm"
              @click="emit('remove', hazard.id)"
            >
              Remove
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Add Hazard -->
    <div v-if="!showSelector && !showCustomForm">
      <button
        type="button"
        class="w-full border-2 border-dashed border-digimon-dark-600 rounded-lg p-4
               text-digimon-dark-400 hover:border-yellow-500/50 hover:text-yellow-400
               transition-colors"
        @click="showSelector = true"
      >
        + Add Environmental Hazard
      </button>
    </div>

    <!-- Hazard Selector -->
    <div v-if="showSelector" class="border border-digimon-dark-600 rounded-lg p-4 bg-digimon-dark-750">
      <div class="flex justify-between items-center mb-4">
        <h4 class="font-semibold text-white">Select Hazard</h4>
        <button
          type="button"
          class="text-digimon-dark-400 hover:text-white"
          @click="showSelector = false"
        >
          ✕
        </button>
      </div>

      <!-- Search and filter -->
      <div class="flex gap-2 mb-4">
        <input
          v-model="searchQuery"
          type="text"
          placeholder="Search hazards..."
          class="flex-1 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                 text-white text-sm focus:border-yellow-500 focus:outline-none"
        />
        <select
          v-model="filterCategory"
          class="bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                 text-white text-sm focus:border-yellow-500 focus:outline-none"
        >
          <option value="all">All Types</option>
          <option v-for="cat in categories" :key="cat" :value="cat" class="capitalize">
            {{ cat }}
          </option>
        </select>
      </div>

      <!-- Hazard list -->
      <div class="max-h-64 overflow-y-auto space-y-2">
        <button
          v-for="hazard in availableHazards"
          :key="hazard.id"
          type="button"
          class="w-full text-left bg-digimon-dark-700 hover:bg-digimon-dark-600 rounded-lg p-3
                 transition-colors"
          @click="selectHazard(hazard)"
        >
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-lg">{{ getCategoryIcon(hazard.category) }}</span>
            <span class="font-semibold text-white">{{ hazard.name }}</span>
            <span :class="['text-xs px-2 py-0.5 rounded', getSeverityColor(hazard.severity)]">
              {{ hazard.severity }}
            </span>
            <span v-if="hazard.duration" class="text-xs text-digimon-dark-400">
              {{ hazard.duration }} rounds
            </span>
          </div>
          <p class="text-xs text-digimon-dark-400 mt-1 line-clamp-1">{{ hazard.description }}</p>
          <p class="text-xs text-yellow-400/70 mt-1 line-clamp-2">{{ hazard.effect }}</p>
        </button>

        <div v-if="availableHazards.length === 0" class="text-center py-4 text-digimon-dark-400">
          No hazards found
        </div>
      </div>

      <!-- Custom hazard button -->
      <div class="mt-4 pt-4 border-t border-digimon-dark-600">
        <button
          type="button"
          class="text-sm text-digimon-dark-400 hover:text-yellow-400 transition-colors"
          @click="showCustomForm = true; showSelector = false"
        >
          + Create Custom Hazard
        </button>
      </div>
    </div>

    <!-- Custom Hazard Form -->
    <div v-if="showCustomForm" class="border border-digimon-dark-600 rounded-lg p-4 bg-digimon-dark-750">
      <div class="flex justify-between items-center mb-4">
        <h4 class="font-semibold text-white">Create Custom Hazard</h4>
        <button
          type="button"
          class="text-digimon-dark-400 hover:text-white"
          @click="showCustomForm = false"
        >
          ✕
        </button>
      </div>

      <div class="space-y-3">
        <div>
          <label class="block text-sm text-digimon-dark-400 mb-1">Name *</label>
          <input
            v-model="customHazard.name"
            type="text"
            placeholder="Hazard name"
            class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                   text-white text-sm focus:border-yellow-500 focus:outline-none"
          />
        </div>

        <div>
          <label class="block text-sm text-digimon-dark-400 mb-1">Description</label>
          <input
            v-model="customHazard.description"
            type="text"
            placeholder="What is this hazard?"
            class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                   text-white text-sm focus:border-yellow-500 focus:outline-none"
          />
        </div>

        <div>
          <label class="block text-sm text-digimon-dark-400 mb-1">Effect *</label>
          <textarea
            v-model="customHazard.effect"
            rows="2"
            placeholder="What mechanical effect does it have?"
            class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                   text-white text-sm focus:border-yellow-500 focus:outline-none resize-none"
          />
        </div>

        <div class="grid grid-cols-2 gap-3">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Affected Area</label>
            <input
              v-model="customHazard.affectedArea"
              type="text"
              placeholder="e.g., 10ft radius"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                     text-white text-sm focus:border-yellow-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Duration (rounds)</label>
            <input
              v-model.number="customHazard.duration"
              type="number"
              min="1"
              placeholder="Leave empty for permanent"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                     text-white text-sm focus:border-yellow-500 focus:outline-none"
            />
          </div>
        </div>

        <div class="flex gap-2 pt-2">
          <button
            type="button"
            class="bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded text-sm font-semibold"
            @click="addCustomHazard"
          >
            Add Hazard
          </button>
          <button
            type="button"
            class="bg-digimon-dark-600 hover:bg-digimon-dark-500 text-white px-4 py-2 rounded text-sm"
            @click="showCustomForm = false"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
