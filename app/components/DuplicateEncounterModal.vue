<script setup lang="ts">
const props = defineProps<{
  encounterName: string
  busy?: boolean
}>()

const emit = defineEmits<{
  (e: 'confirm', mode: 'fresh' | 'snapshot', name: string): void
  (e: 'cancel'): void
}>()

const name = ref(`${props.encounterName} (Copy)`)
const mode = ref<'fresh' | 'snapshot'>('fresh')

// Re-seed if the modal is reused for a different encounter
watch(() => props.encounterName, (n) => { name.value = `${n} (Copy)` })

function confirm() {
  if (!name.value.trim() || props.busy) return
  emit('confirm', mode.value, name.value.trim())
}
</script>

<template>
  <Teleport to="body">
    <div
      class="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4"
      @click.self="emit('cancel')"
    >
      <div class="bg-digimon-dark-800 rounded-xl p-6 w-full max-w-md border border-digimon-dark-700">
        <h2 class="font-display text-xl font-semibold text-white mb-4">Duplicate Encounter</h2>

        <form @submit.prevent="confirm">
          <div class="mb-4">
            <label class="block text-sm text-digimon-dark-400 mb-1">Name</label>
            <input
              v-model="name"
              type="text"
              required
              class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2
                     text-white focus:border-digimon-orange-500 focus:outline-none"
            />
          </div>

          <div class="space-y-2 mb-6">
            <label
              :class="[
                'block rounded-lg border p-3 cursor-pointer transition-colors',
                mode === 'fresh'
                  ? 'border-digimon-orange-500 bg-digimon-orange-900/20'
                  : 'border-digimon-dark-600 hover:border-digimon-dark-500'
              ]"
            >
              <div class="flex items-center gap-2">
                <input v-model="mode" type="radio" value="fresh" class="accent-digimon-orange-500" />
                <span class="text-white font-semibold text-sm">Fresh copy</span>
              </div>
              <p class="text-xs text-digimon-dark-400 mt-1 ml-6">
                Keeps the combatants, their rolled initiative, the map and every token position.
                Resets to Setup, round 0 — wounds, effects and actions all cleared.
              </p>
            </label>

            <label
              :class="[
                'block rounded-lg border p-3 cursor-pointer transition-colors',
                mode === 'snapshot'
                  ? 'border-digimon-orange-500 bg-digimon-orange-900/20'
                  : 'border-digimon-dark-600 hover:border-digimon-dark-500'
              ]"
            >
              <div class="flex items-center gap-2">
                <input v-model="mode" type="radio" value="snapshot" class="accent-digimon-orange-500" />
                <span class="text-white font-semibold text-sm">Exact snapshot</span>
              </div>
              <p class="text-xs text-digimon-dark-400 mt-1 ml-6">
                Copies the fight exactly as it stands — phase, round, whose turn it is,
                current wounds, effects and clashes.
              </p>
            </label>
          </div>

          <p class="text-xs text-digimon-dark-500 mb-4">
            Either way the copy starts hidden from players, with an empty battle log and no
            carried-over player prompts.
          </p>

          <div class="flex gap-3">
            <button
              type="submit"
              :disabled="busy || !name.trim()"
              class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                     disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors"
            >
              {{ busy ? 'Duplicating…' : 'Duplicate' }}
            </button>
            <button
              type="button"
              class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2
                     rounded-lg font-semibold transition-colors"
              @click="emit('cancel')"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  </Teleport>
</template>
