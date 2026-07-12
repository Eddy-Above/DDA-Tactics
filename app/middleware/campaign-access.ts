export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return

  const cookie = useCookie(`campaign-access-${campaignId}`)
  if (cookie.value) return

  // Account-based access: any grant at all (DM-tier or player-tier) counts
  // as "you belong here" and bypasses the password prompt. useRequestFetch
  // (not $fetch) so the session cookie is forwarded during SSR/direct
  // navigation — a bare $fetch on the server doesn't carry the incoming
  // request's cookies to this internal call.
  try {
    const requestFetch = useRequestFetch()
    const access = await requestFetch<{ isOwner: boolean; isCoOwner: boolean; isCoDm: boolean; playerScope: 'all' | 'specific' | null }>(
      `/api/campaigns/${campaignId}/my-access`,
    )
    if (access.isOwner || access.isCoOwner || access.isCoDm || access.playerScope) {
      useCookie(`campaign-access-${campaignId}`, { maxAge: 60 * 60 * 24 * 30 }).value = 'true'
      return
    }
  } catch {
    // ignore — fall through to the password-based check
  }

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
