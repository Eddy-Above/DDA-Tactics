/** Lifesteal doubles the CPU cap as a Complex Action; healing can never exceed damage dealt. */
export function lifestealHealing(damage: number, cpu: number, complex = false): number {
  return Math.min(Math.max(0, damage), Math.max(0, cpu) * (complex ? 2 : 1))
}
