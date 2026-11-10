import { allowFields, boundedString, finiteNumber } from './securityValidation'

const fields: Record<string, readonly string[]> = {
  'card-move': ['participantId'], 'cheer-up': ['participantId', 'targetParticipantId'],
  'clash-break': ['clashId', 'breakerId', 'tamerId', 'roll', 'diceResults'],
  'clash-check': ['clashId', 'participantId', 'roll', 'diceResults'],
  'clash-initiate': ['participantId', 'targetId', 'tamerId', 'bodyRoll', 'bodyDiceResults', 'reachDistance'],
  cleanse: ['requestId', 'ownerId', 'mode', 'selections'],
  'data-absorb': ['participantId', 'extraActions'],
  'digivolve-fail': ['participantId', 'targetSpecies', 'rollTotal', 'dc'],
  digivolve: ['participantId', 'targetChainIndex', 'rollTotal'],
  direct: ['participantId', 'targetDigimonId', 'bolstered'],
  doors: ['participantId', 'doorIds', 'isOpen'],
  'end-turn': ['participantId', 'turnKey'],
  'gm-digivolve': ['participantId', 'targetChainIndex'],
  'grant-inspiration': ['participantId', 'amount'],
  'intercede-claim': ['requestId', 'interceptorParticipantId', 'chosenTargetId', 'throwAllyLandingPos'],
  'intercede-optouts': ['ownerId', 'participantId', 'intercedeOptOuts'],
  'intercede-pass': ['ownerId', 'action'],
  'intercede-skip': ['requestId', 'optOut', 'optOutTargetIds', 'characterOptOuts'],
  log: ['actorId', 'actorName', 'action', 'target', 'result', 'damage', 'effects', 'round', 'baseDamage', 'netSuccesses', 'targetArmor', 'clashArmorBonus', 'armorPiercing', 'effectiveArmor', 'finalDamage', 'hit', 'accuracyDicePool', 'accuracyDiceResults', 'accuracySuccesses', 'dodgeDicePool', 'dodgeDiceResults', 'dodgeSuccesses'],
  'mode-change': ['participantId', 'newSwaps'],
  'quick-reaction': ['requestId', 'tamerParticipantId', 'targetParticipantId'],
  'skill-order': ['participantId', 'orderName'],
  'special-order': ['participantId', 'orderName', 'targetId', 'partnerId', 'effectId', 'requestId'],
  'spend-inspiration': ['participantId', 'spendType', 'amount', 'requestId', 'rollId', 'rollType', 'targetParticipantId', 'baseDicePool', 'bonusSign', 'willpowerSign', 'diceResults'],
  stance: ['participantId', 'stance'],
  'tormentor-check': ['bossParticipantId', 'failingParticipantIds'],
  'requests-create': ['type', 'targetTamerId', 'targetParticipantId', 'data'],
  response: ['requestId', 'tamerId', 'response'],
  'requests-delete': ['requestId', 'responseId'], 'responses-delete': ['requestId', 'responseId'],
  delete: ['requestId', 'responseId'], duplicate: ['name', 'mode'],
  update: ['name', 'description', 'round', 'phase', 'participants', 'turnOrder', 'currentTurnIndex', 'battleLog', 'hazards', 'pendingRequests', 'requestResponses', 'mapId', 'visibleToPlayers', 'intercedeOptOuts', 'movementActionParticipantId'],
}
const responseFields: Record<string, string[]> = {
  'digimon-selected': ['digimonId'], 'initiative-rolled': ['initiative', 'initiativeRoll'],
  'dodge-rolled': ['dodgeDicePool', 'dodgeSuccesses', 'dodgeDiceResults'],
  'health-rolled': ['healthDicePool', 'healthSuccesses', 'healthDiceResults'],
  'counterattack-declined': [],
  'counterattack-triggered': ['attackId', 'attackName', 'accuracyDicePool', 'accuracySuccesses', 'accuracyDiceResults'],
  'recovery-rolled': ['tamerSuccesses', 'digimonSuccesses', 'tamerDiceResults', 'digimonDiceResults'],
  'divine-protection-used': [], 'divine-protection-declined': [],
}

