<script setup lang="ts">
import type { DigimonStage } from '../../../types'
import { getStageColor } from '../../../utils/displayHelpers'
import type { EvolutionChainEntry } from '../../../composables/useEvolution'
import type { Digimon } from '../../../server/db/schema'

definePageMeta({
  title: 'New Evolution Line',
})

const router = useRouter()
const { createEvolutionLine, loading, error } = useEvolution()
const { tamers, fetchTamers } = useTamers()
const { digimonList, fetchDigimon } = useDigimon()

onMounted(async () => {
  await Promise.all([fetchTamers(), fetchDigimon()])
})

const stages: DigimonStage[] = ['fresh', 'in-training', 'rookie', 'champion', 'ultimate', 'mega']
const requirementTypes = ['battles', 'xp', 'bond', 'item', 'special'] as const

const form = reactive({
  name: '',
  description: '',
  partnerId: '',
  chain: [] as EvolutionChainEntry[],
})

// New entry form
const newEntry = reactive({
  stage: 'rookie' as DigimonStage,
  species: '',
  digimonId: null as string | null,
  hasRequirements: false,
  requirementType: 'battles' as typeof requirementTypes[number],
  requirementValue: 5,
  requirementDescription: '',
  requirementItemName: '',
})

// Filter Digimon by selected stage
const digimonForStage = computed(() => {
  return digimonList.value.filter(d => d.stage === newEntry.stage)
})

// When a Digimon is selected, auto-fill species name
function handleDigimonSelect(digimonId: string | null) {
  newEntry.digimonId = digimonId
  if (digimonId) {
    const selected = digimonList.value.find(d => d.id === digimonId)
    if (selected) {
      newEntry.species = selected.species
    }
  }
}

function addChainEntry() {
  if (!newEntry.species.trim()) return

  const entry: EvolutionChainEntry = {
    stage: newEntry.stage,
    species: newEntry.species,
    digimonId: newEntry.digimonId,
    requirements: newEntry.hasRequirements
      ? {
          type: newEntry.requirementType,
          description: newEntry.requirementDescription || `Requires ${newEntry.requirementValue} ${newEntry.requirementType}`,
          value: newEntry.requirementType === 'item' || newEntry.requirementType === 'special' ? null : newEntry.requirementValue,
          itemName: newEntry.requirementType === 'item' ? newEntry.requirementItemName : null,
        }
      : null,
  }

  form.chain.push(entry)

  // Auto-advance to next stage
  const currentStageIndex = stages.indexOf(newEntry.stage)
  if (currentStageIndex < stages.length - 1) {
    newEntry.stage = stages[currentStageIndex + 1]
  }

  // Reset form
  newEntry.species = ''
  newEntry.digimonId = null
  newEntry.hasRequirements = false
  newEntry.requirementValue = 5
  newEntry.requirementDescription = ''
  newEntry.requirementItemName = ''
}

function removeChainEntry(index: number) {
  form.chain.splice(index, 1)
}

function moveEntryUp(index: number) {
  if (index === 0) return
  const temp = form.chain[index]
  form.chain[index] = form.chain[index - 1]
  form.chain[index - 1] = temp
}

function moveEntryDown(index: number) {
  if (index === form.chain.length - 1) return
  const temp = form.chain[index]
  form.chain[index] = form.chain[index + 1]
  form.chain[index + 1] = temp
}

async function handleSubmit() {
  if (!form.name.trim() || form.chain.length === 0) {
    return
  }

  const created = await createEvolutionLine({
    name: form.name,
    description: form.description,
    chain: form.chain,
    partnerId: form.partnerId || undefined,
  })

  if (created) {
    router.push('/library/evolution')
  }
}

