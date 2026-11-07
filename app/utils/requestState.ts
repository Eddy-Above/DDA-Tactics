// Whether a pending request has already been answered. Shared by the server (to make a repeat
// submission a no-op) and the player page (to stop showing an answered prompt), so both read the
// same rule. Free of server/client-only imports.

interface RequestLike {
  id: string
  /** Stamped by responses.post on the first answer; survives deleting the response. */
  answeredAt?: string | null
}

interface ResponseLike {
  requestId: string
  tamerId?: string
}

/**
 * True once the request has an answer: its `answeredAt` stamp is set, or a stored response
 * (optionally from `tamerId`) exists. The stamp matters because responses are deleted when a
 * result is dismissed, which must never turn an answered request back into an open prompt.
 */
export function isRequestAnswered(
  request: RequestLike,
  responses: readonly ResponseLike[] | null | undefined,
  tamerId?: string,
): boolean {
  if (request.answeredAt) return true
  return (responses ?? []).some((r) => r.requestId === request.id && (!tamerId || r.tamerId === tamerId))
}
