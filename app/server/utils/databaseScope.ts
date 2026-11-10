import { AsyncLocalStorage } from 'node:async_hooks'

// Services use the same imported db object while a command runs in one transaction.
// Store only the transaction handle; never cache mutable encounter records here.
export interface ScopedRoomState {
  participantPositions: Record<string, { x: number; y: number; z: number }>
  destructibleStates: Array<{ structureId: string; currentWounds: number }>
  version: number
}
type Scope = { database: any; afterCommit?: Array<() => void | Promise<void>>; rooms: Map<string, ScopedRoomState> }
const scope = new AsyncLocalStorage<Scope>()
export function scopedDatabase(): any { return scope.getStore()?.database }
export function withDatabase<T>(database: any, work: () => Promise<T>, afterCommit?: Scope['afterCommit']): Promise<T> {
  return scope.run({ database, afterCommit, rooms: new Map() }, work)
}
export function afterDatabaseCommit(work: () => void | Promise<void>): boolean {
  const pending = scope.getStore()?.afterCommit
  if (!pending) return false
  pending.push(work)
  return true
}
export function scopedRoomState(encounterId: string): ScopedRoomState | undefined { return scope.getStore()?.rooms.get(encounterId) }
export function stageRoomState(encounterId: string, state: ScopedRoomState): boolean {
  const current = scope.getStore()
  if (!current?.afterCommit) return false
  current.rooms.set(encounterId, state)
  return true
}
