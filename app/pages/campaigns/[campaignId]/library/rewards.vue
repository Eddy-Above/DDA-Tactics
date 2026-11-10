<script setup lang="ts">
import { displayImageUrl } from '~/utils/imageFallback'
import type { RewardResult, RewardRoster } from '~/types/rewards'
import { useRewardGrant } from '~/composables/useRewardGrant'

definePageMeta({ title: 'Grant Rewards', middleware: ['campaign-access', 'dm-access'] })
const { campaignId } = useCampaignContext()
const { roster, selectedTamerIds, selectedDigimonIds, selectedPartners, amounts, loading, busy, error, success,
  needsVerification, rosterReady, validationMessage, load, toggleTamer, toggleDigimon, selectAll, clearSelection, grant } = useRewardGrant({
  load: () => $fetch<RewardRoster>(`/api/campaigns/${campaignId.value}/rewards`),
  send: body => $fetch<RewardResult>(`/api/campaigns/${campaignId.value}/rewards`, { method: 'POST', body }),
})
const dmPassword = ref(''), verifying = ref(false)
async function verifyDm() {
  if (verifying.value) return
  verifying.value = true
  try {
    const result = await $fetch<{ valid: boolean }>(`/api/campaigns/${campaignId.value}/verify-dm-password`, { method: 'POST', body: { password: dmPassword.value } })
    if (!result.valid) { error.value = 'Incorrect GM password'; return }
    dmPassword.value = ''
    await load()
  } catch (e: any) { error.value = e.data?.message ?? 'Could not verify GM access' }
  finally { verifying.value = false }
}
onMounted(load)
</script>

