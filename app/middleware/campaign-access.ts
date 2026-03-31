export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return

  const cookie = useCookie(`campaign-access-${campaignId}`)
  if (cookie.value) return

  // Check if campaign has a password
  try {
    const campaign = await $fetch<{ hasPassword: boolean }>(`/api/campaigns/${campaignId}`)
    if (campaign.hasPassword) {
      return navigateTo(`/?unlock=${campaignId}`)
    }
  } catch {
    return navigateTo('/')
  }
})
