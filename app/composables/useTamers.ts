import type { Tamer } from '../server/db/schema'

export interface CreateTamerData {
  name: string
  age: number
  campaignLevel: 'standard' | 'enhanced' | 'extreme'
  attributes: {
    agility: number
    body: number
    charisma: number
    intelligence: number
    willpower: number
  }
  skills: {
    dodge: number
    fight: number
    stealth: number
    athletics: number
    endurance: number
    featsOfStrength: number
    manipulate: number
    perform: number
    persuasion: number
    computer: number
    survival: number
    knowledge: number
    perception: number
    decipherIntent: number
    bravery: number
  }
  aspects?: Tamer['aspects']
  torments?: Tamer['torments']
  xp?: number
  inspiration?: number
  notes?: string
  spriteUrl?: string
}

export function useTamers() {
  const tamers = ref<Tamer[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchTamers() {
    loading.value = true
    error.value = null
    try {
      tamers.value = await $fetch<Tamer[]>('/api/tamers')
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tamers'
      console.error('Failed to fetch tamers:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchTamer(id: string): Promise<Tamer | null> {
    loading.value = true
    error.value = null
    try {
      return await $fetch<Tamer>(`/api/tamers/${id}`)
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch tamer'
      console.error('Failed to fetch tamer:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createTamer(data: CreateTamerData): Promise<Tamer | null> {
    loading.value = true
    error.value = null
    try {
      const newTamer = await $fetch<Tamer>('/api/tamers', {
        method: 'POST',
        body: data,
      })
      tamers.value = [...tamers.value, newTamer]
      return newTamer
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create tamer'
      console.error('Failed to create tamer:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateTamer(id: string, data: Partial<Tamer>): Promise<Tamer | null> {
    loading.value = true
    error.value = null
    try {
      const updated = await $fetch<Tamer>(`/api/tamers/${id}`, {
        method: 'PUT',
        body: data,
      })
      tamers.value = tamers.value.map((t) => (t.id === id ? updated : t))
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update tamer'
      console.error('Failed to update tamer:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteTamer(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/tamers/${id}`, { method: 'DELETE' })
      tamers.value = tamers.value.filter((t) => t.id !== id)
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete tamer'
      console.error('Failed to delete tamer:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  // Derived stat calculations
  function calculateDerivedStats(tamer: Tamer) {
    const { attributes, skills } = tamer
    return {
      woundBoxes: Math.max(2, attributes.body + skills.endurance),
      speed: attributes.agility + skills.survival,
      accuracyPool: attributes.agility + skills.fight,
      dodgePool: attributes.agility + skills.dodge,
      armor: attributes.body + skills.endurance,
      damage: attributes.body + skills.fight,
      maxInspiration: Math.max(1, attributes.willpower),
    }
  }

  return {
    tamers,
    loading,
    error,
    fetchTamers,
    fetchTamer,
    createTamer,
    updateTamer,
    deleteTamer,
    calculateDerivedStats,
  }
}