<template>
  <div class="container mx-auto px-4 py-8">
    <NuxtLink :to="`/campaigns/${campaignId}/library`" class="text-digimon-orange-400 hover:text-digimon-orange-300">← Library</NuxtLink>
    <h1 class="font-display text-3xl font-bold text-white mt-4 mb-2">Grant Rewards</h1>
    <p class="text-digimon-dark-400 mb-6">Reward one player or the whole group. Amounts apply to each selected recipient.</p>
    <p v-if="error" role="alert" class="mb-4 rounded-lg bg-red-900/30 border border-red-700 p-3 text-red-300">{{ error }}</p>
    <div v-if="success" role="status" class="mb-6 rounded-xl border border-green-700 bg-green-900/20 p-4 text-green-300">
      <p class="font-semibold">{{ success.replayed ? 'These rewards were already granted.' : 'Rewards granted.' }}</p>
      <p v-if="success.tamerXp">{{ success.tamerXp }} XP each for {{ success.tamerCount }} Tamer{{ success.tamerCount === 1 ? '' : 's' }}.</p>
      <p v-if="success.tamerInspiration">{{ success.tamerInspiration }} Inspiration each for {{ success.tamerCount }} Tamer{{ success.tamerCount === 1 ? '' : 's' }}.</p>
      <p v-if="success.digimonBonusDP">{{ success.digimonBonusDP }} Bonus DP each for {{ success.digimonCount }} partner Digimon.</p>
      <p v-if="success.untrackedTamerIds.length" class="text-amber-300 mt-2">Some older characters have no lifetime XP total recorded yet. Their available XP was granted; enter their starting lifetime total on the character sheet.</p>
    </div>
    <form v-if="needsVerification" class="max-w-lg rounded-xl border border-digimon-dark-700 bg-digimon-dark-800 p-6" @submit.prevent="verifyDm">
      <h2 class="font-display text-xl text-white mb-2">GM access</h2>
      <p class="text-digimon-dark-300 text-sm mb-4">Sign in with a GM account, or verify the campaign GM password to grant rewards.</p>
      <label class="block text-sm text-digimon-dark-300">GM password
        <input v-model="dmPassword" type="password" autocomplete="current-password" required class="block w-full mt-1 rounded bg-digimon-dark-700 border border-digimon-dark-600 p-2 text-white" />
      </label>
      <button :disabled="verifying" class="mt-4 bg-digimon-orange-500 hover:bg-digimon-orange-600 rounded px-4 py-2 text-white disabled:opacity-40">{{ verifying ? 'Verifying…' : 'Verify GM access' }}</button>
    </form>
    <p v-else-if="!rosterReady && !error" class="text-digimon-dark-300">Loading recipients…</p>
    <div v-else-if="!rosterReady" class="rounded-xl border border-digimon-dark-700 bg-digimon-dark-800 p-6">
      <p class="text-digimon-dark-300 mb-4">Players could not be loaded. Resolve the error above, then try again.</p>
      <button class="rounded bg-digimon-orange-500 hover:bg-digimon-orange-600 px-4 py-2 text-white" @click="load">Retry loading players</button>
    </div>
    <template v-else>
      <div class="grid lg:grid-cols-3 gap-6">
        <section class="lg:col-span-2 rounded-xl border border-digimon-dark-700 bg-digimon-dark-800 p-6">
          <div class="flex flex-wrap items-center justify-between gap-3 mb-4">
            <h2 class="font-display text-xl font-semibold text-white">Players</h2>
            <div class="flex gap-3 text-sm">
              <button :disabled="busy" class="text-digimon-orange-400 disabled:opacity-40" @click="selectAll">Select entire group</button>
              <button :disabled="busy" class="text-digimon-dark-300 disabled:opacity-40" @click="clearSelection">Clear</button>
            </div>
          </div>
          <p v-if="!roster.tamers.length" class="text-digimon-dark-400">No Tamers in this campaign yet. Add them in the Library first.</p>
          <div v-for="person in roster.tamers" :key="person.id" class="py-4 border-t border-digimon-dark-700">
            <label class="flex gap-3 items-center cursor-pointer">
              <input type="checkbox" :checked="selectedTamerIds.includes(person.id)" :disabled="busy" @change="toggleTamer(person.id)" />
              <img v-if="person.spriteUrl" :src="displayImageUrl(person.spriteUrl)" alt="" class="w-10 h-10 object-contain rounded" />
              <span><span class="block font-semibold text-white">{{ person.name }}</span>
                <span class="text-xs text-digimon-dark-400">{{ person.xp }} available XP · {{ person.totalXp ?? 'Unrecorded' }} lifetime XP · {{ person.inspiration }} Inspiration</span>
              </span>
            </label>
            <div v-if="selectedTamerIds.includes(person.id) && amounts.digimonBonusDP > 0" class="ml-7 mt-3">
              <p class="text-xs text-digimon-dark-400 mb-2">Partner Digimon receiving Bonus DP:</p>
              <div class="flex flex-wrap gap-2">
                <label v-for="partner in roster.digimon.filter(d => d.partnerId === person.id)" :key="partner.id" class="flex gap-2 items-center rounded bg-digimon-dark-700 px-3 py-2 text-sm text-white">
                  <input type="checkbox" :checked="selectedDigimonIds.includes(partner.id)" :disabled="busy" @change="toggleDigimon(partner.id)" />
                  {{ partner.name }} <span class="text-digimon-dark-400">{{ partner.bonusDP }} shared Bonus DP</span>
                </label>
                <span v-if="!roster.digimon.some(d => d.partnerId === person.id)" class="text-xs text-digimon-dark-400">No partner Digimon.</span>
              </div>
            </div>
          </div>
        </section>
        <form class="rounded-xl border border-digimon-dark-700 bg-digimon-dark-800 p-6 self-start" @submit.prevent="grant">
          <h2 class="font-display text-xl font-semibold text-white mb-4">Rewards</h2>
          <label class="block text-sm text-digimon-dark-300 mb-4">Tamer XP each
            <input v-model.number="amounts.tamerXp" type="number" min="0" step="1" :disabled="busy" class="block w-full mt-1 rounded bg-digimon-dark-700 border border-digimon-dark-600 p-2 text-white" />
          </label>
          <label class="block text-sm text-digimon-dark-300 mb-4">Tamer Inspiration each
            <input v-model.number="amounts.tamerInspiration" type="number" min="0" step="1" :disabled="busy" class="block w-full mt-1 rounded bg-digimon-dark-700 border border-digimon-dark-600 p-2 text-white" />
          </label>
          <label class="block text-sm text-digimon-dark-300 mb-4">Partner Digimon Bonus DP each
            <input v-model.number="amounts.digimonBonusDP" type="number" min="0" step="1" :disabled="busy" class="block w-full mt-1 rounded bg-digimon-dark-700 border border-digimon-dark-600 p-2 text-white" />
          </label>
          <p class="text-xs text-digimon-dark-400 mb-4">Bonus DP is shared across all evolution stages of each selected partner.</p>
          <div class="text-sm text-digimon-dark-300 border-t border-digimon-dark-600 pt-4 mb-4 space-y-1">
            <p>{{ selectedTamerIds.length }} Tamer{{ selectedTamerIds.length === 1 ? '' : 's' }} selected.</p>
            <p v-if="amounts.tamerXp > 0">{{ amounts.tamerXp }} XP each · {{ amounts.tamerXp * selectedTamerIds.length }} XP total.</p>
            <p v-if="amounts.tamerInspiration > 0">{{ amounts.tamerInspiration }} Inspiration each · {{ amounts.tamerInspiration * selectedTamerIds.length }} total.</p>
            <p v-if="amounts.digimonBonusDP > 0">{{ amounts.digimonBonusDP }} Bonus DP each for {{ selectedPartners.length }} partners · {{ amounts.digimonBonusDP * selectedPartners.length }} DP total.</p>
          </div>
          <p v-if="validationMessage" class="text-xs text-digimon-dark-400 mb-3">{{ validationMessage }}</p>
          <button type="submit" :disabled="busy || loading || !!validationMessage" class="w-full rounded bg-digimon-orange-500 hover:bg-digimon-orange-600 px-4 py-3 font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed">{{ busy ? 'Granting…' : 'Grant rewards' }}</button>
        </form>
      </div>
    </template>
  </div>
</template>
