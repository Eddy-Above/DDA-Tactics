import { eq } from 'drizzle-orm'
import { db, campaigns, encounters } from '../db'
import type { CampaignLevel, CampaignRulesSettings, EddySoulRules, HouseRules } from '../../types'
import { readCombatMetadata } from './combatRecordCache'

export interface CampaignCombatContext {
  campaignLevel: CampaignLevel
  rulesSettings: CampaignRulesSettings | undefined
  eddySoulRules: EddySoulRules
  houseRules: HouseRules | undefined
}

// Keep rule defaults consistent for actions that already loaded their encounter row.
export async function loadCampaignCombatContext(campaignId: string | null | undefined): Promise<CampaignCombatContext> {
  const campaign = campaignId
    ? await readCombatMetadata(`campaign-row:${campaignId}`, async () => (await db.select().from(campaigns).where(eq(campaigns.id, campaignId)))[0])
    : undefined
  const rulesSettings = campaign ? campaign.rulesSettings ?? {} : undefined
  return {
    campaignLevel: campaign?.level ?? 'standard',
    rulesSettings,
    eddySoulRules: rulesSettings?.eddySoulRules ?? {},
    houseRules: rulesSettings?.houseRules,
  }
}

// Aura refreshes only run during combat; avoid loading campaign rules for inactive encounters.
export async function loadEncounterCombatContext(encounterId: string | undefined) {
  if (!encounterId) return null
  const [encounter] = await db.select().from(encounters).where(eq(encounters.id, encounterId))
  if (!encounter || encounter.phase !== 'combat') return null
  return { encounter, ...await loadCampaignCombatContext(encounter.campaignId) }
}
