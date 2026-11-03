// Evolution-form tracking shared by the GM and player encounter pages (pure — no imports).

/**
 * Which form each evolving participant is currently in. When this changes between two
 * encounter snapshots, a digivolve/devolve happened (on any client — e.g. the GM's Manage
 * modal), so a cached evolution line's currentStageIndex — which drives the Digivolve/Devolve
 * options — is stale and the lines must be refetched.
 */
export function evolutionFormsKey(encounter: any): string {
  const participants: any[] = encounter?.participants ?? []
  return participants
    .filter((p) => p.evolutionLineId)
    .map((p) => `${p.id}:${p.entityId}`)
    .join('|')
}
