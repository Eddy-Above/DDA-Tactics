import assert from 'node:assert/strict'
import { test } from 'node:test'
import { loadTypeScript, loadVueComponent } from './helpers/loadTypeScript.mjs'
import { createSSRApp, ref, watch } from 'vue'
import { renderToString } from '@vue/server-renderer'

test('blocked legacy images use a local placeholder without retries or saved-record changes', () => {
  const { applyImageFallback, IMAGE_FALLBACK } = loadTypeScript('utils/imageFallback.ts')
  const stored = { spriteUrl: 'http://legacy.example/sprite.png' }
  const image = { src: stored.spriteUrl, getAttribute() { return this.src } }
  assert.equal(applyImageFallback(image), true)
  assert.equal(image.src, IMAGE_FALLBACK)
  assert.ok(image.src.startsWith('data:image/svg+xml,'))
  assert.equal(applyImageFallback(image), false, 'a blocked placeholder must not create an error loop')
  assert.equal(stored.spriteUrl, 'http://legacy.example/sprite.png')
})

test('saved URLs require absolute HTTPS, with an explicit exception for generated previews', () => {
  const { displayImageUrl, IMAGE_FALLBACK } = loadTypeScript('utils/imageFallback.ts')
  for (const url of ['http://legacy.example/a.png', '//example.com/a.png', '/private', 'javascript:alert(1)', 'https://user:pass@example.com/a.png', undefined]) {
    assert.equal(displayImageUrl(url), IMAGE_FALLBACK)
  }
  assert.equal(displayImageUrl('https://example.com/sprite.png'), 'https://example.com/sprite.png')
  assert.equal(displayImageUrl('data:image/png;base64,AA=='), IMAGE_FALLBACK)
  assert.equal(displayImageUrl('data:image/png;base64,AA==', true), 'data:image/png;base64,AA==')
  assert.equal(displayImageUrl('blob:https://example.com/preview', true), 'blob:https://example.com/preview')
})

test('the real sprite component renders legacy images as a fallback and preserves HTTPS sprites', async () => {
  Object.assign(globalThis, { ref, watch })
  const SpritePreview = loadVueComponent('components/SpritePreview.vue')
  const legacy = await renderToString(createSSRApp(SpritePreview, { modelValue: 'http://legacy.example/sprite.png' }))
  assert.ok(!legacy.includes('http://legacy.example'), 'invalid legacy URL never enters the rendered document')
  assert.ok(legacy.includes('data:image/svg+xml,'))
  const secure = await renderToString(createSSRApp(SpritePreview, { modelValue: 'https://example.com/sprite.png' }))
  assert.ok(secure.includes('https://example.com/sprite.png'))
})