// Common evolution line templates
const templates = [
  {
    name: 'Agumon Line',
    chain: [
      { stage: 'fresh', species: 'Botamon' },
      { stage: 'in-training', species: 'Koromon' },
      { stage: 'rookie', species: 'Agumon' },
      { stage: 'champion', species: 'Greymon' },
      { stage: 'ultimate', species: 'MetalGreymon' },
      { stage: 'mega', species: 'WarGreymon' },
    ],
  },
  {
    name: 'Gabumon Line',
    chain: [
      { stage: 'fresh', species: 'Punimon' },
      { stage: 'in-training', species: 'Tsunomon' },
      { stage: 'rookie', species: 'Gabumon' },
      { stage: 'champion', species: 'Garurumon' },
      { stage: 'ultimate', species: 'WereGarurumon' },
      { stage: 'mega', species: 'MetalGarurumon' },
    ],
  },
  {
    name: 'Patamon Line',
    chain: [
      { stage: 'fresh', species: 'Poyomon' },
      { stage: 'in-training', species: 'Tokomon' },
      { stage: 'rookie', species: 'Patamon' },
      { stage: 'champion', species: 'Angemon' },
      { stage: 'ultimate', species: 'MagnaAngemon' },
      { stage: 'mega', species: 'Seraphimon' },
    ],
  },
]

function applyTemplate(template: typeof templates[0]) {
  form.name = template.name
  form.chain = template.chain.map((entry) => ({
    ...entry,
    stage: entry.stage as DigimonStage,
    digimonId: null,
    requirements: null,
  }))
}

