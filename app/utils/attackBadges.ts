import type { Attack } from '~/types'
import type { MapRadialItem } from '~/types/mapRadial'
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

/** Build the map radial menu entry for an attack: visible details plus the full tooltip text. */
export function attackRadialItem(attack: Attack, disabled: boolean): MapRadialItem {
  const tags = attack.tags ?? []
  const range = attack.range ? attack.range[0].toUpperCase() + attack.range.slice(1) : undefined
  const aoe = getAttackBadges(attack).aoe ?? undefined
  const effect = attack.effect || undefined
  return {
    id: attack.id,
    label: attack.name,
    description: [range, aoe, effect, ...tags].filter(Boolean).join(' · '),
    disabled,
    range,
    aoe,
    effect,
    // The area tag is already shown as the AoE type.
    tags: tags.filter(tag => !/^area attack/i.test(tag.trim())),
  }
}
