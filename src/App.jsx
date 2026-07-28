import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet-polylinedecorator'
import {
  client,
  useConfig,
  useElementColumns,
  usePaginatedElementData,
} from '@sigmacomputing/plugin'
import { DEMO_EVENTS } from './demoData.js'

// Sigma serves paginated element data in fixed-size chunks of this many rows.
const PAGE_SIZE = 25000

// ---- palette (shared with the timeline plugin / dashboard) ----------------
const C = {
  reached: '#2f5fb0', missed: '#b7c8e6', route: '#3f7ad6',
  red: '#e0483f', blue: '#3b82f6', amber: '#e08a2b',
  purple: '#7c58d6', green: '#5bb587', slate: '#586176', ink: '#1a2233',
}
const COLOR_TOKEN = { red: C.red, blue: C.blue }

// lucide-style line-icon paths (stroke, fill:none unless `fill`)
const G = {
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  thermometer: '<path d="M14 4v10.5a4 4 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/>',
  stop: '<path d="M7.3 2.6h9.4L21.4 7.3v9.4L16.7 21.4H7.3L2.6 16.7V7.3z"/>',
  handoff: '<path d="m16 3 4 4-4 4M20 7H5M8 21l-4-4 4-4M4 17h15"/>',
  load: '<path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8"/>',
  alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
}
const MODE_EMOJI = { Ocean: '🚢', Air: '✈️', Road: '🚚', Rail: '🚆' }
const ANCHOR = '&#9875;'

const HERE_STYLES = {
  'HERE Day': 'explore.day', 'HERE Night': 'explore.night',
  'HERE Satellite': 'satellite.day', 'HERE Satellite + roads': 'explore.satellite.day',
}
const BASEMAP_OPTIONS = ['Carto Light', 'OpenStreetMap', ...Object.keys(HERE_STYLES)]

// Editor panel — declared once (writing config from a plugin reloads the element).
const BASE_CONFIG = [
  { name: 'events', type: 'element' },
  { name: 'shipmentId', type: 'column', source: 'events', allowMultiple: false },
  { name: 'eventType', type: 'column', source: 'events', allowMultiple: false },
  { name: 'order', type: 'column', source: 'events', allowMultiple: false },
  { name: 'latitude', type: 'column', source: 'events', allowMultiple: false },
  { name: 'longitude', type: 'column', source: 'events', allowMultiple: false },
  { name: 'geometry', type: 'column', source: 'events', allowMultiple: false },
  { name: 'label', type: 'column', source: 'events', allowMultiple: false },
  { name: 'status', type: 'column', source: 'events', allowMultiple: false },
  { name: 'Attributes', type: 'group' },
  { name: 'legMode', type: 'column', source: 'events', allowMultiple: false },
  { name: 'legNumber', type: 'column', source: 'events', allowMultiple: false },
  { name: 'waypointNumber', type: 'column', source: 'events', allowMultiple: false },
  { name: 'isContainerPort', type: 'column', source: 'events', allowMultiple: false },
  { name: 'color', type: 'column', source: 'events', allowMultiple: false },
  { name: 'Base map', type: 'group' },
  { name: 'basemap', type: 'dropdown', values: BASEMAP_OPTIONS, defaultValue: 'Carto Light' },
  { name: 'hereApiKey', type: 'text', secure: true, placeholder: 'HERE API key (for HERE basemaps)' },
  { name: 'Options', type: 'group' },
  { name: 'showArrows', type: 'toggle', defaultValue: true },
]
client.config.configureEditorPanel(BASE_CONFIG)

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch])
const toNum = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
const truthy = (v) => v === true || v === 'true' || v === 1 || v === '1'
function parseGeom(cell) {
  if (cell == null) return null
  let o = cell
  if (typeof cell === 'string') { try { o = JSON.parse(cell) } catch { return null } }
  return o && (o.geometry || o) // accept Feature or bare geometry
}

