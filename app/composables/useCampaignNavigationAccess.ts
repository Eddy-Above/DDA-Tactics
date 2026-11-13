interface NavigationCampaignAccess {
  isMember: boolean
  isDm: boolean
  isManager: boolean
}

type NavigationRequests = WeakMap<object, Map<string, Promise<NavigationCampaignAccess>>>

/** Share authority checks between guards of one navigation, never later visits. */
export function useCampaignNavigationAccess(to: object, campaignId: string): Promise<NavigationCampaignAccess> {
  const app = useNuxtApp() as ReturnType<typeof useNuxtApp> & { _campaignNavigationRequests?: NavigationRequests }
  const navigations = app._campaignNavigationRequests ??= new WeakMap()
  let requests = navigations.get(to)
  if (!requests) {
    requests = new Map()
    navigations.set(to, requests)
  }
  let request = requests.get(campaignId)
  if (!request) {
    request = useRequestFetch()<NavigationCampaignAccess>(`/api/campaigns/${campaignId}/my-access`)
    requests.set(campaignId, request)
  }
  return request
}
