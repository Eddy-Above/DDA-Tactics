import type { TamerAttributes, TamerSkills } from '../types'

interface ExperienceRecord {
  totalXp?: number | null
  xp?: number | null
  inspiration?: number | null
  attributes?: Partial<TamerAttributes> | null
  skills?: Partial<TamerSkills> | null
  xpBonuses?: {
    attributes?: Partial<TamerAttributes> | null
    skills?: Partial<TamerSkills> | null
    inspiration?: number
  } | null
  torments?: readonly {
    markedBoxes: number
    cpMarkedBoxes?: number
    gmMarkedBoxes?: number
    xpBoxCosts?: readonly number[]
  }[] | null
}

const nonnegative = (value?: number | null) => Number.isFinite(value) ? Math.max(0, value!) : 0

/** Available XP plus the cost of saved XP purchases; starting CP and GM grants are free. */
export function tamerExperience(record?: ExperienceRecord | null) {
  const available = nonnegative(record?.xp)
  if (!record) return { available, spent: 0, total: available }
  let spent = 0
  for (const [key, bonus] of Object.entries(record.xpBonuses?.attributes ?? {})) {
    const ranks = nonnegative(bonus)
    const base = nonnegative(record.attributes?.[key as keyof TamerAttributes])
    spent += ranks * (2 * base + ranks + 1)
  }
  for (const [key, bonus] of Object.entries(record.xpBonuses?.skills ?? {})) {
    const ranks = nonnegative(bonus)
    const base = nonnegative(record.skills?.[key as keyof TamerSkills])
    spent += ranks * (2 * base + ranks + 1) / 2
  }
  const inspirationRanks = nonnegative(record.xpBonuses?.inspiration)
  const baseInspiration = nonnegative(record.inspiration ?? 1)
  spent += inspirationRanks * (2 * baseInspiration + inspirationRanks - 1)
  for (const torment of record.torments ?? []) {
    if (Array.isArray(torment.xpBoxCosts)) {
      spent += torment.xpBoxCosts.reduce((sum, cost) => sum + nonnegative(cost), 0)
    } else {
      // Match the editor's fallback for older records without purchase receipts.
      const floor = Math.max(nonnegative(torment.cpMarkedBoxes), nonnegative(torment.gmMarkedBoxes))
      const ranks = Math.max(0, nonnegative(torment.markedBoxes) - floor)
      spent += ranks * (2 * floor + ranks + 1) / 2
    }
  }
  return { available, spent, total: available + spent }
}

export function validTotalXp(value: unknown): value is number | null {
  return value === null || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
}

/** Total XP owns the budget. Saved spending includes purchases that have since been consumed. */
export function reconcileTamerExperience(existing: ExperienceRecord, patch: ExperienceRecord): { xp: number; totalXp: number | null } {
  const before = tamerExperience(existing)
  const after = tamerExperience({ ...existing, ...patch })
  const totalXp = patch.totalXp === undefined ? (existing.totalXp ?? null) : patch.totalXp
  if (!validTotalXp(totalXp)) throw new Error('Total XP must be a nonnegative whole number or null')
  if (existing.totalXp != null && totalXp === null) throw new Error('A recorded Total XP budget cannot be cleared')
  const consumed = existing.totalXp == null ? 0 : Math.max(0, existing.totalXp - before.total)
  const xp = (totalXp ?? before.total) - consumed - after.spent
  if (!Number.isInteger(xp) || xp < 0) throw new Error(`Total XP cannot be less than the ${consumed + after.spent} XP already spent`)
  if (patch.xp !== undefined && patch.xp !== xp) {
    throw new Error('Available XP is calculated from Total XP and spending; adjust Total XP instead')
  }
  return { xp, totalXp }
}
