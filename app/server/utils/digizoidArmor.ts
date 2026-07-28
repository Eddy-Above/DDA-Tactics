// Digizoid Armor (Section 3.12a) — shared server-side logic.
// Mirrors the per-choice bonuses already applied client-side in useDigimon.ts / useDigimonStats.ts.

export interface DigizoidArmorBonus {
  armor: number
  health: number
  dodge: number
  movement: number
}

const ZERO_BONUS: DigizoidArmorBonus = { armor: 0, health: 0, dodge: 0, movement: 0 }

export function getDigizoidArmorBonus(qualities: any[] | undefined | null): DigizoidArmorBonus {
  const digizoidArmor = (qualities || []).find((q: any) => q.id === 'digizoid-armor')
  if (!digizoidArmor) return ZERO_BONUS

  const cid = digizoidArmor.choiceId
  const bonus: DigizoidArmorBonus = { armor: cid === 'red' ? 4 : 2, health: 0, dodge: 0, movement: 0 }
  if (cid === 'chrome' || cid === 'gold' || cid === 'obsidian') bonus.health = 1
  if (cid === 'red') bonus.health = 2
  if (cid === 'blue') { bonus.dodge = 2; bonus.movement = 4 }
  return bonus
}

/** Black Digizoid Armor: rolled fresh each round. 1-2: +4 Armor; 3-4: +4 Dodge; 5-6: +2 Armor and +2 Dodge. */
export function rollBlackArmorBonus(): { armor: number; dodge: number } {
  const roll = Math.floor(Math.random() * 6) + 1
  if (roll <= 2) return { armor: 4, dodge: 0 }
  if (roll <= 4) return { armor: 0, dodge: 4 }
  return { armor: 2, dodge: 2 }
}

/** Gold reflects Ranged hits, Obsidian reflects Melee hits. Returns null for non-reflective choices. */
export function getReflectArmorRange(choiceId: string | undefined): 'ranged' | 'melee' | null {
  if (choiceId === 'gold') return 'ranged'
  if (choiceId === 'obsidian') return 'melee'
  return null
}
