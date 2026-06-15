/**
 * Selective Targeting quality: [Area] attacks won't damage allies or give them negative
 * effects, and enemies can't gain positive effects from the attacker's area attacks.
 * Only applies when the attack is an [Area] attack with more than one total target.
 */
export function getSelectiveTargetingFilter(
  attackerHasSelectiveTargeting: boolean,
  isAreaAttack: boolean,
  totalTargetCount: number,
  attackerIsEnemy: boolean,
  targetIsEnemy: boolean,
): 'ally' | 'enemy' | null {
  if (!attackerHasSelectiveTargeting || !isAreaAttack || totalTargetCount <= 1) return null
  return targetIsEnemy === attackerIsEnemy ? 'ally' : 'enemy'
}

export function selectiveTargetingBlocksDamage(filter: 'ally' | 'enemy' | null): boolean {
  return filter === 'ally'
}

export function selectiveTargetingBlocksEffect(
  filter: 'ally' | 'enemy' | null,
  alignment: 'P' | 'N' | 'NA' | undefined,
): boolean {
  if (filter === 'ally') return alignment === 'N'
  if (filter === 'enemy') return alignment === 'P'
  return false
}
