import type { Digimon, EvolutionLine } from '../server/db/schema'

type Form = Pick<Digimon, 'id' | 'name' | 'stage' | 'partnerId' | 'evolvesFromId' | 'evolutionPathIds'>
type Entry = EvolutionLine['chain'][number]

export function evolutionChain(value: unknown): Entry[] {
  if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return [] } }
  return Array.isArray(value) ? value : []
}

/** A chosen base follows its sheet identity. Legacy lines keep the Rookie/first-form default. */
export function getEvolutionBaseIndex(value: unknown): number {
  const chain = evolutionChain(value)
  const selected = chain.findIndex(entry => entry.isBaseForm && entry.isUnlocked)
  if (selected >= 0) return selected
  const rookie = chain.findIndex(entry => entry.stage === 'rookie')
  return rookie >= 0 ? rookie : 0
}

/** Base forms above Rookie also retain their sheet wounds between encounters. */
export function isPersistentEvolutionForm(form: { id: string; stage: string; isEnemy?: boolean }, line?: { chain: unknown }): boolean {
  if (form.isEnemy) return false
  if (['fresh', 'in-training', 'rookie'].includes(form.stage)) return true
  return !!line && evolutionChain(line.chain)[getEvolutionBaseIndex(line.chain)]?.digimonId === form.id
}

/** Build affected connected trees, using both directions of library links and guarding cycles. */
export function planEvolutionLineSync(forms: Form[], lines: EvolutionLine[], changedIds: string[]) {
  const byId = new Map(forms.map(form => [form.id, form]))
  const children = new Map(forms.map(form => [form.id, new Set<string>()]))
  const neighbors = new Map(forms.map(form => [form.id, new Set<string>()]))
  const link = (parent: string, child: string) => {
    if (parent === child || !byId.has(parent) || !byId.has(child)) return
    children.get(parent)!.add(child)
    neighbors.get(parent)!.add(child); neighbors.get(child)!.add(parent)
  }
  for (const form of forms) {
    for (const id of form.evolutionPathIds ?? []) {
      const child = byId.get(id)
      // An explicit parent takes precedence over a stale forward link after reparenting.
      if (child && (!child.evolvesFromId || child.evolvesFromId === form.id)) link(form.id, id)
    }
    if (form.evolvesFromId) link(form.evolvesFromId, form.id)
  }
  const affected = new Set(changedIds)
  // Include the old root when a branch was detached from an existing line.
  for (const line of lines) {
    const chain = evolutionChain(line.chain)
    if (chain.some(entry => affected.has(entry.digimonId))) {
      for (const entry of chain) affected.add(entry.digimonId)
    }
  }
  const seen = new Set<string>()
  const plans: Array<{ existing?: EvolutionLine; chain: Entry[]; currentStageIndex: number; root: Form }> = []
  for (const id of affected) {
    if (!byId.has(id) || seen.has(id)) continue
    const component = new Set<string>(), pending = [id]
    while (pending.length) {
      const next = pending.pop()!
      if (component.has(next)) continue
      component.add(next); seen.add(next)
      pending.push(...neighbors.get(next)!)
    }
    const ordered = [...component].sort()
    const hasParent = new Set(ordered.flatMap(parent => [...children.get(parent)!]))
    const roots = ordered.filter(node => !hasParent.has(node))
    const existingLines = lines.filter(line => {
      const chain = evolutionChain(line.chain)
      const root = chain.find(entry => entry.evolvesFromIndex === null) ?? chain[0]
      return root && component.has(root.digimonId)
    })
    if (!existingLines.length && component.size < 2) continue
    for (const existing of existingLines.length ? existingLines : [undefined]) {
      const before = evolutionChain(existing?.chain)
      const previous = new Map(before.map(entry => [entry.digimonId, entry]))
      const chain: Entry[] = [], visited = new Set<string>()
      const walk = (formId: string, parentIndex: number | null) => {
        if (visited.has(formId)) return
        visited.add(formId)
        const form = byId.get(formId)!, index = chain.length
        chain.push({ ...previous.get(formId), stage: form.stage, species: form.name, digimonId: formId,
          isUnlocked: previous.get(formId)?.isUnlocked ?? (parentIndex === null), evolvesFromIndex: parentIndex })
        for (const child of children.get(formId)!) walk(child, index)
      }
      for (const root of [...roots, ...ordered]) walk(root, null)
      const currentId = before[existing?.currentStageIndex ?? 0]?.digimonId
      const currentIndex = chain.findIndex(entry => entry.digimonId === currentId)
      plans.push({ existing, chain, root: byId.get(chain[0]!.digimonId)!,
        currentStageIndex: currentIndex >= 0 ? currentIndex : Math.max(0, chain.findIndex(entry => entry.isUnlocked)) })
    }
  }
  return plans
}
