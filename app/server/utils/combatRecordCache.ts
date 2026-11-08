import { AsyncLocalStorage } from 'node:async_hooks'

type RecordKind = 'digimon' | 'tamer'
interface CombatRecordScope {
  digimon: Map<string, Promise<any>>
  tamer: Map<string, Promise<any>>
  derived: Map<string, Promise<any>>
}

// Only immutable entity records/raw derived stats are shared. Participants, wounds,
// effects, forms and turn order always come from each sequential resolution step.
const scopes = new AsyncLocalStorage<CombatRecordScope>()

export function withCombatRecords<T>(work: () => Promise<T>): Promise<T> {
  if (scopes.getStore()) return work()
  return scopes.run({ digimon: new Map(), tamer: new Map(), derived: new Map() }, work)
}

function remember<T>(cache: Map<string, Promise<T>>, id: string, load: () => PromiseLike<T>): Promise<T> {
  const existing = cache.get(id)
  if (existing) return existing
  const pending = Promise.resolve().then(load)
  cache.set(id, pending)
  pending.catch(() => { if (cache.get(id) === pending) cache.delete(id) })
  return pending
}

export function readCombatRecord<T>(kind: RecordKind, id: string, query: () => PromiseLike<T[]>): Promise<T | undefined> {
  const load = async () => (await query())[0]
  const scope = scopes.getStore()
  return scope ? remember(scope[kind], id, load) : load()
}

/** Bulk and single reads share per-ID promises, including absent records, within one action. */
export async function readCombatRecords<T extends { id: string }>(
  kind: RecordKind,
  ids: readonly string[],
  queryMissing: (ids: string[]) => PromiseLike<T[]>,
): Promise<Map<string, T>> {
  const uniqueIds = [...new Set(ids)]
  if (uniqueIds.length === 0) return new Map()

  const cache = scopes.getStore()?.[kind]
  const missingIds = uniqueIds.filter(id => !cache?.has(id))
  // Defer the query until all missing IDs have pending entries. An overlapping bulk/single
  // read can then join the same work before any database request has completed.
  const batch = missingIds.length > 0
    ? Promise.resolve().then(() => queryMissing(missingIds))
      .then(rows => new Map(rows.map(row => [row.id, row])))
    : undefined
  const records = await Promise.all(uniqueIds.map(id => {
    const load = () => batch!.then(rows => rows.get(id))
    return cache ? remember<T | undefined>(cache, id, load) : load()
  }))
  const result = new Map<string, T>()
  records.forEach((record, index) => {
    if (record !== undefined) result.set(uniqueIds[index]!, record)
  })
  return result
}

export function readCombatDerivedStats<T>(id: string, compute: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore()
  return scope ? remember(scope.derived, id, compute) : compute()
}

/** Reuse the cast's existing bulk reads without issuing another query per target. */
export function primeCombatRecords(kind: RecordKind, records: { id: string }[]): void {
  const cache = scopes.getStore()?.[kind]
  if (!cache) return
  for (const record of records) if (!cache.has(record.id)) cache.set(record.id, Promise.resolve(record))
}

/** Call immediately after an entity write; late pre-write reads cannot refill it. */
export function invalidateCombatRecord(kind: RecordKind, id: string): void {
  const scope = scopes.getStore()
  scope?.[kind].delete(id)
  if (kind === 'digimon') scope?.derived.delete(id)
}
