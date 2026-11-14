/** Accept work immediately, but build each request after the previous save settles. */
export function createSerialTaskQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const result = tail.then(work)
      tail = result.catch(() => {})
      return result
    },
    async flush(): Promise<void> {
      let pending: Promise<unknown>
      do { pending = tail; await pending } while (pending !== tail)
    },
  }
}
