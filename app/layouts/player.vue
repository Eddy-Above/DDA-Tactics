<script setup lang="ts">
const route = useRoute()
const campaignId = computed(() => route.params.campaignId as string | undefined)
</script>

<template>
  <div class="min-h-screen bg-digimon-dark-900">
    <div v-if="campaignId" class="absolute top-4 left-4 z-10">
      <NuxtLink
        :to="`/campaigns/${campaignId}`"
        class="text-digimon-dark-500 hover:text-digimon-dark-300 text-sm transition-colors"
      >
        ← Campaign Hub
      </NuxtLink>
    </div>
    <slot />
  </div>
</template>
