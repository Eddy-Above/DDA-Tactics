<script setup lang="ts">
definePageMeta({
  title: 'Campaign Settings',
  middleware: ['campaign-access', 'dm-access'],
})

const { campaignId, campaign, loadCampaign } = useCampaignContext()
const { updateCampaign } = useCampaigns()

const loading = ref(true)
const saving = ref(false)
const saved = ref(false)

const form = reactive({
  name: '',
  description: '',
  level: 'standard' as 'standard' | 'enhanced' | 'extreme',
  password: '' as string,
  dmPassword: '' as string,
})

const changePassword = ref(false)
const changeDmPassword = ref(false)

onMounted(async () => {
  await loadCampaign()
  if (campaign.value) {
    form.name = campaign.value.name
    form.description = campaign.value.description
    form.level = campaign.value.level
  }
  loading.value = false
})

async function handleSave() {
  saving.value = true
  saved.value = false

  const data: any = {
    name: form.name,
    description: form.description,
    level: form.level,
  }

  if (changePassword.value) {
    data.password = form.password || null
  }
  if (changeDmPassword.value) {
    data.dmPassword = form.dmPassword || null
  }

  await updateCampaign(campaignId.value, data)
  await loadCampaign()
  saving.value = false
  saved.value = true
  setTimeout(() => { saved.value = false }, 2000)
}
</script>

<template>
  <div class="container mx-auto px-4 py-8 max-w-2xl">
    <div class="mb-8">
      <NuxtLink
        :to="`/campaigns/${campaignId}`"
        class="text-digimon-dark-400 hover:text-white text-sm mb-4 inline-block"
      >
        ← Back to Campaign Hub
      </NuxtLink>
      <h1 class="font-display text-3xl font-bold text-white">Campaign Settings</h1>
    </div>

    <div v-if="loading" class="text-center py-16">
      <div class="text-digimon-dark-400">Loading...</div>
    </div>

    <form v-else class="space-y-6" @submit.prevent="handleSave">
      <!-- Name -->
      <div>
        <label class="block text-sm font-medium text-digimon-dark-300 mb-2">Campaign Name</label>
        <input
          v-model="form.name"
          type="text"
          required
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
        <h3 class="font-semibold text-white">Password Protection</h3>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm text-digimon-dark-400">Campaign Password</label>
            <label class="flex items-center gap-2 text-sm text-digimon-dark-400">
              <input v-model="changePassword" type="checkbox" class="rounded" />
              Change password
            </label>
          </div>
          <input
            v-if="changePassword"
            v-model="form.password"
            type="password"
            placeholder="New password (leave blank to remove)"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none"
          />
          <p v-else class="text-sm text-digimon-dark-500">
            {{ campaign?.hasPassword ? 'Password is set' : 'No password set' }}
          </p>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm text-digimon-dark-400">DM Password</label>
            <label class="flex items-center gap-2 text-sm text-digimon-dark-400">
              <input v-model="changeDmPassword" type="checkbox" class="rounded" />
              Change password
            </label>
          </div>
          <input
            v-if="changeDmPassword"
            v-model="form.dmPassword"
            type="password"
            placeholder="New DM password (leave blank to remove)"
            class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                   focus:border-digimon-orange-500 focus:outline-none"
          />
          <p v-else class="text-sm text-digimon-dark-500">
            {{ campaign?.hasDmPassword ? 'DM password is set' : 'No DM password set' }}
          </p>
        </div>
      </div>

      <!-- Rules Settings (Placeholder) -->
      <div class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700">
        <h3 class="font-semibold text-white mb-2">Campaign Rules</h3>
        <p class="text-digimon-dark-400 text-sm">
          Rules customization coming soon. This section will allow you to select additional or alternative rules for this campaign.
        </p>
      </div>

      <!-- Submit -->
      <div class="flex items-center gap-4">
        <button
          type="submit"
          :disabled="saving"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 disabled:opacity-50
                 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          {{ saving ? 'Saving...' : 'Save Changes' }}
        </button>
        <span v-if="saved" class="text-green-400 text-sm">Saved!</span>
      </div>
    </form>
  </div>
</template>
