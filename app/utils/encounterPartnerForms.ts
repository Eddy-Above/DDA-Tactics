interface PartnerLine {
  partnerId?: string | null
  chain?: unknown
  currentStageIndex?: number | null
}
interface PartnerForm {
  id: string
  partnerId?: string | null
  isEnemy?: boolean
}

function partnerEvolutionState(lines: readonly PartnerLine[]) {
  const current = new Set<string>(), managed = new Set<string>()
  for (const line of lines) {
    if (!line.partnerId) continue
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

export function currentPartnerFormIds(lines: readonly PartnerLine[]): string[] {
  return [...partnerEvolutionState(lines).current]
}

/** A partnered line is an association even when its library form has no partnerId. */
export function encounterPartnerForms<T extends PartnerForm>(forms: readonly T[], lines: readonly PartnerLine[]): T[] {
  const { current, managed } = partnerEvolutionState(lines)
  return forms.filter(form => current.has(form.id) || !!form.partnerId && !form.isEnemy && !managed.has(form.id))
}
