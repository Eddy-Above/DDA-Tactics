// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: false },

  modules: [
    '@nuxtjs/tailwindcss',
  ],

  typescript: {
    strict: true,
    typeCheck: false, // Disabled due to vite-plugin-checker issue
  },

  tailwindcss: {
    configPath: 'tailwind.config.ts',
  },

  // Server-side SQLite database
  nitro: {
    experimental: {
      database: true,
    },
  },

  // Runtime config for database path
  runtimeConfig: {
    dbPath: './data/digimon.db',
  },

  app: {
    head: {
      title: 'Digimon DDA 1.4 Session Helper',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'GM aid application for Digimon Digital Adventure 1.4 TTRPG' },
      ],
      link: [
        { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
      ],
    },
  },

  // Disable experimental appManifest to fix recurring build cache corruption
  // See: https://github.com/nuxt/nuxt/issues/30461
  experimental: {
    appManifest: false,
  },
})
