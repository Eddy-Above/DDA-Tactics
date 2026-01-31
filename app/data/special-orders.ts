/**
 * Special Orders data and thresholds
 * Extracted from duplicated tamer form pages
 */

export const specialOrderThresholds = {
  standard: [3, 4, 5],
  enhanced: [5, 6, 7],
  extreme: [6, 8, 10],
} as const

export const specialOrdersData: Record<string, { name: string; type: string; effect: string }[]> = {
  agility: [
    { name: 'Strike First!', type: 'Passive', effect: '+1 Initiative and 2 Base Movement' },
    { name: 'Strike Fast!', type: 'Once Per Day / Complex', effect: 'Target\'s Dodge Pools halved for one attack (no Huge Power/Overkill)' },
    { name: 'Strike Last!', type: 'Once Per Day / Intercede', effect: 'Counter Blow on any attack, hit or miss (no Huge Power/Overkill)' },
  ],
  body: [
    { name: 'Energy Burst', type: 'Once Per Day / Complex', effect: 'Digimon recovers 5 wound boxes' },
    { name: 'Enduring Soul', type: 'Passive', effect: 'Survive one fatal blow with 1 Wound Box (once per battle)' },
    { name: 'Finishing Touch', type: 'Once Per Day / Simple', effect: '4s count as successes on Accuracy Roll (no Huge Power/Overkill)' },
  ],
  charisma: [
    { name: 'Swagger', type: 'Once Per Battle / Simple', effect: 'Taunt for 3 rounds, auto-aggro at CPUx2' },
    { name: 'Peak Performance', type: 'Once Per Day / Complex', effect: 'Bastion buff: +2 to all stats except health for 1 round' },
    { name: 'Guiding Light', type: 'Passive', effect: '+2 Accuracy to allies in burst radius, +1 Dodge per ally in radius' },
  ],
  intelligence: [
    { name: 'Quick Reaction', type: 'Once Per Day / Intercede', effect: 'Gain Stage Bonus+2 Dodge Dice for the round (diminishing)' },
    { name: 'Enemy Scan', type: 'Once Per Battle / Complex', effect: 'Debilitate: -2 to all stats except health for 1 round' },
    { name: 'Decimation', type: 'Once Per Day / Complex', effect: 'Use Signature Move on Round 2 instead of Round 3' },
  ],
  willpower: [
    { name: 'Tough it Out!', type: 'Once Per Battle / Complex', effect: 'Purify: cure one negative effect' },
    { name: 'Challenger', type: 'Passive', effect: 'Gain 2 + (enemy stage difference) temporary Wound Boxes (max 5)' },
    { name: 'Fateful Intervention', type: 'Free Action', effect: 'See Inspiration / Fateful Intervention mechanic' },
  ],
}
