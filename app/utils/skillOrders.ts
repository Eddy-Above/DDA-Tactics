import { skillOrdersData, SKILL_ORDER_SKILL_THRESHOLD, SKILL_ATTRIBUTE_MAP } from '../data/skill-orders'
import { specialOrderThresholds } from '../data/special-orders'

/**
 * Number of simple actions a skill order costs to activate on a turn.
 * Only orders that explicitly declare a Simple or Complex action cost anything;
 * Passive, Intercede, and plain "Once Per Day" orders are resource/reaction-gated,
 * not on-turn-action-gated.
 */
export function getSkillOrderActionCost(orderType: string): number {
  if (orderType.includes('Complex')) return 2
  if (orderType.includes('Simple')) return 1
  return 0
}

export interface UnlockedSkillOrder {
  skill: string
  attribute: string
  name: string
  type: string
  effect: string
}

/**
 * Get unlocked skill orders for a tamer based on their skills, attributes, and campaign level.
 * Two prerequisites must both be met for each skill option:
 * 1. Skill total (base + XP bonus) >= SKILL_ORDER_SKILL_THRESHOLD[level]
 * 2. Governing attribute total (base + XP bonus) >= first special order threshold for that level
 */
export function getUnlockedSkillOrders(
  skills: { [key: string]: number },
  attributes: { [key: string]: number },
  xpBonuses: { skills?: { [key: string]: number }; attributes?: { [key: string]: number } } | null,
  campaignLevel: 'standard' | 'enhanced' | 'extreme'
): UnlockedSkillOrder[] {
  const skillThreshold = SKILL_ORDER_SKILL_THRESHOLD[campaignLevel]
  const attrThreshold = specialOrderThresholds[campaignLevel][0]
  const unlocked: UnlockedSkillOrder[] = []

  for (const [skill, orderData] of Object.entries(skillOrdersData)) {
    const baseSkill = skills[skill] || 0
    const bonusSkill = xpBonuses?.skills?.[skill] || 0
    const totalSkill = baseSkill + bonusSkill

    const attribute = SKILL_ATTRIBUTE_MAP[skill as keyof typeof SKILL_ATTRIBUTE_MAP]
    const baseAttr = attributes[attribute] || 0
    const bonusAttr = xpBonuses?.attributes?.[attribute] || 0
    const totalAttr = baseAttr + bonusAttr

    if (totalSkill >= skillThreshold && totalAttr >= attrThreshold) {
      unlocked.push({
        skill,
        attribute,
        name: orderData.name,
        type: orderData.type,
        effect: orderData.effect,
      })
    }
  }

  return unlocked
}
