<script setup lang="ts">
import { computed } from 'vue'
import { encounterActionLabel, getEncounterFeedback } from '~/utils/encounterFeedback'

const props = defineProps<{ encounterId?: string | null }>()
const feedback = getEncounterFeedback()
const pending = computed(() => feedback.pending.value.filter(item => item.encounterId === props.encounterId))
const errors = computed(() => feedback.errors.value.filter(item => item.encounterId === props.encounterId))
</script>

<template>
  <div class="fixed bottom-4 left-4 z-[1000010] max-w-sm space-y-2 pointer-events-none" aria-live="polite" aria-atomic="true">
    <div v-if="pending.length" role="status" class="rounded-lg border border-digimon-orange-500/50 bg-digimon-dark-900 px-4 py-2 text-sm text-white shadow-lg">
      {{ encounterActionLabel(pending[pending.length - 1]) }}…<span v-if="pending.length > 1" class="ml-2 text-digimon-dark-400">{{ pending.length }} pending</span>
    </div>
    <div v-for="error in errors" :key="error.id" role="alert" class="pointer-events-auto flex items-start gap-3 rounded-lg border border-red-500 bg-digimon-dark-900 px-4 py-3 text-sm text-red-300 shadow-lg">
      <span>{{ error.message }}</span>
      <button type="button" aria-label="Dismiss error" class="ml-auto text-white" @click="feedback.dismiss(error.id)">×</button>
    </div>
  </div>
</template>
