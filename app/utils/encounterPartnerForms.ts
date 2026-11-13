interface PartnerLine {
  campaignId?: string | null
  partnerId?: string | null
  chain?: unknown
  currentStageIndex?: number | null
}
interface PartnerForm {
  id: string
  campaignId?: string | null
  partnerId?: string | null
  isEnemy?: boolean
}

function partnerEvolutionState(lines: readonly PartnerLine[], campaignId: string, owners: ReadonlySet<string>) {
  const current = new Set<string>(), managed = new Set<string>()
  for (const line of lines) {
    if (!line.partnerId || !owners.has(line.partnerId) || line.campaignId && line.campaignId !== campaignId) continue
    let chain = line.chain
    if (typeof chain === 'string') { try { chain = JSON.parse(chain) } catch { continue } }
    if (!Array.isArray(chain)) continue
    const currentId = chain[line.currentStageIndex ?? 0]?.digimonId
    if (typeof currentId !== 'string' || !currentId) continue
    current.add(currentId)
    for (const entry of chain) if (typeof entry?.digimonId === 'string') managed.add(entry.digimonId)
  }
  return { current, managed }
}

export function currentPartnerFormIds(lines: readonly PartnerLine[], campaignId: string, tamerIds: readonly string[]): string[] {
  return [...partnerEvolutionState(lines, campaignId, new Set(tamerIds)).current]
}

/** A partnered line is an association even when its library form has no partnerId. */
export function encounterPartnerForms<T extends PartnerForm>(forms: readonly T[], lines: readonly PartnerLine[], campaignId: string, tamerIds: readonly string[]): T[] {
  const owners = new Set(tamerIds)
  const { current, managed } = partnerEvolutionState(lines, campaignId, owners)
  return forms.filter(form => {
    if (form.campaignId && form.campaignId !== campaignId || form.partnerId && !owners.has(form.partnerId)) return false
    return current.has(form.id) || !!form.partnerId && !form.isEnemy && !managed.has(form.id)
  })
}
