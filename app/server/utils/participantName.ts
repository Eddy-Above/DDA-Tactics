// Get display name with numbering for duplicate enemy participants
export function resolveParticipantName(
  participant: { id: string; type: string; entityId: string; seq?: number },
  allParticipants: Array<{ id: string; type: string; entityId: string; seq?: number }>,
  baseName: string | undefined,
  isEnemy: boolean
): string {
  const name = baseName || 'Digimon'

  if (participant.type === 'digimon') {
    if (participant.seq !== undefined) {
      // Stable: use the seq assigned at add-time
      const otherExists = allParticipants.some(p => p.id !== participant.id && p.entityId === participant.entityId)
      if (participant.seq > 1 || otherExists) return `${name} ${participant.seq}`
    } else {
      // Legacy fallback for participants without seq
      const duplicates = allParticipants.filter(p => p.entityId === participant.entityId)
      if (duplicates.length > 1) {
        const sorted = [...duplicates].sort((a, b) => a.id.localeCompare(b.id))
        const index = sorted.findIndex(p => p.id === participant.id)
        return `${name} ${index + 1}`
      }
    }
  }

  return name
}
