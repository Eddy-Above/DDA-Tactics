<script setup lang="ts">
import { ref } from 'vue'

interface RollResult {
  fatefulIntervention?: boolean
  rolls: number[]
  successes: number
  dicePool: number
  successThreshold?: number
  automaticSuccesses?: number
}

interface Props {
  currentInspiration: number
  maxInspiration: number
  loading: boolean
  spendInspiration: (kind: 'reroll' | 'modifier', amount: number) => Promise<boolean>
  fatefulCost?: number
}

const props = defineProps<Props>()
defineEmits<{ fateful: [] }>()
const spending = ref(false)

const rollResult = defineModel<RollResult | null>('rollResult', { required: true })

function recompute(rolls: number[], roll: RollResult) {
  return rolls.filter(d => d >= (roll.successThreshold ?? 5)).length + (roll.automaticSuccesses ?? 0)
}

async function adjustRoll(kind: 'reroll' | 'modifier') {
  const original = rollResult.value
  if (!original || original.fatefulIntervention || props.loading || spending.value || props.currentInspiration < 1) return
  spending.value = true
  try {
    if (!(await props.spendInspiration(kind, 1)) || rollResult.value !== original) return
    const die = () => Math.floor(Math.random() * 6) + 1
    const rolls = kind === 'reroll' ? original.rolls.map(die) : [...original.rolls, die()]
    rollResult.value = { ...original, rolls, dicePool: rolls.length, successes: recompute(rolls, original) }
  } finally {
    spending.value = false
  }
}

const handleReroll = () => adjustRoll('reroll')
const handleAddDie = () => adjustRoll('modifier')
</script>

<template>
  <div v-if="rollResult" class="mb-4 p-3 bg-yellow-900/10 rounded-lg border border-yellow-600/50">
    <div class="text-sm text-yellow-400 font-medium mb-2">✦ Spend Inspiration</div>
    <div v-if="!rollResult.fatefulIntervention" class="grid grid-cols-2 gap-2">
      <button
        :disabled="loading || spending || currentInspiration < 1"
        class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        @click="handleReroll"
      >
        🎲 Re-roll (1)
      </button>
      <button
        :disabled="loading || spending || currentInspiration < 1"
        class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        @click="handleAddDie"
      >
        ➕ +1 Die (1)
      </button>
    </div>
    <button v-if="fatefulCost !== undefined && !rollResult.fatefulIntervention" :disabled="loading || spending || currentInspiration < fatefulCost" class="mt-2 w-full text-xs px-2 py-1.5 rounded bg-amber-700 text-white disabled:opacity-40" @click="$emit('fateful')">Fateful Intervention ({{ fatefulCost }})</button>
    <p v-if="rollResult.fatefulIntervention" class="text-xs text-yellow-300">Fateful Intervention: your chosen dice are ready.</p>
    <div class="text-xs text-digimon-dark-400 mt-2 text-right">
      Inspiration: {{ currentInspiration }}/{{ maxInspiration }}
    </div>
  </div>
</template>
