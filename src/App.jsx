import { useEffect, useMemo, useRef } from 'react'
import L from 'leaflet'
import 'leaflet-polylinedecorator'
import { client, useConfig, usePaginatedElementData } from '@sigmacomputing/plugin'
import { DEMO_EVENTS } from './demoData.js'

const PAGE_SIZE = 25000

// ===== icon system: shape (container) + color (hex) + icon_key (inner glyph), all from data =====
const GLYPH = {
  'thermo-up':'<path d="M13 4v10.2a3.6 3.6 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/><path d="M19 9V3M16.5 5.5 19 3l2.5 2.5"/>',
  'thermo-dn':'<path d="M13 4v10.2a3.6 3.6 0 1 1-4 0V4a2 2 0 0 1 4 0Z"/><path d="M19 3v6M16.5 6.5 19 9l2.5-2.5"/>',
  'bolt':'<path d="M13 2 4 14h7l-1 8 10-12h-7z"/>',
  'sun':'<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>',
  'route':'<path d="M5 19V11a4 4 0 0 1 4-4h7"/><path d="M13 4l4 3-4 3"/>',
  'snow':'<path d="M12 3v18M4.5 7.5l15 9M19.5 7.5l-15 9"/>',
  'scissors':'<circle cx="6" cy="7" r="2.2"/><circle cx="6" cy="17" r="2.2"/><path d="M8 8.5 20 17M8 15.5 20 7"/>',
  'bell':'<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 7.5 2.5 7.5h-17S6 15 6 9M10.2 21a2 2 0 0 0 3.6 0"/>',
  'handoff':'<path d="m16 3 4 4-4 4M20 7H5M8 21l-4-4 4-4M4 17h15"/>',
  'load':'<path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8"/>',
  'unload':'<path d="M21 8 12 3 3 8v8l9 5 9-5V8ZM3 8l9 5 9-5M12 13v8"/>',
  'anchor':'<circle cx="12" cy="5" r="3"/><path d="M12 22V8M5 12H2a10 10 0 0 0 20 0h-3"/>',
}
const MODE_EMOJI = { Ocean:'🚢', Air:'✈️', Road:'🚚', Rail:'🚆' }
const ROUTE = '#8a9cb8'
const gsvg = (key, size) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" style="stroke:#fff;fill:none;stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round">${GLYPH[key] || ''}</svg>`
const ANCHOR_BADGE = '<div style="position:absolute;right:-9px;top:-8px;width:22px;height:22px;border-radius:50%;background:#fff;border:2px solid #586176;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 4px rgba(0,0,0,.35);font-size:13px;line-height:1">&#9875;</div>'

