import { ref } from 'vue'

interface AutomaticDefenseAdapters {
  encounterId: () => string | null | undefined
  isPending: (request: any) => boolean
  isBlocked: (request: any) => boolean
  submit: (request: any) => Promise<boolean>
}

/** Resolve zero-dice defenses in encounter order, once even across repeated pushes. */
export function useAutomaticDefenses(adapters: AutomaticDefenseAdapters) {
  const failed = ref(new Set<string>())
  const pending = new Map<string, Promise<boolean>>()
  const completed = new Set<string>()
  let chain: Promise<unknown> = Promise.resolve()
  const keyFor = (request: any) => `${adapters.encounterId()}:${request.id}`

  function resolve(request: any, retry = false): Promise<boolean> {
    const encounterId = adapters.encounterId()
    const key = keyFor(request)
    if (!encounterId || completed.has(key)) return Promise.resolve(false)
    if (pending.has(key)) return pending.get(key)!
    if (failed.value.has(key) && !retry) return Promise.resolve(false)
    failed.value.delete(key)
    const run = async () => {
      if (adapters.encounterId() !== encounterId || !adapters.isPending(request) || !adapters.isBlocked(request)) return false
      try {
        const accepted = await adapters.submit(request)
        if (accepted) completed.add(key)
        else failed.value.add(key)
        return accepted
      } catch {
        failed.value.add(key)
        return false
      } finally {
        pending.delete(key)
      }
    }
    const next = chain.then(run, run).finally(() => pending.delete(key))
    pending.set(key, next)
    chain = next.catch(() => undefined)
    return next
  }

  return { resolve, hasFailed: (request: any) => !!request && failed.value.has(keyFor(request)) }
}
