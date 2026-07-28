// Mock of @sigmacomputing/plugin that mimics how Sigma actually feeds a plugin:
// config maps field name -> COLUMN ID, and data/columns are keyed by those column ids.
// Lets us exercise the REAL data path (which ?demo=1 skips) via: HARNESS=1 npm run dev
const COLS = {
  c_type:'EVENT_TYPE', c_lat:'LATITUDE', c_lon:'LONGITUDE', c_geo:'GEOJSON', c_status:'STATUS',
  c_label:'DISPLAY_LABEL', c_time:'EVENT_TIME', c_ship:'INTERNAL_SHIPMENT_ID', c_wp:'WAYPOINT_NUMBER',
  c_mode:'LEG_MODE', c_leg:'LEG_NUMBER', c_port:'IS_CONTAINER_PORT', c_icon:'ICON_KEY',
  c_shape:'SHAPE', c_color:'COLOR', c_dur:'DURATION_SEC',
}
// 4 rows: origin waypoint, ocean leg w/ LineString, a shock alert, missed destination
const D = {
  c_type:['waypoint','travel','alert','failed_waypoint'],
  c_lat:[52.95,null,47.5,37.74],
  c_lon:[-1.15,null,-12.0,-25.67],
  c_geo:[
    JSON.stringify({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[-1.15,52.95]}}),
    JSON.stringify({type:'LineString',coordinates:[[-3,53.41],[-8.5,50],[-16,45],[-23,39.8]]}),
    JSON.stringify({type:'Point',coordinates:[-12,47.5]}),
    JSON.stringify({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[-25.67,37.74]}}),
  ],
  c_status:['Shipment origin: Northgate Cold Store','In transit, leg 2: A -> B','Shock alert ×4 over 12 min','Shipment destination (not reached): Port Vesta'],
  c_label:['Waypoint','In transit','Alert','Failed waypoint'],
  c_time:[1778500000000,1778600000000,1779000000000,1779500000000], // epoch ms, like Sigma
  c_ship:['SHIP-1','SHIP-1','SHIP-1','SHIP-1'],
  c_wp:[1,null,null,3],
  c_mode:['Road','Ocean',null,'Ocean'],
  c_leg:[1,2,2,2],
  c_port:[false,false,false,false],
  c_icon:['pin','transit','bolt','pin-missed'],
  c_shape:['pin','bare','triangle','pin'],
  c_color:['#2563eb',null,'#dc2626','#94a3b8'],
  c_dur:[604800,4000000,null,null],
}
const CONFIG = {
  events:'el_events', eventType:'c_type', latitude:'c_lat', longitude:'c_lon', geometry:'c_geo',
  status:'c_status', label:'c_label', order:'c_time', shipmentId:'c_ship', waypointNumber:'c_wp',
  legMode:'c_mode', legNumber:'c_leg', isContainerPort:'c_port', iconKey:'c_icon', shape:'c_shape',
  color:'c_color', durationSec:'c_dur',
  tooltip:['c_status','c_mode'],           // multi-column tooltip, as Sigma sends it
  basemap:'Carto Light', showArrows:true, legendTitle:'',
}
export const client = { config: { configureEditorPanel(){}, get(){return CONFIG} } }
export const useConfig = () => CONFIG
export const useElementColumns = () => Object.fromEntries(Object.entries(COLS).map(([id,name])=>[id,{name}]))
export const usePaginatedElementData = () => [D, () => {}]
export const useElementData = () => D
