<template>
  <div
    ref="menuRef"
    class="map-radial"
    :style="{ left: center.x + 'px', top: center.y + 'px', width: diameter + 'px', height: diameter + 'px' }"
    role="menu"
    :aria-label="`${label} actions`"
    @pointerdown.stop
    @pointerup.stop
    @click.stop
    @dblclick.stop
    @contextmenu.stop.prevent
    @wheel.stop
    @keydown.stop="onKeydown"
  >
    <svg :viewBox="`${-extent} ${-extent} ${diameter} ${diameter}`" class="radial-svg" aria-label="Character action wheel">
      <defs>
        <clipPath v-for="sector in childSectors" :id="sector.clipId" :key="sector.clipId" clipPathUnits="userSpaceOnUse">
          <path :d="sector.path" />
        </clipPath>
      </defs>
      <circle class="hub-outline" :r="innerRadius - 6" />
      <g
        v-for="sector in rootSectors"
        :key="sector.item.id"
        class="radial-sector"
        :class="{ selected: branchIds[0] === sector.item.id, active: sector.item.active, disabled: sector.item.disabled }"
        role="menuitem"
        :aria-label="sector.item.label"
        :aria-description="[sector.item.cost, sector.item.description].filter(Boolean).join(' · ')"
        :aria-disabled="!!sector.item.disabled"
        :aria-haspopup="sector.item.children ? 'menu' : undefined"
        :aria-expanded="sector.item.children ? branchIds[0] === sector.item.id : undefined"
        :tabindex="sector.item.disabled ? -1 : 0"
        data-radial-item="root"
        @click="activate(sector.item, 'root', $event)"
        @mouseenter="hover(sector.item)"
        @mouseleave="hover(null)"
        @focus="hover(sector.item)"
        @blur="hover(null)"
      >
        <title>{{ [sector.item.label, sector.item.cost, sector.item.description].filter(Boolean).join(' — ') }}</title>
        <path class="sector-shape" :d="sector.path" />
        <g :transform="`translate(${sector.position.x}, ${sector.position.y})`" class="sector-content">
          <svg v-if="iconPaths[sector.item.icon || '']" x="-9" :y="-13 - sector.lines.length * 4 - (sector.item.cost ? 5 : 0)" width="18" height="18" viewBox="0 0 24 24" class="sector-icon">
            <path :d="iconPaths[sector.item.icon!]" />
          </svg>
          <text v-else-if="sector.item.icon" class="sector-symbol" :y="-sector.lines.length * 4">{{ sector.item.icon }}</text>
          <text class="sector-label" :y="(sector.item.icon ? 11 : 4) - (sector.lines.length - 1) * 6 - (sector.item.cost ? 5 : 0)">
            <tspan v-for="(line, index) in sector.lines" :key="index" x="0" :dy="index ? 12 : 0">{{ line }}</tspan>
          </text>
          <text v-if="sector.item.cost" class="sector-cost" :y="21 + (sector.lines.length - 1) * 6">{{ sector.item.cost }}{{ sector.item.children ? ' ›' : '' }}</text>
          <text v-else-if="sector.item.children" class="branch-indicator" y="31">›</text>
        </g>
      </g>
      <g
        v-for="sector in childSectors"
        :key="`${branchIds.join('/')}:${sector.item.id}`"
        class="radial-sector child-sector"
        :class="{ active: sector.item.active, disabled: sector.item.disabled }"
        role="menuitem"
        :aria-label="sector.item.label"
        :aria-description="[sector.item.cost, sector.item.description].filter(Boolean).join(' · ')"
        :aria-disabled="!!sector.item.disabled"
        :aria-haspopup="sector.item.children ? 'menu' : undefined"
        :tabindex="sector.item.disabled ? -1 : 0"
        data-radial-item="child"
        @click="activate(sector.item, 'child', $event)"
        @mouseenter="hover(sector.item)"
        @mouseleave="hover(null)"
        @focus="hover(sector.item)"
        @blur="hover(null)"
      >
        <title>{{ [sector.item.label, sector.item.cost, sector.item.description].filter(Boolean).join(' — ') }}</title>
        <path class="sector-shape" :d="sector.path" />
        <g :clip-path="sector.rows ? `url(#${sector.clipId})` : undefined">
          <g :transform="`translate(${sector.position.x}, ${sector.position.y})`" class="sector-content">
            <template v-if="sector.rows">
              <text v-for="(row, index) in sector.rows" :key="index" :class="rowClass[row.kind]" :x="row.x ?? 0" :y="row.y">{{ row.text }}</text>
            </template>
            <template v-else>
              <text v-if="sector.item.active" class="choice-current" :y="-9 - sector.lines.length * 5">✓ CURRENT</text>
              <text class="sector-label" :y="4 - (sector.lines.length - 1) * 6">
                <tspan v-for="(line, index) in sector.lines" :key="index" x="0" :dy="index ? 12 : 0">{{ line }}</tspan>
              </text>
              <text v-if="sector.item.children" class="branch-indicator" :y="13 + sector.lines.length * 6">›</text>
            </template>
          </g>
        </g>
      </g>
    </svg>
    <button
      class="radial-hub-button"
      :style="{ top: `calc(50% + ${innerRadius - 31}px)`, maxWidth: (innerRadius * 2 - 16) + 'px' }"
      :aria-label="branchIds.length ? 'Back to previous actions' : 'Close action menu'"
      :title="branchIds.length ? 'Back (Escape)' : 'Close (Escape)'"
      @click="back"
    >
      <span aria-hidden="true">{{ branchIds.length ? '‹' : '×' }}</span>
      {{ branchIds.length ? 'Back' : 'Close' }}
    </button>
    <span class="sr-only" aria-live="polite">{{ branchLabel ? `${branchLabel} choices` : `${label} actions` }}</span>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue'
