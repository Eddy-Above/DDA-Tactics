import type { CombatParticipant } from '../types/combat'

export const AMMO_USES_PER_COMBAT = 5
type AmmoAttack = { id?: string; tags?: readonly string[] }
type AmmoParticipant = Pick<CombatParticipant, 'ammoUses' | 'usedAttackIds'>

export function isAmmoAttack(attack: AmmoAttack | null | undefined): boolean {
  return attack?.tags?.some(tag => tag.trim().toLowerCase() === 'ammo') ?? false
}

export function ammoAttackError(participant: Pick<AmmoParticipant, 'ammoUses'>, attack: AmmoAttack | null | undefined): string | null {
  return isAmmoAttack(attack) && attack?.id && (participant.ammoUses?.[attack.id] ?? 0) >= AMMO_USES_PER_COMBAT
    ? 'This attack is out of Ammo (5 uses per combat)' : null
}

/** Charge once at declaration, including misses and attacks with multiple targets. */
export function recordCombatAttackUse(participant: AmmoParticipant, attackId: string, attack: AmmoAttack | null | undefined) {
  return {
    usedAttackIds: [...(participant.usedAttackIds ?? []), attackId],
    ...(isAmmoAttack(attack) ? {
      ammoUses: { ...participant.ammoUses, [attackId]: (participant.ammoUses?.[attackId] ?? 0) + 1 },
    } : {}),
  }
}
