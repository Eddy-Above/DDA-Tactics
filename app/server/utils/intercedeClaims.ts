const pendingClaims = new Map<string, Promise<void>>()

/** Keep intercede decisions and their room updates in encounter order. */
export async function serializeIntercedeClaim<T>(encounterId: string, claim: () => Promise<T>): Promise<T> {
  const previous = pendingClaims.get(encounterId) ?? Promise.resolve()
  let release!: () => void
  const pending = new Promise<void>((resolve) => { release = resolve })
  pendingClaims.set(encounterId, pending)

  await previous
  try {
    return await claim()
  } finally {
    release()
    if (pendingClaims.get(encounterId) === pending) pendingClaims.delete(encounterId)
  }
}