/** Public command metadata never expands the fields that the underlying operation may write. */
export function validateEncounterCommandFields(operation: string, body: unknown): void {
  const allowed = fields[operation]
  if (!allowed) throw createError({ statusCode: 400, message: 'Unknown encounter command' })
  const metadata = ['update', 'delete', 'duplicate', 'requests-delete', 'responses-delete'].includes(operation) ? [] : ['operationId', 'expectedRevision']
  const value = allowFields(body, [...allowed, ...metadata])
  const numeric = new Set(['roll', 'bodyRoll', 'reachDistance', 'extraActions', 'rollTotal', 'dc', 'targetChainIndex', 'amount', 'baseDicePool', 'bonusSign', 'willpowerSign',
    'round', 'damage', 'baseDamage', 'netSuccesses', 'targetArmor', 'clashArmorBonus', 'armorPiercing', 'effectiveArmor', 'finalDamage', 'accuracyDicePool', 'accuracySuccesses', 'dodgeDicePool', 'dodgeSuccesses'])
  for (const [key, item] of Object.entries(value)) {
    if (item === undefined || item === null) continue
    if (numeric.has(key)) finiteNumber(item, key, { integer: true })
    else if (key.endsWith('Id') || ['ownerId', 'stance', 'spendType', 'rollType', 'orderName', 'targetSpecies', 'mode', 'action', 'actorName', 'target', 'result', 'turnKey'].includes(key)) boundedString(item, key, key === 'result' ? 10000 : 200)
    else if (['bolstered', 'isOpen', 'optOut', 'hit'].includes(key) && typeof item !== 'boolean') throw createError({ statusCode: 400, message: `Invalid ${key}` })
    else if (['diceResults', 'bodyDiceResults', 'accuracyDiceResults', 'dodgeDiceResults'].includes(key)) {
      if (!Array.isArray(item) || item.length > 10000) throw createError({ statusCode: 400, message: 'Invalid command dice' })
      item.forEach(die => finiteNumber(die, key, { integer: true, min: 1, max: 6 }))
    }
  }
  if (value.operationId !== undefined) boundedString(value.operationId, 'operationId', 128, false)
  if (value.expectedRevision !== undefined) finiteNumber(value.expectedRevision, 'expectedRevision', { integer: true, min: 0 })
  if (operation === 'requests-create' && !['digimon-selection', 'initiative-roll', 'dodge-roll', 'intercede-offer', 'health-roll', 'recovery-check', 'divine-protection-offer'].includes(value.type)) throw createError({ statusCode: 400, message: 'Unknown player prompt' })
  if (operation !== 'response') return
  if (typeof value.response?.type !== 'string' || !Object.hasOwn(responseFields, value.response.type)) throw createError({ statusCode: 400, message: 'Unknown player response' })
  const response = allowFields(value.response, ['type', 'timestamp', 'participantId', ...responseFields[value.response.type]!])
  for (const [key, item] of Object.entries(response)) {
    if (key === 'type') continue
    if (['digimonId', 'attackId', 'attackName', 'timestamp', 'participantId'].includes(key)) {
      if (key !== 'digimonId' || item !== null) boundedString(item, key, key === 'attackName' ? 200 : 128)
    } else if (key.endsWith('DiceResults')) {
      if (!Array.isArray(item) || item.length > 10000) throw createError({ statusCode: 400, message: 'Invalid response dice' })
      item.forEach(die => finiteNumber(die, key, { integer: true, min: 1, max: 6 }))
    } else finiteNumber(item, key, { integer: true, min: key.startsWith('initiative') ? -10000 : 0, max: 10000 })
  }
}
