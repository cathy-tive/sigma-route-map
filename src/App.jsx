import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet-polylinedecorator'
import {
  client,
  useConfig,
  useElementColumns,
  usePaginatedElementData,
} from '@sigmacomputing/plugin'

// Sigma serves paginated element data in fixed-size chunks of this many rows.
const PAGE_SIZE = 25000

// Categorical palettes (static dropdown). Event types map to slots in order.
const PALETTES = {
  Default: [
    '#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f',
    '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac',
  ],
  'Colorblind-safe': [
    '#e69f00', '#56b4e9', '#009e73', '#f0e442', '#0072b2', '#d55e00', '#cc79a7', '#999999',
  ],
  Warm: [
    '#b30000', '#e34a33', '#fc8d59', '#fdbb84', '#fdd49e',
    '#d7301f', '#ef6548', '#f16913', '#cc4c02', '#7f0000',
  ],
  Cool: [
    '#08519c', '#3182bd', '#6baed6', '#9ecae1', '#41ab5d',
    '#74c476', '#238b45', '#54278f', '#756bb1', '#006d2c',
  ],
}
const PALETTE_OPTIONS = Object.keys(PALETTES)
const DEFAULT_PALETTE = PALETTES.Default

// Distinct glyphs assigned to event types in order (legend maps glyph → type).
const SYMBOLS = ['●', '▲', '■', '◆', '★', '✚', '✦', '▼', '⬢', '◗']

// Line-style dropdown → SVG dashArray.
const LINE_STYLES = { Solid: null, Dashed: '10 8', Dotted: '2 7' }
const LINE_STYLE_OPTIONS = Object.keys(LINE_STYLES)

const HERE_STYLES = {
  'HERE Day': 'explore.day',
  'HERE Night': 'explore.night',
  'HERE Satellite': 'satellite.day',
  'HERE Satellite + roads': 'explore.satellite.day',
}
const BASEMAP_OPTIONS = ['OpenStreetMap', ...Object.keys(HERE_STYLES)]

// Editor panel — declared once at load, never re-declared at runtime (writing
// config from a plugin makes Sigma reload the element = infinite loop).
const BASE_CONFIG = [
  { name: 'points', type: 'element' },
  { name: 'latitude', type: 'column', source: 'points', allowMultiple: false },
  { name: 'longitude', type: 'column', source: 'points', allowMultiple: false },
  { name: 'shipmentId', type: 'column', source: 'points', allowMultiple: false },
  { name: 'order', type: 'column', source: 'points', allowMultiple: false },
  { name: 'eventType', type: 'column', source: 'points', allowMultiple: false },
  { name: 'tooltip', type: 'column', source: 'points', allowMultiple: true },
  { name: 'Geofences', type: 'group' },
  { name: 'geofences', type: 'element' },
  { name: 'geofenceGeometry', type: 'column', source: 'geofences', allowMultiple: false },
  { name: 'geofenceLabel', type: 'column', source: 'geofences', allowMultiple: false },
  { name: 'geofenceCategory', type: 'column', source: 'geofences', allowMultiple: false },
  { name: 'Line & markers', type: 'group' },
  { name: 'lineStyle', type: 'dropdown', values: LINE_STYLE_OPTIONS, defaultValue: 'Solid' },
  { name: 'lineColor', type: 'color' },
  { name: 'showArrows', type: 'toggle', defaultValue: true },
  { name: 'colorPalette', type: 'dropdown', values: PALETTE_OPTIONS, defaultValue: 'Default' },
  { name: 'Marker symbols', type: 'group' },
  {
    name: 'eventSymbols',
    type: 'text',
    multiline: true,
    label: 'Symbol per event type — one per line (e.g. Temp excursion=🌡)',
    placeholder: 'Temp excursion=🌡\nDelay=⏱\nDelivered=✓',
  },
  { name: 'Base map', type: 'group' },
  { name: 'basemap', type: 'dropdown', values: BASEMAP_OPTIONS, defaultValue: 'OpenStreetMap' },
  {
    name: 'hereApiKey',
    type: 'text',
    secure: true,
    placeholder: 'HERE API key (required for HERE basemaps)',
  },
  { name: 'Legend', type: 'group' },
  { name: 'showLegendHeader', type: 'toggle', defaultValue: true },
  {
    name: 'legendTitle',
    type: 'text',
    placeholder: 'Header text (defaults to "Events")',
  },
]

