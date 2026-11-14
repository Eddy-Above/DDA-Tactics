/** The participant fields needed by the map's display-name rules. */
export interface DisplayNameParticipant {
  id: string
  type: string
  entityId: string
  seq?: number
  isEnemy?: boolean
}

/** Older fall entries stored the participant ID in both fields. Preserve named history. */
export function battleLogActorName(entry: { action: string; actorId: string; actorName: string }, names: Record<string, string>): string {
  return entry.action === 'Fall' && entry.actorName === entry.actorId ? names[entry.actorId] ?? entry.actorName : entry.actorName
}

/**
 * Only enemy Digimon are numbered. Their duplicate groups use the resolved base name, including
 * across entity IDs, and keep assigned sequence numbers or fall back to sorted participant IDs.
 * Tamers and partner Digimon keep the base name and do not affect enemy duplicate counts.
 * Missing records are excluded entirely; an existing empty base name is retained.
 */
export function buildParticipantDisplayNames<T extends DisplayNameParticipant>(
  participants: readonly T[],
  resolveBaseName: (participant: T) => string | null | undefined,
  isEnemy: (participant: T) => boolean = participant => participant.isEnemy === true,
): Record<string, string> {
  const entries: Array<{ participant: T; name: string; enemy: boolean }> = []
  const groups = new Map<string, string[]>()
  for (const participant of participants) {
    const name = resolveBaseName(participant)
    if (name == null) continue
    const enemy = participant.type === 'digimon' && isEnemy(participant)
    entries.push({ participant, name, enemy })
    if (!enemy) continue
    const group = groups.get(name)
    if (group) group.push(participant.id)
    else groups.set(name, [participant.id])
  }
  for (const ids of groups.values()) ids.sort((a, b) => a.localeCompare(b))

  const names: Record<string, string> = {}
  for (const { participant, name, enemy } of entries) {
    if (!enemy) {
      names[participant.id] = name
      continue
    }
    const group = groups.get(name)!
    if (participant.seq !== undefined) {
      names[participant.id] = participant.seq > 1 || group.length > 1 ? `${name} ${participant.seq}` : name
    } else {
      names[participant.id] = group.length > 1 ? `${name} ${group.indexOf(participant.id) + 1}` : name
    }
  }
  return names
}
