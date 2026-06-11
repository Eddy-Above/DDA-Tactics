import type { Attack } from '~/types'
import { getAreaShape } from '~/utils/areaShapes'

export interface AttackBadges {
  effect: string | null   // attack.effect (e.g. "Paralysis", "Poison 3")
  ap: string | null        // "AP III" — rank suffix from the Armor Piercing tag
  charge: boolean          // has 'Charge Attack' tag
  aoe: string | null       // display label for the AOE shape, e.g. "Burst", "Close Blast"
}

const AOE_LABELS: Record<string, string> = {
  'blast': 'Blast',
  'burst': 'Burst',
  'close-blast': 'Close Blast',
  'cone': 'Cone',
  'line': 'Line',
  'pass': 'Pass',
}

/** Derive the at-a-glance map-picker badges (effect / AP / charge / AOE) for an attack. */
export function getAttackBadges(attack: Attack): AttackBadges {
  const tags = attack.tags ?? []

  const apTag = tags.find((t) => /armor piercing/i.test(t))
  const apRank = apTag ? apTag.replace(/armor piercing/i, '').trim() : ''
  const ap = apTag ? (apRank ? `AP ${apRank}` : 'AP') : null

  const charge = tags.some((t) => t.trim().toLowerCase() === 'charge attack')

  const shape = getAreaShape(tags)
  const aoe = shape ? (AOE_LABELS[shape] ?? shape) : null

  return {
    effect: attack.effect || null,
    ap,
    charge,
    aoe,
  }
}