// ---- per-event visual (icon + color) --------------------------------------
function visual(e) {
  const t = e.type
  if (t === 'waypoint') return { bg: C.reached, glyph: G.pin, fill: true }
  if (t === 'failed_waypoint') return { bg: C.missed, glyph: G.pin, fill: true }
  if (t === 'travel') return { bg: 'transparent', emoji: MODE_EMOJI[e.legMode] || '🧭', bare: true }
  if (t === 'unplanned stop') return { bg: C.amber, glyph: G.stop, fill: true }
  if (t === 'carrier_change') return { bg: C.purple, glyph: G.handoff }
  if (t === 'loading' || t === 'unloading') return { bg: C.green, glyph: G.load }
  if (t === 'alert') return { bg: C.red, glyph: G.alert, fill: true }
  if (t && t.startsWith('temp')) return { bg: COLOR_TOKEN[e.color] || C.slate, glyph: G.thermometer }
  return { bg: C.slate, glyph: G.pin, fill: true }
}
const svg = (glyph, fill) =>
  `<svg viewBox="0 0 24 24" style="width:14px;height:14px;stroke:#fff;fill:${fill ? '#fff' : 'none'};stroke-width:${fill ? 0 : 2};stroke-linecap:round;stroke-linejoin:round">${glyph}</svg>`

function labelOf(e) {
  const t = e.type, s = e.status || ''
  if (t === 'waypoint' || t === 'failed_waypoint') {
    if (/^Shipment origin/i.test(s)) return 'Shipment origin'
    if (/not reached/i.test(s)) return 'Destination — not reached'
    if (/^Shipment destination/i.test(s)) return 'Shipment destination'
    return e.wpNum ? 'Waypoint ' + e.wpNum : 'Waypoint'
  }
  if (t === 'travel') return 'In transit — Leg ' + (e.legNumber ?? '')
  return e.label || t
}
const popHtml = (e) => `<b>${esc(labelOf(e))}</b><br>${esc(e.status || '')}`

// ---- marker icons ----------------------------------------------------------
const ANCHOR_BADGE =
  `<div style="position:absolute;right:-10px;top:-9px;width:24px;height:24px;border-radius:50%;background:#fff;border:2px solid ${C.slate};display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);font-size:14px;line-height:1">${ANCHOR}</div>`
function pinHtml(e) {
  const missed = e.type === 'failed_waypoint'
  const anchor = e.container ? ANCHOR_BADGE : ''
  return `<div style="position:relative;width:38px;height:48px;filter:drop-shadow(0 2px 3px rgba(20,30,60,.4))">` +
    `<svg viewBox="0 0 34 44" width="38" height="48"><path d="M17 43C17 43 32 25 32 15A15 15 0 1 0 2 15C2 25 17 43 17 43Z" fill="${missed ? C.missed : C.reached}" stroke="#fff" stroke-width="2.5"/></svg>` +
    `<div style="position:absolute;top:7px;left:0;width:38px;text-align:center;color:${missed ? C.ink : '#fff'};font-weight:800;font-size:16px">${e.wpNum ?? ''}</div>${anchor}</div>`
}
const pinIcon = (e) => L.divIcon({ className: '', html: pinHtml(e), iconSize: [38, 48], iconAnchor: [19, 47] })
function dotHtml(e, size = 26) {
  const v = visual(e)
  const inner = v.emoji ? `<span style="font-size:${size - 10}px;line-height:1">${v.emoji}</span>` : svg(v.glyph, v.fill)
  const anchor = e.container ? `<div style="position:absolute;right:-8px;top:-8px;width:18px;height:18px;border-radius:50%;background:#fff;border:1.5px solid ${C.slate};display:flex;align-items:center;justify-content:center;font-size:11px;line-height:1">${ANCHOR}</div>` : ''
  const num = e.wpNum ? `<span style="position:absolute;left:-6px;top:-6px;background:${C.ink};color:#fff;border-radius:50%;width:16px;height:16px;font-size:10px;display:flex;align-items:center;justify-content:center;font-weight:700">${e.wpNum}</span>` : ''
  return `<div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 4px rgba(20,30,60,.35);display:flex;align-items:center;justify-content:center;background:${v.bg}">${inner}${num}${anchor}</div>`
}
const dotIcon = (e, size = 26) => L.divIcon({ className: '', html: dotHtml(e, size), iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
function hubIcon(items) {
  const k = items.length, R = Math.min(34 + k * 3, 64), c = R + 26, S = c * 2, sz = 26
  let spokes = '', icons = ''
  items.forEach((e, i) => {
    const ang = (-90 + (i * 360) / k) * Math.PI / 180, x = c + R * Math.cos(ang), y = c + R * Math.sin(ang)
    spokes += `<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#aab4c6" stroke-width="1.5"/>`
    icons += `<div style="position:absolute;left:${x - sz / 2}px;top:${y - sz / 2}px">${dotHtml(e, sz)}</div>`
  })
  const hub = `<div style="position:absolute;left:${c - 11}px;top:${c - 11}px;width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid ${C.slate};box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`
  return L.divIcon({ className: '', html: `<div style="position:relative;width:${S}px;height:${S}px"><svg width="${S}" height="${S}" style="position:absolute;left:0;top:0">${spokes}</svg>${hub}${icons}</div>`, iconSize: [S, S], iconAnchor: [c, c] })
}
const collapsedIcon = (n) => L.divIcon({ className: '', html: `<div style="width:32px;height:32px;border-radius:50%;background:#fff;border:3px solid ${C.slate};box-shadow:0 1px 5px rgba(20,30,60,.3);display:flex;align-items:center;justify-content:center;font-weight:800;color:${C.slate};font-size:14px">${n}</div>`, iconSize: [32, 32], iconAnchor: [16, 16] })
function collapsedWpIcon(lead, extra) {
  const badge = extra > 0 ? `<div style="position:absolute;left:26px;top:-6px;background:${C.slate};color:#fff;border-radius:11px;min-width:26px;height:21px;padding:0 5px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">+${extra}</div>` : ''
  return L.divIcon({ className: '', html: `<div style="position:relative;width:38px;height:48px">${pinHtml(lead)}${badge}</div>`, iconSize: [64, 48], iconAnchor: [19, 47] })
}

function makeBaseLayer(basemap, apiKey) {
  const style = HERE_STYLES[basemap]
  if (style && apiKey) {
    return L.tileLayer(`https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png?size=256&style=${style}&apiKey=${encodeURIComponent(apiKey)}`,
      { maxZoom: 20, maxNativeZoom: 20, attribution: '&copy; HERE' })
  }
  if (basemap === 'OpenStreetMap') {
    return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, maxNativeZoom: 19, attribution: '&copy; OpenStreetMap' })
  }
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', { maxZoom: 19, maxNativeZoom: 19, subdomains: 'abcd', attribution: '&copy; CARTO' })
}

