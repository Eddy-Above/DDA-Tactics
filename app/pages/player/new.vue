<script setup lang="ts">
import type { CreateTamerData } from '../../composables/useTamers'

definePageMeta({
  layout: 'player',
  title: 'Create Your Character',
})

const router = useRouter()
const { createTamer, loading, error } = useTamers()
const selectedTamerId = useCookie<string | null>('player-tamer-id', { default: () => null })

const form = reactive<CreateTamerData>({
  name: '',
  age: 14,
  campaignLevel: 'standard',
  attributes: {
    agility: 2,
    body: 2,
    charisma: 2,
    intelligence: 2,
    willpower: 2,
  },
  skills: {
    dodge: 0,
    fight: 0,
    stealth: 0,
    athletics: 0,
    endurance: 0,
    featsOfStrength: 0,
    manipulate: 0,
    perform: 0,
    persuasion: 0,
    computer: 0,
    survival: 0,
    knowledge: 0,
    perception: 0,
    decipherIntent: 0,
    bravery: 0,
  },
  aspects: [],
  torments: [],
  notes: '',
})

const attributePoints = computed(() => {
  const total = Object.values(form.attributes).reduce((a, b) => a + b, 0)
  const max = form.campaignLevel === 'standard' ? 14 : form.campaignLevel === 'enhanced' ? 16 : 18
  return { used: total, max }
})

const skillPoints = computed(() => {
  const total = Object.values(form.skills).reduce((a, b) => a + b, 0)
  const max = form.campaignLevel === 'standard' ? 20 : form.campaignLevel === 'enhanced' ? 25 : 30
  return { used: total, max }
})

const skillsByAttribute = {
  agility: ['dodge', 'fight', 'stealth'],
  body: ['athletics', 'endurance', 'featsOfStrength'],
  charisma: ['manipulate', 'perform', 'persuasion'],
  intelligence: ['computer', 'survival', 'knowledge'],
  willpower: ['perception', 'decipherIntent', 'bravery'],
}

const skillLabels: Record<string, string> = {
  dodge: 'Dodge',
  fight: 'Fight',
  stealth: 'Stealth',
  athletics: 'Athletics',
  endurance: 'Endurance',
  featsOfStrength: 'Feats of Strength',
  manipulate: 'Manipulate',
  perform: 'Perform',
  persuasion: 'Persuasion',
  computer: 'Computer',
  survival: 'Survival',
  knowledge: 'Knowledge',
  perception: 'Perception',
  decipherIntent: 'Decipher Intent',
  bravery: 'Bravery',
}

async function handleSubmit() {
  const created = await createTamer(form)
  if (created) {
    selectedTamerId.value = created.id
    router.push(`/player/${created.id}`)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-4xl">
    <div class="mb-8">
      <NuxtLink to="/player" class="text-digimon-dark-400 hover:text-white text-sm mb-2 inline-block">
        &larr; Back
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Create Your Character</h1>
    </div>

    <form class="space-y-8" @submit.prevent="handleSubmit">
      <!-- Basic Info -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Basic Information</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
            <input
              v-model="form.name"
              type="text"
              required
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Age</label>
            <input
              v-model.number="form.age"
              type="number"
              min="6"
              max="100"
              required
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
          <div>
            <label class="block text-sm text-digimon-dark-400 mb-1">Campaign Level</label>
            <select
              v-model="form.campaignLevel"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            >
              <option value="standard">Standard</option>
              <option value="enhanced">Enhanced</option>
              <option value="extreme">Extreme</option>
            </select>
          </div>
        </div>
      </div>

      <!-- Attributes -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Attributes</h2>
          <span
            :class="[
              'text-sm px-3 py-1 rounded',
              attributePoints.used === attributePoints.max && 'bg-green-900/30 text-green-400',
              attributePoints.used < attributePoints.max && 'bg-yellow-900/30 text-yellow-400',
              attributePoints.used > attributePoints.max && 'bg-red-900/30 text-red-400',
            ]"
          >
            {{ attributePoints.used }} / {{ attributePoints.max }} points
          </span>
        </div>
        <div class="grid grid-cols-5 gap-4">
          <div v-for="attr in (['agility', 'body', 'charisma', 'intelligence', 'willpower'] as const)" :key="attr" class="text-center">
            <label class="block text-sm text-digimon-dark-400 mb-2 capitalize">{{ attr }}</label>
            <input
              v-model.number="form.attributes[attr]"
              type="number"
              min="1"
              max="5"
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-2 py-2
                     text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>
        </div>
      </div>

      <!-- Skills -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <div class="flex justify-between items-center mb-4">
          <h2 class="font-display text-xl font-semibold text-white">Skills</h2>
          <span
            :class="[
              'text-sm px-3 py-1 rounded',
              skillPoints.used === skillPoints.max && 'bg-green-900/30 text-green-400',
              skillPoints.used < skillPoints.max && 'bg-yellow-900/30 text-yellow-400',
              skillPoints.used > skillPoints.max && 'bg-red-900/30 text-red-400',
            ]"
          >
            {{ skillPoints.used }} / {{ skillPoints.max }} points
          </span>
        </div>
        <div class="grid grid-cols-1 md:grid-cols-5 gap-6">
          <div v-for="(skills, attr) in skillsByAttribute" :key="attr">
            <h3 class="text-sm font-semibold text-digimon-orange-400 mb-3 capitalize">{{ attr }}</h3>
            <div class="space-y-2">
              <div v-for="skill in skills" :key="skill" class="flex items-center gap-2">
                <label class="flex-1 text-sm text-digimon-dark-300">{{ skillLabels[skill] }}</label>
                <input
                  v-model.number="form.skills[skill as keyof typeof form.skills]"
                  type="number"
                  min="0"
                  max="5"
                  class="w-14 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                         text-white text-center text-sm focus:border-digimon-orange-500 focus:outline-none"
                />
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Notes -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Notes</h2>
        <textarea
          v-model="form.notes"
          rows="4"
          placeholder="Character background, personality, goals..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                 text-white focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
      </div>

      <!-- Error message -->
      <div v-if="error" class="bg-red-900/20 border border-red-500 rounded-lg p-4 text-red-400">
        {{ error }}
      </div>

      <!-- Submit -->
      <div class="flex gap-4">
        <button
          type="submit"
          :disabled="loading"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-2 rounded-lg font-semibold transition-colors"
        >
          {{ loading ? 'Creating...' : 'Create Character' }}
        </button>
        <NuxtLink
          to="/player"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-2 rounded-lg
                 font-semibold transition-colors"
        >
          Cancel
        </NuxtLink>
      </div>
    </form>
  </div>
</template>