import type { MapRadialItem } from '~/types/mapRadial'
import { fitRadialArc, radialDetailRows, radialPoint, radialSectorPath, wrapRadialLabel } from '~/utils/radialMenu'
import type { RadialRowKind, RadialTextMeasure } from '~/utils/radialMenu'

const props = defineProps<{
  items: MapRadialItem[]
  center: { x: number; y: number }
  bounds: { width: number; height: number }
  label: string
  tokenRadius?: number
}>()
const emit = defineEmits<{
  (e: 'select', item: MapRadialItem): void
  (e: 'close'): void
  (e: 'hover', item: MapRadialItem | null): void
}>()

const menuRef = ref<HTMLDivElement | null>(null)
const menuId = `map-radial-${useId()}`
const fontRevision = ref(0)
let textContext: CanvasRenderingContext2D | null = null
let fontFamily = 'sans-serif'
let disposed = false
// Keep these in step with the SVG text classes below; measurements include glyph overhangs.
const textStyles: Record<RadialRowKind, { size: number; weight: number; spacing: number }> = {
  current: { size: 7, weight: 700, spacing: .6 },
  label: { size: 10.5, weight: 600, spacing: .05 },
  cost: { size: 8.5, weight: 600, spacing: 0 },
  meta: { size: 8.5, weight: 600, spacing: 0 },
  effect: { size: 9, weight: 700, spacing: 0 },
  tags: { size: 8, weight: 400, spacing: 0 },
}
const textMeasurements = new Map<string, ReturnType<RadialTextMeasure>>()
const measureText: RadialTextMeasure = (text, kind) => {
  const key = `${kind}:${text}`
  const cached = textMeasurements.get(key)
  if (cached) return cached
  const style = textStyles[kind]
  const context = textContext!
  context.font = `${style.weight} ${style.size}px ${fontFamily}`
  context.textAlign = 'center'
  const metrics = context.measureText(text)
  const measurement = {
    width: Math.max(metrics.width, Math.abs(metrics.actualBoundingBoxLeft) * 2, Math.abs(metrics.actualBoundingBoxRight) * 2) + style.spacing * Array.from(text).length,
    ascent: Math.max(metrics.fontBoundingBoxAscent || 0, metrics.actualBoundingBoxAscent, style.size * .95),
    descent: Math.max(metrics.fontBoundingBoxDescent || 0, metrics.actualBoundingBoxDescent, style.size * .3),
  }
  textMeasurements.set(key, measurement)
  return measurement
}
function refreshTextMetrics() {
  if (disposed || typeof document === 'undefined' || !(menuRef.value instanceof HTMLElement)) return
  textContext ??= document.createElement('canvas').getContext('2d')
  fontFamily = getComputedStyle(menuRef.value).fontFamily
  textMeasurements.clear()
  fontRevision.value++
}
const branchIds = ref<string[]>([])
const rootPage = ref(0)
const childPage = ref(0)
const innerRadius = computed(() => Math.max(43, Math.min(70, (props.tokenRadius ?? 28) + 12)))
const rootRadius = computed(() => innerRadius.value + 68)
const outerRadius = computed(() => rootRadius.value + 87)
const extent = computed(() => outerRadius.value + 5)
const diameter = computed(() => extent.value * 2)
const arc = computed(() => fitRadialArc(props.center, props.bounds, outerRadius.value + 2))
const rootCapacity = computed(() => Math.max(2, Math.min(7, Math.floor(arc.value.sweep / 43))))
const childCapacity = computed(() => Math.max(2, Math.min(8, Math.floor(arc.value.sweep / 31))))
const branch = computed(() => {
  let options = props.items
  let selected: MapRadialItem | undefined
  for (const id of branchIds.value) {
    selected = options.find(item => item.id === id)
    if (!selected?.children || selected.disabled) return null
    options = selected.children
  }
  return branchIds.value.length ? { options, selected } : null
})
const branchLabel = computed(() => branch.value?.selected?.label)

