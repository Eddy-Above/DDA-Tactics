import type { MapRadialItem } from '../types/mapRadial'

/** Costs displayed by the map wheel; attack leaves supply their exact rider totals. */
export function withRadialActionCosts(items: MapRadialItem[], participant?: any, record?: any, rules?: any): MapRadialItem[] {
  const freeClash = record?.qualities?.some((q: any) => q.choiceId === 'wrestlemania') && !participant?.usedFreeClashThisRound
  const freeSwap = rules?.modeChangeFreeSwapsPerCombat && (record?.qualities?.find((q: any) => q.id === 'mode-change-x0')?.ranks ?? 0) >= 2
    && (participant?.modeChangeFreeSwapsUsed ?? 0) < 3
  const costs: Record<string, string> = {
    move: '1 Simple', attack: 'Varies', stance: '1 Simple', direct: '1–2 Simple',
    'special-order': 'Varies', digivolve: '1 Simple', 'mode-change': freeSwap ? 'Free' : '1 Simple',
    clash: freeClash ? 'Free' : '1 Simple', 'clash-attack': '2 Simple', 'clash-pin': '2 Simple',
    'clash-throw': '2 Simple', 'clash-move': '1 Simple', 'clash-check': 'Free', 'clash-end': 'Free',
    'gm-move': 'Free', 'gm-manage': 'Free', doors: 'Free',
  }
  function decorate(item: MapRadialItem, inherited?: string): MapRadialItem {
    const cost = item.cost ?? (item.id === 'direct:direct' ? '1 Simple' : item.id === 'direct:bolster' ? '2 Simple' : costs[item.id] ?? inherited)
    return { ...item, ...(cost ? { cost } : {}), ...(item.children ? { children: item.children.map(child => decorate(child, cost === 'Varies' ? undefined : cost)) } : {}) }
  }
  return items.map(item => decorate(item))
}
