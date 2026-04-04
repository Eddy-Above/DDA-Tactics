import type { Campaign, CampaignLevel, TormentRequirements, CampaignRulesSettings, SkillRenames, EddySoulRules, HouseRules } from '../types'

export function useCampaignContext() {
  const route = useRoute()
  const { fetchCampaign } = useCampaigns()

  const campaign = useState<Campaign | null>('current-campaign', () => null)

  const campaignId = computed(() => route.params.campaignId as string)

  const campaignLevel = computed<CampaignLevel>(() => campaign.value?.level || 'standard')

  const campaignRules = computed<TormentRequirements | undefined>(() => {
    const rules = campaign.value?.rulesSettings as CampaignRulesSettings | undefined
    return rules?.tormentRequirements
  })

  const skillRenames = computed<SkillRenames | undefined>(() => {
    const rules = campaign.value?.rulesSettings as CampaignRulesSettings | undefined
    return rules?.skillRenames
  })

  const eddySoulRules = computed<EddySoulRules | undefined>(() => {
    const rules = campaign.value?.rulesSettings as CampaignRulesSettings | undefined
    return rules?.eddySoulRules
  })

  const houseRules = computed<HouseRules | undefined>(() => {
    const rules = campaign.value?.rulesSettings as CampaignRulesSettings | undefined
    return rules?.houseRules
  })

  async function loadCampaign(force?: boolean) {
    const id = campaignId.value
    if (!id) return
    if (!force && campaign.value?.id === id) return
    campaign.value = await fetchCampaign(id)
  }

  return {
    campaignId,
    campaign,
    campaignLevel,
    campaignRules,
    skillRenames,
    eddySoulRules,
    houseRules,
    loadCampaign,
  }
}
