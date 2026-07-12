// Gates the GM tool pages (library create/edit, maps). Settings has its own,
// stricter middleware — see settings-access.ts.
export default defineNuxtRouteMiddleware(async (to) => {
  const campaignId = to.params.campaignId as string
  if (!campaignId) return

  const cookie = useCookie(`campaign-dm-${campaignId}`)
  if (cookie.value) return

  // Account-based DM access: owner, co-owner, or co-dm grant all count.
  // useRequestFetch (not $fetch) so the session cookie is forwarded during
  // SSR/direct navigation — a bare $fetch on the server doesn't carry the
  // incoming request's cookies to this internal call.
  try {
    const requestFetch = useRequestFetch()
    const access = await requestFetch<{ isOwner: boolean; isCoOwner: boolean; isCoDm: boolean }>(
      `/api/campaigns/${campaignId}/my-access`,
    )
    if (access.isOwner || access.isCoOwner || access.isCoDm) {
      useCookie(`campaign-dm-${campaignId}`, { maxAge: 60 * 60 * 24 * 30 }).value = 'true'
      return
    }
  } catch {
    // ignore — fall through to the password-based check
  }

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