const LEGEND = [
  { label: 'Waypoints (⚓ = container port)', color: C.reached, types: ['waypoint', 'failed_waypoint'] },
  { label: 'Unplanned stops', color: C.amber, types: ['unplanned stop'] },
  { label: 'Temp out of range', color: C.red, types: ['temp_out_of_range'] },
  { label: 'Temp back in range', color: C.blue, types: ['temp_back_in_range'] },
  { label: 'Carrier change / loaded', color: C.purple, types: ['carrier_change', 'loading', 'unloading'] },
  { label: 'Transit route', color: C.route, types: ['__transit__'] },
]

// Page through an element fully.
function usePagedElementData(configId) {
  const [data, loadMore] = usePaginatedElementData(configId)
  const requestedRef = useRef(-1)
  const count = useMemo(() => {
    const k = data ? Object.keys(data)[0] : null
    return k && data[k] ? data[k].length : 0
  }, [data])
  useEffect(() => { requestedRef.current = -1 }, [configId])
  useEffect(() => {
    if (!configId) return
    if (count > requestedRef.current && count % PAGE_SIZE === 0) { requestedRef.current = count; loadMore() }
  }, [configId, count, data, loadMore])
  return data
}

export default function App() {
  const config = useConfig()
  const data = usePagedElementData(config.events)
  const isDemo = typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('demo')

  const mapRef = useRef(null)
  const mapInstance = useRef(null)
  const baseLayerRef = useRef(null)
  const geomLayerRef = useRef(null)
  const markerLayerRef = useRef(null)
  const legendRef = useRef(null)
  const fittedRef = useRef(false)
  const activeRef = useRef(new Set())

  // ---- normalize rows -----------------------------------------------------
  const { rows, error } = useMemo(() => {
    if (isDemo && !config.events) {
      return {
        rows: DEMO_EVENTS.map((r) => ({
          shipId: r.INTERNAL_SHIPMENT_ID || 'demo', type: r.EVENT_TYPE, order: r.EVENT_TIME,
          la: toNum(r.LATITUDE), lo: toNum(r.LONGITUDE), geojson: r.GEOJSON, status: r.STATUS,
          label: r.DISPLAY_LABEL, legMode: r.LEG_MODE, legNumber: r.LEG_NUMBER,
          wpNum: r.WAYPOINT_NUMBER, container: !!r.IS_CONTAINER_PORT, color: r.COLOR,
        })),
        error: null,
      }
    }
    if (!config.events) return { rows: [], error: 'Select an events table in the panel.' }
    if (!config.eventType) return { rows: [], error: 'Choose the event type column.' }
    const col = (id) => (id ? data?.[id] : null)
    const et = col(config.eventType)
    if (!et) return { rows: [], error: 'Loading data…' }
    const lat = col(config.latitude), lon = col(config.longitude), geo = col(config.geometry)
    const ship = col(config.shipmentId), ord = col(config.order), status = col(config.status)
    const label = col(config.label), mode = col(config.legMode), legn = col(config.legNumber)
    const wp = col(config.waypointNumber), cont = col(config.isContainerPort), color = col(config.color)
    const out = []
    for (let i = 0; i < et.length; i++) {
      out.push({
        shipId: ship ? String(ship[i] ?? '') : '_all', type: et[i] ? String(et[i]) : null,
        order: ord ? ord[i] : i, la: lat ? toNum(lat[i]) : null, lo: lon ? toNum(lon[i]) : null,
        geojson: geo ? parseGeom(geo[i]) : null, status: status ? status[i] : '',
        label: label ? label[i] : null, legMode: mode ? mode[i] : null,
        legNumber: legn ? legn[i] : null, wpNum: wp ? toNum(wp[i]) : null,
        container: cont ? truthy(cont[i]) : false, color: color ? color[i] : null,
      })
    }
    return { rows: out, error: out.length ? null : 'No rows.' }
  }, [config, data, isDemo])

  const cfg = config

  // ---- init map once ------------------------------------------------------
  useEffect(() => {
    if (mapInstance.current || !mapRef.current) return
    const container = mapRef.current
    if (container._leaflet_id != null) container._leaflet_id = undefined
    const map = L.map(container, { worldCopyJump: true, maxZoom: 20, attributionControl: false }).setView([10, 120], 3)
    map.createPane('geom').style.zIndex = 350
    geomLayerRef.current = L.layerGroup().addTo(map)
    markerLayerRef.current = L.layerGroup().addTo(map)
    mapInstance.current = map
    return () => { map.remove(); mapInstance.current = null }
  }, [])

  // ---- base tiles ---------------------------------------------------------
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (baseLayerRef.current) { baseLayerRef.current.remove() }
    const layer = makeBaseLayer(cfg.basemap, cfg.hereApiKey)
    layer.addTo(map)
    if (layer.bringToBack) layer.bringToBack()
    baseLayerRef.current = layer
    map.setMaxZoom(layer.options.maxNativeZoom ?? 19)
  }, [cfg.basemap, cfg.hereApiKey])

  // ---- draw geometry (transit lines + waypoint polygons) — zoom-independent
  useEffect(() => {
    const map = mapInstance.current, layer = geomLayerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const bounds = []
    for (const e of rows) {
      const geom = e.geojson && (e.geojson.geometry || e.geojson)
      if (!geom) continue
      if (e.type === 'travel' && geom.type === 'LineString') {
        const ll = geom.coordinates.map((c) => [c[1], c[0]])
        const pl = L.polyline(ll, { color: C.route, weight: 3.5, opacity: 0.9, pane: 'geom' }).addTo(layer)
        pl.bindTooltip(`<b>${esc(labelOf(e))}</b> · ${esc(e.legMode || '')}<br>${esc((e.status || '').slice(0, 90))}`, { sticky: true })
        if (cfg.showArrows !== false) {
          L.polylineDecorator(pl, { patterns: [{ offset: '6%', repeat: '11%', symbol: L.Symbol.arrowHead({ pixelSize: 16, headAngle: 50, pathOptions: { stroke: true, weight: 1, color: '#fff', fillColor: C.route, fillOpacity: 1 } }) }] }).addTo(layer)
        }
        ll.forEach((p) => bounds.push(p))
      } else if ((e.type === 'waypoint' || e.type === 'failed_waypoint') && (geom.type === 'Polygon' || geom.type === 'MultiPolygon')) {
        L.geoJSON(geom, { pane: 'geom', style: { color: e.type === 'failed_waypoint' ? C.missed : C.reached, weight: 1.5, fillOpacity: 0.12 } }).addTo(layer)
      }
    }
    rows.forEach((e) => { if (e.la != null && e.lo != null) bounds.push([e.la, e.lo]) })
    if (!fittedRef.current && bounds.length) { map.fitBounds(bounds, { padding: [55, 55], maxZoom: 12 }); fittedRef.current = true }
  }, [rows, cfg.showArrows])

  useEffect(() => { fittedRef.current = false }, [config.events])

  // ---- draw markers (hub-and-spoke, collapse/expand) — redraws on zoom ----
  useEffect(() => {
    const map = mapInstance.current, layer = markerLayerRef.current
    if (!map || !layer) return
    activeRef.current = new Set(rows.map((r) => r.type))
    const EXPAND_ZOOM = 10, PIX = 42

    function render() {
      layer.clearLayers()
      const z = map.getZoom()
      const pts = rows.filter((e) => e.la != null && e.lo != null && e.type !== 'travel' && activeRef.current.has(e.type))
      // screen-space grouping
      const gs = []
      for (const e of pts) {
        const p = map.latLngToLayerPoint([e.la, e.lo])
        let g = null
        for (const x of gs) { if (p.distanceTo(x.p) < PIX) { g = x; break } }
        if (!g) { g = { p, la: e.la, lo: e.lo, items: [] }; gs.push(g) }
        g.items.push(e)
      }
      for (const g of gs) {
        if (g.items.length === 1) {
          const e = g.items[0]
          L.marker([e.la, e.lo], { icon: e.wpNum ? pinIcon(e) : dotIcon(e), zIndexOffset: e.wpNum ? 1000 : 0 }).bindPopup(popHtml(e)).addTo(layer)
        } else if (z >= EXPAND_ZOOM) {
          L.marker([g.la, g.lo], { icon: hubIcon(g.items), zIndexOffset: 500 })
            .bindPopup(`<b>${g.items.length} events at this location</b>` + g.items.map((e) => `<div style="margin-top:3px">• ${esc(labelOf(e))} — ${esc((e.status || '').slice(0, 70))}</div>`).join('')).addTo(layer)
        } else {
          const wps = g.items.filter((e) => e.wpNum).sort((a, b) => a.wpNum - b.wpNum)
          const m = wps.length
            ? L.marker([wps[0].la, wps[0].lo], { icon: collapsedWpIcon(wps[0], g.items.length - 1), zIndexOffset: 900 })
            : L.marker([g.la, g.lo], { icon: collapsedIcon(g.items.length), zIndexOffset: 400 })
          m.bindTooltip(`${g.items.length} events here — click to zoom in`)
          m.on('click', () => map.flyTo([g.la, g.lo], Math.max(EXPAND_ZOOM, z + 3)))
          m.addTo(layer)
        }
      }
    }
    render()
    map.on('zoomend moveend', render)
    return () => map.off('zoomend moveend', render)
  }, [rows])

  // ---- legend (clickable toggles) -----------------------------------------
  useEffect(() => {
    const map = mapInstance.current
    if (!map) return
    if (legendRef.current) { legendRef.current.remove() }
    if (!rows.length) return
    const present = new Set(rows.map((r) => r.type))
    const items = LEGEND.filter((c) => c.types.includes('__transit__') || c.types.some((t) => present.has(t)))
    const legend = L.control({ position: 'bottomright' })
    legend.onAdd = () => {
      const div = L.DomUtil.create('div', 'map-legend')
      div.innerHTML = '<div class="map-legend-header">Layers — click to toggle</div>' +
        items.map((c, i) => `<div class="legend-row" data-i="${i}"><span class="legend-sw" style="background:${c.color}"></span>${esc(c.label)}</div>`).join('')
      div.querySelectorAll('.legend-row').forEach((row) => {
        row.onclick = () => {
          const c = items[+row.dataset.i]
          const on = row.classList.toggle('off')
          if (c.types[0] === '__transit__') { on ? map.removeLayer(geomLayerRef.current) : map.addLayer(geomLayerRef.current); return }
          c.types.forEach((t) => (on ? activeRef.current.delete(t) : activeRef.current.add(t)))
          map.fire('moveend') // trigger marker re-render
        }
      })
      L.DomEvent.disableClickPropagation(div)
      return div
    }
    legend.addTo(map)
    legendRef.current = legend
  }, [rows])

  return (
    <>
      <div id="map" ref={mapRef} />
      {error && <div className="plugin-message">{error}</div>}
    </>
  )
}
