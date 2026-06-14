<script setup lang="ts">
interface RollResult {
  rolls: number[]
  successes: number
  dicePool: number
}

interface Props {
  currentInspiration: number
  maxInspiration: number
  loading: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'spend-inspiration': [{ spendType: 'reroll' | 'modifier'; amount: number }]
}>()

const rollResult = defineModel<RollResult | null>('rollResult', { required: true })

function recompute(rolls: number[]) {
  return rolls.filter(d => d >= 5).length
}

async function handleReroll() {
  if (!rollResult.value) return
  emit('spend-inspiration', { spendType: 'reroll', amount: 1 })
  const rolls = rollResult.value.rolls.map(() => Math.floor(Math.random() * 6) + 1)
  rollResult.value = { ...rollResult.value, rolls, successes: recompute(rolls) }
}

async function handleAddDie() {
  if (!rollResult.value) return
  emit('spend-inspiration', { spendType: 'modifier', amount: 1 })
  const rolls = [...rollResult.value.rolls, Math.floor(Math.random() * 6) + 1]
  rollResult.value = { ...rollResult.value, rolls, dicePool: rollResult.value.dicePool + 1, successes: recompute(rolls) }
}

async function handleRemoveDie() {
  if (!rollResult.value || rollResult.value.dicePool <= 1) return
  emit('spend-inspiration', { spendType: 'modifier', amount: 1 })
  const rolls = [...rollResult.value.rolls]
  let lowestIndex = 0
  for (let i = 1; i < rolls.length; i++) {
    if (rolls[i] < rolls[lowestIndex]) lowestIndex = i
  }
  rolls.splice(lowestIndex, 1)
  rollResult.value = { ...rollResult.value, rolls, dicePool: rollResult.value.dicePool - 1, successes: recompute(rolls) }
}
</script>

<template>
  <div v-if="rollResult" class="mb-4 p-3 bg-yellow-900/10 rounded-lg border border-yellow-600/50">
    <div class="text-sm text-yellow-400 font-medium mb-2">✦ Spend Inspiration</div>
    <div class="grid grid-cols-3 gap-2">
      <button
        :disabled="loading || currentInspiration < 1"
        class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        @click="handleReroll"
      >
        🎲 Re-roll (1)
      </button>
      <button
        :disabled="loading || currentInspiration < 1"
        class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        @click="handleAddDie"
      >
        ➕ +1 Die (1)
      </button>
      <button
        :disabled="loading || currentInspiration < 1 || rollResult.dicePool <= 1"
        class="text-xs px-2 py-1.5 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
        @click="handleRemoveDie"
      >
        ➖ -1 Die (1)
      </button>
    </div>
    <div class="text-xs text-digimon-dark-400 mt-2 text-right">
      Inspiration: {{ currentInspiration }}/{{ maxInspiration }}
    </div>
  </div>
</template>
