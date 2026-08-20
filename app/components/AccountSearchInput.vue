<script setup lang="ts">
import type { AccountUser } from '~/types'

const modelValue = defineModel<AccountUser | null>({ default: null })

const { searchUsers } = useAuth()

const query = ref('')
const results = ref<AccountUser[]>([])

let debounce: ReturnType<typeof setTimeout> | null = null
watch(query, (q) => {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(async () => {
    results.value = q.trim() ? await searchUsers(q) : []
  }, 250)
})

function select(u: AccountUser) {
  modelValue.value = u
  query.value = ''
  results.value = []
}

function clear() {
  modelValue.value = null
}
</script>

<template>
  <div v-if="!modelValue">
    <label class="block text-sm text-digimon-dark-400 mb-1">Search username</label>
    <input
      v-model="query"
      type="text"
      placeholder="Start typing a username..."
      class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white text-sm
             focus:border-digimon-orange-500 focus:outline-none"
    />
    <div v-if="results.length > 0" class="mt-2 space-y-1">
      <button
        v-for="r in results"
        :key="r.id"
        type="button"
        class="block w-full text-left px-3 py-1.5 rounded bg-digimon-dark-800 hover:bg-digimon-dark-700 text-sm text-white"
        @click="select(r)"
      >
        {{ r.username }}
      </button>
    </div>
  </div>

  <div v-else class="flex items-center justify-between">
    <span class="text-white text-sm">Granting access to <strong>{{ modelValue.username }}</strong></span>
    <button type="button" class="text-xs text-digimon-dark-400 hover:text-white" @click="clear">
      Change
    </button>
  </div>
</template>