function paged(items: MapRadialItem[], page: number, capacity: number): MapRadialItem[] {
  if (items.length <= capacity) return items
  const size = capacity - 1
  const pageCount = Math.ceil(items.length / size)
  const current = page % pageCount
  return [
    ...items.slice(current * size, (current + 1) * size),
    { id: '__radial-more', label: 'More', icon: 'more', description: `Page ${current + 1} of ${pageCount}. Show the next choices.` },
  ]
}

function sectors(items: MapRadialItem[], inner: number, outer: number, start: number, sweep: number, child = false) {
  void fontRevision.value
  const width = sweep / Math.max(1, items.length)
  return items.map((item, index) => {
    const geometry = { inner, outer, start: start + index * width + 1.1, end: start + (index + 1) * width - 1.1 }
    return {
      item,
      clipId: `${menuId}-child-${index}`,
      path: radialSectorPath(inner, outer, geometry.start, geometry.end),
      position: radialPoint((inner + outer) / 2, start + (index + 0.5) * width),
      lines: wrapRadialLabel(item.label, child ? 15 : 11, 3),
      rows: child ? radialDetailRows(item, geometry, textContext ? measureText : undefined) : null,
    }
  })
}
const rowClass: Record<RadialRowKind, string> = {
  current: 'choice-current',
  label: 'sector-label',
  cost: 'sector-cost',
  meta: 'sector-meta',
  effect: 'sector-effect',
  tags: 'sector-tags',
}
const rootSectors = computed(() => {
  const items = paged(props.items, rootPage.value, rootCapacity.value)
  const sweep = Math.min(arc.value.sweep, Math.max(70, items.length * 53))
  return sectors(items, innerRadius.value, rootRadius.value, arc.value.start + (arc.value.sweep - sweep) / 2, sweep)
})
const childSectors = computed(() => {
  if (!branch.value) return []
  const choices = branch.value.options.length ? branch.value.options : [{ id: '__radial-empty', label: 'No choices available', disabled: true }]
  const items = paged(choices, childPage.value, childCapacity.value)
  const sweep = Math.min(arc.value.sweep, Math.max(60, items.length * 43))
  const parent = rootSectors.value.find(sector => sector.item.id === branchIds.value[0])
  const angle = parent ? Math.atan2(parent.position.y, parent.position.x) * 180 / Math.PI : arc.value.start + arc.value.sweep / 2
  // Unwrap the angle into the same turn as the fitted fan before clamping it.
  const unwrapped = angle + 360 * Math.round((arc.value.start + arc.value.sweep / 2 - angle) / 360)
  const start = Math.max(arc.value.start, Math.min(arc.value.start + arc.value.sweep - sweep, unwrapped - sweep / 2))
  return sectors(items, rootRadius.value + 7, outerRadius.value, start, sweep, true)
})

