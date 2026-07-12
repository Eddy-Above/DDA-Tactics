import type { Tamer } from '../server/db/schema'
import type { CreationRules, EddySoulRules } from '../types'

export interface CreateTamerData {
  name: string
  age: number
  campaignId?: string | null
  creationRules?: CreationRules | null
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
  grantedInspiration?: number
  xpBonuses?: Tamer['xpBonuses']
  notes?: string
  spriteUrl?: string
  hidden?: boolean
}

export function useTamers() {
  const tamers = ref<Tamer[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchTamers(campaignId?: string, options?: { sandbox?: boolean }) {
    loading.value = true
    error.value = null
    try {
      const query = options?.sandbox ? '?sandbox=true' : campaignId ? `?campaignId=${campaignId}` : ''
      tamers.value = await $fetch<Tamer[]>(`/api/tamers${query}`)
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
  function calculateDerivedStats(tamer: Tamer, eddySoulRules?: EddySoulRules) {
    const { attributes, skills } = tamer
    const xp = tamer.xpBonuses ?? { attributes: { agility: 0, body: 0, charisma: 0, intelligence: 0, willpower: 0 }, skills: { dodge: 0, fight: 0, stealth: 0, athletics: 0, endurance: 0, featsOfStrength: 0, manipulate: 0, perform: 0, persuasion: 0, computer: 0, survival: 0, knowledge: 0, perception: 0, decipherIntent: 0, bravery: 0 }, inspiration: 0 }
    const totalAttr = (key: keyof TamerAttributes) => attributes[key] + (xp.attributes[key] ?? 0)
    const totalSkill = (key: keyof TamerSkills) => skills[key] + (xp.skills[key] ?? 0)
    return {
      woundBoxes: Math.max(2, totalAttr('body') + totalSkill('endurance')),
      speed: totalAttr('agility') + totalSkill('survival'),
      accuracyPool: eddySoulRules?.accuracyIsAgilityAthletics
        ? totalAttr('agility') + totalSkill('athletics')
        : totalAttr('agility') + totalSkill('fight'),
      dodgePool: totalAttr('agility') + totalSkill('dodge'),
      armor: eddySoulRules?.armorIsWillpowerEndurance
        ? totalAttr('willpower') + totalSkill('endurance')
        : totalAttr('body') + totalSkill('endurance'),
      damage: eddySoulRules?.damageIsBodyFeatsOfStrength
        ? totalAttr('body') + totalSkill('featsOfStrength')
        : totalAttr('body') + totalSkill('fight'),
      maxInspiration: Math.max(1, totalAttr('willpower')),
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
