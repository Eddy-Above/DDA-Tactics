import { specialOrderThresholds, specialOrdersData } from '../data/special-orders'

export interface UnlockedSpecialOrder {
  attribute: string
  name: string
  type: string
  effect: string
  tier: number
}

/**
 * Get unlocked special orders for a tamer based on their attributes and campaign level.
 * Works with raw Tamer data (including XP bonuses).
 */
export function getUnlockedSpecialOrders(
  attributes: { agility: number; body: number; charisma: number; intelligence: number; willpower: number },
  xpBonuses: { attributes: { agility: number; body: number; charisma: number; intelligence: number; willpower: number } } | null,
  campaignLevel: 'standard' | 'enhanced' | 'extreme'
): UnlockedSpecialOrder[] {
  const thresholds = specialOrderThresholds[campaignLevel]
  const unlocked: UnlockedSpecialOrder[] = []

  for (const [attr, orders] of Object.entries(specialOrdersData)) {
    const baseVal = attributes[attr as keyof typeof attributes] || 0
    const bonusVal = xpBonuses?.attributes?.[attr as keyof typeof attributes] || 0
    const totalVal = baseVal + bonusVal

    orders.forEach((order, index) => {
      if (totalVal >= thresholds[index]) {
        unlocked.push({
          attribute: attr,
          name: order.name,
          type: order.type,
          effect: order.effect,
          tier: index + 1,
        })
      }
    })
  }

  return unlocked
}

/**
 * Check whether a digimon's owning tamer (by partnerId) has unlocked
 * "Strike First!" (+1 Initiative and +2 Base Movement).
 */
export function hasPartnerStrikeFirst(
  partnerId: string | null | undefined,
  tamers: Array<{ id: string; attributes: any; xpBonuses: any }>,
  campaignLevel: 'standard' | 'enhanced' | 'extreme'
): boolean {
  if (!partnerId) return false
  const tamer = tamers.find(t => t.id === partnerId)
  if (!tamer) return false
  const attrs = typeof tamer.attributes === 'string' ? JSON.parse(tamer.attributes) : tamer.attributes
  const xpB = typeof tamer.xpBonuses === 'string' ? JSON.parse(tamer.xpBonuses) : tamer.xpBonuses
  return getUnlockedSpecialOrders(attrs, xpB, campaignLevel).some(o => o.name === 'Strike First!')
}

/**
 * Parse action cost from a special order's type string.
 * Returns number of simple actions required.
 */
export function getOrderActionCost(orderType: string): number {
  if (orderType.includes('Complex')) return 2
  if (orderType.includes('Simple')) return 1
  if (orderType.includes('Free')) return 0
  if (orderType.includes('Passive')) return 0
  if (orderType.includes('Intercede')) return 0 // Intercede has special handling
  return 1 // Default to simple
}

/**
 * Check if an order is "once per day" or "once per battle"
 */
export function getOrderUsageLimit(orderType: string): 'per-day' | 'per-battle' | 'passive' {
  if (orderType.includes('Once Per Day')) return 'per-day'
  if (orderType.includes('Once Per Battle')) return 'per-battle'
  return 'passive'
}
