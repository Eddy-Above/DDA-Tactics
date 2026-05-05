<template>
  <div class="container mx-auto px-4 py-8 max-w-lg">
    <NuxtLink :to="`/campaigns/${campaignId}/library/maps`" class="text-digimon-dark-400 hover:text-white text-sm mb-4 inline-block">
      &larr; Back to Maps
    </NuxtLink>
    <h1 class="font-display text-3xl font-bold text-white mb-6">New Map</h1>

    <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700 p-6 space-y-5">
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-1">Map Name *</label>
        <input v-model="form.name" type="text" class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white" placeholder="e.g. Forest Clearing" />
      </div>

      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-1">Description</label>
        <textarea v-model="form.description" class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white h-20" />
      </div>

      <div class="grid grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-digimon-dark-300 mb-1">Width (X)</label>
          <input v-model.number="form.width" type="number" min="4" max="100" class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white" />
        </div>
        <div>
          <label class="block text-sm font-medium text-digimon-dark-300 mb-1">Depth (Z)</label>
          <input v-model.number="form.depth" type="number" min="4" max="100" class="w-full bg-digimon-dark-700 border border-digimon-dark-600 rounded-lg px-3 py-2 text-white" />
        </div>
      </div>

      <div v-if="error" class="text-red-400 text-sm">{{ error }}</div>

      <div class="flex gap-3 pt-2">
        <NuxtLink :to="`/campaigns/${campaignId}/library/maps`" class="flex-1 text-center bg-digimon-dark-700 text-white py-2 rounded-lg">Cancel</NuxtLink>
        <button :disabled="!form.name || saving" class="flex-1 bg-digimon-orange-600 hover:bg-digimon-orange-700 disabled:opacity-50 text-white py-2 rounded-lg font-semibold" @click="submit">
          {{ saving ? 'Creating...' : 'Create Map' }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useMap } from '~/composables/useMap'

definePageMeta({ middleware: ['dm-access'] })

const route = useRoute()
const router = useRouter()
const campaignId = computed(() => route.params.campaignId as string)
const { createMap } = useMap()

const form = reactive({ name: '', description: '', width: 20, depth: 20 })
const saving = ref(false)
const error = ref<string | null>(null)

async function submit() {
  if (!form.name) return
  saving.value = true
  error.value = null
  try {
    const map = await createMap({
      name: form.name,
      description: form.description,
      campaignId: campaignId.value,
      dimensions: { width: form.width, depth: form.depth },
    })
    router.push(`/campaigns/${campaignId.value}/library/maps/${map.id}`)
  } catch (e: any) {
    error.value = e.message ?? 'Failed to create map'
  } finally {
    saving.value = false
  }
}
</script>
