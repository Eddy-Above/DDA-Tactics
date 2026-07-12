export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return

  const cookie = useCookie(`campaign-access-${campaignId}`)
  if (cookie.value) return

  // Account-based access: any grant at all (DM-tier or player-tier) counts
  // as "you belong here" and bypasses the password prompt.
  try {
    const access = await $fetch<{ isOwner: boolean; isCoOwner: boolean; isCoDm: boolean; playerScope: 'all' | 'specific' | null }>(
      `/api/campaigns/${campaignId}/my-access`,
    )
    if (access.isOwner || access.isCoOwner || access.isCoDm || access.playerScope) return
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
