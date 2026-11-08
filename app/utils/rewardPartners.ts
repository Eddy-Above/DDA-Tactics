interface PartnerForm {
  id: string
  name: string
  campaignId?: string | null
  partnerId?: string | null
  isEnemy?: boolean
  stage?: string
  spriteUrl?: string | null
  bonusDP?: number
  evolvesFromId?: string | null
  evolutionPathIds?: readonly string[] | null
}
interface PartnerLine {
  id: string
  name?: string
  campaignId?: string | null
  partnerId?: string | null
  chain?: unknown
}
export interface RewardPartner {
  id: string
  name: string
  partnerId: string
  spriteUrl: string | null
  bonusDP: number
  formIds: string[]
}

const stages = ['fresh', 'in-training', 'rookie', 'champion', 'ultimate', 'mega', 'ultra']
const stageRank = (stage?: string) => { const index = stages.indexOf(stage ?? ''); return index < 0 ? stages.length : index }

/** One shared Bonus DP pool per linked partner, never crossing campaign or Tamer ownership. */
export function rewardPartners(forms: readonly PartnerForm[], lines: readonly PartnerLine[], campaignId: string, tamerIds: readonly string[]): RewardPartner[] {
  const owners = new Set(tamerIds)
  const records = new Map(forms.filter(form => form.campaignId === campaignId && !form.isEnemy && form.partnerId && owners.has(form.partnerId)).map(form => [form.id, form]))
  const parents = new Map([...records.keys()].map(id => [id, id]))
  const children = new Set<string>()
  function root(id: string) {
    let current = id
    while (parents.get(current) !== current) current = parents.get(current)!
    while (id !== current) { const next = parents.get(id)!; parents.set(id, current); id = next }
    return current
  }
  function join(a: string, b: string) {
    if (!records.has(a) || !records.has(b) || records.get(a)!.partnerId !== records.get(b)!.partnerId) return false
    const first = root(a), second = root(b)
    if (first !== second) parents.set(second, first)
    return true
  }
  for (const form of records.values()) {
    if (form.evolvesFromId && join(form.id, form.evolvesFromId)) children.add(form.id)
    for (const child of form.evolutionPathIds ?? []) if (join(form.id, child)) children.add(child)
  }
  const ownedLines = lines.filter(line => line.campaignId === campaignId && line.partnerId && owners.has(line.partnerId)).map(line => {
    let parsed = line.chain
    if (typeof parsed === 'string') { try { parsed = JSON.parse(parsed) } catch { parsed = [] } }
    const chain = Array.isArray(parsed) ? parsed : []
    const ids = chain.map(entry => entry?.digimonId)
      .filter((id): id is string => typeof id === 'string' && records.get(id)?.partnerId === line.partnerId)
    for (let i = 1; i < ids.length; i++) join(ids[0], ids[i])
    for (const entry of chain) {
      if (Number.isInteger(entry?.evolvesFromIndex) && entry.evolvesFromIndex >= 0) {
        const parent = chain[entry.evolvesFromIndex]?.digimonId
        if (entry.digimonId !== parent && join(entry.digimonId, parent)) children.add(entry.digimonId)
      }
    }
    return { ...line, ids }
  }).sort((a, b) => a.id.localeCompare(b.id))
  const groups = new Map<string, PartnerForm[]>()
  for (const form of records.values()) {
    const id = root(form.id)
    const group = groups.get(id) ?? []
    group.push(form); groups.set(id, group)
  }
  const lineByGroup = new Map<string, typeof ownedLines[number]>()
  for (const line of ownedLines) for (const id of line.ids) if (!lineByGroup.has(root(id))) lineByGroup.set(root(id), line)
  return [...groups].map(([id, group]) => {
    const roots = group.filter(form => !children.has(form.id))
    const representative = (roots.length ? roots : group).sort((a, b) => stageRank(a.stage) - stageRank(b.stage) || a.id.localeCompare(b.id))[0]
    const formIds = group.map(form => form.id).sort()
    const line = lineByGroup.get(id)
    return { id: representative.id, name: line?.name?.trim() || representative.name, partnerId: representative.partnerId!,
      spriteUrl: representative.spriteUrl ?? null, formIds,
      bonusDP: group.reduce((highest, form) => Math.max(highest, Number.isFinite(form.bonusDP) ? form.bonusDP! : 0), 0) }
  }).sort((a, b) => a.id.localeCompare(b.id))
}
