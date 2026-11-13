import { inArray } from 'drizzle-orm'
import { db, digimon, tamers, evolutionLines } from '../db'

type ScopedKind = 'tamer' | 'digimon' | 'map' | 'evolution-line'
function invalid(): never { throw createError({ statusCode: 400, message: 'Linked character records belong to conflicting campaigns', data: { code: 'INVALID_CHARACTER_SCOPE' } }) }
const chainIds = (line: any): string[] => {
  let chain = line.chain
  if (typeof chain === 'string') { try { chain = JSON.parse(chain) } catch { invalid() } }
  if (!Array.isArray(chain)) invalid()
  return chain.map((entry: any) => typeof entry?.digimonId === 'string' && entry.digimonId ? entry.digimonId : invalid())
}

/** One metadata snapshot per operation/list; traversal is iterative, including cyclic legacy graphs. */
export function createEntityScopeResolver(seedRows: any[] = [], seedKind: ScopedKind = 'digimon') {
  let snapshot: Promise<any> | undefined
  const prepare = async () => {
    const lineRows = await db.select({ id: evolutionLines.id, campaignId: evolutionLines.campaignId, partnerId: evolutionLines.partnerId, chain: evolutionLines.chain }).from(evolutionLines).where(undefined)
    const lines = new Map<string, any>(lineRows.map(line => [line.id, line]))
    if (seedKind === 'evolution-line') for (const line of seedRows) lines.set(line.id, line)
    const forms = new Map<string, any>(seedKind === 'digimon' ? seedRows.map(row => [row.id, row]) : [])
    const linkedLines = new Map<string, Set<string>>(), formsByLine = new Map<string, string[] | null>()
    for (const line of lines.values()) {
      let ids: string[]
      try { ids = chainIds(line); formsByLine.set(line.id, ids) }
      catch {
        formsByLine.set(line.id, null)
        // Keep recognizable edges protected even when another entry is broken.
        // Resolving this line or one of its forms must still fail closed.
        let chain = line.chain
        if (typeof chain === 'string') { try { chain = JSON.parse(chain) } catch { chain = [] } }
        ids = Array.isArray(chain) ? chain.flatMap(entry => typeof entry?.digimonId === 'string' && entry.digimonId ? [entry.digimonId] : []) : []
      }
      for (const id of ids) {
        if (!linkedLines.has(id)) linkedLines.set(id, new Set())
        linkedLines.get(id)!.add(line.id)
      }
    }
    const requiredForms = new Set<string>(), requiredLines = new Set<string>()
    const pending: Array<[boolean, string]> = seedRows.map(row => [seedKind === 'evolution-line', row.id])
    while (pending.length) {
      const [isLine, id] = pending.pop()!
      const visited = isLine ? requiredLines : requiredForms
      if (visited.has(id)) continue
      visited.add(id)
      if (isLine) {
        const ids = formsByLine.get(id)
        if (!ids) continue // Reject this line when resolved; do not poison unrelated list rows.
        for (const formId of ids) pending.push([false, formId])
      } else for (const lineId of linkedLines.get(id) ?? []) pending.push([true, lineId])
    }
    const missingForms = [...requiredForms].filter(id => !forms.has(id))
    if (missingForms.length) {
      const rows = await db.select({ id: digimon.id, campaignId: digimon.campaignId, partnerId: digimon.partnerId }).from(digimon).where(inArray(digimon.id, missingForms))
      for (const row of rows) forms.set(row.id, row)
    }
    const partnerIds = [...new Set([...forms.values(), ...[...requiredLines].map(id => lines.get(id))].flatMap(row => row?.partnerId ? [row.partnerId] : []))]
    const partners = new Map<string, any>()
    if (partnerIds.length) {
      const owners = await db.select({ id: tamers.id, campaignId: tamers.campaignId }).from(tamers).where(inArray(tamers.id, partnerIds))
      for (const owner of owners) partners.set(owner.id, owner)
    }
    return { lines, forms, partners, linkedLines, formsByLine }
  }
  return async (kind: ScopedKind, record: any): Promise<string | null> => {
    if (kind === 'tamer' || kind === 'map') return record.campaignId ?? null
    const graph = await (snapshot ??= prepare())
    const pending: Array<[boolean, string]> = [[kind === 'evolution-line', record.id]]
    const visitedForms = new Set<string>(), visitedLines = new Set<string>(), scopes = new Set<string | null>()
    while (pending.length) {
      const [isLine, id] = pending.pop()!
      const visited = isLine ? visitedLines : visitedForms
      if (visited.has(id)) continue
      visited.add(id)
      const row = isLine ? graph.lines.get(id) : graph.forms.get(id)
      if (!row) invalid()
      if (row.campaignId) scopes.add(row.campaignId)
      if (row.partnerId) {
        const partner = graph.partners.get(row.partnerId)
        if (!partner) invalid()
        scopes.add(partner.campaignId ?? null)
      }
      if (scopes.size > 1) invalid()
      if (isLine) {
        const ids = graph.formsByLine.get(id)
        if (!ids) invalid()
        for (const formId of ids) pending.push([false, formId])
      }
      else for (const lineId of graph.linkedLines.get(id) ?? []) pending.push([true, lineId])
    }
    return [...scopes][0] ?? null
  }
}
