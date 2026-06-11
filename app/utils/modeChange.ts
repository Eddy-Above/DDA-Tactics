import type { CombatParticipant } from '~/composables/useEncounters'
import type { EddySoulRules } from '~/types'
import type { SwappableStat, StatSwaps } from '~/utils/statSwaps'

export function getModeChangeQualities(participant: CombatParticipant, digimonMap: Map<string, any>) {
  const digi = digimonMap.get(participant.entityId)
  const qualities: any[] = digi?.qualities ?? []
  const mc = qualities.find((q: any) => q.id === 'mode-change')
  const x0 = qualities.find((q: any) => q.id === 'mode-change-x0')
  return { mc, mcRank: mc?.ranks ?? 0, x0, x0Rank: x0?.ranks ?? 0 }
}

export function getModeChangePairs(participant: CombatParticipant, digimonMap: Map<string, any>): Array<{ a: SwappableStat; b: SwappableStat; label: string }> {
  const { mcRank, x0Rank } = getModeChangeQualities(participant, digimonMap)
  if (mcRank === 0) return []
  if (x0Rank >= 1) {
    return [
      { a: 'damage', b: 'armor', label: 'D↔A' },
      { a: 'accuracy', b: 'dodge', label: 'Acc↔Dod' },
      { a: 'damage', b: 'dodge', label: 'D↔Dod' },
      { a: 'accuracy', b: 'armor', label: 'Acc↔A' },
      { a: 'damage', b: 'accuracy', label: 'D↔Acc' },
      { a: 'dodge', b: 'armor', label: 'Dod↔A' },
    ]
  }
  const pairs: Array<{ a: SwappableStat; b: SwappableStat; label: string }> = [
    { a: 'damage', b: 'armor', label: 'D↔A' },
  ]
  if (mcRank >= 2) pairs.push({ a: 'accuracy', b: 'dodge', label: 'Acc↔Dod' })
  return pairs
}

export function isSwapActive(participant: CombatParticipant, pair: { a: SwappableStat; b: SwappableStat }): boolean {
  const swaps = participant.statSwaps as StatSwaps | undefined
  return swaps?.[pair.a] === pair.b && swaps?.[pair.b] === pair.a
}

export function getModeChangeLabel(swaps: StatSwaps | undefined): string {
  if (!swaps || Object.keys(swaps).length === 0) return ''
  const seen = new Set<string>()
  const parts: string[] = []
  const labels: Record<string, string> = { accuracy: 'Acc', damage: 'D', dodge: 'Dod', armor: 'A' }
  for (const [k, v] of Object.entries(swaps) as [SwappableStat, SwappableStat][]) {
    if (!seen.has(k) && !seen.has(v)) {
      parts.push(`${labels[k] ?? k}↔${labels[v] ?? v}`)
      seen.add(k); seen.add(v)
    }
  }
  return parts.join(', ')
}

export function canUseModeChangeSwap(participant: CombatParticipant, digimonMap: Map<string, any>, eddySoulRules: EddySoulRules | undefined): boolean {
  if ((participant.actionsRemaining?.simple || 0) >= 1) return true
  const { x0Rank } = getModeChangeQualities(participant, digimonMap)
  if (eddySoulRules?.modeChangeFreeSwapsPerCombat && x0Rank >= 2) {
    return ((participant as any).modeChangeFreeSwapsUsed ?? 0) < 3
  }
  return false
}
