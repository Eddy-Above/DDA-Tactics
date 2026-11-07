export interface RadialPoint { x: number; y: number }
export interface RadialArc { start: number; sweep: number }

export function radialPoint(radius: number, angle: number): RadialPoint {
  const radians = angle * Math.PI / 180
  return { x: radius * Math.cos(radians), y: radius * Math.sin(radians) }
}

/** SVG's two arcs keep the whole wedge clickable, including its curved corners. */
export function radialSectorPath(inner: number, outer: number, start: number, end: number): string {
  const a = radialPoint(outer, start)
  const b = radialPoint(outer, end)
  const c = radialPoint(inner, end)
  const d = radialPoint(inner, start)
  const large = end - start > 180 ? 1 : 0
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`
}

/** Find the widest inward-facing fan without moving its centre off the token. */
export function fitRadialArc(center: RadialPoint, bounds: { width: number; height: number }, radius: number): RadialArc {
  const margin = 10
  const step = 3
  const slots = 360 / step
  const valid = Array.from({ length: slots }, (_, i) => {
    const p = radialPoint(radius, i * step)
    return center.x + p.x >= margin && center.x + p.x <= bounds.width - margin
      && center.y + p.y >= margin && center.y + p.y <= bounds.height - margin
  })
  if (valid.every(Boolean)) return { start: -240, sweep: 300 }
  let bestStart = 0
  let bestLength = 0
  let length = 0
  for (let i = 0; i < slots * 2; i++) {
    length = valid[i % slots] ? Math.min(length + 1, slots) : 0
    if (length > bestLength) {
      bestLength = length
      bestStart = i - length + 1
    }
  }
  if (bestLength < 12) {
    // A very small viewport still gets an inward-facing, usable fan.
    const inward = Math.atan2(bounds.height / 2 - center.y, bounds.width / 2 - center.x) * 180 / Math.PI
    return { start: inward - 24, sweep: 48 }
  }
  const sweep = Math.min(300, (bestLength - 1) * step)
  return { start: bestStart * step + ((bestLength - 1) * step - sweep) / 2, sweep }
}

export function wrapRadialLabel(label: string, limit = 13, maxLines = 3): string[] {
  const words = label.trim().split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    if (line && `${line} ${word}`.length > limit) { lines.push(line); line = '' }
    if (word.length > limit) {
      if (line) { lines.push(line); line = '' }
      let rest = word
      while (rest.length > limit) { lines.push(rest.slice(0, limit - 1) + '–'); rest = rest.slice(limit - 1) }
      line = rest
    } else line = line ? `${line} ${word}` : word
  }
  if (line) lines.push(line)
  if (lines.length > maxLines) {
    lines.length = maxLines
    lines[maxLines - 1] = lines[maxLines - 1].slice(0, limit - 1) + '…'
  }
  return lines
}

/** Whole tags are packed onto lines; the last allowed line ends in an ellipsis when tags remain. */
export function wrapRadialTags(tags: string[], limit = 17, maxLines = 2): string[] {
  const lines: string[] = []
  let line = ''
  for (const tag of tags.map(tag => tag.trim()).filter(Boolean)) {
    if (line && `${line} · ${tag}`.length > limit) { lines.push(line); line = tag }
    else line = line ? `${line} · ${tag}` : tag
  }
  if (line) lines.push(line)
  const clipped = lines.length > maxLines
  if (clipped) lines.length = maxLines
  return lines.map((text, index) => {
    const last = clipped && index === maxLines - 1
    return text.length > limit || last ? text.slice(0, limit - 1).trimEnd() + '…' : text
  })
}

export type RadialRowKind = 'current' | 'label' | 'meta' | 'effect' | 'tags'
export interface RadialRow { kind: RadialRowKind; text: string; x?: number; y: number }
export interface RadialSectorGeometry { inner: number; outer: number; start: number; end: number }
export type RadialTextMeasure = (text: string, kind: RadialRowKind) => { width: number; ascent: number; descent: number }
export interface RadialRowItem {
  label: string
  active?: boolean
  range?: string
  aoe?: string
  effect?: string
  tags?: string[]
}

const ROW_HEIGHT: Record<RadialRowKind, number> = { current: 9, label: 12, meta: 10, effect: 11, tags: 9.5 }
const FONT_SIZE: Record<RadialRowKind, number> = { current: 7, label: 10.5, meta: 8.5, effect: 9, tags: 8 }
type DetailRow = Omit<RadialRow, 'x' | 'y'>

const fallbackTextMeasure: RadialTextMeasure = (text, kind) => ({
  width: text.length * FONT_SIZE[kind] * 0.62,
  ascent: FONT_SIZE[kind] * 0.8,
  descent: FONT_SIZE[kind] * 0.2,
})

/** Safe x intervals for an entire horizontal glyph band inside an annular sector. */
function sectorTextIntervals(geometry: RadialSectorGeometry, top: number, bottom: number): Array<[number, number]> {
  const inset = 3
  const outer = geometry.outer - inset
  const inner = geometry.inner + inset
  const maxY = Math.max(Math.abs(top), Math.abs(bottom))
  if (maxY >= outer) return []
  const outerX = Math.sqrt(outer * outer - maxY * maxY)
  let left = -outerX
  let right = outerX
  const start = geometry.start * Math.PI / 180
  const end = geometry.end * Math.PI / 180
  // cross(startDirection, point) >= inset; cross(point, endDirection) >= inset.
  // Each is linear, so its worst y is one endpoint of the glyph band.
  for (const [a, b] of [[-Math.sin(start), Math.cos(start)], [Math.sin(end), -Math.cos(end)]]) {
    const remaining = inset - Math.min(b * top, b * bottom)
    if (Math.abs(a) < 1e-10) {
      if (remaining > 1e-8) return []
    } else if (a > 0) left = Math.max(left, remaining / a)
    else right = Math.min(right, remaining / a)
  }
  if (left >= right) return []
  const minY = top <= 0 && bottom >= 0 ? 0 : Math.min(Math.abs(top), Math.abs(bottom))
  if (minY >= inner) return [[left, right]]
  const innerX = Math.sqrt(inner * inner - minY * minY)
  return [[left, Math.min(right, -innerX)], [Math.max(left, innerX), right]]
    .filter(([a, b]) => b > a) as Array<[number, number]>
}

function fitRowText(text: string, kind: RadialRowKind, width: number, measure: RadialTextMeasure): string | null {
  if (measure(text, kind).width <= width) return text
  if (measure('…', kind).width > width) return null
  const source = text.replace(/…$/, '').trimEnd()
  let low = 0
  let high = source.length
  while (low < high) {
    const middle = Math.ceil((low + high) / 2)
    if (measure(source.slice(0, middle).trimEnd() + '…', kind).width <= width) low = middle
    else high = middle - 1
  }
  return source.slice(0, low).trimEnd() + '…'
}

function fitSectorRows(rows: DetailRow[], geometry: RadialSectorGeometry, measure: RadialTextMeasure): RadialRow[] | null {
  const center = radialPoint((geometry.inner + geometry.outer) / 2, (geometry.start + geometry.end) / 2)
  const metrics = rows.map(row => measure(row.text, row.kind))
  const heights = rows.map((row, index) => Math.max(ROW_HEIGHT[row.kind], metrics[index].ascent + metrics[index].descent + 1))
  let top = -heights.reduce((sum, height) => sum + height, 0) / 2
  const fitted: RadialRow[] = []
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index]
    const metric = metrics[index]
    const y = top + (heights[index] - metric.ascent - metric.descent) / 2 + metric.ascent
    top += heights[index]
    const intervals = sectorTextIntervals(geometry, center.y + y - metric.ascent, center.y + y + metric.descent)
    // Prefer a segment that keeps the text whole, then the widest one. Most sectors
    // have only one segment; the two choices matter when a glyph band crosses the hole.
    intervals.sort((a, b) => {
      const aw = a[1] - a[0], bw = b[1] - b[0]
      const aFits = aw >= metric.width, bFits = bw >= metric.width
      if (aFits !== bFits) return aFits ? -1 : 1
      if (!aFits && Math.abs(aw - bw) > 1e-8) return bw - aw
      const distance = ([left, right]: [number, number]) => Math.max(left - center.x, center.x - right, 0)
      return distance(a) - distance(b)
    })
    const interval = intervals[0]
    if (!interval) return null
    const text = fitRowText(row.text, row.kind, interval[1] - interval[0], measure)
    if (!text) return null
    const halfWidth = measure(text, row.kind).width / 2
    const x = Math.max(interval[0] + halfWidth, Math.min(interval[1] - halfWidth, center.x)) - center.x
    fitted.push({ ...row, text, x, y })
  }
  return fitted
}

function fitDetailRows(rows: DetailRow[], item: RadialRowItem, geometry: RadialSectorGeometry, measure: RadialTextMeasure): RadialRow[] {
  const remaining = [...rows]
  for (;;) {
    const fitted = fitSectorRows(remaining, geometry, measure)
    if (fitted) return fitted
    // A narrow fan has less vertical space than the nominal ring thickness.
    // Keep a named, selectable attack while removing the least essential rows.
    const tags = remaining.map(row => row.kind).lastIndexOf('tags')
    if (tags >= 0) { remaining.splice(tags, 1); continue }
    const names = remaining.filter(row => row.kind === 'label')
    if (names.length > 1) {
      const first = remaining.findIndex(row => row.kind === 'label')
      remaining.splice(first, names.length, { kind: 'label', text: item.label })
      continue
    }
    const meta = remaining.filter(row => row.kind === 'meta')
    if (meta.length > 1) {
      const first = remaining.findIndex(row => row.kind === 'meta')
      remaining.splice(first, meta.length, { kind: 'meta', text: meta.map(row => row.text).join(' · ') })
      continue
    }
    const extra = remaining.findIndex(row => row.kind !== 'label')
    if (extra >= 0) { remaining.splice(extra, 1); continue }
    // Every menu sector (at least ~22 degrees wide) can contain one name row.
    // For an unusably small caller-provided sector, report the invalid layout
    // rather than silently return an invisible, nameless choice.
    throw new RangeError('Radial sector is too small to display an attack name')
  }
}

/**
 * Stacked, vertically centred text rows for an outer-ring choice that carries attack
 * details (range type, AoE type, effect, tags). Returns null for plain choices, which
 * keep the original label-only layout.
 */
export function radialDetailRows(item: RadialRowItem, geometry?: RadialSectorGeometry, measure: RadialTextMeasure = fallbackTextMeasure): RadialRow[] | null {
  const metaParts = [item.range, item.aoe].filter((part): part is string => !!part)
  const meta = metaParts.join(' · ')
  const effect = item.effect?.trim()
  const tags = (item.tags ?? []).filter(tag => tag.trim())
  if (!meta && !effect && !tags.length) return null
  const rows: DetailRow[] = []
  if (item.active) rows.push({ kind: 'current', text: '✓ CURRENT' })
  // The name gives up its third line so the block stays inside the 80px ring.
  for (const text of wrapRadialLabel(item.label, 15, 2)) rows.push({ kind: 'label', text })
  // Range and AoE type share a row unless the pair (e.g. "Ranged · Close Blast") is too wide.
  if (meta) for (const text of meta.length > 17 ? metaParts : [meta]) rows.push({ kind: 'meta', text })
  if (effect) rows.push({ kind: 'effect', text: wrapRadialLabel(effect, 15, 1)[0] })
  for (const text of wrapRadialTags(tags, 17, effect ? 1 : 2)) rows.push({ kind: 'tags', text })
  if (geometry) return fitDetailRows(rows, item, geometry, measure)
  let top = -rows.reduce((sum, row) => sum + ROW_HEIGHT[row.kind], 0) / 2
  return rows.map(row => {
    const y = top + ROW_HEIGHT[row.kind] * 0.8
    top += ROW_HEIGHT[row.kind]
    return { ...row, y }
  })
}
