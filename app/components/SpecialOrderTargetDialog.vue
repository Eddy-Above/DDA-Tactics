<script setup lang="ts">
import { computed, ref, watch } from 'vue'

interface OrderCharacter {
  id: string
  name: string
  effects?: Array<{ id: string; name: string }>
}

const props = defineProps<{
  orderName: string
  partners: OrderCharacter[]
  targets: OrderCharacter[]
  busy: boolean
}>()
const emit = defineEmits<{
  confirm: [choice: { partnerId?: string; targetId?: string; effectId?: string }]
  cancel: []
}>()
const partnerId = ref('')
const targetId = ref('')
const effectId = ref('')
const needsTarget = computed(() => ['Enemy Scan', 'Swagger'].includes(props.orderName))
const needsPartner = computed(() => props.orderName !== 'Enemy Scan')
const selectedPartner = computed(() => props.partners.find(p => p.id === partnerId.value))
const canConfirm = computed(() => !props.busy && (!needsPartner.value || !!selectedPartner.value)
  && (!needsTarget.value || props.targets.some(t => t.id === targetId.value))
  && (props.orderName !== 'Tough it Out!' || selectedPartner.value?.effects?.some(e => e.id === effectId.value)))
watch(() => props.orderName, () => {
  partnerId.value = props.partners.length === 1 ? props.partners[0]!.id : ''
  targetId.value = ''
  effectId.value = ''
}, { immediate: true })
watch(partnerId, () => { effectId.value = '' })
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 bg-black/80 flex items-center justify-center z-[70] p-4" role="dialog" aria-modal="true" :aria-label="orderName">
      <div class="bg-digimon-dark-800 border border-digimon-dark-600 rounded-xl p-6 w-full max-w-md">
        <h2 class="text-lg font-semibold text-white mb-4">{{ orderName }}</h2>
        <label v-if="needsPartner" class="block text-sm text-digimon-dark-300 mb-4">
          Your partner
          <select v-model="partnerId" :disabled="busy" class="block w-full mt-1 p-2 rounded bg-digimon-dark-700 text-white">
            <option value="" disabled>Select a partner</option>
            <option v-for="partner in partners" :key="partner.id" :value="partner.id">{{ partner.name }}</option>
          </select>
        </label>
        <label v-if="needsTarget" class="block text-sm text-digimon-dark-300 mb-4">
          {{ orderName === 'Swagger' ? 'Enemy target' : 'Enemy Digimon' }}
          <select v-model="targetId" :disabled="busy" class="block w-full mt-1 p-2 rounded bg-digimon-dark-700 text-white">
            <option value="" disabled>Select a target</option>
            <option v-for="target in targets" :key="target.id" :value="target.id">{{ target.name }}</option>
          </select>
        </label>
        <label v-if="orderName === 'Tough it Out!'" class="block text-sm text-digimon-dark-300 mb-4">
          Negative effect to purify
          <select v-model="effectId" :disabled="busy || !selectedPartner" class="block w-full mt-1 p-2 rounded bg-digimon-dark-700 text-white">
            <option value="" disabled>Select an effect</option>
            <option v-for="effect in selectedPartner?.effects ?? []" :key="effect.id" :value="effect.id">{{ effect.name }}</option>
          </select>
          <span v-if="selectedPartner && !selectedPartner.effects?.length" class="block text-xs mt-2">This partner has no negative effects.</span>
        </label>
        <div class="flex gap-2 mt-4">
          <button :disabled="!canConfirm" class="flex-1 px-3 py-2 rounded bg-cyan-700 hover:bg-cyan-600 text-white disabled:opacity-40" @click="emit('confirm', { partnerId: partnerId || undefined, targetId: targetId || undefined, effectId: effectId || undefined })">{{ busy ? 'Applying…' : 'Use order' }}</button>
          <button :disabled="busy" class="px-3 py-2 rounded bg-digimon-dark-700 text-white" @click="emit('cancel')">Cancel</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
