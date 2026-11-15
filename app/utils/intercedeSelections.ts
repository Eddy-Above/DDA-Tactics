export const INTERCEDE_SELECTION_PRESETS = [
  { id: 'tamers', label: 'Select tamers' },
  { id: 'partners', label: 'Select partners' },
  { id: 'mine', label: 'Select my characters' },
  { id: 'allies', label: 'Select my allies' },
] as const

export type IntercedeSelectionPreset = typeof INTERCEDE_SELECTION_PRESETS[number]['id']

interface SelectionParticipant {
  id: string
  entityId: string
  type: string
  isEnemy?: boolean
  inReserve?: boolean
}

interface SelectionDigimon {
  partnerId?: string | null
  isEnemy?: boolean
}

/** Select an exact group from the dialog's available combat targets. */
export function selectIntercedeTargets(
  participants: SelectionParticipant[],
  digimon: ReadonlyMap<string, SelectionDigimon>,
  ownerId: string,
  preset: IntercedeSelectionPreset,
): Set<string> {
  return new Set(participants.filter(p => {
    if (p.type === 'gm' || p.inReserve) return false
    const record = p.type === 'digimon' ? digimon.get(p.entityId) : undefined
    const enemy = p.isEnemy ?? record?.isEnemy ?? false
    const partner = p.type === 'digimon' && !!record?.partnerId && !enemy
    const npc = p.type === 'digimon' && !partner
    switch (preset) {
      case 'tamers': return p.type === 'tamer'
      case 'partners': return partner
      case 'mine': return ownerId === 'GM' ? npc
        : !enemy && (p.type === 'tamer' ? p.entityId === ownerId : partner && record?.partnerId === ownerId)
      case 'allies': return ownerId === 'GM' ? npc : !enemy
    }
  }).map(p => p.id))
}
