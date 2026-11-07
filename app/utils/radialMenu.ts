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