const DEF_SHAPE={waypoint:'pin',failed_waypoint:'pin',travel:'bare','unplanned stop':'octagon',temp_out_of_range:'triangle',temp_back_in_range:'triangle',alert:'triangle',carrier_change:'circle',loading:'circle',unloading:'circle',arrive:'circle',depart:'circle'}
const DEF_COLOR={waypoint:'#2563eb',failed_waypoint:'#94a3b8',travel:null,'unplanned stop':'#d97706',temp_out_of_range:'#dc2626',temp_back_in_range:'#0d9488',alert:'#dc2626',carrier_change:'#7c3aed',loading:'#16a34a',unloading:'#16a34a',arrive:'#586176',depart:'#586176'}
const DEF_ICON={waypoint:'pin',failed_waypoint:'pin-missed',travel:'transit','unplanned stop':'stop',temp_out_of_range:'thermo-up',temp_back_in_range:'thermo-dn',alert:'bell',carrier_change:'handoff',loading:'load',unloading:'unload',arrive:'anchor',depart:'anchor'}
function markerHtml(e, size) {
  size = size || 32
  const type = e.type
  const shape = e.shape || DEF_SHAPE[type] || 'circle'
  const color = e.color || DEF_COLOR[type] || '#586176'
  const iconKey = e.iconKey || DEF_ICON[type] || 'bell'
  if (shape === 'bare') return `<span style="font-size:${size - 4}px;line-height:1;filter:drop-shadow(0 1px 2px rgba(20,30,60,.4))">${MODE_EMOJI[e.legMode] || '🧭'}</span>`
  if (shape === 'pin') {
    const w = size, h = Math.round(size * 1.29), missed = iconKey === 'pin-missed'
    const num = e.wpNum != null ? e.wpNum : ''
    const slash = missed ? '<path d="M4 4 L30 40" stroke="#fff" stroke-width="4" stroke-linecap="round"/>' : ''
    const anchor = e.container ? ANCHOR_BADGE : ''
    return `<div style="position:relative;width:${w}px;height:${h}px;filter:drop-shadow(0 2px 3px rgba(20,30,60,.4))">` +
      `<svg viewBox="0 0 34 44" width="${w}" height="${h}"><path d="M17 43C17 43 32 25 32 15A15 15 0 1 0 2 15C2 25 17 43 17 43Z" fill="${color}" stroke="#fff" stroke-width="2.5"/>${slash}</svg>` +
      `<div style="position:absolute;top:${Math.round(h * 0.14)}px;left:0;width:${w}px;text-align:center;font-weight:800;font-size:${Math.round(size * 0.44)}px;color:${missed ? '#1a2233' : '#fff'}">${num}</div>${anchor}</div>`
  }
  if (shape === 'octagon') return `<div style="position:relative;width:${size}px;height:${size}px;filter:drop-shadow(0 1px 4px rgba(20,30,60,.35))"><svg viewBox="0 0 34 34" width="${size}" height="${size}"><path d="M10 2H24L32 10V24L24 32H10L2 24V10Z" fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg></div>`
  if (shape === 'triangle') return `<div style="position:relative;width:${size}px;height:${size}px;filter:drop-shadow(0 1px 4px rgba(20,30,60,.35))"><svg viewBox="0 0 34 34" width="${size}" height="${size}"><path d="M17 3.5 32.5 31H1.5Z" fill="${color}" stroke="#fff" stroke-width="2.5" stroke-linejoin="round"/></svg><span style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding-top:${Math.round(size * 0.2)}px">${gsvg(iconKey, Math.round(size * 0.42))}</span></div>`
  return `<div style="width:${size}px;height:${size}px;border-radius:50%;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(20,30,60,.35);display:flex;align-items:center;justify-content:center;background:${color}">${gsvg(iconKey, Math.round(size * 0.56))}</div>`
}
function markerIcon(e, size) {
  size = size || 32
  const html = markerHtml(e, size)
  if (e.shape === 'pin') { const h = Math.round(size * 1.29); return L.divIcon({ className: '', html, iconSize: [size, h], iconAnchor: [size / 2, h - 1] }) }
  return L.divIcon({ className: '', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] })
}

