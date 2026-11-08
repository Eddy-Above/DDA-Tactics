<script setup lang="ts">
import { reactive, ref } from 'vue'
import { EFFECT_ALIGNMENT, EFFECT_ATTACK_TYPE_RESTRICTIONS, EFFECT_POTENCY_STAT, PERMANENT_EFFECTS } from '../data/attackConstants'

interface Effect {
  id: string
  name: string
  type: 'buff' | 'debuff' | 'status'
  duration: number
  source: string
  description: string
  potency?: number
  potencyStat?: string
}

interface Props {
  effects: Effect[]
  participantName: string
  stunMaxDuration1?: boolean
  sources?: Array<{ id: string; name: string; cpu?: number; bit?: number }>
}

const props = defineProps<Props>()
const emit = defineEmits<{
  (e: 'add', effect: Effect): void
  (e: 'remove', effectId: string): void
  (e: 'update', effects: Effect[]): void
}>()

const showAddForm = ref(false)
const pendingQuickEffect = ref<{ effect: typeof commonEffects[0], duration: number, potency: number, source: string } | null>(null)
const newEffect = reactive({
  name: '',
  type: 'buff' as 'buff' | 'debuff' | 'status',
  duration: 3,
  description: '',
  source: '',
  potency: 0,
})

function sourceEffectName(name: string): string | null {
  return ['Taunt', 'Fear'].find(effect => effect.toLowerCase() === name.trim().toLowerCase()) ?? null
}

function hasValidSource(name: string, source: string): boolean {
  return !sourceEffectName(name) || !!props.sources?.some(candidate => candidate.id === source)
}

function sourceSpec(name: string, source: string): number | undefined {
  const candidate = props.sources?.find(candidate => candidate.id === source)
  return sourceEffectName(name) === 'Taunt' ? candidate?.cpu : candidate?.bit
}

function selectQuickSource() {
  const pending = pendingQuickEffect.value
  if (!pending) return
  pending.potency = sourceSpec(pending.effect.name, pending.source) ?? pending.potency
}

function selectCustomSource() {
  newEffect.potency = sourceSpec(newEffect.name, newEffect.source) ?? newEffect.potency
}

function storedSourcePotency(name: string, spec: number): number {
  const value = Math.max(0, Math.floor(Number(spec) || 0))
  return sourceEffectName(name) === 'Taunt' ? value * 2 : value
}

function updateEffectSource(effectId: string, source: string) {
  const effect = props.effects.find(effect => effect.id === effectId)
  if (!effect || !hasValidSource(effect.name, source)) return
  const spec = sourceSpec(effect.name, source)
  emit('update', props.effects.map(existing => existing.id === effectId ? {
    ...existing, source, type: getEffectType(effect.name),
    ...(spec !== undefined ? { potency: storedSourcePotency(effect.name, spec) } : {}),
  } : existing))
}

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
  if (!newEffect.name.trim() || !hasValidSource(newEffect.name, newEffect.source)) return
  const sourceName = sourceEffectName(newEffect.name)

  const effect: Effect = {
    id: `effect-${Date.now()}`,
    name: sourceName ?? newEffect.name,
    type: sourceName ? getEffectType(sourceName) : newEffect.type,
    duration: (props.stunMaxDuration1 && newEffect.name === 'Stun') ? 1 : newEffect.duration,
    source: sourceName ? newEffect.source : 'Manual',
    description: newEffect.description,
    ...(sourceName ? { potency: storedSourcePotency(sourceName, newEffect.potency), potencyStat: EFFECT_POTENCY_STAT[sourceName] } : {}),
  }

  emit('add', effect)
  showAddForm.value = false
  newEffect.name = ''
  newEffect.type = 'buff'
  newEffect.duration = 3
  newEffect.description = ''
  newEffect.source = ''
  newEffect.potency = 0
}

function applyQuickEffect(effect: typeof commonEffects[0]) {
  pendingQuickEffect.value = { effect, duration: PERMANENT_EFFECTS.has(effect.name) ? 0 : 1, potency: 0, source: '' }
}

