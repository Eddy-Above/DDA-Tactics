// This local placeholder also covers saved HTTP images blocked by the HTTPS CSP.
// Keeping the fallback inline avoids another request and leaves saved URLs intact.
export const IMAGE_FALLBACK = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="12" fill="#1e293b"/><path d="M24 94l27-35 19 23 13-16 21 28z" fill="#94a3b8"/><circle cx="88" cy="39" r="10" fill="#94a3b8"/></svg>')}`

/** Saved external images must be HTTPS; generated local previews opt in explicitly. */
export function displayImageUrl(value: unknown, allowPreview = false): string {
  if (typeof value !== 'string') return IMAGE_FALLBACK
  if (value === IMAGE_FALLBACK) return value
  if (allowPreview && /^(?:blob:|data:image\/(?:png|jpeg|webp|gif);base64,)/i.test(value)) return value
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : IMAGE_FALLBACK
  } catch { return IMAGE_FALLBACK }
}

export function applyImageFallback(image: { src: string; getAttribute(name: string): string | null }): boolean {
  if (image.getAttribute('src') === IMAGE_FALLBACK) return false
  image.src = IMAGE_FALLBACK
  return true
}
