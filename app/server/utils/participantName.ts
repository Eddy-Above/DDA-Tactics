// Get display name with numbering for duplicate enemy participants
export function resolveParticipantName(
  participant: { id: string; type: string; entityId: string },
  allParticipants: Array<{ id: string; type: string; entityId: string }>,
  baseName: string | undefined,
  isEnemy: boolean
): string {
  const name = baseName || 'Digimon'

  // Only number enemy digimon when duplicates exist
  if (participant.type === 'digimon' && isEnemy) {
    const duplicates = allParticipants.filter(p => p.entityId === participant.entityId)
    if (duplicates.length > 1) {
      const sorted = [...duplicates].sort((a, b) => a.id.localeCompare(b.id))
      const index = sorted.findIndex(p => p.id === participant.id)
      return `${name} ${index + 1}`
    }
  }

  return name
}
