<script setup lang="ts">
definePageMeta({
  title: 'Campaign Hub',
  middleware: ['campaign-access'],
})

const { campaignId, campaign, campaignLevel, loadCampaign } = useCampaignContext()
const { tamers, fetchTamers } = useTamers()
const { digimonList, fetchDigimon } = useDigimon()
const { encounters, fetchEncounters } = useEncounters()
const { verifyDmPassword } = useCampaigns()

const loading = ref(true)

// DM password modal
const showDmPasswordModal = ref(false)
const dmPasswordInput = ref('')
const dmPasswordError = ref('')

onMounted(async () => {
  await loadCampaign()
  await Promise.all([
    fetchTamers(campaignId.value),
    fetchDigimon({ campaignId: campaignId.value }),
    fetchEncounters(campaignId.value),
  ])
  loading.value = false
})

const stats = computed(() => [
  { label: 'Tamers', value: tamers.value.length, color: 'text-digimon-orange-400' },
  { label: 'Digimon', value: digimonList.value.length, color: 'text-digimon-stage-champion' },
  { label: 'Encounters', value: encounters.value.length, color: 'text-green-400' },
])

function openDmSection() {
  if (campaign.value?.hasDmPassword) {
    const cookie = useCookie(`campaign-dm-${campaignId.value}`)
    if (cookie.value) {
      navigateTo(`/campaigns/${campaignId.value}/library`)
    } else {
      showDmPasswordModal.value = true
      dmPasswordInput.value = ''
      dmPasswordError.value = ''
    }
  } else {
    navigateTo(`/campaigns/${campaignId.value}/library`)
  }
}

async function submitDmPassword() {
  if (!dmPasswordInput.value) return

  const valid = await verifyDmPassword(campaignId.value, dmPasswordInput.value)
  if (valid) {
    const cookie = useCookie(`campaign-dm-${campaignId.value}`, { maxAge: 60 * 60 * 24 * 30 })
    cookie.value = 'true'
    showDmPasswordModal.value = false
    navigateTo(`/campaigns/${campaignId.value}/library`)
  } else {
    dmPasswordError.value = 'Incorrect DM password'
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div v-if="loading" class="text-center py-16">
      <div class="text-digimon-dark-400">Loading campaign...</div>
    </div>

    <div v-else-if="campaign">
      <!-- Header -->
      <div class="mb-8">
        <NuxtLink to="/" class="text-digimon-dark-400 hover:text-white text-sm mb-4 inline-block">
          ← All Campaigns
        </NuxtLink>
        <h1 class="font-display text-3xl font-bold text-white mb-2">{{ campaign.name }}</h1>
        <p v-if="campaign.description" class="text-digimon-dark-400">{{ campaign.description }}</p>
        <p class="text-sm mt-2">
          <span class="capitalize font-medium" :class="{
            'text-green-400': campaign.level === 'standard',
            'text-yellow-400': campaign.level === 'enhanced',
            'text-red-400': campaign.level === 'extreme',
          }">{{ campaign.level }}</span>
          <span class="text-digimon-dark-600"> campaign</span>
        </p>
      </div>

      <!-- Stats -->
      <div class="grid grid-cols-3 gap-4 mb-8">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="bg-digimon-dark-800 rounded-xl p-4 border border-digimon-dark-700"
        >
          <p class="text-sm text-digimon-dark-400 mb-1">{{ stat.label }}</p>
          <p :class="['text-3xl font-display font-bold', stat.color]">{{ stat.value }}</p>
        </div>
      </div>

      <!-- Section Buttons -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        <button
          class="bg-digimon-dark-800 rounded-xl p-8 border border-digimon-dark-700
                 hover:border-digimon-orange-500 transition-all text-left group"
          @click="openDmSection"
        >
          <div class="text-4xl mb-4">📖</div>
          <h2 class="font-display text-2xl font-semibold text-white group-hover:text-digimon-orange-400 transition-colors mb-2">
            DM Section
          </h2>
          <p class="text-digimon-dark-400">
            Manage tamers, digimon, encounters, and evolution lines
          </p>
          <span v-if="campaign.hasDmPassword" class="text-digimon-dark-500 text-sm mt-2 inline-block">🔒 Password protected</span>
        </button>

        <NuxtLink
          :to="`/campaigns/${campaignId}/player`"
          class="bg-digimon-dark-800 rounded-xl p-8 border border-digimon-dark-700
                 hover:border-digimon-orange-500 transition-all text-left group"
        >
          <div class="text-4xl mb-4">🎮</div>
          <h2 class="font-display text-2xl font-semibold text-white group-hover:text-digimon-orange-400 transition-colors mb-2">
            Player Section
          </h2>
          <p class="text-digimon-dark-400">
            View your character, partner digimon, and respond to encounters
          </p>
        </NuxtLink>
      </div>

      <!-- Settings link -->
      <div class="text-center">
        <NuxtLink
          :to="`/campaigns/${campaignId}/settings`"
          class="text-digimon-dark-400 hover:text-digimon-orange-400 text-sm transition-colors"
        >
          Campaign Settings →
        </NuxtLink>
      </div>
    </div>

    <!-- DM Password Modal -->
    <Teleport to="body">
      <div v-if="showDmPasswordModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700 p-6 w-full max-w-sm">
          <h3 class="font-display text-lg font-semibold text-white mb-4">Enter DM Password</h3>
          <form @submit.prevent="submitDmPassword">
            <input
              v-model="dmPasswordInput"
              type="password"
              placeholder="DM Password"
              class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                     focus:border-digimon-orange-500 focus:outline-none mb-2"
              autofocus
            />
            <p v-if="dmPasswordError" class="text-red-400 text-sm mb-3">{{ dmPasswordError }}</p>
            <div class="flex gap-3 mt-4">
              <button
                type="button"
                class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
                @click="showDmPasswordModal = false"
              >
                Cancel
              </button>
              <button
                type="submit"
                class="flex-1 bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-4 py-2 rounded-lg font-semibold transition-colors"
              >
                Enter
              </button>
            </div>
          </form>
        </div>
      </div>
    </Teleport>
  </div>
</template>
