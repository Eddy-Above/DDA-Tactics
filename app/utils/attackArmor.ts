type ArmorAttack = { effect?: string | null; tags?: readonly string[] } | null | undefined

export function isTankBusterAttack(attack: ArmorAttack): boolean {
  return attack?.effect === 'Tank Buster' || !!attack?.tags?.includes('Tank Buster')
}

export function tankBusterStunEffect(attack: ArmorAttack, damage: number, source: string) {
  return isTankBusterAttack(attack) && damage >= 4 ? {
    name: 'Stun', type: 'debuff' as const, duration: 1, source, potency: 1,
    description: 'Tank Buster: stunned by overwhelming strike.',
  } : null
}

/** Tank Buster and Counterblow halve Armor once, before flat Armor Piercing. */
export function effectiveAttackArmor(armor: number, armorPiercing: number, attack: ArmorAttack, counterBlow = false): number {
  const reduced = isTankBusterAttack(attack) || counterBlow ? Math.floor(armor / 2) : armor
  return Math.max(0, reduced - armorPiercing)
}
