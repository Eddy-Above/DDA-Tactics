<script setup lang="ts">
import type { ReactionOrderOption } from '../composables/useReactionOrders'
defineProps<{ choices: ReactionOrderOption[]; busy: boolean }>()
defineEmits<{ declare: [choice: ReactionOrderOption, order: 'Quick Reaction' | 'Strike Last!']; skip: [choice: ReactionOrderOption] }>()
</script>

<template>
  <Teleport to="body">
    <aside v-if="choices.length" class="fixed bottom-4 right-4 z-[65] w-80 max-w-[90vw] max-h-[50vh] overflow-y-auto bg-digimon-dark-800 border-2 border-cyan-600 rounded-xl p-4 shadow-xl" aria-label="Reaction Special Orders">
      <h2 class="font-semibold text-cyan-300 mb-2">Reaction Special Orders</h2>
      <div v-for="choice in choices" :key="choice.key" class="space-y-2 border-t border-digimon-dark-600 pt-2 mt-2">
        <p class="text-xs text-white">{{ choice.label }}</p>
        <button v-if="choice.quickReaction" :disabled="busy" class="w-full text-sm px-3 py-2 rounded bg-cyan-800 text-white disabled:opacity-40" @click="$emit('declare', choice, 'Quick Reaction')">Quick Reaction · Dodge bonus this round</button>
        <button v-if="choice.strikeLast" :disabled="busy" class="w-full text-sm px-3 py-2 rounded bg-orange-800 text-white disabled:opacity-40" @click="$emit('declare', choice, 'Strike Last!')">Strike Last! · Counter Blow</button>
        <button :disabled="busy" class="w-full text-xs text-digimon-dark-300 py-1" @click="$emit('skip', choice)">Continue without an order</button>
      </div>
    </aside>
  </Teleport>
</template>
