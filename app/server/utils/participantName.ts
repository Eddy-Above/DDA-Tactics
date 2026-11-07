// Get display name with numbering for duplicate enemy participants
export function resolveParticipantName(
  participant: { id: string; type: string; entityId: string; seq?: number; isEnemy?: boolean },
  allParticipants: Array<{ id: string; type: string; entityId: string; seq?: number; isEnemy?: boolean }>,
  baseName: string | undefined,
  isEnemy: boolean
): string {
  const name = baseName || 'Digimon'

  if (participant.type === 'digimon' && (participant.isEnemy ?? isEnemy) === true) {
    // Legacy peers share the resolved entity's enemy status unless their own
    // persisted flag explicitly overrides it. Other participant types never count.
    const enemyPeers = allParticipants.filter(p =>
      p.type === 'digimon' && p.entityId === participant.entityId && (p.isEnemy ?? isEnemy) === true
    )
    if (participant.seq !== undefined) {
      // Stable: use the seq assigned at add-time
      const otherExists = enemyPeers.some(p => p.id !== participant.id)
      if (participant.seq > 1 || otherExists) return `${name} ${participant.seq}`
    } else {
      // Legacy fallback for participants without seq
      const duplicates = enemyPeers
      if (duplicates.length > 1) {
        const sorted = [...duplicates].sort((a, b) => a.id.localeCompare(b.id))
        const index = sorted.findIndex(p => p.id === participant.id)
        return `${name} ${index + 1}`
      }
    }
  }

  return name
}
