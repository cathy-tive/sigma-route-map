# Sigma Route Map Plugin

A custom [Sigma](https://sigmacomputing.com) plugin that draws **shipment paths as
lines with direction arrows**, **event markers** as category-symbol pins, and
**geofences** (circles + polygons) underneath.

Built with React + Vite + [`@sigmacomputing/plugin`](https://www.npmjs.com/package/@sigmacomputing/plugin)
+ Leaflet + `leaflet-polylinedecorator`. Sibling of `sigma-map-plugin` (the
clustering map), sharing the same setup/lessons.

## What it does

- **Line** — connects the points of each shipment into a path, ordered by an
  `order` column (stable-sorted; ties preserve row order). Style is selectable
  (solid / dashed / dotted) with an optional color, and **sparse direction
  arrows** (~4 per line) you can toggle off.
- **Event markers** — only rows where `eventType` is set become pins; the
  symbol + color are assigned per event type (with a legend). Two events at the
  **same shipment + same `order`** (same time) are **merged** into one pin with
  a count badge and a combined tooltip.
- **Geofences** — a second source draws circles and polygons *under* the line
  and markers, colored by an optional category.

## Editor panel

**Points source** (`points`):

| Field | Required | Purpose |
| --- | --- | --- |
| `latitude`, `longitude` | ✅ | point location |
| `shipmentId` | — | groups points into separate lines |
| `order` | — | orders points along each line (timestamp or sequence) |
| `eventType` | — | non-null → an event marker; drives symbol/color |
| `tooltip` | — | one or more columns shown on a marker's hover (one `Name: value` line each) |

Events at the **same place** (same shipment + same coordinate, rounded to ~1m)
are **merged** into one pin with a count badge and combined tooltip, regardless
of timestamp.

**Marker symbols** are auto-assigned per event type (see the legend). To set
specific ones, use the **`eventSymbols`** field — one `Event type=symbol` per
line (emoji or any glyph work):

```
Temp excursion=🌡
Delay=⏱
Delivered=✓
```
Unlisted types keep their auto-assigned glyph.

**Geofences source** (`geofences`):

| Field | Required | Purpose |
| --- | --- | --- |
| `geofenceGeometry` | ✅ (for geofences) | geometry — use `BOUNDARY` (or `BOUNDARY_GEOJSON`) from `TRANSFORMS.PLATFORM.GEOFENCES_LATEST_V3` |
| `geofenceLabel` | — | hover tooltip (e.g. `LOCATION_NAME`) |
| `geofenceCategory` | — | fill color by category (e.g. `GEOFENCE_LOCATION_TYPE`) |

**Styling:** `lineStyle`, `lineColor`, `showArrows`, `colorPalette`, `basemap` +
`hereApiKey`, `showLegendHeader`, `legendTitle`.

### Geofence geometry

Feed the **`BOUNDARY`** column (GEOGRAPHY) — Snowflake serializes it to GeoJSON,
identical to `BOUNDARY_GEOJSON`. The parser accepts a GeoJSON object, a GeoJSON
string, or WKT. It covers both shapes the platform uses:

- **Circle** → GeoJSON `{"properties":{"radius":<m>,"subType":"Circle"},"geometry":{"type":"Point",…}}` — drawn as `L.circle`.
- **Polygon** → standard GeoJSON `Polygon` — drawn directly.

> ⚠️ A circle's radius survives **only in the GeoJSON form** (the raw GEOGRAPHY
> is just a center point). If circles render as tiny dots, Sigma delivered the
> column as WKT — switch the column to `BOUNDARY_GEOJSON` or `ST_ASGEOJSON(BOUNDARY)`.

> Geofences aren't clustered — **filter to the relevant ones** in your query
> (the source table has ~90k). Don't point it at the whole table unfiltered.

## Local development

```bash
npm install
npm run dev        # serves http://localhost:3001
```

Demo mode (no workbook needed): `http://localhost:3001/?demo=1` renders a sample
SF→OKC route with events (including a merged one) and two geofences. Params:
`?lineStyle=Dashed`, `?noarrows`, `?palette=Warm`, `?linecolor=e15759`,
`?basemap=HERE Day&here=YOUR_KEY`.

In Sigma: add a **Plugin** element, set the Dev URL to `http://localhost:3001`,
then assign the **points** source (+ columns) and optionally the **geofences**
source.

## Deploying

Static build — same as `sigma-map-plugin`. `npm run build` → host `./dist` over
HTTPS (GitHub Pages, etc.) → register the URL in Sigma under Custom Plugins.
`base: './'` keeps asset paths relative.