client.config.configureEditorPanel(BASE_CONFIG)

const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch],
  )

function toNumber(v) {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}

// A sortable key for the ordering column: number, else parsed date, else null
// (falls back to row order).
function toOrdKey(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return v
  const t = Date.parse(v)
  if (!Number.isNaN(t)) return t
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function makeBaseLayer(basemap, apiKey) {
  const style = HERE_STYLES[basemap]
  if (style && apiKey) {
    return L.tileLayer(
      `https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png?size=256&style=${style}&apiKey=${encodeURIComponent(
        apiKey,
      )}`,
      { maxZoom: 20, maxNativeZoom: 20, attribution: '&copy; HERE Technologies' },
    )
  }
  return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    maxNativeZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  })
}

// Teardrop pin, colored by category, with a glyph and an optional count badge.
function pinIcon(color, glyph, count) {
  const badge = count > 1 ? `<span class="route-pin-badge">${count}</span>` : ''
  const html =
    `<div class="route-pin">` +
    `<svg viewBox="0 0 28 38"><path d="M14 0C6.3 0 0 6.3 0 14c0 10.5 14 24 14 24s14-13.5 14-24C28 6.3 21.7 0 14 0z" fill="${color}" stroke="#fff" stroke-width="2"/></svg>` +
    `<span class="route-pin-glyph">${glyph || ''}</span>${badge}</div>`
  return L.divIcon({
    className: 'route-pin-wrap',
    html,
    iconSize: [28, 38],
    iconAnchor: [14, 38],
    tooltipAnchor: [0, -34],
  })
}

// Minimal WKT → GeoJSON Feature (POINT / POLYGON / MULTIPOLYGON) as a fallback
// for when Sigma hands a GEOGRAPHY column over as WKT instead of GeoJSON.
function wktToFeature(wkt) {
  const s = String(wkt).trim()
  const up = s.toUpperCase()
  const ring = (str) =>
    str
      .trim()
      .split(',')
      .map((pair) => pair.trim().split(/\s+/).map(Number))
  if (up.startsWith('POINT')) {
    const m = s.match(/\(([^)]*)\)/)
    if (!m) return null
    const [x, y] = m[1].trim().split(/\s+/).map(Number)
    return { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [x, y] } }
  }
  if (up.startsWith('MULTIPOLYGON')) {
    const polys = [...s.matchAll(/\(\(\(([\s\S]*?)\)\)\)/g)]
    // fall through to a simpler ring grab if the strict pattern misses
    const rings = [...s.matchAll(/\(([^()]+)\)/g)].map((mm) => ring(mm[1]))
    if (!rings.length) return null
    return {
      type: 'Feature',
      properties: {},
      geometry: { type: 'MultiPolygon', coordinates: polys.length ? [[rings[0]]] : [[rings[0]]] },
    }
  }
  if (up.startsWith('POLYGON')) {
    const rings = [...s.matchAll(/\(([^()]+)\)/g)].map((mm) => ring(mm[1]))
    if (!rings.length) return null
    return { type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } }
  }
  return null
}

// Normalize a geofence geometry cell into a GeoJSON Feature. Accepts a GeoJSON
// object, a GeoJSON string, or a WKT string. Circles keep their radius only in
// the GeoJSON form (`properties.radius`); a bare point renders as a small dot.
function parseGeofence(cell) {
  if (cell == null) return null
  if (typeof cell === 'object') {
    if (cell.type === 'Feature' && cell.geometry) return cell
    if (cell.type && cell.coordinates) return { type: 'Feature', geometry: cell, properties: {} }
    return null
  }
  const s = String(cell).trim()
  if (s.startsWith('{')) {
    try {
      const obj = JSON.parse(s)
      if (obj.type === 'Feature' && obj.geometry) return obj
      if (obj.type && obj.coordinates) return { type: 'Feature', geometry: obj, properties: {} }
      return null
    } catch {
      return null
    }
  }
  return wktToFeature(s)
}

