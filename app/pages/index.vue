<script setup lang="ts">
import { refDebounced } from '@vueuse/core'

definePageMeta({
  title: 'Campaigns',
})

const { campaigns, totalPages, fetchCampaigns, verifyCampaignPassword } = useCampaigns()
const loading = ref(true)
const currentPage = ref(1)
const searchTerm = ref('')
const debouncedSearchTerm = refDebounced(searchTerm, 300)

// Password modal state
const showPasswordModal = ref(false)
const passwordCampaignId = ref<string | null>(null)
const passwordInput = ref('')
const passwordError = ref('')

onMounted(async () => {
  await fetchCampaigns({ page: currentPage.value, pageSize: 20, search: searchTerm.value })
  loading.value = false

  // Check if redirected to unlock a campaign
  const route = useRoute()
  if (route.query.unlock) {
    openPasswordModal(route.query.unlock as string)
  }
})

watch(debouncedSearchTerm, async (value) => {
  currentPage.value = 1
  await fetchCampaigns({ page: 1, pageSize: 20, search: value })
})

async function goToPage(newPage: number) {
  if (newPage < 1 || newPage > totalPages.value) return
  currentPage.value = newPage
  await fetchCampaigns({ page: newPage, pageSize: 20, search: searchTerm.value })
}

async function openCampaign(campaign: any) {
  if (!campaign.hasPassword) {
    navigateTo(`/campaigns/${campaign.id}`)
    return
  }

  const cookie = useCookie(`campaign-access-${campaign.id}`)
  if (cookie.value) {
    navigateTo(`/campaigns/${campaign.id}`)
    return
  }

  // Account-based access: any grant at all (DM-tier or player-tier) counts
  // as "you belong here" and skips the password prompt entirely — mirrors
  // the bypass condition in middleware/campaign-access.ts.
  try {
    const access = await $fetch<{ isOwner: boolean; isCoOwner: boolean; isCoDm: boolean; playerScope: 'all' | 'specific' | null }>(
      `/api/campaigns/${campaign.id}/my-access`,
    )
    if (access.isOwner || access.isCoOwner || access.isCoDm || access.playerScope) {
      useCookie(`campaign-access-${campaign.id}`, { maxAge: 60 * 60 * 24 * 30 }).value = 'true'
      navigateTo(`/campaigns/${campaign.id}`)
      return
    }
  } catch {
    // ignore — fall through to the password prompt
  }

  openPasswordModal(campaign.id)
}

function openPasswordModal(campaignId: string) {
  passwordCampaignId.value = campaignId
  passwordInput.value = ''
  passwordError.value = ''
  showPasswordModal.value = true
}

async function submitPassword() {
  if (!passwordCampaignId.value || !passwordInput.value) return

  const valid = await verifyCampaignPassword(passwordCampaignId.value, passwordInput.value)
  if (valid) {
    const cookie = useCookie(`campaign-access-${passwordCampaignId.value}`, { maxAge: 60 * 60 * 24 * 30 })
    cookie.value = 'true'
    showPasswordModal.value = false
    navigateTo(`/campaigns/${passwordCampaignId.value}`)
  } else {
    passwordError.value = 'Incorrect password'
  }
}

