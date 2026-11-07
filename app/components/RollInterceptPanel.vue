<script setup lang="ts">
import { ref } from 'vue'

interface RollResult {
  rolls: number[]
  successes: number
  dicePool: number
}

interface Props {
  currentInspiration: number
  maxInspiration: number
  loading: boolean
  spendInspiration: (kind: 'reroll' | 'modifier', amount: number) => Promise<boolean>
}

const props = defineProps<Props>()
const spending = ref(false)

const rollResult = defineModel<RollResult | null>('rollResult', { required: true })

function recompute(rolls: number[]) {
  return rolls.filter(d => d >= 5).length
}

async function adjustRoll(kind: 'reroll' | 'modifier') {
  const original = rollResult.value
  if (!original || props.loading || spending.value || props.currentInspiration < 1) return
  spending.value = true
  try {
    if (!(await props.spendInspiration(kind, 1)) || rollResult.value !== original) return
    const die = () => Math.floor(Math.random() * 6) + 1
    const rolls = kind === 'reroll' ? original.rolls.map(die) : [...original.rolls, die()]
    rollResult.value = { ...original, rolls, dicePool: rolls.length, successes: recompute(rolls) }
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
    <div class="grid grid-cols-2 gap-2">
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
    <div class="text-xs text-digimon-dark-400 mt-2 text-right">
      Inspiration: {{ currentInspiration }}/{{ maxInspiration }}
    </div>
  </div>
</template>
