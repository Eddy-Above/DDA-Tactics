// Clash rules shared by client and server (pure — no imports).

/**
 * True when `target` is in a clash and `attacker` is not part of that same clash.
 * Such a target cannot dodge, and adds both clashers' CPU to its Armor. An attack from the
 * target's own clash opponent is a Clash Attack (half dodge) and returns false.
 */
export function isAttackedFromOutsideClash(attacker: any, target: any): boolean {
  return !!target?.clash?.clashId && attacker?.clash?.clashId !== target.clash.clashId
}
