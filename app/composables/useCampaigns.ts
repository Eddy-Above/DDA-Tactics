import type { Campaign } from '../types'

export interface CreateCampaignData {
  name: string
  description?: string
  level?: 'standard' | 'enhanced' | 'extreme'
  password?: string
  dmPassword?: string
}

export function useCampaigns() {
  const campaigns = ref<Campaign[]>([])
  const currentCampaign = ref<Campaign | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchCampaigns() {
    loading.value = true
    error.value = null
    try {
      campaigns.value = await $fetch<Campaign[]>('/api/campaigns')
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch campaigns'
      console.error('Failed to fetch campaigns:', e)
    } finally {
      loading.value = false
    }
  }

  async function fetchCampaign(id: string): Promise<Campaign | null> {
    loading.value = true
    error.value = null
    try {
      const campaign = await $fetch<Campaign>(`/api/campaigns/${id}`)
      currentCampaign.value = campaign
      return campaign
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to fetch campaign'
      console.error('Failed to fetch campaign:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function createCampaign(data: CreateCampaignData): Promise<Campaign | null> {
    loading.value = true
    error.value = null
    try {
      const newCampaign = await $fetch<Campaign>('/api/campaigns', {
        method: 'POST',
        body: data,
      })
      campaigns.value = [...campaigns.value, newCampaign]
      return newCampaign
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to create campaign'
      console.error('Failed to create campaign:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function updateCampaign(id: string, data: Partial<Campaign & { password?: string | null; dmPassword?: string | null }>): Promise<Campaign | null> {
    loading.value = true
    error.value = null
    try {
      const updated = await $fetch<Campaign>(`/api/campaigns/${id}`, {
        method: 'PUT',
        body: data,
      })
      campaigns.value = campaigns.value.map(c => c.id === id ? updated : c)
      if (currentCampaign.value?.id === id) currentCampaign.value = updated
      return updated
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to update campaign'
      console.error('Failed to update campaign:', e)
      return null
    } finally {
      loading.value = false
    }
  }

  async function deleteCampaign(id: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      await $fetch(`/api/campaigns/${id}`, { method: 'DELETE' })
      campaigns.value = campaigns.value.filter(c => c.id !== id)
      if (currentCampaign.value?.id === id) currentCampaign.value = null
      return true
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to delete campaign'
      console.error('Failed to delete campaign:', e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function verifyCampaignPassword(id: string, password: string): Promise<boolean> {
    try {
      const result = await $fetch<{ valid: boolean }>(`/api/campaigns/${id}/verify-password`, {
        method: 'POST',
        body: { password },
      })
      return result.valid
    } catch (e) {
      console.error('Failed to verify campaign password:', e)
      return false
    }
  }

  async function verifyDmPassword(id: string, password: string): Promise<boolean> {
    try {
      const result = await $fetch<{ valid: boolean }>(`/api/campaigns/${id}/verify-dm-password`, {
        method: 'POST',
        body: { password },
      })
      return result.valid
    } catch (e) {
      console.error('Failed to verify DM password:', e)
      return false
    }
  }

  return {
    campaigns,
    currentCampaign,
    loading,
    error,
    fetchCampaigns,
    fetchCampaign,
    createCampaign,
    updateCampaign,
    deleteCampaign,
    verifyCampaignPassword,
    verifyDmPassword,
  }
}