// Build lines (per shipment, stable-sorted) + merged event markers from rows.
// rows: { la, lo, ship, ordKey, ordRaw, etype, tip[] }
function buildRoute(rows) {
  const groups = new Map()
  for (const r of rows) {
    if (!groups.has(r.ship)) groups.set(r.ship, [])
    groups.get(r.ship).push(r)
  }

  const lines = []
  for (const [ship, grp] of groups) {
    grp.sort((a, b) => {
      const ka = a.ordKey == null ? a.idx : a.ordKey
      const kb = b.ordKey == null ? b.idx : b.ordKey
      return ka - kb || a.idx - b.idx // stable tie-break by row order
    })
    lines.push({ ship, coords: grp.map((r) => [r.la, r.lo]) })
  }

  // Events = rows with an event type; merge those at the same place (same
  // shipment + same coordinate, rounded to ~1m) into a single marker with a
  // combined tooltip — regardless of whether their timestamps match.
  const eventTypes = []
  const merged = new Map()
  for (const r of rows) {
    if (!r.etype) continue
    if (!eventTypes.includes(r.etype)) eventTypes.push(r.etype)
    const key = `${r.ship}|${r.la.toFixed(5)}|${r.lo.toFixed(5)}`
    if (!merged.has(key)) merged.set(key, { la: r.la, lo: r.lo, entries: [] })
    merged.get(key).entries.push({ etype: r.etype, tip: r.tip })
  }

  const events = [...merged.values()].map((m) => {
    const tipHtml = m.entries
      .map((e) => {
        const head = `<strong>${esc(e.etype)}</strong>`
        const lines = (e.tip || [])
          .filter((t) => t.value !== null && t.value !== undefined && t.value !== '')
          .map((t) => (t.name ? `${esc(t.name)}: ${esc(t.value)}` : esc(t.value)))
        return [head, ...lines].join('<br>')
      })
      .join('<hr style="margin:4px 0;border:none;border-top:1px solid #e5e7eb">')
    return { la: m.la, lo: m.lo, count: m.entries.length, primaryType: m.entries[0].etype, tipHtml }
  })

  return { lines, events, eventTypes }
}

// ---- demo data (?demo=1) ---------------------------------------------------
const DEMO_ROUTE = [
  { la: 37.77, lo: -122.42, ord: 0, etype: 'Origin', detail: 'San Francisco, CA' },
  { la: 35.37, lo: -119.02, ord: 1, etype: null, detail: '' },
  { la: 34.9, lo: -117.02, ord: 2, etype: null, detail: '' },
  { la: 35.19, lo: -114.05, ord: 3, etype: 'Delay', detail: '2h 15m at Kingman, AZ' },
  { la: 35.2, lo: -111.65, ord: 4, etype: null, detail: '' },
  { la: 35.08, lo: -106.65, ord: 5, etype: 'Temp excursion', detail: '9.2°C for 40 min' },
  { la: 35.08, lo: -106.65, ord: 5, etype: 'Shock', detail: '6.1 G' }, // same time+place → merged
  { la: 35.22, lo: -101.83, ord: 6, etype: null, detail: '' },
  { la: 35.47, lo: -97.52, ord: 7, etype: 'Delivered', detail: 'Oklahoma City, OK' },
]

function demoGeofences() {
  return [
    {
      feature: {
        type: 'Feature',
        properties: { radius: 30000, subType: 'Circle' },
        geometry: { type: 'Point', coordinates: [-122.42, 37.77] },
      },
      label: 'SF Origin Zone',
      category: 'Origin',
    },
    {
      feature: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [[[-97.7, 35.55], [-97.35, 35.55], [-97.35, 35.38], [-97.7, 35.38], [-97.7, 35.55]]],
        },
      },
      label: 'OKC Distribution Center',
      category: 'Destination',
    },
  ]
}

