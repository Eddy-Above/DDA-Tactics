<script setup lang="ts">
import { EFFECT_ALIGNMENT, EFFECT_ATTACK_TYPE_RESTRICTIONS } from '../data/attackConstants'

interface Effect {
  id: string
  name: string
  type: 'buff' | 'debuff' | 'status'
  duration: number
  source: string
  description: string
}

interface Props {
  effects: Effect[]
  participantName: string
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'add', effect: Effect): void
  (e: 'remove', effectId: string): void
  (e: 'update', effects: Effect[]): void
}>()

const showAddForm = ref(false)
const newEffect = reactive({
  name: '',
  type: 'buff' as 'buff' | 'debuff' | 'status',
  duration: 3,
  description: '',
})

// Build effects list from game system constants
function getEffectType(name: string): 'buff' | 'debuff' | 'status' {
  const alignment = EFFECT_ALIGNMENT[name]
  if (alignment === 'P') return 'buff'
  if (alignment === 'N') return 'debuff'
  if (alignment === 'NA') return 'status'
  // For effects only in EFFECT_ATTACK_TYPE_RESTRICTIONS, infer from attack type restriction
  const restriction = EFFECT_ATTACK_TYPE_RESTRICTIONS[name]
  if (restriction === 'support') return 'buff'
  if (restriction === 'damage') return 'debuff'
  return 'status'
}

const commonEffects = (() => {
  const allNames = new Set([
    ...Object.keys(EFFECT_ALIGNMENT),
    ...Object.keys(EFFECT_ATTACK_TYPE_RESTRICTIONS),
  ])
  return Array.from(allNames)
    .sort()
    .map((name) => ({
      name,
      type: getEffectType(name),
      duration: 1,
      description: '',
    }))
})()

function addEffect() {
  if (!newEffect.name.trim()) return

  const effect: Effect = {
    id: `effect-${Date.now()}`,
    name: newEffect.name,
    type: newEffect.type,
    duration: newEffect.duration,
    source: 'Manual',
    description: newEffect.description,
  }

  emit('add', effect)
  showAddForm.value = false
  newEffect.name = ''
  newEffect.type = 'buff'
  newEffect.duration = 3
  newEffect.description = ''
}

function applyQuickEffect(effect: typeof commonEffects[0]) {
  const newEff: Effect = {
    id: `effect-${Date.now()}`,
    name: effect.name,
    type: effect.type,
    duration: effect.duration,
    source: 'Quick Apply',
    description: effect.description,
  }
  emit('add', newEff)
}

function getEffectColor(type: string) {
  const colors = {
    buff: 'bg-green-900/30 text-green-400 border-green-500/30',
    debuff: 'bg-red-900/30 text-red-400 border-red-500/30',
    status: 'bg-yellow-900/30 text-yellow-400 border-yellow-500/30',
  }
  return colors[type as keyof typeof colors] || colors.status
}
</script>

<template>
  <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700">
    <div class="flex justify-between items-center mb-3">
      <h3 class="font-display text-lg font-semibold text-white">
        Effects on {{ participantName }}
      </h3>
      <button
        class="text-sm bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-2 py-1 rounded"
        @click="showAddForm = !showAddForm"
      >
        {{ showAddForm ? 'Cancel' : '+ Add' }}
      </button>
    </div>

    <!-- Current effects -->
    <div v-if="effects.length > 0" class="space-y-2 mb-4">
      <div
        v-for="effect in effects"
        :key="effect.id"
        :class="['p-2 rounded border flex justify-between items-start', getEffectColor(effect.type)]"
      >
        <div>
          <div class="flex items-center gap-2">
            <span class="font-medium">{{ effect.name }}</span>
            <span class="text-xs opacity-75">({{ effect.duration }} rounds)</span>
          </div>
          <p v-if="effect.description" class="text-xs opacity-75 mt-1">
            {{ effect.description }}
          </p>
        </div>
        <button
          class="text-xs opacity-75 hover:opacity-100"
          @click="emit('remove', effect.id)"
        >
          ✕
        </button>
      </div>
    </div>
    <div v-else class="text-digimon-dark-400 text-sm mb-4">
      No active effects
    </div>

    <!-- Quick apply buttons -->
    <div class="mb-4">
      <label class="block text-xs text-digimon-dark-400 mb-2">Quick Apply</label>
      <div class="flex flex-wrap gap-1">
        <button
          v-for="effect in commonEffects"
          :key="effect.name"
          :class="[
            'text-xs px-2 py-1 rounded border transition-colors',
            effect.type === 'buff' && 'bg-green-900/20 text-green-400 border-green-500/30 hover:bg-green-900/40',
            effect.type === 'debuff' && 'bg-red-900/20 text-red-400 border-red-500/30 hover:bg-red-900/40',
            effect.type === 'status' && 'bg-yellow-900/20 text-yellow-400 border-yellow-500/30 hover:bg-yellow-900/40',
          ]"
          :title="effect.description"
          @click="applyQuickEffect(effect)"
        >
          {{ effect.name }}
        </button>
      </div>
    </div>

    <!-- Add custom effect form -->
    <div v-if="showAddForm" class="border border-dashed border-digimon-dark-600 rounded-lg p-3">
      <h4 class="text-sm font-semibold text-digimon-dark-300 mb-2">Custom Effect</h4>
      <div class="space-y-2">
        <input
          v-model="newEffect.name"
          type="text"
          placeholder="Effect name"
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                 text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
        />
        <div class="flex gap-2">
          <select
            v-model="newEffect.type"
            class="flex-1 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                   text-white text-sm focus:border-digimon-orange-500 focus:outline-none"
          >
            <option value="buff">Buff</option>
            <option value="debuff">Debuff</option>
            <option value="status">Status</option>
          </select>
          <input
            v-model.number="newEffect.duration"
            type="number"
            min="1"
            max="99"
            placeholder="Rounds"
            class="w-20 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                   text-white text-sm text-center focus:border-digimon-orange-500 focus:outline-none"
          />
        </div>
        <textarea
          v-model="newEffect.description"
          rows="2"
          placeholder="Effect description..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                 text-white text-sm focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
        <button
          class="w-full bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-3 py-1 rounded text-sm"
          @click="addEffect"
        >
          Add Effect
        </button>
      </div>
    </div>
  </div>
</template>
