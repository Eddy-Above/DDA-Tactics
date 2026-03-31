export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return

  const cookie = useCookie(`campaign-dm-${campaignId}`)
  if (cookie.value) return

  // Check if campaign has a DM password
  try {
    const campaign = await $fetch<{ hasDmPassword: boolean }>(`/api/campaigns/${campaignId}`)
    if (campaign.hasDmPassword) {
      return navigateTo(`/campaigns/${campaignId}`)
    }
  } catch {
    return navigateTo(`/campaigns/${campaignId}`)
  }
})
