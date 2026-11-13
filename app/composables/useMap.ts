import { ref } from 'vue'
import type { GameMap } from '~/types'

export function useMap() {
  const maps = ref<GameMap[]>([])
  const currentMap = ref<GameMap | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  let fetchVersion = 0

  async function fetchMaps(campaignId?: string) {
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<GameMap[]>('/api/maps', { query: campaignId ? { campaignId } : { sandbox: 'true' } })
      maps.value = data
    } catch (e: any) {
      error.value = e.message ?? 'Failed to load maps'
    } finally {
      loading.value = false
    }
  }

  async function fetchMap(mapId: string) {
    const version = ++fetchVersion
    loading.value = true
    error.value = null
    try {
      const data = await $fetch<GameMap>(`/api/maps/${mapId}`)
      if (version === fetchVersion) currentMap.value = data
      return data
    } catch (e: any) {
      if (version === fetchVersion) error.value = e.message ?? 'Failed to load map'
      return null
    } finally {
      if (version === fetchVersion) loading.value = false
    }
  }

  async function createMap(body: { name: string; description?: string; campaignId?: string | null; generateGround?: boolean; dimensions: { width: number; depth: number; height?: number } }) {
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

  // Autosave keeps the editor's newer immutable map root. A compact acknowledgement
  // deliberately does not replace currentMap or the map-list cache with an older snapshot.
  async function updateMapMinimal(mapId: string, body: Partial<GameMap>, clientId?: string) {
    return await $fetch<Pick<GameMap, 'id' | 'updatedAt'>>(`/api/maps/${mapId}?return=minimal`, { method: 'PUT', body, ...(clientId ? { headers: { 'X-Map-Client-Id': clientId } } : {}) })
  }

  async function deleteMap(mapId: string) {
    await $fetch(`/api/maps/${mapId}`, { method: 'DELETE' })
    maps.value = maps.value.filter(m => m.id !== mapId)
    if (currentMap.value?.id === mapId) currentMap.value = null
  }

  return { maps, currentMap, loading, error, fetchMaps, fetchMap, createMap, updateMap, updateMapMinimal, deleteMap }
}
