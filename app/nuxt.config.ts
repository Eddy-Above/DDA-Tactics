import { defineNuxtConfig } from 'nuxt/config'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2024-11-01',
  devtools: { enabled: false },

  modules: [
    '@nuxtjs/tailwindcss',
    'nuxt-security',
  ],

  typescript: {
    strict: true,
    typeCheck: false, // Disabled due to vite-plugin-checker issue
  },

  tailwindcss: {
    configPath: 'tailwind.config.ts',
  },

  security: {
    nonce: true,
    contentSecurityPolicyReportOnly: true, // Enforce after staging verification with DDA_CSP_REPORT_ONLY=false.
    // App-specific admission/Origin/rate policies preserve large JSON maps and combat text.
    requestSizeLimiter: false,
    rateLimiter: false,
    xssValidator: false,
    corsHandler: false,
    allowedMethodsRestricter: false,
    csrf: false,
    removeLoggers: false,
    headers: {
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: false,
      originAgentCluster: false,
      xFrameOptions: 'DENY',
      referrerPolicy: 'strict-origin-when-cross-origin',
      permissionsPolicy: { camera: [], microphone: [], geolocation: [], fullscreen: ['self'] },
      contentSecurityPolicy: {
        'default-src': ["'self'"],
        'base-uri': ["'none'"],
        'object-src': ["'none'"],
        'frame-ancestors': ["'none'"],
        'form-action': ["'self'"],
        'script-src': ["'self'", "'nonce-{{nonce}}'", "'strict-dynamic'"],
        'script-src-attr': ["'none'"],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        'style-src-attr': ["'unsafe-inline'"],
        'img-src': ["'self'", 'https:', 'data:', 'blob:'],
        'font-src': ["'self'", 'https:', 'data:'],
        'connect-src': ["'self'"],
        'worker-src': ["'self'", 'blob:'],
        'upgrade-insecure-requests': false,
      },
    },
  },

  nitro: {
    experimental: {
      websocket: true,
    },
  },

  app: {
    head: {
      title: 'DDA Tactics',
      meta: [
        { charset: 'utf-8' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1' },
        { name: 'description', content: 'Tactical GM aid for Digimon Digital Adventure 1.4 TTRPG' },
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
    componentIslands: false,
  },
})
