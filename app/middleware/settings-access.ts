// Gates campaign Settings specifically — stricter than dm-access.ts.
// Ownerless campaigns behave exactly as they always have (DM password only,
// forever). Owned campaigns reserve Settings for the owner/co-owner; the DM
// password alone still grants every other GM tool page (via dm-access.ts)
// but no longer reaches Settings here.
export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return

  try {
    const campaign = await $fetch<{ ownerId: string | null; hasDmPassword: boolean }>(`/api/campaigns/${campaignId}`)

    if (!campaign.ownerId) {
      const cookie = useCookie(`campaign-dm-${campaignId}`)
      if (cookie.value) return
      if (campaign.hasDmPassword) {
        return navigateTo(`/campaigns/${campaignId}`)
      }
      return
    }

    // useRequestFetch (not $fetch) so the session cookie is forwarded during
    // SSR/direct navigation — a bare $fetch on the server doesn't carry the
    // incoming request's cookies to this internal call.
    const requestFetch = useRequestFetch()
    const access = await requestFetch<{ isOwner: boolean; isCoOwner: boolean }>(`/api/campaigns/${campaignId}/my-access`)
    if (access.isOwner || access.isCoOwner) return

    return navigateTo(`/campaigns/${campaignId}`)
  } catch {
    return navigateTo(`/campaigns/${campaignId}`)
  }
})