function getLevelColor(level: string) {
  switch (level) {
    case 'enhanced': return 'text-yellow-400'
    case 'extreme': return 'text-red-400'
    default: return 'text-green-400'
  }
}
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <div class="mb-8 flex items-center justify-between">
      <div>
        <h1 class="font-display text-3xl font-bold text-white mb-2">
          DDA Tactics
        </h1>
        <p class="text-digimon-dark-400">
          Select a campaign or create a new one
        </p>
      </div>
      <div class="flex gap-2">
        <NuxtLink
          to="/workshop"
          class="bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          🛠️ Character Workshop
        </NuxtLink>
        <NuxtLink
          to="/campaigns/new"
          class="bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
        >
          + New Campaign
        </NuxtLink>
      </div>
    </div>

    <div class="mb-6">
      <input
        v-model="searchTerm"
        type="text"
        placeholder="Search campaigns by name..."
        class="w-full max-w-md bg-digimon-dark-800 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
               focus:border-digimon-orange-500 focus:outline-none"
      />
    </div>

    <div v-if="loading" class="text-center py-16">
      <div class="text-digimon-dark-400">Loading campaigns...</div>
    </div>

    <div v-else-if="campaigns.length === 0 && searchTerm" class="text-center py-16">
      <div class="text-6xl mb-4">🔍</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Campaigns Found</h2>
      <p class="text-digimon-dark-400 mb-6">No campaigns match "{{ searchTerm }}"</p>
    </div>

    <div v-else-if="campaigns.length === 0" class="text-center py-16">
      <div class="text-6xl mb-4">📋</div>
      <h2 class="text-xl font-semibold text-white mb-2">No Campaigns Yet</h2>
      <p class="text-digimon-dark-400 mb-6">Create your first campaign to get started</p>
      <NuxtLink
        to="/campaigns/new"
        class="inline-block bg-digimon-orange-500 hover:bg-digimon-orange-600 text-white px-6 py-3 rounded-lg font-semibold transition-colors"
      >
        Create Campaign
      </NuxtLink>
    </div>

    <template v-else>
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <button
          v-for="campaign in campaigns"
          :key="campaign.id"
          class="bg-digimon-dark-800 rounded-xl p-6 border border-digimon-dark-700
                 hover:border-digimon-orange-500 transition-all text-left group"
          @click="openCampaign(campaign)"
        >
          <div class="flex items-start justify-between mb-3">
            <h2 class="font-display text-xl font-semibold text-white group-hover:text-digimon-orange-400 transition-colors">
              {{ campaign.name }}
            </h2>
            <div class="flex items-center gap-2">
              <span v-if="campaign.hasPassword" class="text-digimon-dark-500" title="Password protected">🔒</span>
            </div>
          </div>
          <p v-if="campaign.description" class="text-digimon-dark-400 text-sm mb-4 line-clamp-2">
            {{ campaign.description }}
          </p>
          <div class="flex items-center gap-3 text-sm">
            <span :class="getLevelColor(campaign.level)" class="capitalize font-medium">
              {{ campaign.level }}
            </span>
            <span class="text-digimon-dark-600">·</span>
            <span class="text-digimon-dark-500">
              {{ new Date(campaign.createdAt).toLocaleDateString() }}
            </span>
          </div>
        </button>
      </div>

      <div v-if="totalPages > 1" class="flex items-center justify-center gap-4 mt-8">
        <button
          class="bg-digimon-dark-800 hover:bg-digimon-dark-700 disabled:opacity-40 disabled:cursor-not-allowed
                 text-white px-4 py-2 rounded-lg border border-digimon-dark-700 transition-colors"
          :disabled="currentPage <= 1"
          @click="goToPage(currentPage - 1)"
        >
          ← Prev
        </button>
        <span class="text-digimon-dark-400 text-sm">
          Page {{ currentPage }} of {{ totalPages }}
        </span>
        <button
          class="bg-digimon-dark-800 hover:bg-digimon-dark-700 disabled:opacity-40 disabled:cursor-not-allowed
                 text-white px-4 py-2 rounded-lg border border-digimon-dark-700 transition-colors"
          :disabled="currentPage >= totalPages"
          @click="goToPage(currentPage + 1)"
        >
          Next →
        </button>
      </div>
    </template>

    <!-- Password Modal -->
    <Teleport to="body">
      <div v-if="showPasswordModal" class="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
        <div class="bg-digimon-dark-800 rounded-xl border border-digimon-dark-700 p-6 w-full max-w-sm">
          <h3 class="font-display text-lg font-semibold text-white mb-4">Enter Campaign Password</h3>
          <form @submit.prevent="submitPassword">
            <input
              v-model="passwordInput"
              type="password"
              placeholder="Password"
              class="w-full bg-digimon-dark-900 border border-digimon-dark-600 rounded-lg px-4 py-2 text-white
                     focus:border-digimon-orange-500 focus:outline-none mb-2"
              autofocus
            />
            <p v-if="passwordError" class="text-red-400 text-sm mb-3">{{ passwordError }}</p>
            <div class="flex gap-3 mt-4">
              <button
                type="button"
                class="flex-1 bg-digimon-dark-700 hover:bg-digimon-dark-600 text-white px-4 py-2 rounded-lg transition-colors"
                @click="showPasswordModal = false"
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
