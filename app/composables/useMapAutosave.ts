import { computed, ref, toRaw } from 'vue'
import type { GameMap } from '~/types'
import type { MapGeometryCollection } from '~/utils/mapEdits'

export type MapSavePatch = Partial<Pick<GameMap, MapGeometryCollection>>
export type MapSaveAcknowledgement = Pick<GameMap, 'id' | 'updatedAt'>
export type MapSaveStatus = 'saved' | 'pending' | 'saving' | 'error'

interface MapAutosaveOptions {
  save: (mapId: string, patch: MapSavePatch) => Promise<MapSaveAcknowledgement>
  onSaved?: (mapId: string, acknowledgement: MapSaveAcknowledgement, notifications: string[]) => void
  debounceMs?: number
  maxWaitMs?: number
}

interface SaveQueue {
  mapId: string
  pending: MapSavePatch
  notifications: Set<string>
  inFlight: Promise<boolean> | null
  debounceTimer: ReturnType<typeof setTimeout> | null
  maximumTimer: ReturnType<typeof setTimeout> | null
  ready: boolean
  error: string | null
}

/**
 * Saves immutable editor snapshots in order. Enqueue only holds published collection references;
 * JSON serialization happens once when a batch starts, never once for every cell or pointer move.
 * The owner flushes before navigation and disposes timers when its editing session ends.
 */
export function useMapAutosave(options: MapAutosaveOptions) {
  const queues = new Map<string, SaveQueue>()
  const version = ref(0)
  let disposed = false
  const touch = () => { version.value++ }
  const hasPending = (queue: SaveQueue) => Object.keys(queue.pending).length > 0

  function clearTimers(queue: SaveQueue) {
    if (queue.debounceTimer !== null) clearTimeout(queue.debounceTimer)
    if (queue.maximumTimer !== null) clearTimeout(queue.maximumTimer)
    queue.debounceTimer = queue.maximumTimer = null
  }

  function getQueue(mapId: string): SaveQueue {
    let queue = queues.get(mapId)
    if (!queue) {
      queue = { mapId, pending: {}, notifications: new Set(), inFlight: null,
        debounceTimer: null, maximumTimer: null, ready: false, error: null }
      queues.set(mapId, queue)
    }
    return queue
  }

  function startSave(queue: SaveQueue): Promise<boolean> {
    if (queue.inFlight) return queue.inFlight
    if (!hasPending(queue)) return Promise.resolve(queue.error === null)
    clearTimers(queue)
    const patch: MapSavePatch = JSON.parse(JSON.stringify(queue.pending))
    const notifications = [...queue.notifications]
    queue.pending = {}
    queue.notifications.clear()
    queue.ready = false
    queue.error = null
    const operation = (async () => {
      try {
        const acknowledgement = await Promise.resolve().then(() => options.save(queue.mapId, patch))
        // A notification failure does not turn a committed write back into an unsaved edit.
        try { options.onSaved?.(queue.mapId, acknowledgement, notifications) } catch { /* owner handles connectivity */ }
        return true
      } catch (error: unknown) {
        // Edits queued while this request ran take precedence over its older collection values.
        queue.pending = { ...patch, ...queue.pending }
        for (const notification of notifications) queue.notifications.add(notification)
        queue.error = error instanceof Error ? error.message : 'Failed to save map'
        queue.ready = false
        clearTimers(queue)
        return false
      } finally {
        queue.inFlight = null
        touch()
        if (!disposed && !queue.error && queue.ready && hasPending(queue)) void startSave(queue)
      }
    })()
    queue.inFlight = operation
    touch()
    return operation
  }

  function ready(queue: SaveQueue) {
    clearTimers(queue)
    queue.ready = true
    if (!queue.inFlight && !queue.error && !disposed) void startSave(queue)
  }

  function enqueue(map: GameMap, collections: readonly MapGeometryCollection[], notification?: string) {
    if (disposed || collections.length === 0) return
    const queue = getQueue(map.id)
    const raw = toRaw(map)
    for (const collection of collections) {
      // Atomic editor commits never mutate these arrays or their entries after publication.
      Object.assign(queue.pending, { [collection]: toRaw(raw[collection] ?? []) })
    }
    if (notification) queue.notifications.add(notification)
    if (!queue.error) {
      if (queue.debounceTimer !== null) clearTimeout(queue.debounceTimer)
      queue.debounceTimer = setTimeout(() => ready(queue), options.debounceMs ?? 300)
      if (queue.maximumTimer === null) queue.maximumTimer = setTimeout(() => ready(queue), options.maxWaitMs ?? 1500)
    }
    touch()
  }

  async function flushOne(queue: SaveQueue): Promise<boolean> {
    clearTimers(queue)
    queue.ready = true
    while (queue.inFlight || hasPending(queue)) {
      const success = await (queue.inFlight ?? startSave(queue))
      if (!success) return false
      clearTimers(queue)
      queue.ready = true
    }
    return queue.error === null
  }

  async function flush(mapId?: string): Promise<boolean> {
    const targets = mapId ? [queues.get(mapId)].filter((queue): queue is SaveQueue => Boolean(queue)) : [...queues.values()]
    const results = await Promise.all(targets.map(flushOne))
    return results.every(Boolean)
  }

  function dispose() {
    disposed = true
    for (const queue of queues.values()) clearTimers(queue)
    // Retain dirty state: unmounting must not pretend unsent edits were saved.
  }

  const status = computed<MapSaveStatus>(() => {
    version.value
    const values = [...queues.values()]
    if (values.some(queue => queue.error)) return 'error'
    if (values.some(queue => queue.inFlight)) return 'saving'
    if (values.some(hasPending)) return 'pending'
    return 'saved'
  })
  const error = computed(() => { version.value; return [...queues.values()].find(queue => queue.error)?.error ?? null })
  const hasUnsaved = computed(() => status.value !== 'saved')
  return { enqueue, flush, retry: flush, dispose, status, error, hasUnsaved }
}
