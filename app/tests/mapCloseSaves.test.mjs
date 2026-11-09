import assert from 'node:assert/strict'
import test from 'node:test'
import { ref } from 'vue'
import { loadPageFunctions } from './helpers/loadTypeScript.mjs'

for (const page of ['encounters/[id]', 'player/[tamerId]']) {
  test(`${page} keeps map view open when saving fails and closes only after a successful flush`, async () => {
    let finish
    const deps = { showMapView: ref(true), mapDirectMode: ref({}), showDirectChoicePicker: ref(true),
      encounterMapRef: ref({ flushMapSaves: () => new Promise(resolve => { finish = resolve }) }) }
    const handlers = loadPageFunctions(`pages/campaigns/[campaignId]/${page}.vue`, ['closeMapView', 'toggleMapView'], deps)
    const failed = handlers.closeMapView()
    assert.equal(deps.showMapView.value, true)
    finish(false)
    assert.equal(await failed, false)
    assert.equal(deps.showMapView.value, true)
    const saved = handlers.toggleMapView()
    assert.equal(deps.showMapView.value, true)
    finish(true)
    await saved
    assert.equal(deps.showMapView.value, false)
    if (page.startsWith('player')) {
      assert.equal(deps.mapDirectMode.value, null)
      assert.equal(deps.showDirectChoicePicker.value, false)
    }
    await handlers.toggleMapView()
    assert.equal(deps.showMapView.value, true)
  })
}
