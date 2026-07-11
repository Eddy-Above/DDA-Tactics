<script setup lang="ts">
import type { CreationRulesDiffEntry } from '~/utils/creationRules'

// Shown when an imported character's embedded creation rules don't match
// the target campaign's rules. Policy is warn + block: the diff explains
// why the import was refused; there is no override.
defineProps<{
  diff: CreationRulesDiffEntry[]
  sourceLabel?: string
  targetLabel?: string
}>()

const emit = defineEmits<{
  (e: 'close'): void
}>()
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" @click.self="emit('close')">
      <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-600 max-w-lg w-full max-h-[85vh] overflow-y-auto">
        <div class="p-6">
          <h2 class="font-display text-xl font-bold text-white mb-1">⚠️ Rules Mismatch</h2>
          <p class="text-sm text-digimon-dark-400 mb-4">
            This character was built under different creation rules than
            {{ targetLabel || 'this campaign' }} uses, so it can't be imported here.
            Rebuild it under matching rules, or ask the GM to align the campaign settings.
          </p>

          <div class="rounded-lg border border-digimon-dark-600 overflow-hidden mb-6">
            <table class="w-full text-sm">
              <thead>
                <tr class="bg-digimon-dark-700 text-digimon-dark-300">
                  <th class="text-left px-3 py-2 font-medium">Rule</th>
                  <th class="text-left px-3 py-2 font-medium">{{ sourceLabel || 'Character' }}</th>
                  <th class="text-left px-3 py-2 font-medium">{{ targetLabel || 'Campaign' }}</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="entry in diff"
                  :key="entry.field"
                  class="border-t border-digimon-dark-700"
                >
                  <td class="px-3 py-2 text-digimon-dark-300">{{ entry.label }}</td>
                  <td class="px-3 py-2 text-yellow-400">{{ entry.a }}</td>
                  <td class="px-3 py-2 text-white">{{ entry.b }}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <button
            class="w-full bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg
                   font-semibold transition-colors"
            @click="emit('close')"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
