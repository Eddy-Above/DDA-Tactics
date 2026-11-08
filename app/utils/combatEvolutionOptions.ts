/** Fields used to choose combat forms; each returned target retains the rest of its entry. */
export interface CombatEvolutionEntry {
  species: string
  isUnlocked: boolean
  evolvesFromIndex: number | null
}

export type CombatEvolutionTarget<T extends CombatEvolutionEntry> = T & { chainIndex: number }
export type CombatWarpTarget<T extends CombatEvolutionEntry> = CombatEvolutionTarget<T> & { stagesSkipped: number; warpDC: number }

export interface CombatEvolutionOptionsInput<T extends CombatEvolutionEntry> {
  chain: readonly T[] | string
  /** The caller supplies the line's current stage, or the GM's per-NPC stage override. */
  currentIndex: number
  hasWoundsHistory: boolean
  warpEvolution?: boolean
  baseDC: number
}

export interface CombatEvolutionChoices<T extends CombatEvolutionEntry> {
  canEvolve: boolean
  canDevolve: boolean
  evolveTargets: CombatEvolutionTarget<T>[]
  devolveTarget: CombatEvolutionTarget<T> | null
  warpTargets: CombatWarpTarget<T>[]
}

/**
 * Combat evolution choices shared by the GM and player pages. Evolving uses unlocked children;
 * devolution needs saved wound history. Warp Evolution offers unlocked grandchildren reached
 * through unlocked direct children, skipping one stage at the campaign's base DC plus five.
 */
export function buildCombatEvolutionOptions<T extends CombatEvolutionEntry>(
  input: CombatEvolutionOptionsInput<T>,
): CombatEvolutionChoices<T> {
  const chain: readonly T[] = typeof input.chain === 'string' ? JSON.parse(input.chain) as T[] : input.chain
  const indexed = chain.map((entry, chainIndex) => ({ ...entry, chainIndex }))
  const evolveTargets = indexed.filter(entry => entry.evolvesFromIndex === input.currentIndex && entry.isUnlocked)
  const currentEntry = chain[input.currentIndex]
  const canDevolve = input.hasWoundsHistory && currentEntry?.evolvesFromIndex !== null
  const devolveTarget = canDevolve
    ? { ...chain[currentEntry.evolvesFromIndex!], chainIndex: currentEntry.evolvesFromIndex! }
    : null

  const warpTargets: CombatWarpTarget<T>[] = []
  if (input.warpEvolution) {
    for (const child of evolveTargets) {
      for (const grandchild of indexed.filter(entry => entry.evolvesFromIndex === child.chainIndex && entry.isUnlocked)) {
        warpTargets.push({ ...grandchild, stagesSkipped: 1, warpDC: input.baseDC + 5 })
      }
    }
  }

  return { canEvolve: evolveTargets.length > 0, canDevolve, evolveTargets, devolveTarget, warpTargets }
}
