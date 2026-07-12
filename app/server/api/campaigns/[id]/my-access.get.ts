import { getMyCampaignAccess } from '../../../utils/campaignAuth'

// Single source of truth for "what can the current session do on this
// campaign" — consumed by the campaign-access/dm-access/settings-access
// middleware and the Settings page's Account Access section.
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  return await getMyCampaignAccess(event, id)
})
