// Encounter snapshots: how a client decides whether an incoming copy of the encounter may replace
// the one it holds. Pure and shared (server payload builder, GM page, player page); no imports.
//
// A snapshot reaches a page three ways: a WebSocket `encounter-state` push, the encounter GET, and
// the response of an action it just performed. They can arrive out of order (a slow response lands
// after a newer push), so every snapshot passes one gate before it replaces page state.

/** Battle-log entries kept in a payload. The database keeps them all. */
export const BATTLE_LOG_WINDOW = 50

/** Phases in which a published encounter is shown to a player. */
export const PLAYER_VISIBLE_PHASES: readonly string[] = ['setup', 'initiative', 'combat']

export type SnapshotSource = 'ws' | 'action' | 'fetch'

interface SnapshotEncounter {
  id?: string
  /** Database row revision, incremented atomically by the encounters UPDATE trigger. */
  revision?: number | string | null
  updatedAt?: string | Date | null
  battleLog?: readonly unknown[] | null
  _battleLogTotal?: number
  _battleLogWasTrimmed?: boolean
  participants?: readonly any[] | null
  pendingRequests?: readonly any[] | null
  phase?: string
  visibleToPlayers?: boolean
  participantPositions?: unknown
  destructibleStates?: unknown
  version?: number
}

/** The last `BATTLE_LOG_WINDOW` entries, plus how many exist in all. */
export function trimBattleLog<T>(log: readonly T[] | null | undefined): { entries: T[]; total: number; wasTrimmed: boolean } {
  const all = log ?? []
  const wasTrimmed = all.length > BATTLE_LOG_WINDOW
  return { entries: wasTrimmed ? all.slice(all.length - BATTLE_LOG_WINDOW) : [...all], total: all.length, wasTrimmed }
}

/** Old encounters stored `{ simple, complex }`; the app now only tracks `{ simple }`. */
export function normalizeActionsRemaining<T extends { actionsRemaining?: any }>(participants: readonly T[]): T[] {
  return participants.map((p) => {
    // Retry receipts include old movement paths and fingerprints; only the server uses them.
    const { attackReceipts: _attacks, movementReceipts: _moves, ...visible } = p as T & { attackReceipts?: unknown; movementReceipts?: unknown }
    return {
      ...visible,
      actionsRemaining: p.actionsRemaining?.complex !== undefined
        ? { simple: p.actionsRemaining.simple || 0 }
        : p.actionsRemaining || { simple: 2 },
    } as T
  })
}

/** Bound every public command response just like GET/WebSocket snapshots. */
export function shapeEncounterResult<T>(result: T): T {
  if (!result || typeof result !== 'object') return result
  const value = result as any
  if (typeof value.id === 'string' && Array.isArray(value.participants)) return shapeActionResponse(value)
  if (value.encounter && Array.isArray(value.encounter.participants)) return { ...value, encounter: shapeActionResponse(value.encounter) }
  return result
}

/** `updatedAt` as milliseconds, or null when absent/unparseable (such a snapshot cannot be ordered). */
export function snapshotStamp(encounter: SnapshotEncounter | null | undefined): number | null {
  const raw = encounter?.updatedAt
  if (raw === undefined || raw === null) return null
  const ms = raw instanceof Date ? raw.getTime() : Date.parse(raw)
  return Number.isNaN(ms) ? null : ms
}

/** Read the authoritative token without losing bigint precision in JSON string responses. */
export function snapshotRevision(encounter: SnapshotEncounter | null | undefined): bigint | null {
  const value = encounter?.revision
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return null
  if (typeof value !== 'number' && (typeof value !== 'string' || !/^\d+$/.test(value))) return null
  return BigInt(value)
}

/**
 * Gives an action response (a raw encounter row) the same shape as a pushed payload: the battle log
 * trimmed to the window with its true length, and, because positions are owned by the live room,
 * the positions/destructibles/version the page already holds. The row's copies come from the
 * database, which lags the room by up to its persist delay, so adopting them would undo moves.
 */