const HERE_STYLES = { 'HERE Day':'explore.day','HERE Night':'explore.night','HERE Satellite':'satellite.day','HERE Satellite + roads':'explore.satellite.day' }
const BASEMAP_OPTIONS = ['Carto Light','OpenStreetMap',...Object.keys(HERE_STYLES)]
const BASE_CONFIG = [
  { name:'events', type:'element' },
  { name:'shipmentId', type:'column', source:'events', allowMultiple:false },
  { name:'eventType', type:'column', source:'events', allowMultiple:false },
  { name:'order', type:'column', source:'events', allowMultiple:false },
  { name:'latitude', type:'column', source:'events', allowMultiple:false },
  { name:'longitude', type:'column', source:'events', allowMultiple:false },
  { name:'geometry', type:'column', source:'events', allowMultiple:false },
  { name:'label', type:'column', source:'events', allowMultiple:false },
  { name:'status', type:'column', source:'events', allowMultiple:false },
  { name:'Style (from data)', type:'group' },
  { name:'shape', type:'column', source:'events', allowMultiple:false },
  { name:'color', type:'column', source:'events', allowMultiple:false },
  { name:'iconKey', type:'column', source:'events', allowMultiple:false },
  { name:'Attributes', type:'group' },
  { name:'legMode', type:'column', source:'events', allowMultiple:false },
  { name:'legNumber', type:'column', source:'events', allowMultiple:false },
  { name:'waypointNumber', type:'column', source:'events', allowMultiple:false },
  { name:'isContainerPort', type:'column', source:'events', allowMultiple:false },
  { name:'Base map', type:'group' },
  { name:'basemap', type:'dropdown', values:BASEMAP_OPTIONS, defaultValue:'Carto Light' },
  { name:'hereApiKey', type:'text', secure:true, placeholder:'HERE API key (for HERE basemaps)' },
  { name:'Options', type:'group' },
  { name:'showArrows', type:'toggle', defaultValue:true },
  { name:'Legend', type:'group' },
  { name:'legendTitle', type:'text', placeholder:'Legend header (default: Layers)' },
]
client.config.configureEditorPanel(BASE_CONFIG)

const toNum = (v) => { if (v==null||v==='') return null; const n = typeof v==='number'?v:Number(v); return Number.isFinite(n)?n:null }
const truthy = (v) => v===true||v==='true'||v===1||v==='1'
function parseGeom(cell){ if(cell==null) return null; let o=cell; if(typeof cell==='string'){ try{o=JSON.parse(cell)}catch{return null} } return o && (o.geometry||o) }
const esc = (s)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
function labelOf(e){
  const t=e.type, s=e.status||''
  if(t==='waypoint'||t==='failed_waypoint'){ if(/^Shipment origin/i.test(s))return'Shipment origin'; if(/not reached/i.test(s))return'Destination — not reached'; if(/^Shipment destination/i.test(s))return'Shipment destination'; return e.wpNum?('Waypoint '+e.wpNum):'Waypoint' }
  if(t==='travel') return 'In transit — Leg '+(e.legNumber ?? '')
  return e.label || t
}
const pop=(e)=>`<b>${esc(labelOf(e))}</b><br>${esc(e.status||'')}`

function makeBaseLayer(basemap, apiKey){
  const style=HERE_STYLES[basemap]
  if(style&&apiKey) return L.tileLayer(`https://maps.hereapi.com/v3/base/mc/{z}/{x}/{y}/png?size=256&style=${style}&apiKey=${encodeURIComponent(apiKey)}`,{maxZoom:20,maxNativeZoom:20,attribution:'&copy; HERE'})
  if(basemap==='OpenStreetMap') return L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,maxNativeZoom:19,attribution:'&copy; OpenStreetMap'})
  return L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',{maxZoom:19,maxNativeZoom:19,subdomains:'abcd',attribution:'&copy; CARTO'})
}

const GROUPS = [
  { label:'Waypoints', types:['waypoint','failed_waypoint'] },
  { label:'Unplanned stops', types:['unplanned stop'] },
  { label:'Temp out of range', types:['temp_out_of_range'] },
  { label:'Temp back in range', types:['temp_back_in_range'] },
  { label:'Alerts', types:['alert'] },
  { label:'Carrier change', types:['carrier_change'] },
  { label:'Loaded / unloaded', types:['loading','unloading'] },
]

function usePagedElementData(configId){
  const [data,loadMore]=usePaginatedElementData(configId)
  const requestedRef=useRef(-1)
  const count=useMemo(()=>{const k=data?Object.keys(data)[0]:null;return k&&data[k]?data[k].length:0},[data])
  useEffect(()=>{requestedRef.current=-1},[configId])
  useEffect(()=>{ if(!configId)return; if(count>requestedRef.current&&count%PAGE_SIZE===0){requestedRef.current=count;loadMore()} },[configId,count,data,loadMore])
  return data
}

