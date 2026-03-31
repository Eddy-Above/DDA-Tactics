<script setup lang="ts">
definePageMeta({
  title: 'Library',
  middleware: ['campaign-access', 'dm-access'],
})

const { campaignId } = useCampaignContext()

const libraryItems = computed(() => [
  {
    name: 'Tamers',
    description: 'Manage human characters',
    path: `/campaigns/${campaignId.value}/library/tamers`,
    icon: '👤',
    color: 'text-digimon-orange-400',
  },
  {
    name: 'Digimon',
    description: 'Manage partner and enemy Digimon',
    path: `/campaigns/${campaignId.value}/library/digimon`,
    icon: '🦖',
    color: 'text-digimon-stage-champion',
  },
  {
    name: 'Evolution Lines',
    description: 'Manage digivolution chains',
    path: `/campaigns/${campaignId.value}/library/evolution`,
    icon: '⬆️',
    color: 'text-digimon-stage-ultimate',
  },
])
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="font-display text-3xl font-bold text-white mb-2">Library</h1>
      <p class="text-digimon-dark-400">
        Manage your campaign's Tamers and Digimon
      </p>
    </div>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-6">
      <NuxtLink
        v-for="item in libraryItems"
        :key="item.path"
        :to="item.path"
        class="bg-digimon-dark-800 rounded-xl p-8 border border-digimon-dark-700
               hover:border-digimon-orange-500 transition-all duration-200 group"
      >
        <div class="text-5xl mb-4">{{ item.icon }}</div>
        <h2 :class="['font-display text-2xl font-semibold mb-2 transition-colors', item.color]">
          {{ item.name }}
        </h2>
        <p class="text-digimon-dark-400">
          {{ item.description }}
        </p>
      </NuxtLink>
    </div>
  </div>
</template>
