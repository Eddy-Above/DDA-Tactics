<script setup lang="ts">
interface Props {
  currentInspiration: number
  maxInspiration: number
  actOfInspirationCost: number
  fatefulInterventionCost: number
  loading: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'spend-inspiration': [{ spendType: 'reroll' | 'modifier' | 'act-of-inspiration' | 'fateful-intervention'; amount: number }]
}>()

const modifierAmount = defineModel<number>('modifierAmount', { required: true })

function spend(spendType: 'reroll' | 'modifier' | 'act-of-inspiration' | 'fateful-intervention', amount: number) {
  emit('spend-inspiration', { spendType, amount })
}
</script>

<template>
  <div class="rounded-xl p-4 border-2 border-yellow-600/50 bg-yellow-900/10">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-display text-lg font-semibold text-yellow-400">✦ Inspiration</h3>
      <span class="text-yellow-300 font-semibold text-sm">
        {{ currentInspiration }}/{{ maxInspiration }}
      </span>
    </div>
    <p class="text-xs text-digimon-dark-400 mb-3">
      Spend freely on any roll. The GM applies the effect to your in-progress roll.
    </p>
    <div class="grid grid-cols-2 gap-2">
      <button
        :disabled="loading || currentInspiration < 1"
        class="text-sm px-3 py-2 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-left"
        @click="spend('reroll', 1)"
      >
        🎲 Re-roll
        <span class="block text-xs text-yellow-200/70">Spend 1 — take the new result</span>
      </button>
      <button
        :disabled="loading || currentInspiration < actOfInspirationCost"
        class="text-sm px-3 py-2 rounded bg-yellow-800 hover:bg-yellow-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-left"
        @click="spend('act-of-inspiration', actOfInspirationCost)"
      >
        ⚡ Act of Inspiration
        <span class="block text-xs text-yellow-200/70">Spend {{ actOfInspirationCost }} — ±5 to a check / dice pool</span>
      </button>
      <button
        :disabled="loading || currentInspiration < fatefulInterventionCost"
        class="text-sm px-3 py-2 rounded bg-amber-800 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-left"
        @click="spend('fateful-intervention', fatefulInterventionCost)"
      >
        🌟 Fateful Intervention
        <span class="block text-xs text-yellow-200/70">Spend {{ fatefulInterventionCost }} — set every die + ±5 + Willpower</span>
      </button>
      <div class="flex items-center gap-1 bg-digimon-dark-800 rounded px-2 py-1">
        <input
          v-model.number="modifierAmount"
          type="number"
          min="1"
          :max="currentInspiration"
          class="w-12 text-sm bg-digimon-dark-700 border border-digimon-dark-500 rounded px-1 py-0.5 text-white"
        />
        <button
          :disabled="loading || currentInspiration < modifierAmount || modifierAmount < 1"
          class="flex-1 text-sm px-2 py-1 rounded bg-yellow-700 hover:bg-yellow-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium"
          @click="spend('modifier', modifierAmount)"
        >
          +/− Modify
        </button>
      </div>
    </div>
  </div>
</template>