const iconPaths: Record<string, string> = {
  move: 'M12 3v18M3 12h18M8 7l4-4 4 4M8 17l4 4 4-4M7 8l-4 4 4 4M17 8l4 4-4 4',
  attack: 'm5 3 15 15-2 2L3 5V3h2Zm9 13 4-4M4 20l5-5M3 18l3 3',
  stance: 'M12 3 4 6v6c0 5 8 9 8 9s8-4 8-9V6l-8-3ZM12 7v10M8 11h8',
  clash: 'm3 3 7 7m-7 0 7-7m11 0-7 7m0-7 7 7M7 14l3 3-5 5-3-3 5-5Zm10 0 5 5-3 3-5-5 3-3Z',
  'gm-move': 'M4 7h16v13H4V7Zm3 0V4h10v3M8 13h8M12 9v8',
  manage: 'M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6',
  direct: 'M4 4h16v12H9l-5 4V4Zm4 5h8M8 12h5',
  orders: 'M8 4h12v16H8M3 7h2M3 12h2M3 17h2M11 8h6M11 12h6M11 16h4',
  digivolve: 'm12 2 4 7 6 3-6 3-4 7-4-7-6-3 6-3 4-7ZM12 8v8M8 12h8',
  'mode-change': 'M4 8h15l-4-4M20 16H5l4 4M20 8l-4 4M4 16l4-4',
  door: 'M5 21V3h14v18M5 21l10-3V3M11 11v2',
  more: 'm9 5 7 7-7 7',
}

function hover(item: MapRadialItem | null) { emit('hover', item?.disabled ? null : item) }
function focusItems(ring?: 'root' | 'child') {
  return Array.from(menuRef.value?.querySelectorAll<SVGElement>(`[data-radial-item${ring ? `="${ring}"` : ''}]:not([aria-disabled="true"])`) ?? [])
}
async function focusFirst(ring: 'root' | 'child') {
  await nextTick()
  focusItems(ring)[0]?.focus()
}
function activate(item: MapRadialItem, ring: 'root' | 'child', event?: Event) {
  if (item.disabled) return
  if (event?.currentTarget instanceof SVGElement) event.currentTarget.focus()
  if (item.id === '__radial-more') {
    if (ring === 'root') { rootPage.value++; branchIds.value = [] }
    else childPage.value++
    hover(null)
    void focusFirst(ring)
  } else if (item.children) {
    branchIds.value = ring === 'root' ? [item.id] : [...branchIds.value, item.id]
    childPage.value = 0
    hover(null)
    void focusFirst('child')
  } else {
    hover(null)
    emit('select', item)
  }
}
function back() {
  hover(null)
  if (!branchIds.value.length) { emit('close'); return }
  branchIds.value = branchIds.value.slice(0, -1)
  childPage.value = 0
  void focusFirst(branchIds.value.length ? 'child' : 'root')
}
function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' || event.key === 'Backspace') { event.preventDefault(); back(); return }
  const target = event.target as HTMLElement
  const ring = target.dataset?.radialItem === 'child' ? 'child' : 'root'
  const currentSectors = ring === 'child' ? childSectors.value : rootSectors.value
  if (event.key === 'Enter' || event.key === ' ') {
    const current = focusItems(ring).indexOf(target as unknown as SVGElement)
    const item = currentSectors.filter(sector => !sector.item.disabled)[current]?.item
    if (item) { event.preventDefault(); activate(item, ring) }
    return
  }
  if (event.key === 'ArrowLeft' && ring === 'child') { event.preventDefault(); back(); return }
  if (event.key === 'ArrowRight') {
    const sector = currentSectors.find(sector => sector.item.label === target.getAttribute('aria-label'))
    if (sector?.item.children) { event.preventDefault(); activate(sector.item, ring); return }
  }
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
  event.preventDefault()
  const items = focusItems(ring)
  if (!items.length) return
  const index = items.indexOf(target as unknown as SVGElement)
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
    : (index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length
  items[next]?.focus()
}

watch(() => props.items, () => {
  if (branchIds.value.length && !branch.value) { branchIds.value = []; childPage.value = 0 }
})
onMounted(() => {
  refreshTextMetrics()
  if (typeof document !== 'undefined') {
    document.fonts?.addEventListener('loadingdone', refreshTextMetrics)
    void document.fonts?.ready.then(refreshTextMetrics)
  }
  void focusFirst('root')
})
onBeforeUnmount(() => {
  disposed = true
  if (typeof document !== 'undefined') document.fonts?.removeEventListener('loadingdone', refreshTextMetrics)
  hover(null)
})
</script>

