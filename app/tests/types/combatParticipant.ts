// Compile-time compatibility contracts; this file does not load the database at runtime.
import type { ActiveEffect, ClashState, CombatParticipant, StoredCombatParticipant } from '../../types/combat'
import type {
  ActiveEffect as IndexActiveEffect,
  ClashState as IndexClashState,
  CombatParticipant as IndexParticipant,
  StoredCombatParticipant as IndexStoredParticipant,
} from '../../types'
import type {
  ActiveEffect as ComposableActiveEffect,
  ClashState as ComposableClashState,
  CombatParticipant as ComposableParticipant,
} from '../../composables/useEncounters'
import type { Encounter as StoredEncounter } from '../../server/db/schema'

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false
type Assert<T extends true> = T

export type CombatAliasesAgree = [
  Assert<Equal<CombatParticipant, IndexParticipant>>,
  Assert<Equal<CombatParticipant, ComposableParticipant>>,
  Assert<Equal<StoredCombatParticipant, IndexStoredParticipant>>,
  Assert<Equal<StoredCombatParticipant, StoredEncounter['participants'][number]>>,
  Assert<Equal<ActiveEffect, IndexActiveEffect>>,
  Assert<Equal<ActiveEffect, ComposableActiveEffect>>,
  Assert<Equal<ClashState, IndexClashState>>,
  Assert<Equal<ClashState, ComposableClashState>>,
]

const base = {
  id: 'enemy-1', type: 'digimon', entityId: 'goblimon', seq: 1, isEnemy: true,
  initiative: 4, initiativeRoll: 10, actionsRemaining: { simple: 2 },
  currentStance: 'neutral', activeEffects: [], isActive: false, hasActed: false,
} satisfies StoredCombatParticipant

const live = { ...base, currentWounds: 0, maxWounds: 6 } satisfies CombatParticipant
const legacyStored = { ...base } satisfies StoredCombatParticipant
const legacyComplexCounter = { ...live, actionsRemaining: { simple: 2, complex: 1 } } satisfies CombatParticipant

const indexParticipant: IndexParticipant = live
const composableParticipant: ComposableParticipant = indexParticipant
const schemaParticipant: StoredEncounter['participants'][number] = composableParticipant

// Live clients must normalize wound totals on an older stored snapshot before using it.
// @ts-expect-error Canonical live participants require both currentWounds and maxWounds.
const missingWoundTotals: CombatParticipant = legacyStored
// @ts-expect-error A deprecated complex counter cannot replace the simple-action source of truth.
const complexOnly: CombatParticipant['actionsRemaining'] = { complex: 1 }
// @ts-expect-error The supported participant kinds are unchanged by the model consolidation.
const invalidKind: CombatParticipant['type'] = 'npc'
// @ts-expect-error The supported stance values are unchanged by the model consolidation.
const invalidStance: CombatParticipant['currentStance'] = 'aggressive'

const clash: ClashState = {
  clashId: 'clash-1', opponentParticipantId: 'partner-1', isController: true,
  isPinned: false, clashCheckNeeded: true, clashPinsUsed: 1,
  pendingRoll: 9, pendingRollDescription: 'dice: [3, 6], body: +2',
  cannotInitiateUntilRound: 3, reachInitiated: true, reachDistance: 2,
}

const extended = {
  ...live, clash, name: 'Goblimon', airborneByJump: true,
  woundsHistory: [{ stageIndex: 1, wounds: 0, entityId: 'goblimon', maxWounds: 6, totalHealth: 12 }],
  specialOrderDebt: { '3': 1 }, gmCharacterOptOuts: { ally: ['enemy-1'] },
  maxPostTurnIntercedes: 2, strikeFastTurnKey: 'round-2', fatefulSpentRollIds: ['roll-1'],
  strikeLastCounter: { attackerId: 'partner-1', groupId: 'cast-1', tamerId: 'tai' },
  isMinion: true, summonerId: 'boss-1', summonedByParticipantId: 'boss-1',
  seenAttackIds: { claw: 2 }, juggernauntBonuses: { damage: 2 }, timeControlUsed: true,
  dataAbsorbActive: true, dataAbsorbHealAmount: 4, buggedSpecValues: { bit: 2, cpu: 3, ram: 4 },
  demoralizedAttributes: { body: 1 }, tormentorBonusStacks: 2, tankBusterUsedAtThresholds: [0.75],
  blackArmorRoundBonus: { armor: 2, dodge: 2 }, brownArmorAutoDodgeAvailable: true,
} satisfies CombatParticipant

// Keep concrete assignment checks part of the file without exporting runtime fixtures.
void [schemaParticipant, legacyComplexCounter, missingWoundTotals, complexOnly, invalidKind, invalidStance, extended]
