import { AsyncLocalStorage } from 'node:async_hooks'

interface ReceiptScope {
  encounterId: string
  actorId: string | undefined
  receipt: { operationId: string; fingerprint: string }
  saved: boolean
}
const scopes = new AsyncLocalStorage<ReceiptScope>()

export async function withEncounterCommandReceipt<T>(encounterId: string, actorId: string | undefined,
  operationId: string | undefined, fingerprint: string, work: () => Promise<T>) {
  if (!operationId) return { value: await work(), saved: false }
  const scope: ReceiptScope = { encounterId, actorId, receipt: { operationId, fingerprint }, saved: false }
  const value = await scopes.run(scope, work)
  // Only a result containing the saved receipt can omit the boundary's fallback persistence.
  const result = value as any
  const saved = scope.saved && result?.id === encounterId && result.participants?.some((p: any) =>
    p.id === actorId && p.attackReceipts?.some((r: any) => r.operationId === operationId && r.fingerprint === fingerprint))
  return { value, saved: !!saved }
}

/** Append the retry receipt to the action's own participant write, in the same transaction. */
export function includeEncounterCommandReceipt<T extends { id: string; attackReceipts?: any[] }>(encounterId: string, participants: T[]): T[] {
  const scope = scopes.getStore()
  if (!scope || scope.encounterId !== encounterId || !participants.some(p => p.id === scope.actorId)) return participants
  return participants.map(p => p.id !== scope.actorId ? p : { ...p,
    attackReceipts: [...(p.attackReceipts ?? []).filter(r => r.operationId !== scope.receipt.operationId), scope.receipt].slice(-50),
  })
}

/** Call only after the database write succeeds. A rolled-back transaction publishes nothing. */
export function markEncounterCommandReceiptSaved(encounterId: string): void {
  const scope = scopes.getStore()
  if (scope?.encounterId === encounterId) scope.saved = true
}