// Page through an element fully (loops loadMore over PAGE_SIZE chunks).
function usePagedElementData(configId) {
  const [data, loadMore] = usePaginatedElementData(configId)
  const requestedRef = useRef(-1)
  const timerRef = useRef(null)
  const [loading, setLoading] = useState(false)

  const count = useMemo(() => {
    const k = data ? Object.keys(data)[0] : null
    return k && data[k] ? data[k].length : 0
  }, [data])

  useEffect(() => {
    requestedRef.current = -1
    setLoading(false)
  }, [configId])

  useEffect(() => {
    if (!configId) return
    if (count > requestedRef.current && count % PAGE_SIZE === 0) {
      requestedRef.current = count
      setLoading(true)
      loadMore()
    } else {
      setLoading(false)
    }
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => setLoading(false), 3000)
    return () => clearTimeout(timerRef.current)
  }, [configId, count, data, loadMore])

  return [data, count, loading]
}

export default function App() {
  const config = useConfig()
  const pointCols = useElementColumns(config.points)
  const geoCols = useElementColumns(config.geofences)
  const [pointData, , pointLoading] = usePagedElementData(config.points)
  const [geoData] = usePagedElementData(config.geofences)

  const isDemo =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

  // Demo-mode overrides for previewing panel settings standalone.
  const demoOverrides = useMemo(() => {
    if (config.points || !isDemo || typeof window === 'undefined') return null
    const p = new URLSearchParams(window.location.search)
    const o = {}
    if (p.has('lineStyle')) o.lineStyle = p.get('lineStyle')
    if (p.has('noarrows')) o.showArrows = false
    if (p.has('palette')) o.colorPalette = p.get('palette')
    if (p.has('basemap')) o.basemap = p.get('basemap')
    if (p.has('here')) o.hereApiKey = p.get('here')
    if (p.has('linecolor')) o.lineColor = '#' + p.get('linecolor')
    if (p.has('sym')) o.eventSymbols = p.get('sym').replace(/;/g, '\n') // e.g. ?sym=Delay=D;Origin=O
    return Object.keys(o).length ? o : null
  }, [config.points, isDemo])

  const cfg = useMemo(
    () => (demoOverrides ? { ...config, ...demoOverrides } : config),
    [config, demoOverrides],
  )

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const baseLayerRef = useRef(null)
  const geofenceLayerRef = useRef(null)
  const routeLayerRef = useRef(null)
  const markerLayerRef = useRef(null)
  const legendRef = useRef(null)
  const fittedRef = useRef(false)

  // ---- reshape points into lines + merged events --------------------------
  const { lines, events, eventTypes, error } = useMemo(() => {
    if (!config.points) {
      if (isDemo) {
        const rows = DEMO_ROUTE.map((r, idx) => ({
          la: r.la,
          lo: r.lo,
          ship: 'S-1001',
          ordKey: r.ord,
          ordRaw: String(r.ord),
          etype: r.etype,
          tip: [{ name: 'Detail', value: r.detail }],
          idx,
        }))
        return { ...buildRoute(rows), error: null }
      }
      return { lines: [], events: [], eventTypes: [], error: 'Select a points table in the panel.' }
    }
    if (!config.latitude || !config.longitude) {
      return { lines: [], events: [], eventTypes: [], error: 'Choose latitude and longitude columns.' }
    }
    const lat = pointData?.[config.latitude]
    const lon = pointData?.[config.longitude]
    if (!lat || !lon) return { lines: [], events: [], eventTypes: [], error: 'Loading data…' }

    const ship = config.shipmentId ? pointData?.[config.shipmentId] : null
    const ord = config.order ? pointData?.[config.order] : null
    const etypeCol = config.eventType ? pointData?.[config.eventType] : null
    const rawTip = Array.isArray(config.tooltip)
      ? config.tooltip
      : config.tooltip
        ? [config.tooltip]
        : []
    const tipCols = rawTip
      .map((raw) => {
        const id = typeof raw === 'string' ? raw : (raw?.id ?? raw?.columnId ?? raw?.name)
        return { id, name: pointCols?.[id]?.name || '', values: pointData?.[id] }
      })
      .filter((c) => c.id && c.values)

    const rows = []
    for (let i = 0; i < lat.length; i++) {
      const la = toNumber(lat[i])
      const lo = toNumber(lon[i])
      if (la === null || lo === null) continue
      if (la < -90 || la > 90 || lo < -180 || lo > 180) continue
      const rawEtype = etypeCol ? etypeCol[i] : null
      const etype = rawEtype === null || rawEtype === undefined || rawEtype === '' ? null : String(rawEtype)
      rows.push({
        la,
        lo,
        ship: ship ? String(ship[i] ?? '') : '_all',
        ordKey: ord ? toOrdKey(ord[i]) : i,
        ordRaw: ord ? String(ord[i] ?? i) : String(i),
        etype,
        tip: tipCols.map((c) => ({ name: c.name, value: c.values[i] })),
        idx: i,
      })
    }
    const built = buildRoute(rows)
    const hasGeom = built.lines.some((l) => l.coords.length) || built.events.length
    return { ...built, error: hasGeom ? null : 'No valid coordinates found.' }
  }, [config, pointData, pointCols, isDemo])

  // ---- reshape geofences --------------------------------------------------
  const geofences = useMemo(() => {
    if (!config.points && isDemo) return demoGeofences()
    if (!config.geofences || !config.geofenceGeometry) return []
    const geom = geoData?.[config.geofenceGeometry]
    if (!geom) return []
    const label = config.geofenceLabel ? geoData?.[config.geofenceLabel] : null
    const cat = config.geofenceCategory ? geoData?.[config.geofenceCategory] : null
    const out = []
    for (let i = 0; i < geom.length; i++) {
      const feature = parseGeofence(geom[i])
      if (!feature) continue
      out.push({
        feature,
        label: label ? String(label[i] ?? '') : '',
        category: cat ? String(cat[i] ?? '') : null,
      })
    }
    return out
  }, [config, geoData, isDemo])

  const palette = PALETTES[cfg.colorPalette] || DEFAULT_PALETTE
  const colorFor = useMemo(() => {
    const m = new Map()
    eventTypes.forEach((t, i) => m.set(t, palette[i % palette.length]))
    return (t) => m.get(t) || palette[0]
  }, [eventTypes, palette])
  // Explicit `Event type=symbol` overrides from the panel (one per line);
  // anything unlisted falls back to an auto-assigned glyph.
  const symbolOverrides = useMemo(() => {
    const m = new Map()
    if (typeof cfg.eventSymbols === 'string') {
      for (const line of cfg.eventSymbols.split(/[\n;]/)) {
        const i = line.indexOf('=')
        if (i > 0) {
          const key = line.slice(0, i).trim()
          const val = line.slice(i + 1).trim()
          if (key && val) m.set(key, val)
        }
      }
    }
    return m
  }, [cfg.eventSymbols])
  const symbolFor = useMemo(() => {
    const m = new Map()
    eventTypes.forEach((t, i) => m.set(t, symbolOverrides.get(t) || SYMBOLS[i % SYMBOLS.length]))
    return (t) => symbolOverrides.get(t) || m.get(t) || SYMBOLS[0]
  }, [eventTypes, symbolOverrides])

  const geoCategories = useMemo(
    () => [...new Set(geofences.map((g) => g.category).filter((c) => c))],
    [geofences],
  )
  const geoColorFor = (cat) => {
    if (!cat) return '#6b7280'
    const i = geoCategories.indexOf(cat)
    return palette[i % palette.length]
  }

  // ---- init map once ------------------------------------------------------
  useEffect(() => {
    if (mapInstance.current || !mapRef.current) return
    const container = mapRef.current
    if (container._leaflet_id != null) container._leaflet_id = undefined
    const map = L.map(container, { worldCopyJump: true, maxZoom: 20 }).setView([39, -98], 4)
    // Geofences sit below the route line (overlayPane=400) and markers (600).
    map.createPane('geofencePane').style.zIndex = 350
    geofenceLayerRef.current = L.layerGroup().addTo(map)
    routeLayerRef.current = L.layerGroup().addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    mapInstance.current = map
    return () => {
      map.remove()
      mapInstance.current = null
    }
  }, [])

  // ---- base tile layer ----------------------------------------------------
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (baseLayerRef.current) {
      baseLayerRef.current.remove()
      baseLayerRef.current = null
    }
    const layer = makeBaseLayer(cfg.basemap, cfg.hereApiKey)
    layer.addTo(map)
    if (layer.bringToBack) layer.bringToBack()
    baseLayerRef.current = layer
    map.setMaxZoom(layer.options.maxNativeZoom ?? layer.options.maxZoom ?? 19)
  }, [cfg.basemap, cfg.hereApiKey])

  // ---- draw geofences -----------------------------------------------------
  useEffect(() => {
    const layer = geofenceLayerRef.current
    if (!layer) return
    layer.clearLayers()
    for (const g of geofences) {
      const color = geoColorFor(g.category)
      const style = { color, weight: 1.5, fillColor: color, fillOpacity: 0.15, pane: 'geofencePane' }
      const gj = L.geoJSON(g.feature, {
        pane: 'geofencePane',
        style: () => style,
        pointToLayer: (feat, latlng) =>
          L.circle(latlng, { radius: feat.properties?.radius || 0, ...style }),
      })
      if (g.label) gj.bindTooltip(g.label, { sticky: true })
      gj.addTo(layer)
    }
  }, [geofences, cfg.colorPalette])

  // ---- draw route lines + arrows + event markers --------------------------
  useEffect(() => {
    const map = mapInstance.current
    const routeLayer = routeLayerRef.current
    const markerLayer = markerLayerRef.current
    if (!map || !routeLayer || !markerLayer) return
    routeLayer.clearLayers()
    markerLayer.clearLayers()

    const lineColor = cfg.lineColor || '#2b6cb0'
    const dash = LINE_STYLES[cfg.lineStyle]
    const bounds = []

    for (const line of lines) {
      line.coords.forEach((c) => bounds.push(c))
      if (line.coords.length < 2) continue
      const pl = L.polyline(line.coords, {
        color: lineColor,
        weight: 3,
        opacity: 0.9,
        dashArray: dash,
      })
      pl.addTo(routeLayer)
      if (cfg.showArrows !== false) {
        L.polylineDecorator(pl, {
          patterns: [
            {
              offset: '8%',
              repeat: '22%', // sparse — ~4 arrows per line
              symbol: L.Symbol.arrowHead({
                pixelSize: 11,
                polygon: false,
                pathOptions: { stroke: true, color: lineColor, weight: 3, opacity: 0.95 },
              }),
            },
          ],
        }).addTo(routeLayer)
      }
    }

    for (const ev of events) {
      const marker = L.marker([ev.la, ev.lo], {
        icon: pinIcon(colorFor(ev.primaryType), symbolFor(ev.primaryType), ev.count),
      })
      if (ev.tipHtml) marker.bindTooltip(ev.tipHtml)
      // Click a pin to zoom in and center on it.
      marker.on('click', () => {
        const target = Math.min(map.getMaxZoom(), Math.max(map.getZoom() + 3, 13))
        map.setView(marker.getLatLng(), target)
      })
      marker.addTo(markerLayer)
    }

    if (!fittedRef.current && bounds.length) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 12 })
      fittedRef.current = true
    }
  }, [lines, events, colorFor, symbolFor, cfg.lineColor, cfg.lineStyle, cfg.showArrows])

  // Re-fit when the source changes.
  useEffect(() => {
    fittedRef.current = false
  }, [config.points])

  // ---- legend -------------------------------------------------------------
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (legendRef.current) {
      legendRef.current.remove()
      legendRef.current = null
    }
    if (!eventTypes.length) return
    const showHeader = cfg.showLegendHeader !== false
    const headerText = cfg.legendTitle || 'Events'
    const legend = L.control({ position: 'bottomright' })
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-legend')
      const header = showHeader ? `<div class="map-legend-header">${esc(headerText)}</div>` : ''
      const rows = eventTypes
        .map(
          (t) =>
            `<div class="legend-row"><span class="legend-glyph" style="color:${colorFor(
              t,
            )}">${symbolFor(t)}</span>${esc(t)}</div>`,
        )
        .join('')
      div.innerHTML = header + `<div class="map-legend-rows">${rows}</div>`
      L.DomEvent.disableScrollPropagation(div)
      L.DomEvent.disableClickPropagation(div)
      return div
    }
    legend.addTo(map)
    legendRef.current = legend
  }, [eventTypes, colorFor, symbolFor, cfg.showLegendHeader, cfg.legendTitle])

  return (
    <>
      <div id="map" ref={mapRef} />
      {pointLoading && <div className="map-loading">Loading route data…</div>}
      {error && !pointLoading && <div className="plugin-message">{error}</div>}
    </>
  )
}
