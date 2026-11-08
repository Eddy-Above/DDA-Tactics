import { applyStatSwaps, type StatBlock } from './statSwaps'
import { applyStanceToAccuracy } from './stanceModifiers'
import { getEffectStatModifiers, applyDerivedStatEffects } from '../data/attackConstants'
import { calculateDigimonDerivedStats, STAGE_BATTERY_CAPACITY } from '../types'

/** Raw form stats, before stance and qualities. Stat swaps always use this same snapshot. */
export function rawCombatStats(record: any): StatBlock {
  const dark = record?.isDarkEvolution ? 2 : 0
  const value = (key: string) => (record?.baseStats?.[key] ?? 0) + (record?.bonusStats?.[key] ?? 0) + dark
  return { accuracy: value('accuracy'), damage: value('damage'), dodge: value('dodge'), armor: value('armor') }
}

export function digimonDodgeBase(record: any): number {
  const qualities = record?.qualities ?? []
  return rawCombatStats(record).dodge
    + (qualities.find((q: any) => q.id === 'instinct')?.ranks ?? 0)
    + (qualities.some((q: any) => q.id === 'digizoid-armor' && q.choiceId === 'blue') ? 2 : 0)
}

export function tamerDodgeBase(record: any): number {
  return (record?.attributes?.agility ?? 0) + (record?.xpBonuses?.attributes?.agility ?? 0)
    + (record?.skills?.dodge ?? 0) + (record?.xpBonuses?.skills?.dodge ?? 0)
}