export default function App(){
  const config=useConfig()
  const data=usePagedElementData(config.events)
  const isDemo=typeof window!=='undefined'&&new URLSearchParams(window.location.search).has('demo')
  const mapRef=useRef(null), mapInstance=useRef(null), baseRef=useRef(null)
  const geomLayer=useRef(null), markerLayer=useRef(null), legendRef=useRef(null), fitted=useRef(false)
  const shownRef=useRef(null)

  const { rows, error } = useMemo(()=>{
    if(isDemo&&!config.events){
      return { rows: DEMO_EVENTS.map(r=>({ shipId:'demo', type:r.EVENT_TYPE, order:r.EVENT_TIME, la:toNum(r.LATITUDE), lo:toNum(r.LONGITUDE),
        geojson:r.GEOJSON, status:r.STATUS, label:r.DISPLAY_LABEL, legMode:r.LEG_MODE, legNumber:r.LEG_NUMBER,
        wpNum:r.WAYPOINT_NUMBER, container:!!r.IS_CONTAINER_PORT, color:r.COLOR, shape:r.SHAPE, iconKey:r.ICON_KEY })), error:null }
    }
    if(!config.events) return { rows:[], error:'Select an events table in the panel.' }
    if(!config.eventType) return { rows:[], error:'Choose the event type column.' }
    const col=(id)=>id?data?.[id]:null
    const et=col(config.eventType); if(!et) return { rows:[], error:'Loading data…' }
    const lat=col(config.latitude),lon=col(config.longitude),geo=col(config.geometry),ship=col(config.shipmentId),ord=col(config.order),
      status=col(config.status),label=col(config.label),mode=col(config.legMode),legn=col(config.legNumber),
      wp=col(config.waypointNumber),cont=col(config.isContainerPort),color=col(config.color),shape=col(config.shape),ik=col(config.iconKey)
    const out=[]
    for(let i=0;i<et.length;i++){
      out.push({ shipId:ship?String(ship[i]??''):'_all', type:et[i]?String(et[i]):null, order:ord?ord[i]:i,
        la:lat?toNum(lat[i]):null, lo:lon?toNum(lon[i]):null, geojson:geo?parseGeom(geo[i]):null, status:status?status[i]:'',
        label:label?label[i]:null, legMode:mode?mode[i]:null, legNumber:legn?legn[i]:null, wpNum:wp?toNum(wp[i]):null,
        container:cont?truthy(cont[i]):false, color:color?color[i]:null, shape:shape?String(shape[i]||''):null, iconKey:ik?String(ik[i]||''):null })
    }
    return { rows:out, error:out.length?null:'No rows.' }
  },[config,data,isDemo])

  const cfg=config
  useEffect(()=>{ // init once
    if(mapInstance.current||!mapRef.current) return
    const c=mapRef.current; if(c._leaflet_id!=null) c._leaflet_id=undefined
    const map=L.map(c,{worldCopyJump:true,maxZoom:20,attributionControl:false}).setView([20,0],2)
    map.createPane('geom').style.zIndex=350
    geomLayer.current=L.layerGroup().addTo(map); markerLayer.current=L.layerGroup().addTo(map); mapInstance.current=map
    return ()=>{ map.remove(); mapInstance.current=null }
  },[])
  useEffect(()=>{ const map=mapInstance.current; if(!map)return; if(baseRef.current)baseRef.current.remove()
    const layer=makeBaseLayer(cfg.basemap,cfg.hereApiKey); layer.addTo(map); if(layer.bringToBack)layer.bringToBack(); baseRef.current=layer; map.setMaxZoom(layer.options.maxNativeZoom??19)
  },[cfg.basemap,cfg.hereApiKey])

  useEffect(()=>{ // geometry: transit lines + waypoint polygons
    const map=mapInstance.current,layer=geomLayer.current; if(!map||!layer)return
    layer.clearLayers(); const bounds=[]
    for(const e of rows){ const g=e.geojson&&(e.geojson.geometry||e.geojson); if(!g)continue
      if(e.type==='travel'&&g.type==='LineString'){ const ll=g.coordinates.map(c=>[c[1],c[0]])
        const pl=L.polyline(ll,{color:ROUTE,weight:3.5,opacity:.95,pane:'geom'}).addTo(layer)
        pl.bindTooltip(`<b>${esc(labelOf(e))}</b> · ${esc(e.legMode||'')}<br>${esc((e.status||'').slice(0,90))}`,{sticky:true})
        if(cfg.showArrows!==false) L.polylineDecorator(pl,{patterns:[{offset:'6%',repeat:'11%',symbol:L.Symbol.arrowHead({pixelSize:15,headAngle:50,pathOptions:{stroke:true,weight:1,color:'#fff',fillColor:ROUTE,fillOpacity:1}})}]}).addTo(layer)
        ll.forEach(p=>bounds.push(p))
      } else if((e.type==='waypoint'||e.type==='failed_waypoint')&&(g.type==='Polygon'||g.type==='MultiPolygon')){
        L.geoJSON(g,{pane:'geom',style:{color:e.color||'#2563eb',weight:1.5,fillOpacity:0.12}}).addTo(layer)
      }
    }
    rows.forEach(e=>{ if(e.la!=null&&e.lo!=null)bounds.push([e.la,e.lo]) })
    if(!fitted.current&&bounds.length){ map.fitBounds(bounds,{padding:[55,55],maxZoom:12}); fitted.current=true }
  },[rows,cfg.showArrows])
  useEffect(()=>{ fitted.current=false },[config.events])

  useEffect(()=>{ // markers: hub-and-spoke, collapse/expand
    const map=mapInstance.current,layer=markerLayer.current; if(!map||!layer)return
    shownRef.current=null
    const EXPAND_ZOOM=10,PIX=42
    const vis=(t)=>{const st=shownRef.current;return st===null||st.has(t)}
    function collapsedCount(n){ return L.divIcon({className:'',html:`<div style="width:32px;height:32px;border-radius:50%;background:#fff;border:3px solid #586176;box-shadow:0 1px 5px rgba(20,30,60,.3);display:flex;align-items:center;justify-content:center;font-weight:800;color:#586176;font-size:14px">${n}</div>`,iconSize:[32,32],iconAnchor:[16,16]}) }
    function collapsedWp(lead,extra){ const b=extra>0?`<div style="position:absolute;left:28px;top:-4px;background:#586176;color:#fff;border-radius:11px;min-width:26px;height:21px;padding:0 5px;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:12px;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)">+${extra}</div>`:''
      return L.divIcon({className:'',html:`<div style="position:relative">${markerHtml(lead,34)}${b}</div>`,iconSize:[60,44],iconAnchor:[17,43]}) }
    function hubIcon(items){ const k=items.length,R=Math.min(34+k*3,64),c=R+26,S=c*2,sz=28; let sp='',ic=''
      items.forEach((e,i)=>{ const a=(-90+i*360/k)*Math.PI/180,x=c+R*Math.cos(a),y=c+R*Math.sin(a)
        sp+=`<line x1="${c}" y1="${c}" x2="${x}" y2="${y}" stroke="#aab4c6" stroke-width="1.5"/>`; ic+=`<div style="position:absolute;left:${x-sz/2}px;top:${y-sz/2}px">${markerHtml(e,sz)}</div>` })
      const hub=`<div style="position:absolute;left:${c-11}px;top:${c-11}px;width:22px;height:22px;border-radius:50%;background:#fff;border:3px solid #586176;box-shadow:0 1px 4px rgba(0,0,0,.35)"></div>`
      return L.divIcon({className:'',html:`<div style="position:relative;width:${S}px;height:${S}px"><svg width="${S}" height="${S}" style="position:absolute;left:0;top:0">${sp}</svg>${hub}${ic}</div>`,iconSize:[S,S],iconAnchor:[c,c]}) }
    function render(){
      layer.clearLayers(); const z=map.getZoom()
      const pts=rows.filter(e=>e.la!=null&&e.lo!=null&&e.type!=='travel'&&vis(e.type))
      const gs=[]
      for(const e of pts){ const p=map.latLngToLayerPoint([e.la,e.lo]); let g=null; for(const x of gs){ if(p.distanceTo(x.p)<PIX){g=x;break} } if(!g){g={p,la:e.la,lo:e.lo,items:[]};gs.push(g)} g.items.push(e) }
      for(const g of gs){
        if(g.items.length===1){ const e=g.items[0]; L.marker([e.la,e.lo],{icon:markerIcon(e,32),zIndexOffset:e.shape==='pin'?1000:0}).bindPopup(pop(e)).addTo(layer) }
        else if(z>=EXPAND_ZOOM){ L.marker([g.la,g.lo],{icon:hubIcon(g.items),zIndexOffset:500}).bindPopup(`<b>${g.items.length} events at this location</b>`+g.items.map(e=>`<div style="margin-top:3px">• ${esc(labelOf(e))} — ${esc((e.status||'').slice(0,70))}</div>`).join('')).addTo(layer) }
        else { const wps=g.items.filter(e=>e.shape==='pin').sort((a,b)=>(a.wpNum||0)-(b.wpNum||0))
          const m=wps.length?L.marker([wps[0].la,wps[0].lo],{icon:collapsedWp(wps[0],g.items.length-1),zIndexOffset:900}):L.marker([g.la,g.lo],{icon:collapsedCount(g.items.length),zIndexOffset:400})
          m.bindTooltip(g.items.length+' events here — click to zoom in'); m.on('click',()=>map.flyTo([g.la,g.lo],Math.max(EXPAND_ZOOM,z+3))); m.addTo(layer) }
      }
    }
    render(); map.on('zoomend moveend',render); return ()=>map.off('zoomend moveend',render)
  },[rows])

  useEffect(()=>{ // legend — dynamic, matches the data; click isolates then adds (Sigma-style)
    const map=mapInstance.current; if(!map)return; if(legendRef.current)legendRef.current.remove(); if(!rows.length)return
    const present=new Set(rows.map(r=>r.type))
    const items=GROUPS.filter(g=>g.types.some(t=>present.has(t))).map(g=>{const f=rows.find(r=>g.types.includes(r.type));return {...g, rep: f?{...f,wpNum:null,container:false}:{type:g.types[0]}}})
    const legend=L.control({position:'bottomright'})
    legend.onAdd=()=>{ const div=L.DomUtil.create('div','map-legend')
      div.innerHTML='<div class="map-legend-header">'+esc(config.legendTitle||'Layers — click to isolate, add more')+'</div>'+items.map((c,i)=>`<div class="legend-row" data-i="${i}"><span class="legend-sw">${markerHtml(c.rep,22)}</span>${esc(c.label)}</div>`).join('')
      const paint=()=>{ const sh=shownRef.current; div.querySelectorAll('.legend-row').forEach((r2,j)=>{ const on = sh===null || items[j].types.some(t=>sh.has(t)); r2.classList.toggle('off', !on) }) }
      div.querySelectorAll('.legend-row').forEach(row=>{ row.onclick=()=>{
        const g=items[+row.dataset.i]; let sh=shownRef.current
        if(sh===null){ sh=new Set(g.types) }
        else { const allIn=g.types.every(t=>sh.has(t)); if(allIn){ g.types.forEach(t=>sh.delete(t)) } else { g.types.forEach(t=>sh.add(t)) } if(sh.size===0) sh=null }
        shownRef.current=sh; paint(); map.fire('moveend')
      } })
      L.DomEvent.disableClickPropagation(div); return div }
    legend.addTo(map); legendRef.current=legend
  },[rows, config.legendTitle])

  return (<>
    <div id="map" ref={mapRef} />
    {error && <div className="plugin-message">{error}</div>}
  </>)
}