function confirmQuickEffect() {
  if (!pendingQuickEffect.value) return
  const { effect, duration: rawDuration, potency, source } = pendingQuickEffect.value
  if (!hasValidSource(effect.name, source)) return
  const duration = (props.stunMaxDuration1 && effect.name === 'Stun') ? 1 : rawDuration
  const hasPotency = !!EFFECT_POTENCY_STAT[effect.name]
  emit('add', {
    id: `effect-${Date.now()}`,
    name: effect.name,
    type: effect.type,
    duration,
    source: sourceEffectName(effect.name) ? source : 'Quick Apply',
    description: effect.description,
    ...(hasPotency ? { potency: storedSourcePotency(effect.name, potency), potencyStat: EFFECT_POTENCY_STAT[effect.name] } : {}),
  })
  pendingQuickEffect.value = null
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
            <span v-if="effect.potency" class="text-xs opacity-75 ml-1">{{ effect.potency }}</span>
            <span v-if="effect.duration > 0" class="text-xs opacity-75">({{ effect.duration }} rounds)</span>
          </div>
          <p v-if="effect.description" class="text-xs opacity-75 mt-1">
            {{ effect.description }}
          </p>
          <label v-if="sourceEffectName(effect.name)" class="block text-xs mt-1">
            Source
            <select :value="effect.source" class="ml-1 bg-digimon-dark-700 text-white rounded px-1 py-0.5"
              @change="updateEffectSource(effect.id, ($event.target as HTMLSelectElement).value)">
              <option v-if="!sources?.some(source => source.id === effect.source)" :value="effect.source" disabled>Select source</option>
              <option v-for="source in sources ?? []" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
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

    <!-- Quick apply config row -->
    <div v-if="pendingQuickEffect" class="mt-2 p-2 bg-digimon-dark-700 rounded border border-digimon-dark-600 text-sm">
      <div class="font-medium text-white mb-2">Configure: {{ pendingQuickEffect.effect.name }}</div>
      <div class="flex flex-wrap gap-2 items-center">
        <label v-if="sourceEffectName(pendingQuickEffect.effect.name)" class="text-digimon-dark-400">
          Source
          <select v-model="pendingQuickEffect.source" class="ml-1 bg-digimon-dark-600 text-white rounded px-2 py-1" @change="selectQuickSource">
            <option value="" disabled>Select source</option>
            <option v-for="source in sources ?? []" :key="source.id" :value="source.id">{{ source.name }}</option>
          </select>
        </label>
        <template v-if="!PERMANENT_EFFECTS.has(pendingQuickEffect.effect.name)">
          <template v-if="!(stunMaxDuration1 && pendingQuickEffect.effect.name === 'Stun')">
            <label class="text-digimon-dark-400">Duration</label>
            <input
              v-model.number="pendingQuickEffect.duration"
              type="number"
              min="1"
              max="99"
              class="w-16 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-2 py-1 text-white text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </template>
          <span v-else class="text-digimon-dark-400 text-xs">Duration: 1 round (house rule)</span>
        </template>
        <span v-else class="text-digimon-dark-400 text-xs">Permanent</span>
        <template v-if="EFFECT_POTENCY_STAT[pendingQuickEffect.effect.name]">
          <label class="text-digimon-dark-400 ml-1">{{ sourceEffectName(pendingQuickEffect.effect.name) === 'Taunt' ? 'CPU (penalty ×2)' : sourceEffectName(pendingQuickEffect.effect.name) === 'Fear' ? 'BIT' : 'Spec Value' }}</label>
          <input
            v-model.number="pendingQuickEffect.potency"
            type="number"
            min="0"
            class="w-16 bg-digimon-dark-600 border border-digimon-dark-500 rounded px-2 py-1 text-white text-center focus:border-digimon-orange-500 focus:outline-none"
          />
        </template>
        <button
          :disabled="!hasValidSource(pendingQuickEffect.effect.name, pendingQuickEffect.source)"
          class="ml-auto bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-3 py-1 rounded text-xs"
          @click="confirmQuickEffect"
        >Apply</button>
        <button
          class="text-digimon-dark-400 hover:text-white text-xs px-2 py-1"
          @click="pendingQuickEffect = null"
        >Cancel</button>
      </div>
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
          <template v-if="!(stunMaxDuration1 && newEffect.name === 'Stun')">
            <input
              v-model.number="newEffect.duration"
              type="number"
              min="1"
              max="99"
              placeholder="Rounds"
              class="w-20 bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                     text-white text-sm text-center focus:border-digimon-orange-500 focus:outline-none"
            />
          </template>
          <span v-else class="text-digimon-dark-400 text-xs self-center">1 round (house rule)</span>
        </div>
        <div v-if="sourceEffectName(newEffect.name)" class="flex gap-2 items-center text-sm text-digimon-dark-300">
          <label>Source
            <select v-model="newEffect.source" class="bg-digimon-dark-700 text-white rounded p-1" @change="selectCustomSource">
              <option value="" disabled>Select source</option>
              <option v-for="source in sources ?? []" :key="source.id" :value="source.id">{{ source.name }}</option>
            </select>
          </label>
          <label>{{ sourceEffectName(newEffect.name) === 'Taunt' ? 'CPU (penalty ×2)' : 'BIT' }}
            <input v-model.number="newEffect.potency" type="number" min="0" step="1" class="w-16 bg-digimon-dark-700 text-white rounded p-1" />
          </label>
        </div>
        <textarea
          v-model="newEffect.description"
          rows="2"
          placeholder="Effect description..."
          class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded px-2 py-1
                 text-white text-sm focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
        <button
          :disabled="!hasValidSource(newEffect.name, newEffect.source)"
          class="w-full bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-3 py-1 rounded text-sm"
          @click="addEffect"
        >
          Add Effect
        </button>
      </div>
    </div>
  </div>
</template>
