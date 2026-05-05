export function useMapRotation(encounterId: Ref<string | null>) {
  const rotation = ref(Math.PI / 4)  // default 45° isometric

  function storageKey(id: string) { return `map-rotation-${id}` }

  function loadRotation() {
    if (!encounterId.value) return
    try {
      const stored = localStorage.getItem(storageKey(encounterId.value))
      if (stored !== null) rotation.value = parseFloat(stored)
    } catch { /* SSR or localStorage unavailable */ }
  }

  function saveRotation(angle: number) {
    rotation.value = angle
    if (!encounterId.value) return
    try {
      localStorage.setItem(storageKey(encounterId.value), String(angle))
    } catch { /* ignore */ }
  }

  watch(encounterId, loadRotation, { immediate: true })

  return { rotation, saveRotation }
}
