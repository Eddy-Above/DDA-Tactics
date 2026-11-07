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
    { name: 'Strike Fast!', type: 'Once Per Day / Complex', effect: 'After your Digimon moves this turn, halve the target Digimon\'s Dodge for one attack. No Huge Power or Overkill.' },
    { name: 'Strike Last!', type: 'Once Per Day / Intercede', effect: 'When attacked, declare Counter Blow whether the attack hits or misses; roll Accuracy. No Huge Power or Overkill. Tamer owes 1 action next round.' },
  ],
  body: [
    { name: 'Energy Burst', type: 'Once Per Day / Complex', effect: 'Digimon recovers 5 wound boxes' },
    { name: 'Enduring Soul', type: 'Passive', effect: 'Survive one fatal blow with 1 Wound Box (once per battle)' },
    { name: 'Finishing Touch', type: 'Once Per Day / Simple', effect: 'Declare before your Digimon attacks: 4s count as Accuracy successes. No Huge Power or Overkill.' },
  ],
  charisma: [
    { name: 'Swagger', type: 'Once Per Battle / Simple', effect: 'Taunt one enemy for 3 rounds; your Digimon receives aggro at CPUx2. Cannot be Bolstered.' },
    { name: 'Peak Performance', type: 'Once Per Day / Complex', effect: 'Bastion buff: +2 to all stats except health for 1 round' },
    { name: 'Guiding Light', type: 'Passive', effect: '+2 Accuracy to allied Digimon in burst radius; your Digimon gains +1 Dodge per allied Digimon in radius. Minions do not count.' },
  ],
  intelligence: [
    { name: 'Quick Reaction', type: 'Once Per Day / Intercede', effect: 'When an enemy Digimon attacks your partner, gain Stage Bonus+2 Dodge dice for the rest of the round, with successive Dodge penalties. Tamer owes 1 action next round.' },
    { name: 'Enemy Scan', type: 'Once Per Battle / Complex', effect: 'Debilitate one enemy Digimon: -2 to all stats except health for 1 round. Does not stack.' },
    { name: 'Decimation', type: 'Once Per Day / Complex', effect: 'Use Signature Move on Round 2 instead of Round 3' },
  ],
  willpower: [
    { name: 'Tough it Out!', type: 'Once Per Battle / Complex', effect: 'Purify: cure one negative effect' },
    { name: 'Challenger', type: 'Passive', effect: 'Gain 2 + (enemy stage difference) temporary Wound Boxes (max 5)' },
    { name: 'Fateful Intervention', type: 'Free Action', effect: 'Spend maximum potential Inspiration (5/7/10). Add or subtract 5 and your Willpower from a check or Accuracy/Dodge pool, and choose every die.' },
  ],
}
