<script setup lang="ts">
definePageMeta({
  title: 'Log In',
})

const route = useRoute()
const { login, register, error, loading } = useAuth()

const mode = ref<'login' | 'register'>('login')
const username = ref('')
const password = ref('')
const confirmPassword = ref('')
const localError = ref<string | null>(null)

async function handleSubmit() {
  localError.value = null

  if (mode.value === 'register' && password.value !== confirmPassword.value) {
    localError.value = 'Passwords do not match'
    return
  }

  const ok = mode.value === 'login'
    ? await login(username.value, password.value)
    : await register(username.value, password.value)

  if (ok) {
    const redirectTo = (route.query.from as string) || '/'
    navigateTo(redirectTo)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-md">
    <div class="mb-8">
      <NuxtLink to="/" class="text-digimon-dark-400 hover:text-white text-sm mb-4 inline-block">
        ← Back to Campaigns
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">
        {{ mode === 'login' ? 'Log In' : 'Create Account' }}
      </h1>
    </div>

    <div class="flex gap-1 mb-6 bg-digimon-dark-800 rounded-lg p-1">
      <button
        class="flex-1 py-2 rounded-md text-sm font-medium transition-colors"
        :class="mode === 'login' ? 'bg-digimon-orange-500 text-white' : 'text-digimon-dark-400 hover:text-white'"
        @click="mode = 'login'; localError = null"
      >
        Log In
      </button>
      <button
        class="flex-1 py-2 rounded-md text-sm font-medium transition-colors"
        :class="mode === 'register' ? 'bg-digimon-orange-500 text-white' : 'text-digimon-dark-400 hover:text-white'"
        @click="mode = 'register'; localError = null"
      >
        Register
      </button>
    </div>

    <form class="space-y-4" @submit.prevent="handleSubmit">
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Username</label>
        <input
          v-model="username"
          type="text"
          required
          autocomplete="username"
          placeholder="Username"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        />
        <p v-if="mode === 'register'" class="text-xs text-digimon-dark-500 mt-1">
          3-30 characters: letters, numbers, underscore, hyphen
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Password</label>
        <input
          v-model="password"
          type="password"
          required
          :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
          placeholder="Password"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        />
        <p v-if="mode === 'register'" class="text-xs text-digimon-dark-500 mt-1">At least 8 characters</p>
      </div>

      <div v-if="mode === 'register'">
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Confirm Password</label>
        <input
          v-model="confirmPassword"
          type="password"
          required
          autocomplete="new-password"
          placeholder="Confirm password"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        />
      </div>

      <p v-if="localError || error" class="text-sm text-red-400">{{ localError || error }}</p>

      <p v-if="mode === 'register'" class="text-xs text-digimon-dark-500">
        No email is collected and there is no password reset — if you forget your password, you'll need to register a new account.
      </p>

      <button
        type="submit"
        :disabled="loading || !username.trim() || !password"
        class="w-full bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50 disabled:cursor-not-allowed
               text-white px-6 py-3 rounded-lg font-semibold transition-colors"
      >
        {{ loading ? 'Please wait...' : (mode === 'login' ? 'Log In' : 'Create Account') }}
      </button>
    </form>
  </div>
</template>
