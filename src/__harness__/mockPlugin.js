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
  c_type:['waypoint','travel','alert','alert','failed_waypoint'],
  c_lat:[-36.85,null,20.0,25.0,40.71],
  c_lon:[174.76,null,-160.0,-120.0,-74.01],
  c_geo:[
    JSON.stringify({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[174.76,-36.85]}}),
    JSON.stringify({type:'LineString',coordinates:[[174.76,-36.85],[-179.0,-20.0],[-160.0,0.0],[-140.0,15.0],[-120.0,25.0],[-100.0,30.0],[-74.01,40.71]]}),
    JSON.stringify({type:'Point',coordinates:[-160.0,20.0]}),
    JSON.stringify({type:'Point',coordinates:[-120.0,25.0]}),
    JSON.stringify({type:'Feature',properties:{},geometry:{type:'Point',coordinates:[-74.01,40.71]}}),
  ],
  c_status:['Shipment origin: Northgate Cold Store','In transit, leg 2: A -> B','Shock alert ×4 over 12 min','Shipment destination (not reached): Port Vesta','Light alert (240 LUX)'],
  c_label:['Waypoint','In transit','Alert','Failed waypoint','Alert'],
  c_time:[1778500000000,1778600000000,1779000000000,1779500000000,1779100000000], // epoch ms, like Sigma
  c_ship:['SHIP-1','SHIP-1','SHIP-1','SHIP-1','SHIP-1'],
  c_wp:[1,null,null,3,null],
  c_mode:['Road','Ocean',null,'Ocean',null],
  c_leg:[1,2,2,2,2],
  c_port:[false,false,false,false,false],
  c_icon:['pin','transit','bolt','pin-missed','sun'],
  c_shape:['pin','bare','triangle','pin','triangle'],
  c_color:['#2563eb',null,'#dc2626','#94a3b8','#dc2626'],
  c_dur:[604800,4000000,null,null,null],
}
const CONFIG = {
  events:'el_events', eventType:'c_type', latitude:'c_lat', longitude:'c_lon', geometry:'c_geo',
  status:'c_status', label:'c_label', order:'c_time', shipmentId:'c_ship', waypointNumber:'c_wp',
  legMode:'c_mode', legNumber:'c_leg', isContainerPort:'c_port', iconKey:'c_icon', shape:'c_shape',
  color:'c_color', durationSec:'c_dur',
  tooltip1:'c_status', tooltip2:'c_mode',   // single-slot tooltip fields (the working path)
  basemap:'Carto Light', showArrows:true, legendTitle:'',
}
export const client = { config: { configureEditorPanel(){}, get(){return CONFIG} } }
export const useConfig = () => CONFIG
export const useElementColumns = () => Object.fromEntries(Object.entries(COLS).map(([id,name])=>[id,{name}]))
export const usePaginatedElementData = () => [D, () => {}]
export const useElementData = () => D
