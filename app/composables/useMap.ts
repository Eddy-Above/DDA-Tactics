import type { GameMap } from '~/types'

export function useMap() {
  const maps = ref<GameMap[]>([])
  const currentMap = ref<GameMap | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchMaps(campaignId: string) {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<GameMap[]>(`/api/maps?campaignId=${campaignId}`)
      maps.value = data
    } catch (e: any) {
      error.value = e.message ?? 'Failed to load maps'
    } finally {
      loading.value = false
    }
  }

  async function fetchMap(mapId: string) {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<GameMap>(`/api/maps/${mapId}`)
      currentMap.value = data
      return data
    } catch (e: any) {
      error.value = e.message ?? 'Failed to load map'
      return null
    } finally {
      loading.value = false
    }
  }

  async function createMap(body: { name: string; description?: string; campaignId: string; dimensions: { width: number; depth: number; height: number } }) {
    const data = await $fetch<GameMap>('/api/maps', { method: 'POST', body })
    maps.value.push(data)
    return data
  }

  async function updateMap(mapId: string, body: Partial<GameMap>) {
    const data = await $fetch<GameMap>(`/api/maps/${mapId}`, { method: 'PUT', body })
    const idx = maps.value.findIndex(m => m.id === mapId)
    if (idx >= 0) maps.value[idx] = data
    if (currentMap.value?.id === mapId) currentMap.value = data
    return data
  }

  async function deleteMap(mapId: string) {
    await $fetch(`/api/maps/${mapId}`, { method: 'DELETE' })
    maps.value = maps.value.filter(m => m.id !== mapId)
    if (currentMap.value?.id === mapId) currentMap.value = null
  }

  return { maps, currentMap, loading, error, fetchMaps, fetchMap, createMap, updateMap, deleteMap }
}
