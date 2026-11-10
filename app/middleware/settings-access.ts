export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return
  try {
    const access = await useRequestFetch()<{ isManager: boolean }>(`/api/campaigns/${campaignId}/my-access`)
    if (access.isManager) {
      useCookie(`campaign-dm-${campaignId}`, { maxAge: 60 * 60 * 24 * 30 }).value = 'true'
      return
    }
  } catch { /* A failed authority check never grants access. */ }
  useCookie(`campaign-dm-${campaignId}`).value = null
  return navigateTo(`/campaigns/${campaignId}`)
})
