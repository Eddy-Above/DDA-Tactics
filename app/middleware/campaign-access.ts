export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return
  try {
    const access = await useRequestFetch()<{ isMember: boolean }>(`/api/campaigns/${campaignId}/my-access`)
    if (access.isMember) {
      useCookie(`campaign-access-${campaignId}`, { maxAge: 60 * 60 * 24 * 30 }).value = 'true'
      return
    }
  } catch { /* A failed authority check never grants access. */ }
  useCookie(`campaign-access-${campaignId}`).value = null
  return navigateTo(`/?unlock=${campaignId}`)
})
