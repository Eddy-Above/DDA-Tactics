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

/**
 * Whether a target is FULLY shielded by Selective Targeting and should be dropped
 * from the attack's target set entirely (no dodge prompt, no intercede offer, not shown
 * in the attacker's results). Distinct from the partial blocking helpers above.
 */
export function selectiveTargetingExcludesTarget(
  filter: 'ally' | 'enemy' | null,
  attackType: string | undefined,
  effectAlignment: 'P' | 'N' | 'NA' | undefined,
): boolean {
  if (!filter) return false
  // Support attacks deal no damage: a target is fully shielded iff its effect is blocked.
  if (attackType === 'support') return selectiveTargetingBlocksEffect(filter, effectAlignment)
  // Damage attacks: ally takes 0 damage, and the damage-gated effect can't meet its threshold.
  return selectiveTargetingBlocksDamage(filter)
}
