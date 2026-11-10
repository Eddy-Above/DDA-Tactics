import { applyImageFallback } from '../utils/imageFallback'

export default defineNuxtPlugin(nuxtApp => {
  const onImageError = (event: Event) => {
    if (event.target instanceof HTMLImageElement) applyImageFallback(event.target)
  }
  // Image errors do not bubble, so capture covers every page and token overlay.
  document.addEventListener('error', onImageError, true)
  nuxtApp.vueApp.onUnmount(() => document.removeEventListener('error', onImageError, true))
})
