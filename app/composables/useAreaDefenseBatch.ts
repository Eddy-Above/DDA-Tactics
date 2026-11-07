import { computed, ref } from 'vue'
import type { DodgeDefense } from '../utils/areaDefense'
import { getPaidDodgeDiceBonus } from '../utils/areaDefense'

export interface DefenseRoll {
  fatefulIntervention?: boolean
  rolls: number[]
  successes: number
  dicePool: number
  automaticSuccesses?: number
  successThreshold?: number
}

/**
 * idle        nothing rolled yet
 * rolled      a roll exists and has not been sent
 * submitting  being sent
 * submitted   the server has the roll; immutable
 * failed      the last send failed; the roll is kept and is resent unchanged
 * unavailable the request or its target is gone (protected, removed, resolved elsewhere); nothing is sent
 */
export type DefenseStatus = 'idle' | 'rolled' | 'submitting' | 'submitted' | 'failed' | 'unavailable'

export interface DefenseSummary {
  hit: boolean
  finalDamage: number | null
  netSuccesses: number | null
}

export interface DefenseEntry {
  requestId: string
  request: any
  status: DefenseStatus
  roll: DefenseRoll | null
  /** Act of Inspiration chosen for the next roll (before it is paid). */
  actOfInspiration: boolean
  /** Act of Inspiration has been paid for this target: it is never charged again. */
  actPaid: boolean
  rerolls: number
  extraDice: number
  busy: boolean
  error: string | null
  responseId: string | null
  summary: DefenseSummary | null
  /** The server already had an answer for this request when we found it (another tab, a lost reply). */
  answeredElsewhere: boolean
}

export interface SubmitOutcome {
  ok: boolean
  responseId?: string | null
  summary?: DefenseSummary | null
  message?: string
}

export type InspirationSpend = 'act-of-inspiration' | 'reroll' | 'modifier'

export interface AreaDefenseAdapters {
  /** One target's Dodge pool and what shaped it (`computeDodgeDefense` on the page's records). */
  defense: (request: any) => DodgeDefense
  currentInspiration: () => number
  actOfInspirationCost: () => number
  /** Spends Inspiration and resolves true only once the server has accepted the spend. */
  spend: (kind: InspirationSpend, amount: number, requestId?: string) => Promise<boolean>
  /** Sends one `dodge-rolled` response. Must not throw for an ordinary failure: return `{ ok: false }`. */
  submit: (request: any, roll: DefenseRoll) => Promise<SubmitOutcome>
  /** The server already answered this request. */
  isAnswered: (request: any) => boolean
  /** The target is still in the encounter and this player still controls it. */
  isTargetPresent: (request: any) => boolean
  rollDie?: () => number
}

const SETTLED: readonly DefenseStatus[] = ['submitted', 'unavailable']
const SENDABLE: readonly DefenseStatus[] = ['rolled', 'failed']
const countSuccesses = (rolls: number[]) => rolls.filter((d) => d >= 5).length

/**
 * One defense panel per cast: every dodge request an area attack made for this player, each with
 * its own pool, Inspiration choices, roll and status. The rules that keep it honest:
 * - a roll is kept per target and cannot be rolled again for free; extra dice and re-rolls happen
 *   only after the server has accepted an Inspiration spend, and an Act of Inspiration is paid once;
 * - a failed send keeps its roll and resends exactly that roll, so a retry cannot re-roll or
 *   spend again, and a submitted defense never changes;
 * - Inspiration spends are made one at a time, so two targets cannot both claim the last point;
 * - `reconcile` follows the encounter: rolls survive an update, a target that was protected or
 *   removed becomes unavailable (nothing is sent for it), and a request the server already
 *   answered counts as submitted instead of being sent again.
 */
