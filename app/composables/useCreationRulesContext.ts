import type { ComputedRef, InjectionKey, Ref } from 'vue'
import type {
  CampaignLevel,
  CreationRules,
  EddySoulRules,
  HouseRules,
  SkillRenames,
  TormentRequirements,
} from '../types'
import { extractCreationRules } from '~/utils/creationRules'

// Rules source for the tamer/digimon creation forms. Campaign pages resolve
// rules from the campaign (via useCampaignContext); workshop pages provide a
// sandbox rules snapshot instead. The provided context always wins — never
// fall back to campaign state on workshop routes, because useCampaignContext's
// `campaign` is a global useState that can still hold the last-visited campaign.
export interface CreationRulesContext {
  campaignId: ComputedRef<string | null>
  campaignLevel: ComputedRef<CampaignLevel>
  campaignRules: ComputedRef<TormentRequirements | undefined>
  skillRenames: ComputedRef<SkillRenames | undefined>
  eddySoulRules: ComputedRef<EddySoulRules | undefined>
  houseRules: ComputedRef<HouseRules | undefined>
  skillOrdersEnabled: ComputedRef<boolean>
  // Snapshot to persist on the record being created/edited (workshop mode);
  // null on campaign pages (campaign characters derive rules from the campaign)
  creationRules: ComputedRef<CreationRules | null>
  loadCampaign: (force?: boolean) => Promise<void>
}

const CREATION_RULES_KEY: InjectionKey<CreationRulesContext> = Symbol('creation-rules-context')

export function provideCreationRules(rules: Ref<CreationRules>): CreationRulesContext {
  const ctx: CreationRulesContext = {
    campaignId: computed(() => null),
    campaignLevel: computed(() => rules.value.level || 'standard'),
    campaignRules: computed(() => rules.value.tormentRequirements),
    skillRenames: computed(() => rules.value.skillRenames),
    eddySoulRules: computed(() => (rules.value.eddySoulRules ?? {}) as EddySoulRules),
    houseRules: computed(() => (rules.value.houseRules ?? {}) as HouseRules),
    skillOrdersEnabled: computed(() => rules.value.houseRules?.skillOrders === true),
    creationRules: computed(() => rules.value),
    loadCampaign: async () => {},
  }
  provide(CREATION_RULES_KEY, ctx)
  return ctx
}

export function useCreationRulesContext(): CreationRulesContext {
  const injected = inject(CREATION_RULES_KEY, null)
  if (injected) return injected

  const campaignCtx = useCampaignContext()
  return {
    campaignId: computed(() => campaignCtx.campaignId.value ?? null),
    campaignLevel: campaignCtx.campaignLevel,
    campaignRules: campaignCtx.campaignRules,
    skillRenames: campaignCtx.skillRenames,
    eddySoulRules: campaignCtx.eddySoulRules,
    houseRules: campaignCtx.houseRules,
    skillOrdersEnabled: campaignCtx.skillOrdersEnabled,
    creationRules: computed(() =>
      campaignCtx.campaign.value ? extractCreationRules(campaignCtx.campaign.value) : null,
    ),
    loadCampaign: campaignCtx.loadCampaign,
  }
}
