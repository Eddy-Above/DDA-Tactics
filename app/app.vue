<script setup lang="ts">
// Main app component
useHead({
  htmlAttrs: {
    lang: 'en',
    class: 'dark',
  },
  bodyAttrs: {
    class: 'bg-digimon-dark-900 text-white min-h-screen font-body',
  },
})
</script>

<template>
  <NuxtLayout>
    <NuxtPage />
  </NuxtLayout>
  <RollLogPanel />
</template>

<style>
/* Global styles */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Orbitron:wght@400;500;600;700&display=swap');

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: theme('colors.digimon.dark.800');
}

::-webkit-scrollbar-thumb {
  background: theme('colors.digimon.dark.600');
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: theme('colors.digimon.orange.600');
}
</style>