export function useAreaDefenseBatch(adapters: AreaDefenseAdapters) {
  const groupId = ref<string | null>(null)
  const entries = ref<DefenseEntry[]>([])
  const running = ref(false)
  const active = computed(() => groupId.value !== null)
  const isSettled = computed(() => entries.value.length > 0 && entries.value.every((e) => SETTLED.includes(e.status)))
  const views = computed(() => entries.value.map((entry) => ({ ...entry, defense: adapters.defense(entry.request) })))

  const die = adapters.rollDie ?? (() => Math.floor(Math.random() * 6) + 1)
  const find = (requestId: string) => entries.value.find((e) => e.requestId === requestId)
  const newEntry = (request: any): DefenseEntry => ({
    requestId: request.id, request, status: 'idle', roll: null, actOfInspiration: false, actPaid: !!request.data?.dodgeActPaid,
    rerolls: 0, extraDice: 0, busy: false, error: null, responseId: null, summary: null, answeredElsewhere: false,
  })

  let spendChain: Promise<unknown> = Promise.resolve()
  function spend(kind: InspirationSpend, amount: number, requestId: string): Promise<boolean> {
    const run = async () => {
      if (adapters.currentInspiration() < amount) return false
      try {
        return (await adapters.spend(kind, amount, requestId)) === true
      } catch {
        return false
      }
    }
    const next = spendChain.then(run, run)
    spendChain = next.catch(() => undefined)
    return next
  }

  function open(id: string, requests: any[]) {
    groupId.value = id
    entries.value = requests.map(newEntry)
  }

  function close() {
    groupId.value = null
    entries.value = []
  }

  function ownsRequest(requestId: string): boolean {
    return entries.value.some((e) => e.requestId === requestId)
  }

  function toggleAct(requestId: string) {
    const entry = find(requestId)
    if (!entry || entry.status !== 'idle' || entry.busy || entry.actPaid) return
    if (!entry.actOfInspiration && adapters.currentInspiration() < adapters.actOfInspirationCost()) return
    entry.actOfInspiration = !entry.actOfInspiration
  }

  async function rollOne(requestId: string): Promise<boolean> {
    const entry = find(requestId)
    if (!entry || entry.status !== 'idle' || entry.busy) return false // already rolled: no free re-roll
    entry.busy = true
    entry.error = null
    try {
      const defense = adapters.defense(entry.request)
      if (entry.request.data?.dodgeActPaid) entry.actPaid = true
      if (entry.actOfInspiration && !defense.blocked && !entry.actPaid) {
        if (!(await spend('act-of-inspiration', adapters.actOfInspirationCost(), entry.requestId))) {
          entry.error = 'Could not spend Inspiration, so nothing was rolled.'
          return false
        }
        entry.actPaid = true
      }
      if (entry.status !== 'idle') return false // settled while the spend was in flight
      const pool = defense.pool + (!defense.blocked && !entry.request.data?.fatefulIntervention
        ? Math.max(getPaidDodgeDiceBonus(entry.request), entry.actPaid ? 5 : 0) : 0)
      const rolls = Array.from({ length: pool }, die)
      const automaticSuccesses = defense.automaticSuccesses ?? 0
      entry.roll = { rolls, successes: countSuccesses(rolls) + automaticSuccesses, dicePool: pool,
        ...(automaticSuccesses ? { automaticSuccesses } : {}) }
      entry.status = 'rolled'
      return true
    } finally {
      entry.busy = false
    }
  }

  async function adjustRoll(requestId: string, kind: 'reroll' | 'modifier'): Promise<boolean> {
    const entry = find(requestId)
    if (!entry || entry.busy || !entry.roll || entry.roll.fatefulIntervention || !SENDABLE.includes(entry.status)) return false
    entry.busy = true
    try {
      if (!(await spend(kind, 1, entry.requestId))) {
        entry.error = 'Could not spend Inspiration; the roll is unchanged.'
        return false
      }
      // Only a paid spend changes the dice, and only while the roll can still be sent.
      if (!entry.roll || !SENDABLE.includes(entry.status)) return false
      const rolls = kind === 'reroll' ? entry.roll.rolls.map(die) : [...entry.roll.rolls, die()]
      entry.roll = {
        ...entry.roll, rolls,
        successes: rolls.filter(d => d >= (entry.roll!.successThreshold ?? 5)).length + (entry.roll.automaticSuccesses ?? 0),
        dicePool: kind === 'reroll' ? entry.roll.dicePool : entry.roll.dicePool + 1,
      }
      if (kind === 'reroll') entry.rerolls++
      else entry.extraDice++
      entry.error = null
      entry.status = 'rolled'
      return true
    } finally {
      entry.busy = false
    }
  }

  async function submitOne(requestId: string): Promise<boolean> {
    const entry = find(requestId)
    if (!entry || entry.busy || !entry.roll || !SENDABLE.includes(entry.status)) return false
    entry.busy = true
    entry.status = 'submitting'
    entry.error = null
    // Sent exactly as held, whatever else happens: a plain copy, so the adapter can serialize it.
    const roll: DefenseRoll = { ...entry.roll, rolls: [...entry.roll.rolls] }
    try {
      const outcome = await adapters.submit(entry.request, roll)
      if (outcome.ok) {
        entry.status = 'submitted'
        entry.responseId = outcome.responseId ?? null
        entry.summary = outcome.summary ?? null
        return true
      }
      if (entry.status === 'submitting') entry.status = 'failed'
      entry.error = outcome.message ?? 'Could not send this defense. Try again.'
      return false
    } catch (error: any) {
      if (entry.status === 'submitting') entry.status = 'failed'
      entry.error = error?.data?.message || error?.message || 'Could not send this defense. Try again.'
      return false
    } finally {
      entry.busy = false
    }
  }

  /** A blocked defense has no roll or Inspiration decision; use the normal submit continuation. */
  async function resolveBlocked(requestId: string): Promise<boolean> {
    const entry = find(requestId)
    if (!entry || entry.busy || SETTLED.includes(entry.status) || !adapters.defense(entry.request).blocked) return false
    entry.actOfInspiration = false
    entry.roll = { rolls: [], successes: 0, dicePool: 0 }
    entry.status = 'rolled'
    return submitOne(requestId)
  }

  function setFatefulRoll(requestId: string, roll: DefenseRoll): boolean {
    const entry = find(requestId)
    if (!entry || entry.busy || SETTLED.includes(entry.status) || entry.status === 'submitting') return false
    entry.roll = { ...roll, rolls: [...roll.rolls] }
    entry.actOfInspiration = false
    entry.status = 'rolled'
    entry.error = null
    return true
  }

  async function runAll(step: (entry: DefenseEntry) => Promise<unknown>, wanted: (entry: DefenseEntry) => boolean) {
    if (running.value) return
    running.value = true
    try {
      // Defense order is the order the server created the requests in.
      for (const entry of [...entries.value]) {
        if (wanted(entry) && !entry.busy) await step(entry)
      }
    } finally {
      running.value = false
    }
  }

  /** Rolls every target that has not rolled yet, in order. Rolled, submitted and unavailable targets are left alone. */
  const rollAllUnrolled = () => runAll((e) => rollOne(e.requestId), (e) => e.status === 'idle')

  /** Sends every target that has a roll waiting, one at a time in defense order; a failure does not stop the rest. */
  const submitReady = () => runAll((e) => submitOne(e.requestId), (e) => !!e.roll && SENDABLE.includes(e.status))

  /**
   * Brings the batch in line with the player's current dodge requests for this cast. Keeps every
   * roll; never re-opens a submitted defense.
   */
  function reconcile(requests: any[]) {
    if (!active.value) return
    const incoming = new Map(requests.map((r) => [r.id, r]))
    for (const entry of entries.value) {
      const request = incoming.get(entry.requestId)
      if (request) entry.request = request
      if (entry.status === 'submitted' || entry.status === 'submitting') continue

      if (!request || !adapters.isTargetPresent(request)) {
        if (entry.status !== 'unavailable') {
          entry.status = 'unavailable'
          entry.error = 'This defense is no longer needed.'
        }
      } else if (adapters.isAnswered(request)) {
        entry.status = 'submitted'
        entry.answeredElsewhere = true
        entry.error = null
      } else if (entry.status === 'unavailable') {
        entry.status = entry.roll ? 'rolled' : 'idle'
        entry.error = null
      }
    }
    for (const request of requests) {
      if (!ownsRequest(request.id) && !adapters.isAnswered(request) && adapters.isTargetPresent(request)) {
        entries.value.push(newEntry(request))
      }
    }
  }

  /** What dismissing the panel must clear on the server: every request, and the responses already sent. */
  function cleanupTargets(): Array<{ requestId: string; responseId: string | null }> {
    return entries.value.map((e) => ({ requestId: e.requestId, responseId: e.responseId }))
  }

  return {
    groupId, entries, views, active, isSettled, running,
    open, close, reconcile, ownsRequest, cleanupTargets,
    toggleAct, rollOne, rerollOne: (id: string) => adjustRoll(id, 'reroll'), addDieOne: (id: string) => adjustRoll(id, 'modifier'),
    submitOne, resolveBlocked, setFatefulRoll, rollAllUnrolled, submitReady,
  }
}