// Get linked Digimon for chain entry display
function getLinkedDigimon(digimonId: string | null): Digimon | null {
  if (!digimonId) return null
  return digimonList.value.find(d => d.id === digimonId) || null
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/library/evolution" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back to Evolution Lines
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">New Evolution Line</h1>
    </div>

    <form class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Basic Information</h2>

        <!-- Quick Templates -->
        <div class="mb-4">
          <label class="block text-sm text-digimon-dark-400 mb-2">Quick Start Templates</label>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="template in templates"
              :key="template.name"
              type="button"
              class="px-3 py-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white text-sm rounded transition-colors"
              @click="applyTemplate(template)"
            >
              {{ template.name }}
            </button>
          </div>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Line Name</label>
            <input
              v-model="form.name"
              type="text"
              required
              placeholder="e.g., Agumon Line"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Partner Tamer (Optional)</label>
            <select
              v-model="form.partnerId"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            >
              <option value="">No Partner</option>
              <option v-for="tamer in tamers" :key="tamer.id" :value="tamer.id">
                {{ tamer.name }}
              </option>
            </select>
          </div>
        </div>
        <div class="mt-4">
          <label class="block text-sm text-digimon-dark-400 mb-1">Description (Optional)</label>
          <textarea
            v-model="form.description"
            rows="2"
            placeholder="Notes about this evolution line..."
            class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                   text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
          />
        </div>
      </div>

      <!-- Evolution Chain -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Evolution Chain</h2>

        <!-- Current chain -->
        <div v-if="form.chain.length > 0" class="space-y-3 mb-6">
          <div
            v-for="(entry, index) in form.chain"
            :key="index"
            class="bg-digimon-dark-700 rounded-lg p-4 flex items-center gap-4"
          >
            <div class="flex flex-col gap-1">
              <button
                type="button"
                :disabled="index === 0"
                class="text-xs text-digimon-dark-400 hover:text-white disabled:opacity-30"
                @click="moveEntryUp(index)"
              >
                ▲
              </button>
              <button
                type="button"
                :disabled="index === form.chain.length - 1"
                class="text-xs text-digimon-dark-400 hover:text-white disabled:opacity-30"
                @click="moveEntryDown(index)"
              >
                ▼
              </button>
            </div>

            <div v-if="getLinkedDigimon(entry.digimonId)?.spriteUrl" class="w-12 h-12 bg-digimon-dark-600 rounded overflow-hidden flex items-center justify-center shrink-0">
              <img
                :src="getLinkedDigimon(entry.digimonId)!.spriteUrl!"
                :alt="entry.species"
                class="max-w-full max-h-full object-contain"
              />
            </div>

            <div class="flex-1">
              <div class="flex items-center gap-3">
                <span class="text-2xl">{{ index + 1 }}.</span>
                <span :class="['font-semibold capitalize', getStageColor(entry.stage)]">
                  {{ entry.stage }}
                </span>
                <span class="text-white">{{ entry.species }}</span>
                <span v-if="entry.digimonId" class="text-xs text-cyan-400">
                  (linked: {{ getLinkedDigimon(entry.digimonId)?.name }})
                </span>
              </div>
              <div v-if="entry.requirements" class="text-sm text-digimon-dark-400 mt-1">
                Requires: {{ entry.requirements.description }}
              </div>
            </div>

            <button
              type="button"
              class="text-red-400 hover:text-red-300 text-sm"
              @click="removeChainEntry(index)"
            >
              Remove
            </button>
          </div>
        </div>

        <!-- Add entry form -->
        <div class="border border-dashed border-digimon-dark-600 rounded-lg p-4">
          <h3 class="text-sm font-semibold text-digimon-dark-300 mb-3">Add Evolution Stage</h3>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label class="block text-xs text-digimon-dark-400 mb-1">Stage</label>
              <select
                v-model="newEntry.stage"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none capitalize"
              >
                <option v-for="stage in stages" :key="stage" :value="stage" class="capitalize">
                  {{ stage }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-xs text-digimon-dark-400 mb-1">Link Existing Digimon</label>
              <select
                :value="newEntry.digimonId"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
                @change="handleDigimonSelect(($event.target as HTMLSelectElement).value || null)"
              >
                <option value="">-- Select or type manually --</option>
                <option v-for="d in digimonForStage" :key="d.id" :value="d.id">
                  {{ d.name }} ({{ d.species }})
                </option>
              </select>
              <p v-if="digimonForStage.length === 0" class="text-xs text-digimon-dark-500 mt-1">
                No {{ newEntry.stage }} Digimon in library
              </p>
            </div>
            <div>
              <label class="block text-xs text-digimon-dark-400 mb-1">Species Name</label>
              <input
                v-model="newEntry.species"
                type="text"
                placeholder="e.g., Agumon"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
                @keyup.enter="addChainEntry"
              />
            </div>
          </div>

          <!-- Requirements -->
          <div class="mb-3">
            <label class="flex items-center gap-2 cursor-pointer">
              <input
                v-model="newEntry.hasRequirements"
                type="checkbox"
                class="w-4 h-4 bg-digimon-dark-700 border border-digimon-dark-600 rounded
                       text-digimon-orange-500 focus:ring-digimon-orange-500"
              />
              <span class="text-sm text-digimon-dark-300">Has evolution requirements</span>
            </label>
          </div>

          <div v-if="newEntry.hasRequirements" class="grid grid-cols-1 md:grid-cols-3 gap-3 mb-3">
            <div>
              <label class="block text-xs text-digimon-dark-400 mb-1">Requirement Type</label>
              <select
                v-model="newEntry.requirementType"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none capitalize"
              >
                <option v-for="type in requirementTypes" :key="type" :value="type" class="capitalize">
                  {{ type }}
                </option>
              </select>
            </div>
            <div v-if="newEntry.requirementType !== 'item' && newEntry.requirementType !== 'special'">
              <label class="block text-xs text-digimon-dark-400 mb-1">Required Value</label>
              <input
                v-model.number="newEntry.requirementValue"
                type="number"
                min="1"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div v-if="newEntry.requirementType === 'item'">
              <label class="block text-xs text-digimon-dark-400 mb-1">Item Name</label>
              <input
                v-model="newEntry.requirementItemName"
                type="text"
                placeholder="e.g., Crest of Courage"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
            <div :class="newEntry.requirementType === 'special' ? 'md:col-span-2' : ''">
              <label class="block text-xs text-digimon-dark-400 mb-1">Description</label>
              <input
                v-model="newEntry.requirementDescription"
                type="text"
                placeholder="e.g., Win 5 battles"
                class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-3 py-2
                       text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
              />
            </div>
          </div>

          <button
            type="button"
            :disabled="!newEntry.species.trim()"
            class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                   text-white px-4 py-2 rounded text-sm font-medium"
            @click="addChainEntry"
          >
            Add to Chain
          </button>
        </div>
      </div>

      <!-- Error message -->
      <div v-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
        {{ error }}
      </div>

      <!-- Submit -->
      <div class="flex gap-4">
        <button
          type="submit"
          :disabled="loading || form.chain.length === 0"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
        >
          {{ loading ? 'Creating...' : 'Create Evolution Line' }}
        </button>
        <NuxtLink
          to="/library/evolution"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
