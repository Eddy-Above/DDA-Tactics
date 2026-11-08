/** Fields used to choose combat forms; each returned target retains the rest of its entry. */
export interface CombatEvolutionEntry {
  species: string
  isUnlocked: boolean
  evolvesFromIndex: number | null
  digimonId?: string
}

export type CombatEvolutionTarget<T extends CombatEvolutionEntry> = T & { chainIndex: number }
export type CombatWarpTarget<T extends CombatEvolutionEntry> = CombatEvolutionTarget<T> & { stagesSkipped: number; warpDC: number }

export interface CombatEvolutionOptionsInput<T extends CombatEvolutionEntry> {
  chain: readonly T[] | string
  /** The caller supplies the line's current stage, or the GM's per-NPC stage override. */
  currentIndex: number
  /** A partner's actual entity resolves stale line indices before choosing any form. */
  currentEntityId?: string
  hasWoundsHistory: boolean
  /** Partner Digimon may use the line's parent when they entered combat already evolved. */
  allowDevolutionWithoutHistory?: boolean
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

/** Resolve the participant's actual form, retaining a matching preferred node in branching lines. */
export function resolveCombatEvolutionIndex(
  chain: readonly { digimonId?: string }[],
  entityId: string,
  preferredIndex: number,
): number {
  if (Number.isInteger(preferredIndex) && preferredIndex >= 0 && preferredIndex < chain.length
    && chain[preferredIndex]?.digimonId === entityId) return preferredIndex
  return chain.findIndex(entry => entry?.digimonId === entityId)
}

/** Resolve an existing direct parent, including index zero and locked forms. */
export function getCombatEvolutionParent<T extends { evolvesFromIndex: number | null }>(
  chain: readonly T[],
  currentIndex: number,
): (T & { chainIndex: number }) | null {
  if (!Number.isInteger(currentIndex) || currentIndex < 0 || currentIndex >= chain.length) return null
  const parentIndex = chain[currentIndex]?.evolvesFromIndex
  if (parentIndex === null || parentIndex === undefined || !Number.isInteger(parentIndex)
    || parentIndex < 0 || parentIndex >= chain.length || parentIndex === currentIndex) return null
  const parent = chain[parentIndex]
  return parent ? { ...parent, chainIndex: parentIndex } : null
}

/**
 * Combat evolution choices shared by the GM and player pages. Evolving uses unlocked children;
 * devolution uses saved wound history or a partner's linked parent form. Warp Evolution offers unlocked grandchildren reached
 * through unlocked direct children, skipping one stage at the campaign's base DC plus five.
 */
export function buildCombatEvolutionOptions<T extends CombatEvolutionEntry>(
  input: CombatEvolutionOptionsInput<T>,
): CombatEvolutionChoices<T> {
  const chain: readonly T[] = typeof input.chain === 'string' ? JSON.parse(input.chain) as T[] : input.chain
  const currentIndex = input.currentEntityId !== undefined
    ? resolveCombatEvolutionIndex(chain, input.currentEntityId, input.currentIndex)
    : input.currentIndex
  if (input.currentEntityId !== undefined && currentIndex < 0) {
    return { canEvolve: false, canDevolve: false, evolveTargets: [], devolveTarget: null, warpTargets: [] }
  }
  const indexed = chain.map((entry, chainIndex) => ({ ...entry, chainIndex }))
  const evolveTargets = indexed.filter(entry => entry.evolvesFromIndex === currentIndex && entry.isUnlocked)
  const parent = getCombatEvolutionParent(chain, currentIndex)
  const hasLinkedParent = typeof parent?.digimonId === 'string' && parent.digimonId.trim().length > 0
  const canDevolve = parent !== null && (input.hasWoundsHistory
    || (input.allowDevolutionWithoutHistory === true && hasLinkedParent))
  const devolveTarget = canDevolve ? parent : null

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