<style scoped>
.map-radial { position: absolute; z-index: 40; transform: translate(-50%, -50%); pointer-events: none; user-select: none; }
.radial-svg { display: block; width: 100%; height: 100%; overflow: visible; pointer-events: none; filter: drop-shadow(0 4px 8px #0008); }
.hub-outline { fill: none; stroke: theme('colors.digimon.orange.500'); stroke-width: 2; opacity: .8; }
.radial-sector { pointer-events: visiblePainted; outline: none; cursor: pointer; }
.sector-shape { fill: theme('colors.digimon.dark.800'); stroke: theme('colors.digimon.dark.600'); stroke-width: 1.5; transition: fill .12s, stroke .12s; }
.child-sector .sector-shape { fill: theme('colors.digimon.dark.900'); }
.radial-sector:hover .sector-shape, .radial-sector:focus-visible .sector-shape { fill: theme('colors.digimon.orange.900'); stroke: theme('colors.digimon.orange.400'); stroke-width: 2; }
.radial-sector.selected .sector-shape { fill: theme('colors.digimon.orange.700'); stroke: theme('colors.digimon.orange.400'); stroke-width: 2; }
.radial-sector.active .sector-shape { fill: theme('colors.digimon.orange.950'); stroke: theme('colors.digimon.orange.500'); }
.radial-sector.disabled { cursor: not-allowed; }
.radial-sector.disabled .sector-shape { fill: theme('colors.digimon.dark.900'); stroke: theme('colors.digimon.dark.700'); }
.radial-sector.disabled .sector-content { opacity: .35; }
.radial-sector.disabled:hover .sector-shape { fill: theme('colors.digimon.dark.900'); stroke: theme('colors.digimon.dark.700'); stroke-width: 1.5; }
.radial-sector.active.disabled .sector-shape { fill: theme('colors.digimon.orange.950'); stroke: theme('colors.digimon.orange.500'); }
.radial-sector.active.disabled .sector-content { opacity: .7; }
.sector-content { pointer-events: none; color: theme('colors.digimon.dark.50'); }
.sector-icon { fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.sector-label { fill: theme('colors.digimon.dark.50'); text-anchor: middle; font-family: inherit; font-size: 10.5px; font-weight: 600; letter-spacing: .05px; }
.sector-symbol { fill: theme('colors.digimon.dark.100'); text-anchor: middle; font-size: 18px; }
.branch-indicator { fill: theme('colors.digimon.orange.300'); text-anchor: middle; font-size: 18px; }
.choice-current { fill: theme('colors.digimon.orange.300'); text-anchor: middle; font-size: 7px; font-weight: 700; letter-spacing: .6px; }
.sector-meta { fill: theme('colors.digimon.dark.100'); text-anchor: middle; font-size: 8.5px; font-weight: 600; }
.sector-cost { fill: theme('colors.digimon.orange.300'); text-anchor: middle; font-size: 8.5px; font-weight: 600; }
.sector-effect { fill: theme('colors.digimon.orange.300'); text-anchor: middle; font-size: 9px; font-weight: 700; }
.sector-tags { fill: theme('colors.digimon.dark.200'); text-anchor: middle; font-size: 8px; }
.radial-hub-button { position: absolute; left: 50%; transform: translateX(-50%); display: flex; align-items: center; justify-content: center; gap: 4px; padding: 2px 9px; border: 1px solid theme('colors.digimon.orange.600'); border-radius: 999px; background: theme('colors.digimon.dark.900'); color: theme('colors.digimon.dark.100'); font-size: 9px; font-weight: 600; line-height: 17px; pointer-events: auto; cursor: pointer; }
.radial-hub-button span { font-size: 16px; font-weight: 400; }
.radial-hub-button:hover, .radial-hub-button:focus-visible { outline: 2px solid theme('colors.digimon.orange.400'); outline-offset: 2px; background: theme('colors.digimon.orange.800'); color: white; }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
@media (prefers-reduced-motion: reduce) { .sector-shape { transition: none; } }
</style>
