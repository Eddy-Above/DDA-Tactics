import { eq } from 'drizzle-orm'
import { db, campaigns } from '../../../db'
import { MAX_SCENE_PRESETS, type ScenePreset } from '../../../../types'

interface UpdateScenePresetsBody {
  presets: Array<Partial<ScenePreset>>
}

// GM prep data only. Deliberately not broadcast: the campaign room includes players,
// and these are scenes they haven't been shown yet.
export default defineEventHandler(async (event) => {
  const campaignId = getRouterParam(event, 'id')
  if (!campaignId) {
    throw createError({ statusCode: 400, message: 'Campaign ID is required' })
  }

  const body = await readBody<UpdateScenePresetsBody>(event)
  if (!Array.isArray(body?.presets) || body.presets.length > MAX_SCENE_PRESETS) {
    throw createError({ statusCode: 400, message: `presets must be an array of at most ${MAX_SCENE_PRESETS} scenes` })
  }

  // Not trimmed: the editor autosaves while the GM is still typing.
  const presets: ScenePreset[] = body.presets.map(p => ({
    imageUrl: String(p?.imageUrl ?? '').slice(0, 2048),
    caption: String(p?.caption ?? '').slice(0, 300),
  }))

  const [existing] = await db.select().from(campaigns).where(eq(campaigns.id, campaignId))
  if (!existing) {
    throw createError({ statusCode: 404, message: 'Campaign not found' })
  }

  await db.update(campaigns)
    .set({ scenePresets: presets })
    .where(eq(campaigns.id, campaignId))

  return { presets }
})
