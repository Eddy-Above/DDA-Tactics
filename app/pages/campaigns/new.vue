<script setup lang="ts">
definePageMeta({
  title: 'Create Campaign',
})

const { createCampaign } = useCampaigns()

const form = reactive({
  name: '',
  description: '',
  level: 'standard' as 'standard' | 'enhanced' | 'extreme',
  password: '',
  dmPassword: '',
})

const saving = ref(false)

async function handleSubmit() {
  if (!form.name.trim()) return

  saving.value = true
  const campaign = await createCampaign({
    name: form.name.trim(),
    description: form.description.trim(),
    level: form.level,
    password: form.password || undefined,
    dmPassword: form.dmPassword || undefined,
  })
  saving.value = false

  if (campaign) {
    // If we set a campaign password, set the access cookie
    if (form.password) {
      const cookie = useCookie(`campaign-access-${campaign.id}`, { maxAge: 60 * 60 * 24 * 30 })
      cookie.value = 'true'
    }
    // If we set a DM password, set the DM cookie
    if (form.dmPassword) {
      const cookie = useCookie(`campaign-dm-${campaign.id}`, { maxAge: 60 * 60 * 24 * 30 })
      cookie.value = 'true'
    }
    navigateTo(`/campaigns/${campaign.id}`)
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-2xl">
    <div class="mb-8">
      <NuxtLink to="/" class="text-digimon-dark-400 hover:text-white text-sm mb-4 inline-block">
        ← Back to Campaigns
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Create Campaign</h1>
    </div>

    <form class="space-y-6" @submit.prevent="handleSubmit">
      <!-- Name -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Campaign Name *</label>
        <input
          v-model="form.name"
          type="text"
          required
          placeholder="My Digimon Campaign"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        />
      </div>

      <!-- Description -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Description</label>
        <textarea
          v-model="form.description"
          rows="3"
          placeholder="A brief description of your campaign..."
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none resize-none"
        />
      </div>

      <!-- Campaign Level -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Campaign Level</label>
        <select
          v-model="form.level"
          class="w-full bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                 focus:border-digimon-orange-500 focus:outline-none"
        >
          <option value="standard">Standard (30 CP, caps at 5)</option>
          <option value="enhanced">Enhanced (40 CP, caps at 7)</option>
          <option value="extreme">Extreme (50 CP, caps at 10)</option>
        </select>
      </div>

      <!-- Passwords -->
      <div class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700 space-y-4">
        <h3 class="font-semibold text-white">Password Protection (Optional)</h3>

        <div>
          <label class="block text-sm text-digimon-dark-400 mb-1">Campaign Password</label>
          <input
            v-model="form.password"
            type="password"
            placeholder="Required to enter the campaign"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none"
          />
          <p class="text-xs text-digimon-dark-500 mt-1">Leave blank for no password</p>
        </div>

        <div>
          <label class="block text-sm text-digimon-dark-400 mb-1">DM Password</label>
          <input
            v-model="form.dmPassword"
            type="password"
            placeholder="Required to access the DM section"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none"
          />
          <p class="text-xs text-digimon-dark-500 mt-1">Leave blank for no DM password</p>
        </div>
      </div>

      <!-- Submit -->
      <div class="flex gap-4">
        <NuxtLink
          to="/"
          class="flex-1 text-center bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-3 rounded-lg transition-colors"
        >
          Cancel
        </NuxtLink>
        <button
          type="submit"
          :disabled="saving || !form.name.trim()"
          class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50 disabled:cursor-not-allowed
                 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          {{ saving ? 'Creating...' : 'Create Campaign' }}
        </button>
      </div>
    </form>
  </div>
</template>
