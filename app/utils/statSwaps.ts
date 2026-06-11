export type SwappableStat = 'accuracy' | 'damage' | 'dodge' | 'armor'
export type StatBlock = Record<SwappableStat, number>
export type StatSwaps = Partial<Record<SwappableStat, SwappableStat>>

export function applyStatSwaps(stats: StatBlock, swaps: StatSwaps | undefined): StatBlock {
  if (!swaps || Object.keys(swaps).length === 0) return stats
  const result = { ...stats }
  for (const [slot, source] of Object.entries(swaps) as [SwappableStat, SwappableStat][]) {
    result[slot] = stats[source]
  }
  return result
}