export function shapeActionResponse<T extends SnapshotEncounter>(raw: T, current?: SnapshotEncounter | null): T {
  const { entries, total, wasTrimmed } = trimBattleLog(raw.battleLog)
  const shaped: any = {
    ...raw,
    battleLog: entries,
    _battleLogTotal: raw._battleLogTotal ?? total,
    _battleLogWasTrimmed: raw._battleLogWasTrimmed ?? wasTrimmed,
  }
  if (raw.participants) shaped.participants = normalizeActionsRemaining(raw.participants)
  const carriesNewerRoomState = typeof raw.version === 'number'
    && (typeof current?.version !== 'number' || raw.version >= current.version)
  if (current && current.id === raw.id && !carriesNewerRoomState) {
    for (const key of ['participantPositions', 'destructibleStates', 'version'] as const) {
      if (current[key] !== undefined) shaped[key] = current[key]
    }
  }
  return shaped
}

/** How many battle-log entries an encounter really has, whether or not its copy is trimmed. */
export function battleLogTotal(encounter: SnapshotEncounter | null | undefined): number {
  return encounter?._battleLogTotal ?? encounter?.battleLog?.length ?? 0
}

/**
 * Battle-log entries that `next` added since `previous` (an encounter, or a total taken earlier
 * with `battleLogTotal`). Works across trimmed and untrimmed copies by counting from the true
 * length instead of array lengths, which differ once a log passes the window.
 */
export function newBattleLogEntries<T = any>(
  previous: SnapshotEncounter | number | null | undefined,
  next: SnapshotEncounter | null | undefined,
): T[] {
  const log = (next?.battleLog ?? []) as T[]
  const previousTotal = typeof previous === 'number' ? previous : battleLogTotal(previous)
  const added = Math.min(Math.max(0, battleLogTotal(next) - previousTotal), log.length)
  return added === 0 ? [] : log.slice(log.length - added)
}

export interface EncounterSnapshotGate {
  /** True if `incoming` may replace what the page holds (and records it as the newest seen). */
  accept(incoming: SnapshotEncounter | null | undefined, meta: { source: SnapshotSource; version?: number }): boolean
  reset(): void
}

/**
 * Database revisions order committed row changes across every channel, independently of request
 * start timestamps and push arrival order. Legacy timestamps/push versions apply only before an
 * authoritative revision has been seen. Switching encounters starts a fresh history.
 */
export function createEncounterSnapshotGate(): EncounterSnapshotGate {
  let encounterId: string | null = null
  let newestVersion = -1
  let newestStamp: number | null = null
  let newestRevision: bigint | null = null

  function reset() {
    encounterId = null
    newestVersion = -1
    newestStamp = null
    newestRevision = null
  }

  return {
    reset,
    accept(incoming, { source, version }) {
      if (!incoming) return false
      if (incoming.id !== encounterId) {
        reset()
        encounterId = incoming.id ?? null
      }
      const revision = snapshotRevision(incoming)
      if (revision !== null) {
        if (newestRevision !== null && revision < newestRevision) return false
        newestRevision = revision
        return true
      }
      // An unversioned response must not undo a database-versioned snapshot during rollout.
      if (newestRevision !== null) return false
      if (source === 'ws' && typeof version === 'number') {
        if (version < newestVersion) return false
        newestVersion = version
      }
      const stamp = snapshotStamp(incoming)
      if (stamp === null) return true
      if (newestStamp !== null && stamp < newestStamp) return false
      newestStamp = stamp
      return true
    },
  }
}

/** Whether a published encounter is one this player's dashboard shows (the `loadData` candidate rule). */
export function isEncounterShownToTamer(
  encounter: SnapshotEncounter | null | undefined,
  tamerId: string,
  partnerDigimonIds: ReadonlySet<string>,
): boolean {
  if (!encounter || encounter.visibleToPlayers === false) return false
  if (!encounter.phase || !PLAYER_VISIBLE_PHASES.includes(encounter.phase)) return false
  const participates = (encounter.participants ?? []).some(
    (p: any) =>
      (p.type === 'tamer' && p.entityId === tamerId) ||
      (p.type === 'digimon' && partnerDigimonIds.has(p.entityId)),
  )
  const awaitsTamer = (encounter.pendingRequests ?? []).some((r: any) => r.targetTamerId === tamerId)
  return participates || awaitsTamer
}

/**
 * True when a snapshot changes whether this encounter belongs on the player's dashboard at all:
 * it was unpublished, left the visible phases, or no longer involves the player. Those need the
 * full load, which re-applies visibility and picks the right encounter, rather than a targeted
 * update of the one currently shown.
 */
export function needsFullReload(
  next: SnapshotEncounter | null | undefined,
  tamerId: string,
  partnerDigimonIds: ReadonlySet<string>,
): boolean {
  return !isEncounterShownToTamer(next, tamerId, partnerDigimonIds)
}
