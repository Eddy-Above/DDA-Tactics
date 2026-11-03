<script setup lang="ts">
interface Props {
  currentInspiration: number
  maxInspiration: number
  actOfInspirationCost: number
  fatefulInterventionCost: number
  loading: boolean
  minimizable?: boolean
}

defineProps<Props>()

const emit = defineEmits<{
  'spend-inspiration': [{ spendType: 'act-of-inspiration' | 'fateful-intervention'; amount: number }]
}>()

// Map Mode only (minimizable): the "✦ Inspiration" heading collapses the panel to a ✦ n/m chip that reopens it.
const minimized = ref(false)

function spend(spendType: 'act-of-inspiration' | 'fateful-intervention', amount: number) {
  emit('spend-inspiration', { spendType, amount })
}
</script>

<template>
  <button
    v-if="minimized"
    type="button"
    title="Show Inspiration"
    class="flex items-center gap-2 rounded-xl px-3 py-1.5 border-2 border-yellow-600/50 bg-yellow-900/10 hover:border-yellow-500"
    @click="minimized = false"
  >
    <span class="font-display text-lg font-semibold leading-none text-yellow-400">✦</span>
    <span class="text-yellow-300 font-semibold text-sm">{{ currentInspiration }}/{{ maxInspiration }}</span>
  </button>
  <div v-else class="rounded-xl p-4 border-2 border-yellow-600/50 bg-yellow-900/10">
    <div class="flex items-center justify-between mb-3">
      <h3 class="font-display text-lg font-semibold text-yellow-400">
        <button v-if="minimizable" type="button" title="Minimise" class="hover:text-yellow-300" @click="minimized = true">✦ Inspiration</button>
        <template v-else>✦ Inspiration</template>
      </h3>
      <span class="text-yellow-300 font-semibold text-sm">
        {{ currentInspiration }}/{{ maxInspiration }}
      </span>
    </div>
    <p class="text-xs text-digimon-dark-400 mb-3">
      Spend freely on any roll. The GM applies the effect to your in-progress roll.
    </p>
    <div class="grid grid-cols-2 gap-2">
      <button
        :disabled="loading || currentInspiration < actOfInspirationCost"
        class="text-sm px-3 py-2 rounded bg-yellow-800 hover:bg-yellow-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-left"
        @click="spend('act-of-inspiration', actOfInspirationCost)"
      >
        ⚡ Act of Inspiration
        <span class="block text-xs text-yellow-200/70">Spend {{ actOfInspirationCost }} — +5 to a check / dice pool</span>
      </button>
      <button
        :disabled="loading || currentInspiration < fatefulInterventionCost"
        class="text-sm px-3 py-2 rounded bg-amber-800 hover:bg-amber-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium text-left"
        @click="spend('fateful-intervention', fatefulInterventionCost)"
      >
        🌟 Fateful Intervention
        <span class="block text-xs text-yellow-200/70">Spend {{ fatefulInterventionCost }} — set every die + ±5 + Willpower</span>
      </button>
    </div>
  </div>
</template>
