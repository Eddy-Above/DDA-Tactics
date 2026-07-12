import type { AccountUser } from '../types'

// Module-level (not per-call) so every component sees the same reactive
// identity — mirrors the singleton-ish usage pattern of useCampaignContext.
const user = ref<AccountUser | null>(null)
const loading = ref(false)
const error = ref<string | null>(null)
const initialized = ref(false)

export function useAuth() {
  const isAuthenticated = computed(() => !!user.value)

  async function fetchMe(): Promise<void> {
    try {
      const result = await $fetch<{ user: AccountUser | null }>('/api/auth/me')
      user.value = result.user
    } catch (e) {
      console.error('Failed to fetch current user:', e)
      user.value = null
    } finally {
      initialized.value = true
    }
  }

  async function register(username: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ id: string; username: string }>('/api/auth/register', {
        method: 'POST',
        body: { username, password },
      })
      user.value = { id: result.id, username: result.username }
      return true
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Failed to register'
      return false
    } finally {
      loading.value = false
    }
  }

  async function login(username: string, password: string): Promise<boolean> {
    loading.value = true
    error.value = null
    try {
      const result = await $fetch<{ id: string; username: string }>('/api/auth/login', {
        method: 'POST',
        body: { username, password },
      })
      user.value = { id: result.id, username: result.username }
      return true
    } catch (e: any) {
      error.value = e?.data?.message || e?.message || 'Invalid username or password'
      return false
    } finally {
      loading.value = false
    }
  }

  async function logout(): Promise<void> {
    try {
      await $fetch('/api/auth/logout', { method: 'POST' })
    } finally {
      user.value = null
    }
  }

  async function searchUsers(query: string): Promise<AccountUser[]> {
    if (!query.trim()) return []
    try {
      const result = await $fetch<{ results: AccountUser[] }>('/api/users/search', { query: { q: query } })
      return result.results
    } catch (e) {
      console.error('Failed to search users:', e)
      return []
    }
  }

  return {
    user,
    isAuthenticated,
    loading,
    error,
    initialized,
    fetchMe,
    register,
    login,
    logout,
    searchUsers,
  }
}
