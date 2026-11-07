import { getUnlockedSpecialOrders } from '../../utils/specialOrders'
import { readCombatRecord } from './combatRecordCache'

/** An automatic miss still gives the Tamer a chance to declare Strike Last. */
export async function offerStrikeLastOnMiss(participants: any[], pendingRequests: any[], attack: {
  id: string; attackerId: string; targetIds: string[]; round: number; attackerName: string; attackName: string
}, campaignLevel: 'standard' | 'enhanced' | 'extreme', records: {
  digimon: (id: string) => Promise<any>; tamer: (id: string) => Promise<any>
}) {
  const attacker = participants.find(p => p.id === attack.attackerId)
  if (attacker?.type !== 'digimon') return pendingRequests
  const offers = [...pendingRequests]
  for (const target of participants.filter(p => attack.targetIds.includes(p.id) && p.type === 'digimon' && !p.inReserve && !!p.isEnemy !== !!attacker.isEnemy)) {
    const record = await readCombatRecord('digimon', target.entityId, async () => [await records.digimon(target.entityId)])
    if (!record?.partnerId) continue
    const owner = participants.find(p => p.type === 'tamer' && p.entityId === record.partnerId && !p.inReserve)
    if (!owner) continue
    const tamer = await readCombatRecord('tamer', owner.entityId, async () => [await records.tamer(owner.entityId)])
    if (!tamer || (tamer.usedPerDayOrders ?? []).includes('Strike Last!')
      || !getUnlockedSpecialOrders(tamer.attributes as any, tamer.xpBonuses as any, campaignLevel).some(o => o.name === 'Strike Last!')) continue
    const id = `strike-last:${attack.id}:${target.id}`
    if (!offers.some(r => r.id === id)) offers.push({
      id, type: 'strike-last-offer', targetTamerId: owner.entityId, targetParticipantId: target.id,
      timestamp: new Date().toISOString(), data: {
        attackerParticipantId: attacker.id, attackerName: attack.attackerName, targetName: record.nickname || record.name,
        attackName: attack.attackName, intercedeGroupId: attack.id, resolvedRound: attack.round,
      },
    })
  }
  return offers
}

/** A declared Strike Last creates its own retaliation, independently of Counterattack quality. */
export function queueStrikeLastCounter(participants: any[], pendingRequests: any[], incoming: any) {
  const defenderId = incoming.targetParticipantId ?? incoming.data?.targetId
  const attackerId = incoming.data?.attackerParticipantId ?? incoming.data?.attackerId
  const defender = participants.find(p => p.id === defenderId)
  const marker = defender?.strikeLastCounter
  if (!marker || marker.attackerId !== attackerId) return { participants, pendingRequests }
  if (incoming.data?.intercedeGroupId && marker.groupId !== incoming.data.intercedeGroupId) return { participants, pendingRequests }
  const updated = participants.map(p => p.id === defenderId ? { ...p, strikeLastCounter: undefined } : p)
  const attacker = participants.find(p => p.id === attackerId)
  if (!attacker || !defender || defender.currentWounds >= defender.maxWounds) return { participants: updated, pendingRequests }
  const request = {
    id: `req-strike-last-${incoming.id}`,
    type: 'counterattack-prompt',
    targetTamerId: marker.tamerId,
    targetParticipantId: defender.id,
    timestamp: new Date().toISOString(),
    data: {
      strikeLast: true, counterBlow: true, suppressPower: true,
      counterattackerParticipantId: defender.id,
      counterattackerEntityId: defender.entityId,
      counterattackerName: incoming.data?.targetName ?? 'Partner',
      originalAttackerParticipantId: attacker.id,
      originalAttackerEntityId: attacker.entityId,
      originalAttackerName: incoming.data?.attackerName ?? 'Enemy',
    },
  }
  return { participants: updated, pendingRequests: pendingRequests.some(r => r.id === request.id) ? pendingRequests : [...pendingRequests, request] }
}
