<script setup lang="ts">
// Shown wherever the player manages intercede preferences while "Pass until my next turn" is on,
// so the temporary preference is never invisible. "Resume prompting" ends it early.
defineProps<{ busy?: boolean }>()
defineEmits<{ (e: 'resume'): void }>()
</script>

<template>
  <span
    class="inline-flex items-center gap-2 text-xs px-2 py-1 rounded border border-yellow-600/60 bg-yellow-900/20 text-yellow-300"
    data-testid="intercede-pass-notice"
  >
    Passing on interceding until your next turn
    <button
      type="button"
      class="underline text-yellow-200 hover:text-white disabled:opacity-50"
      :disabled="busy"
      @click="$emit('resume')"
    >{{ busy ? 'Resuming…' : 'Resume prompting' }}</button>
  </span>
</template>
