/**
 * Utility functions for parsing database responses with JSON fields
 */

function ensureArray(value: any): any[] {
  if (Array.isArray(value)) return value
  return []
}

function safeJSONParse(value: any, defaultValue: any = null) {
  if (value === null || value === undefined) return defaultValue
  if (typeof value === 'object') return value
  if (typeof value === 'string') {
    // Handle malformed data like "[object Object]"
    if (value === '[object Object]' || value.trim() === '') return defaultValue
    try {
      return JSON.parse(value)
    } catch {
      console.warn('Failed to parse JSON:', value)
      return defaultValue
    }
  }
  return defaultValue
}

export function parseTamerData(tamer: any) {
  if (!tamer) return tamer

  return {
    ...tamer,
    attributes: safeJSONParse(tamer.attributes, { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 }),
    skills: safeJSONParse(tamer.skills, {}),
    aspects: safeJSONParse(tamer.aspects, []),
    torments: safeJSONParse(tamer.torments, []),
    equipment: safeJSONParse(tamer.equipment, []),
    specialOrders: safeJSONParse(tamer.specialOrders, []),
    xpBonuses: safeJSONParse(tamer.xpBonuses, {}),
  }
}

export function parseDigimonData(digimon: any) {
  if (!digimon) return digimon

  return {
    ...digimon,
    baseStats: safeJSONParse(digimon.baseStats, { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }),
    attacks: safeJSONParse(digimon.attacks, []),
    qualities: safeJSONParse(digimon.qualities, []),
    bonusStats: safeJSONParse(digimon.bonusStats, { accuracy: 0, damage: 0, dodge: 0, armor: 0, health: 0 }),
    evolutionPathIds: ensureArray(safeJSONParse(digimon.evolutionPathIds, [])),
  }
}