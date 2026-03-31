<script setup lang="ts">
const route = useRoute()
const campaignId = computed(() => route.params.campaignId as string | undefined)

const navItems = computed(() => {
  if (!campaignId.value) {
    return [
      { name: 'Campaigns', path: '/' },
    ]
  }
  const base = `/campaigns/${campaignId.value}`
  return [
    { name: 'Hub', path: base },
    { name: 'Library', path: `${base}/library` },
    { name: 'Encounters', path: `${base}/encounters` },
    { name: 'Player View', path: `${base}/player` },
    { name: 'Settings', path: `${base}/settings` },
  ]
})
</script>

<template>
  <div class="min-h-screen flex flex-col">
    <!-- Header -->
    <header class="bg-digimon-dark-800 border-b border-digimon-dark-700 sticky top-0 z-50">
      <div class="container mx-auto px-4">
        <div class="flex items-center justify-between h-16">
          <!-- Logo -->
          <NuxtLink to="/" class="flex items-center gap-3">
            <div class="w-10 h-10 bg-gradient-to-br from-digimon-orange-500 to-digimon-orange-700 rounded-lg flex items-center justify-center">
              <span class="text-white font-display font-bold text-lg">D</span>
            </div>
            <div class="hidden sm:block">
              <h1 class="font-display text-lg font-semibold text-white">DDA 1.4</h1>
              <p class="text-xs text-digimon-dark-400">Session Helper</p>
            </div>
          </NuxtLink>

          <!-- Navigation -->
          <nav class="flex items-center gap-1">
            <NuxtLink
              v-if="campaignId"
              to="/"
              class="px-3 py-2 rounded-lg text-xs font-medium transition-colors
                     text-digimon-dark-400 hover:text-white hover:bg-digimon-dark-700"
            >
              All Campaigns
            </NuxtLink>
            <NuxtLink
              v-for="item in navItems"
              :key="item.path"
              :to="item.path"
              class="px-4 py-2 rounded-lg text-sm font-medium transition-colors
                     text-digimon-dark-300 hover:text-white hover:bg-digimon-dark-700
                     [&.router-link-active]:text-digimon-orange-400 [&.router-link-active]:bg-digimon-dark-700"
            >
              {{ item.name }}
            </NuxtLink>
          </nav>
        </div>
      </div>
    </header>

    <!-- Main Content -->
    <main class="flex-1">
      <slot />
    </main>

    <!-- Footer -->
    <footer class="bg-digimon-dark-800 border-t border-digimon-dark-700 py-4">
      <div class="container mx-auto px-4 text-center text-sm text-digimon-dark-400">
        Digimon Digital Adventure 1.4 Session Helper
      </div>
    </footer>
  </div>
</template>
