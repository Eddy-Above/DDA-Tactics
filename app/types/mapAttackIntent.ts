import type { Vec3 } from './index'

/** Local aiming data; the server derives allowances and commits it with the attack. */
export interface MapAttackIntent {
  operationId: string
  expectedRevision?: number
  chargeTiming?: 'before' | 'after'
  movement?: {
    kind: 'charge-before' | 'pass'
    origin: Vec3
    destination: Vec3
    path?: Vec3[]
    direction?: Vec3
  }
}
