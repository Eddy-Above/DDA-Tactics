<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { cleanseChoices, cleanseLimit, type CleanseCast, type CleanseMode, type CleanseSelection } from '../utils/cleanse'

const props = defineProps<{
  request: { id: string; data: CleanseCast }
  participants: any[]
  participantName: (participant: any) => string
  busy: boolean
  error: string
}>()
const emit = defineEmits<{ confirm: [mode: CleanseMode, selections: CleanseSelection[]] }>()
const mode = ref<CleanseMode>('cleanse')
const selected = ref<string[]>([])
const choices = computed(() => cleanseChoices(props.request.data, props.participants, mode.value).map(choice => ({
  ...choice, key: JSON.stringify([choice.participantId, choice.effectId]),
  participantName: props.participantName(props.participants.find(participant => participant.id === choice.participantId)),
})))
const limit = computed(() => cleanseLimit(props.request.data))
watch(() => props.request.id, () => { mode.value = 'cleanse'; selected.value = [] })
watch(mode, () => { selected.value = [] })
watch(choices, () => { selected.value = selected.value.filter(key => choices.value.some(choice => choice.key === key)) })
function confirm() {
  if (props.busy || selected.value.length > limit.value) return
  emit('confirm', mode.value, choices.value.filter(choice => selected.value.includes(choice.key))
    .map(({ participantId, effectId }) => ({ participantId, effectId })))
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-[80] bg-black/80 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Choose Cleanse effects">
      <div class="w-full max-w-lg rounded-xl bg-digimon-dark-800 border border-digimon-dark-600 p-5 text-white">
        <h2 class="text-lg font-semibold">{{ request.data.attackName }} · Cleanse</h2>
        <p class="text-sm text-digimon-dark-300 mt-2">Choose up to {{ limit }} effects across all targets. Each loses {{ request.data.potency }} turns; effects that reach zero are removed.</p>
        <label v-if="request.data.isArea && request.data.selectiveTargeting" class="block mt-4 text-sm">
          Selective Targeting
          <select v-model="mode" :disabled="busy" class="ml-2 rounded bg-digimon-dark-700 p-2">
            <option value="cleanse">Cleanse · any effects</option>
            <option value="dispel">Dispel · enemy buffs</option>
            <option value="purify">Purify · ally debuffs</option>
          </select>
        </label>
        <div class="my-4 space-y-2 max-h-80 overflow-y-auto">
          <label v-for="choice in choices" :key="choice.key" class="flex gap-3 items-center p-2 rounded bg-digimon-dark-700">
            <input v-model="selected" type="checkbox" :value="choice.key" :disabled="busy || (!selected.includes(choice.key) && selected.length >= limit)" />
            <span class="flex-1 text-sm">{{ choice.participantName }} · {{ choice.name }}</span>
            <span class="text-sm text-digimon-dark-300">{{ choice.duration }} → {{ choice.remaining || 'removed' }}</span>
          </label>
          <p v-if="!choices.length" class="text-sm text-digimon-dark-400">No effects can be reduced in this mode.</p>
        </div>
        <p v-if="error" role="alert" class="text-sm text-red-400 mb-3">{{ error }}</p>
        <div class="flex justify-end gap-2">
          <button :disabled="busy" class="px-3 py-2 rounded bg-digimon-dark-600" @click="emit('confirm', mode, [])">Skip</button>
          <button :disabled="busy || !selected.length" class="px-3 py-2 rounded bg-digimon-orange-500" @click="confirm">{{ busy ? 'Saving…' : `Apply (${selected.length}/${limit})` }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
