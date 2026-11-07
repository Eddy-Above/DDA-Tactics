<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { getFatefulModifier, type FatefulChoice } from '../utils/fatefulIntervention'

const props = defineProps<{
  rolls: Array<{ id: string; label: string; rollType: 'accuracy' | 'dodge' | 'check'; baseDicePool: number }>
  willpower: number
  cost: number
  inspiration: number
  busy: boolean
  error?: string | null
}>()
const emit = defineEmits<{ confirm: [id: string, choice: FatefulChoice]; cancel: [] }>()
const selectedId = ref(props.rolls[0]?.id ?? '')
const bonusSign = ref<1 | -1>(1)
const willpowerSign = ref<1 | -1>(1)
const dice = ref<number[]>([])
const selected = computed(() => props.rolls.find(r => r.id === selectedId.value))
const modifier = computed(() => getFatefulModifier(props.willpower, { bonusSign: bonusSign.value, willpowerSign: willpowerSign.value }))
const count = computed(() => selected.value?.rollType === 'check' ? 3 : Math.max(0, Math.floor((selected.value?.baseDicePool ?? 0) + modifier.value)))
watch([count, selectedId], () => { dice.value = Array.from({ length: count.value }, (_, i) => dice.value[i] ?? 6) }, { immediate: true })
watch(() => props.rolls, rolls => {
  if (!rolls.some(r => r.id === selectedId.value)) selectedId.value = rolls[0]?.id ?? ''
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-[80] p-4" role="dialog" aria-modal="true" aria-label="Fateful Intervention">
      <div class="bg-digimon-dark-800 border border-yellow-600 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
        <h2 class="text-lg font-semibold text-yellow-300 mb-2">Fateful Intervention</h2>
        <p class="text-sm text-digimon-dark-300 mb-4">Spend {{ cost }} Inspiration. Choose the bonus direction and every die before applying it.</p>
        <label class="block text-sm text-white mb-4">Roll
          <select v-model="selectedId" :disabled="busy" class="block w-full mt-1 p-2 rounded bg-digimon-dark-700">
            <option v-for="roll in rolls" :key="roll.id" :value="roll.id">{{ roll.label }}</option>
          </select>
        </label>
        <p v-if="!rolls.length" class="text-sm text-digimon-dark-300 mb-4">Roll a check or attack, or wait for an incoming attack, then choose Fateful Intervention.</p>
        <div class="grid grid-cols-2 gap-3 mb-4">
          <label class="text-sm text-white">Bonus
            <select v-model.number="bonusSign" :disabled="busy" class="block w-full mt-1 p-2 rounded bg-digimon-dark-700"><option :value="1">Add 5</option><option :value="-1">Subtract 5</option></select>
          </label>
          <label class="text-sm text-white">Willpower
            <select v-model.number="willpowerSign" :disabled="busy" class="block w-full mt-1 p-2 rounded bg-digimon-dark-700"><option :value="1">Add {{ willpower }}</option><option :value="-1">Subtract {{ willpower }}</option></select>
          </label>
        </div>
        <p v-if="selected" class="text-sm text-yellow-200 mb-3">{{ selected.rollType === 'check' ? 'Check modifier' : 'Dice pool' }} {{ modifier >= 0 ? '+' : '' }}{{ modifier }} · {{ count }} dice</p>
        <div class="flex flex-wrap gap-2 mb-4">
          <label v-for="(_, index) in dice" :key="index" class="text-xs text-digimon-dark-400">Die {{ index + 1 }}
            <select v-model.number="dice[index]" :disabled="busy" class="block p-2 rounded bg-digimon-dark-700 text-white text-base"><option v-for="face in 6" :key="face" :value="face">{{ face }}</option></select>
          </label>
        </div>
        <p v-if="error" class="text-sm text-red-300 mb-3" role="alert">{{ error }}</p>
        <div class="flex gap-2">
          <button :disabled="busy || !selected || inspiration < cost" class="flex-1 px-3 py-2 rounded bg-yellow-700 text-white disabled:opacity-40" @click="emit('confirm', selectedId, { bonusSign, willpowerSign, diceResults: [...dice] })">{{ busy ? 'Applying…' : `Spend ${cost} & apply` }}</button>
          <button :disabled="busy" class="px-3 py-2 rounded bg-digimon-dark-700 text-white" @click="emit('cancel')">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
