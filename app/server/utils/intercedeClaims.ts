import { AsyncLocalStorage } from 'node:async_hooks'

const pendingClaims = new Map<string, Promise<void>>()
const activeClaims = new AsyncLocalStorage<ReadonlySet<string>>()

/** Keep intercede decisions and their room updates in encounter order. */
export async function serializeIntercedeClaim<T>(encounterId: string, claim: () => Promise<T>): Promise<T> {
  if (activeClaims.getStore()?.has(encounterId)) return claim()
  const previous = pendingClaims.get(encounterId) ?? Promise.resolve()
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  pendingClaims.set(encounterId, pending)

  await previous
  try {
    return await activeClaims.run(new Set([...(activeClaims.getStore() ?? []), encounterId]), claim)
  } finally {
    release()
    if (pendingClaims.get(encounterId) === pending) pendingClaims.delete(encounterId)
  }
}
