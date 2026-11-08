import type { AttackRadialRider, MapRadialItem } from '../types/mapRadial'
import type { AttackRiders } from './attackAccuracy'
import { attackRadialItem } from './attackBadges'
import { attackActionCost, canBolsterCombatAttack, canUseCombatAttack, hugePowerAvailability } from './combatAttackOptions'
import { getAttackOrderModifiers } from './specialOrderCombat'
import { INSPIRATION_ACT_COST, INSPIRATION_FATEFUL_COST, type CampaignLevel } from '../types'

export interface AttackRadialContext {
  record?: any
  round: number
  houseRules?: any
  eddySoulRules?: any
  campaignLevel: CampaignLevel
  hasTamer: boolean
  inspiration: number
  fatefulAvailable: boolean
}
export interface RadialAttackSelection extends AttackRiders {
  actOfInspiration: boolean
  fatefulIntervention: boolean
}

export function attackRiderSelection(selected: readonly AttackRadialRider[]): RadialAttackSelection {
  return { bolster: selected.some(rider => rider.startsWith('bolster-')),
    bolsterType: selected.includes('bolster-bit-cpu') ? 'bit-cpu' : 'damage-accuracy',
    hugePower: selected.includes('huge-power') || selected.includes('huge-power-2'), hugePowerRank2: selected.includes('huge-power-2'),
    lifesteal: selected.includes('lifesteal'), actOfInspiration: selected.includes('act-of-inspiration'),
    fatefulIntervention: selected.includes('fateful-intervention') }
}

export function toggleAttackRider(selected: readonly AttackRadialRider[], rider: AttackRadialRider): AttackRadialRider[] {
  if (selected.includes(rider)) return selected.filter(current => current !== rider)
  let next = [...selected]
  if (rider.startsWith('bolster-')) next = next.filter(current => !current.startsWith('bolster-') && current !== 'lifesteal')
  if (rider === 'lifesteal') next = next.filter(current => !current.startsWith('bolster-'))
  if (rider.startsWith('huge-power')) next = next.filter(current => !current.startsWith('huge-power'))
  return [...next, rider]
}

function baseActions(participant: any, attack: any, context: AttackRadialContext): number {
  return attackActionCost(participant, attack, context.eddySoulRules)
}

function catalog(participant: any, attack: any, context: AttackRadialContext) {
  const bolster = canBolsterCombatAttack(participant, attack, context.eddySoulRules)
  const power = hugePowerAvailability(participant, attack, context.record?.qualities ?? [], context)
  const suppressed = getAttackOrderModifiers(participant).suppressPower
  const entries: Array<{ id: AttackRadialRider; label: string; allowed: boolean; cost: string; inspiration: number }> = [
    { id: 'bolster-damage-accuracy', label: 'Bolster Accuracy/Damage', allowed: bolster, cost: '2 Simple', inspiration: 0 },
    { id: 'bolster-bit-cpu', label: 'Bolster BIT/CPU', allowed: bolster && (participant.lastBitCpuBolsterRound === undefined || context.round - participant.lastBitCpuBolsterRound >= 2), cost: '2 Simple', inspiration: 0 },
  ]
  if (context.record?.qualities?.some((quality: any) => quality.id === 'huge-power')) {
    entries.push({ id: 'huge-power', label: 'Huge Power', allowed: power.rank1 && !suppressed, cost: 'No extra cost', inspiration: 0 })
    if ((context.record.qualities.find((quality: any) => quality.id === 'huge-power')?.ranks ?? 1) >= 2) {
      entries.push({ id: 'huge-power-2', label: 'Huge Power II', allowed: power.rank2 && !suppressed, cost: 'No extra cost', inspiration: 0 })
    }
  }
  if (attack.effect === 'Lifesteal') entries.push({ id: 'lifesteal', label: 'Lifesteal ×2', allowed: (participant.actionsRemaining?.simple ?? 0) >= 2, cost: '2 Simple', inspiration: 0 })
  if (context.hasTamer) {
    const act = INSPIRATION_ACT_COST[context.campaignLevel], fateful = INSPIRATION_FATEFUL_COST[context.campaignLevel]
    entries.push({ id: 'act-of-inspiration', label: 'Act of Inspiration', allowed: context.inspiration >= act, cost: `${act} Inspiration`, inspiration: act },
      { id: 'fateful-intervention', label: 'Fateful Intervention', allowed: context.fatefulAvailable && context.inspiration >= fateful, cost: `${fateful} Inspiration`, inspiration: fateful })
  }
  return entries
}

export function validAttackRiders(participant: any, attack: any, context: AttackRadialContext, selected: readonly AttackRadialRider[]): boolean {
  if (!Array.isArray(selected) || new Set(selected).size !== selected.length || !canUseCombatAttack(participant, attack, context.eddySoulRules)) return false
  const entries = catalog(participant, attack, context)
  if (selected.some(rider => !entries.some(entry => entry.id === rider && entry.allowed))) return false
  const selection = attackRiderSelection(selected)
  if (selected.filter(rider => rider.startsWith('bolster-')).length > 1 || selected.filter(rider => rider.startsWith('huge-power')).length > 1 || (selection.bolster && selection.lifesteal)) return false
  const actions = Math.max(baseActions(participant, attack, context), selection.bolster || selection.lifesteal ? 2 : 1)
  const inspiration = entries.filter(entry => selected.includes(entry.id)).reduce((sum, entry) => sum + entry.inspiration, 0)
  return (participant.actionsRemaining?.simple ?? 0) >= actions && context.inspiration >= inspiration
}

export function radialAttackItem(participant: any, attack: any, context: AttackRadialContext, selected: readonly AttackRadialRider[] = []): MapRadialItem {
  const actions = baseActions(participant, attack, context)
  const item = attackRadialItem(attack, !canUseCombatAttack(participant, attack, context.eddySoulRules) || (participant.actionsRemaining?.simple ?? 0) < actions)
  const id = encodeURIComponent(attack.id)
  const entries = catalog(participant, attack, context)
  const configured = attackRiderSelection(selected)
  const totalActions = Math.max(actions, configured.bolster || configured.lifesteal ? 2 : 1)
  const inspiration = entries.filter(entry => selected.includes(entry.id)).reduce((sum, entry) => sum + entry.inspiration, 0)
  return { ...item, cost: `${actions} Simple`, children: [
    ...entries.map(entry => ({ id: `attack-rider:${id}:${entry.id}`, label: entry.label, cost: entry.cost,
      active: selected.includes(entry.id), disabled: !selected.includes(entry.id) && !validAttackRiders(participant, attack, context, toggleAttackRider(selected, entry.id)),
      attackId: attack.id, attackRider: entry.id })),
    { id: `attack-confirm:${id}`, label: 'Continue', description: 'Choose the attack target', cost: `${totalActions} Simple${inspiration ? ` + ${inspiration} Insp` : ''}`,
      disabled: !validAttackRiders(participant, attack, context, selected), attackId: attack.id, attackRiders: [...selected] },
  ] }
}
