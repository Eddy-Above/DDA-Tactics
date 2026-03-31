import type { Campaign, CampaignLevel } from '../types'

export function useCampaignContext() {
  const route = useRoute()
  const { fetchCampaign } = useCampaigns()

  const campaign = useState<Campaign | null>('current-campaign', () => null)

  const campaignId = computed(() => route.params.campaignId as string)

  const campaignLevel = computed<CampaignLevel>(() => campaign.value?.level || 'standard')

  async function loadCampaign() {
    const id = campaignId.value
    if (!id) return
    if (campaign.value?.id === id) return
    campaign.value = await fetchCampaign(id)
  }

  return {
    campaignId,
    campaign,
    campaignLevel,
    loadCampaign,
  }
}