/** Per-attack bonuses shared by normal attacks, counterattacks and both encounter views. */
export function combatAttackStats(record: any, participant: any, attack: any, options: {
  eddySoulRules?: any; houseRules?: any; derived?: any; round?: number; fallbackAccuracy?: number; targetId?: string; targetIds?: readonly string[]
} = {}) {
  const raw = rawCombatStats(record)
  const swapped = applyStatSwaps(raw, participant?.statSwaps)
  const baseAccuracy = applyStanceToAccuracy(swapped.accuracy || options.fallbackAccuracy || 0, participant?.currentStance)
  const qualities = record?.qualities ?? []
  const tags: string[] = attack?.tags ?? []
  const quality = (id: string) => qualities.find((q: any) => q.id === id)
  const has = (id: string) => !!quality(id) || qualities.some((q: any) => q.choiceId === id)
  const tagHas = (text: string) => tags.some(tag => tag.toLowerCase().includes(text))
  const notes: string[] = []
  const modifiers: Array<{ label: string; accuracy: number; damage: number }> = []
  let accuracyBonus = 0, damageBonus = 0, automaticSuccesses = 0
  const add = (label: string, accuracy = 0, damage = 0) => {
    accuracyBonus += accuracy; damageBonus += damage
    if (accuracy || damage) modifiers.push({ label, accuracy, damage })
  }
  const derived = applyDerivedStatEffects(options.derived ?? calculateDigimonDerivedStats({ ...raw, health: (record?.baseStats?.health ?? 0) + (record?.bonusStats?.health ?? 0) + (record?.isDarkEvolution ? 2 : 0) }, record?.stage ?? 'rookie', record?.size ?? 'medium'), participant?.activeEffects ?? [])
  if (has('true-guardian')) add('True Guardian', -2)
  if (has('huge-power')) {
    const rank2 = (quality('huge-power')?.ranks ?? 1) >= 2
    notes.push(`${rank2 ? 'Reroll 1s+2s' : 'Reroll 1s'}${options.eddySoulRules?.hugePowerOncePerTurn ? ' (1/turn)' : attack?.range === 'ranged' || rank2 ? ' (1/round)' : ''}`)
  }
  if (has('aggressive-flank')) notes.push('+RAM ACC (near ally)')
  const dataOpt = quality('data-optimization')?.choiceId ?? record?.dataOptimization
  if (dataOpt === 'close-combat') add('Close Combat', attack?.range === 'melee' ? 2 : -1)
  if (dataOpt === 'ranged-striker' && attack?.range === 'ranged') add('Ranged Striker', 2)
  if (has('mobile-artillery') && tagHas('area')) notes.push('+CPU DMG (Area)')
  if (has('hit-and-run') && tagHas('charge')) notes.push('+RAM DMG (Charge)')
  const disarmed = participant?.activeEffects?.some((e: any) => e.name === 'Disarmed')
  const weapon = !disarmed && (tags.some(tag => /^Weapon\s+/i.test(tag)) || tags.includes('Chrome Digizoid'))
  if (weapon) {
    const color = quality('digizoid-weapon')?.choiceId
    if (color === 'chrome' && (!options.eddySoulRules?.chromeWeaponNoWeaponRankRequired || has('weapon') || tags.includes('Chrome Digizoid'))) add('Chrome Digizoid', 2, 1)
    if (color === 'black') { add('Black Digizoid', 2); notes.push('+random (d6)') }
    if (color === 'brown') add('Brown Digizoid', 0, 2)
    if (color === 'blue') { add('Blue Digizoid', 2, 2); automaticSuccesses = 1; notes.push('+1 auto success') }
    if (color === 'gold') add('Gold Digizoid', 4, 1)
    if (color === 'obsidian') { add('Obsidian Digizoid', 2, 2); notes.push('+1 Armor Piercing') }
    if (color === 'red') add('Red Digizoid', 0, 6)
  }
  const signature = tagHas('signature')
  if (signature) {
    if (options.houseRules?.signatureMoveBattery) {
      const battery = participant?.battery ?? 0
      if (attack?.type === 'damage') add('Signature battery', battery, battery)
      notes.push(`Battery ${battery}/${STAGE_BATTERY_CAPACITY[record?.stage as keyof typeof STAGE_BATTERY_CAPACITY] ?? 0}${battery > 0 ? ` (+${battery})` : ' (no charge)'}`)
    } else notes.push('+Attacks ACC/DMG (R3+)')
  }
  for (const tag of tags) {
    const match = tag.match(/^Weapon\s+(\d+|I{1,3}|IV|V)$/i)
    if (match && !disarmed) {
      const roman: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5 }
      const rank = roman[match[1].toUpperCase()] ?? Number(match[1])
      add(tag, rank, rank)
    }
    if (tag.startsWith('Certain Strike')) add('Certain Strike', 2)
  }
  const effects = getEffectStatModifiers(participant?.activeEffects ?? [])
  add('Effects', effects.accuracy, effects.damage)
  const directed = participant?.activeEffects?.find((e: any) => e.name === 'Directed')?.value ?? 0
  if (directed) { add('Directed', directed); notes.push(`Directed +${directed}`) }
  const taunt = participant?.activeEffects?.find((e: any) => e.name === 'Taunt')
  const targetIds = options.targetIds ?? (options.targetId ? [options.targetId] : [])
  if (taunt && targetIds.length > 0) {
    const potency = taunt.potency ?? 0 // Stored as the source's CPU x2.
    const targetsSource = targetIds.includes(taunt.source)
    const isAreaAttack = tags.some(tag => tag.startsWith('Area Attack'))
    const penalty = targetsSource ? (isAreaAttack ? Math.max(0, potency / 2 - 2) : 0) : potency
    add('Taunt', -penalty)
  }
  const fear = participant?.activeEffects?.find((e: any) => e.name === 'Fear')
  if (fear && targetIds.includes(fear.source)) add('Fear', -Math.max(0, fear.potency ?? 0))
  if (has('positive-reinforcement')) {
    const mood = participant?.moodValue ?? 3
    add('Mood', mood <= 2 ? mood - 3 : 0, mood >= 5 ? mood - 4 : 0)
  }
  add('Juggernaut', participant?.juggernauntBonuses?.accuracy ?? 0, participant?.juggernauntBonuses?.damage ?? 0)
  add('Tormentor', (participant?.tormentorBonusStacks ?? 0) * 2, (participant?.tormentorBonusStacks ?? 0) * 2)
  if (has('combat-monster')) add('Combat Monster', 0, participant?.combatMonsterBonus ?? 0)
  const reach = quality('reach')?.ranks ?? 0
  const range = derived.range ?? 0
  const effectiveLimit = derived.effectiveLimit ?? 0
  return {
    accuracy: Math.max(0, baseAccuracy + accuracyBonus), damage: swapped.damage + damageBonus,
    accuracyBonus, damageBonus, automaticSuccesses, modifiers, notes, range, effectiveLimit,
    attackRange: attack?.range === 'melee' ? (reach > 0 ? reach * 2 : 1) : range,
    attackEffectiveLimit: attack?.range === 'melee' ? null : effectiveLimit,
  }
}
