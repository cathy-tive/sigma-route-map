# Shipment Timeline — Map Plugin (Sigma)

A custom [Sigma](https://sigmacomputing.com) plugin that renders a shipment's
`TL_TIMELINE_EVENTS` on a map: transit legs as **lines with direction arrows**,
**numbered origin/destination waypoint pins** (reached vs missed, with a ⚓ badge
at container ports), and every other event (unplanned stops, temp excursions,
carrier changes, loads) as icons that **cluster by location** — a place with
several events collapses to one hub and fans out into a hub-and-spoke when you
zoom in or click it.

Built with React + Vite + [`@sigmacomputing/plugin`](https://www.npmjs.com/package/@sigmacomputing/plugin)
+ Leaflet + `leaflet-polylinedecorator`. Sibling of `sigma-map-plugin` (the
clustering map), sharing the same setup/deploy lessons. The design was nailed
down first in `shipment-timeline/mockups/` and ported here.

## Preview standalone

```bash
npm install
npm run dev
```

Open `http://localhost:3001/?demo=1` — renders real rows for shipment 420890/A1
(embedded in `src/demoData.js`) with no Sigma connection needed.

## Wiring it up in Sigma

Point the **events** source at `SCRATCH.CSLESNICK.TL_TIMELINE_EVENTS` (filtered
to one shipment) and map these columns:

| Panel field | Column | Used for |
|---|---|---|
| `shipmentId` | `internal_shipment_id` | grouping (usually one shipment) |
| `eventType` | `event_type` | icon + color + line/marker routing |
| `order` | `event_time` | ordering |
| `latitude` / `longitude` | `latitude` / `longitude` | point placement |
| `geometry` | `geojson` | transit LineString + waypoint polygon |
| `label` | `display_label` | marker label |
| `status` | `status` | tooltip / popup text |
| `legMode` | `leg_mode` | transit symbol (ship/plane/truck/train) |
| `legNumber` | `leg_number` | "In transit — Leg N" |
| `waypointNumber` | `waypoint_number` | numbered pin + origin/destination |
| `isContainerPort` | `is_container_port` | anchor badge |
| `color` | `color` | temp out = red, back = blue |

**Base map** — Carto Light (default), OpenStreetMap, or HERE (needs an API key
in the panel). **Options** — toggle direction arrows. The legend (bottom-right)
toggles each layer on/off.

## Notes / gotchas

- The editor panel is declared once at load; a plugin must never write config at
  runtime (Sigma reloads the element → infinite loop). Same lesson as the sibling.
- `geojson` cells may arrive as a GeoJSON object, a JSON string, or a Feature —
  `parseGeom` normalizes all three; lines and polygons read `.geometry || self`.
- Co-located events group in **screen space**, so they separate as you zoom; a
  stack at identical coordinates stays a hub and fans out past zoom 10.
- Deploy mirrors `sigma-map-plugin` (build to `dist/`, host on GitHub Pages /
  surge / vercel). tiveinc blocks Pages, so prod hosting lives on the personal
  account — see that repo's notes.
