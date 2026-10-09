# Spatial Message World 🌐

> A persistent, multiplayer infinite 2D spatial message canvas powered by **React 19**, **PixiJS 8**, **Fastify 5**, and **Supabase (PostgreSQL + PostGIS)**.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)
[![PixiJS](https://img.shields.io/badge/PixiJS-8.x-e72264.svg)](https://pixijs.com/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![PostGIS](https://img.shields.io/badge/PostGIS-Spatial_DB-336791.svg)](https://postgis.net/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌟 Overview

**Spatial Message World** is a massive, persistent 2D spatial canvas where users can explore, write, and read notes anchored to exact world coordinates. 

- **Widescreen 2:1 Canvas Universe**: A bounded universe spanning **2,000,100 × 1,000,100** world units (over **200 million** distinct 100×100 grid boxes).
- **Edge-to-Edge Overview**: When zoomed fully out (~0.07% – 0.08%), the canvas fits modern widescreen displays edge-to-edge with zero blank margins and zero vertical scroll.
- **Natural Earth Vector World Map**: Outlines of global coastlines and international country borders rendered directly from official Natural Earth 1:110m vector data at full zoom-out, fading smoothly as you zoom into local neighborhoods.
- **Proximity-Based Lighting (LOD)**: Messages appear as subtle, faint dots when viewed from far away and smoothly brighten into crisp, glowing message cards as you zoom in close.
- **Dynamic Multi-Box Allocation**: Notes scale gracefully up to **10,000 characters**, automatically allocating neighbor grid boxes on a 100-unit snapped grid.
- **Smart Coordinate Search & Safety**: Filtered coordinate search (numbers, commas, negative signs only) with real-time out-of-bounds warning banners.
- **Spatial Real-time Broadcasting**: WebSockets powered by a spatial chunk hub (`RealtimeHub`)—users only receive updates for notes created in their visible viewport.
- **Authoritative Anti-Camping**: Prevents coordinate collision and ensures separation between notes using PostGIS spatial indexes and HMAC session tokens.

---

## 📐 Canvas & Grid Architecture

| Dimension | World Coordinate Range | Total World Units | Total Grid Cells (100×100) |
| :--- | :--- | :--- | :--- |
| **Width (X)** | `-1,000,000` to `+1,000,100` | **2,000,100** | **20,001** columns |
| **Height (Y)** | `-500,000` to `+500,100` | **1,000,100** | **10,001** rows |
| **Total Boxes** | — | — | **200,030,001** possible boxes |
| **Aspect Ratio** | 2 : 1 widescreen | — | Zero vertical scroll on full zoom-out |

---

### 🌍 Multi-Level Geographic Vector Map System (LOD 0 – LOD 4)

Spatial Message World features a **progressive multi-level vector map system** that reveals finer administrative and geographic details as users zoom in from orbit down to local neighborhoods:

```
       Longitude -180°                              (0, 0)                              Longitude +180°
 Latitude +90° ┌───────────────────────────────────────┬───────────────────────────────────────┐
 (Canvas Top)  │                  ·····                │                ·····                  │
               │             .····     ··.             │            .····     ··.              │
               │            :   NORTH     :            │           :   EUROPE /  :             │
               │            :   AMERICA   :            │           :    ASIA     :             │
               │             ·.         .·             │            ·.         .·              │
               │               ·.     .·               │              ·.     .·                │
     Equator 0°├─────────────────·───·─────────────────┼────────────────·───·──────────────────┤
               │                  : :                  │                  : :                  │
               │             .····   ··.               │             .····   ··.               │
               │            :   SOUTH   :              │            :   AFRICA  :              │
               │            :  AMERICA  :              │            :  AUSTRALIA:              │
               │             ·.       .·               │             ·.       .·               │
 Latitude -90° │               ·.   .·                 │               ·.   .·                 │
(Canvas Bottom)└─────────────────···───────────────────┴─────────────────···───────────────────┘
               X: -1,000,000                                                   X: +1,000,100
               Y: -500,000                                                     Y: +500,100
```

#### 1. Mathematical Projection (Equirectangular)
The global geographic coordinates $(\lambda = \text{longitude}, \phi = \text{latitude})$ map linearly to the canvas's $2{,}000{,}100 \times 1{,}000{,}100$ coordinate system:

$$\text{World } X = X_{\min} + \left( \frac{\lambda + 180}{360} \right) \times W = -1{,}000{,}000 + \left( \frac{\lambda + 180}{360} \right) \times 2{,}000{,}100$$

$$\text{World } Y = Y_{\min} + \left( \frac{\phi + 90}{180} \right) \times H = -500{,}000 + \left( \frac{\phi + 90}{180} \right) \times 1{,}000{,}100$$

*Because the PixiJS canvas coordinates have $+Y$ pointing upward in world space, the Prime Meridian ($\lambda = 0^\circ$) and the Equator ($\phi = 0^\circ$) align exactly at canvas origin $(0, 0)$ (Gulf of Guinea).*

#### 2. Level of Detail (LOD) Tiers & Visual Styling

| Tier | Name | Zoom Range | Screen Scale | Geographic Dataset | Styling (Dark Theme) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **LOD 0** | **World Overview** | `0.07%` – `0.35%` | `0.0006 – 0.0035` | Natural Earth 1:110m Admin 0 | Coastlines: pale sky-blue (`#7dd3fc`, 0.38 alpha)<br>Borders: subtle slate (`#94a3b8`, 0.22 alpha) |
| **LOD 1** | **Country Detail** | `0.10%` – `8.00%` | `0.0010 – 0.0800` | Natural Earth 1:50m Admin 0 | National frontiers & coastlines (`#38bdf8`, 0.42 alpha). Stays 100% visible across state & city zooms! |
| **LOD 2** | **States & Provinces** | `0.35%` – `8.00%` | `0.0035 – 0.0800` | Natural Earth 1:10m Admin 1 | State/provincial frontiers worldwide (US states, Indian states, etc.) (`#818cf8`, 0.35 alpha). |
| **LOD 3** | **Districts & Municipal** | `1.50%` – `8.00%` | `0.0150 – 0.0800` | geoBoundaries CGAZ ADM2 | 49,349 district & municipal corporate limits worldwide (`#2dd4bf`, 0.30 alpha). |
| **Places** | **Populated Places** | `0.80%` – `8.00%` | `0.0080 – 0.0800` | Natural Earth 1:10m Places | 7,342 city & town location points with rank-based filtering, gold capital rings, and collision-avoided labels. |
| **LOD 4** | **Street Network** | `3.50%` – `8.00%` | `0.0350 – 0.0800` | OpenStreetMap road networks | Physical street & roadway alignments (`#64748b`, 0.25 alpha). |
| **Notes** | **Message Cards** | `> 8.00%` to `400%` | `0.0800 – 4.0000` | — | **All map layers fade out** (`visible = false`). Note cards, coordinate badges, text editing, and composing take priority. |

> **Administrative City Boundaries vs. Physical Street Networks vs. City Points**: Administrative boundaries (Admin 2 / municipal corporate limits) are jurisdictional dividing lines, street networks are topological paths representing physical roadways, and populated places are distinct point locations. City points are never treated as fake polygons.

#### 3. Spatial Tiling & Bounded LRU Memory Management
- **Spatial Grid Partitioning**: Detailed vector layers (LOD 2–3) are partitioned into geographic grid tiles ($16 \times 8$, $22.5^\circ \times 22.5^\circ$).
- **Viewport Culling**: Only tiles intersecting the current camera viewport bounding box are queried or rendered.
- **Request Deduplication & Cancellation**: In-flight HTTP requests are deduplicated. Rapid panning or zooming triggers automatic request cancellation via `AbortController` for off-screen tiles.
- **LRU GPU Eviction**: Display objects are tracked in an LRU cache (default 80 tiles). When capacity is exceeded, oldest off-screen tiles are destroyed (`graphics.destroy()`), freeing GPU VRAM and preventing memory bloat.
- **Hysteresis Safeguard**: An 8% deadband threshold buffer prevents flickering and rapid swapping when zooming smoothly around LOD transition boundaries.

#### 4. Reproducible Geographic Data Pipeline
A standalone Python pipeline (`scripts/geo/process_boundaries.py`) processes raw ESRI shapefiles into simplified, antimeridian-split spatial vector tiles and compact point features without external GIS runtime dependencies:
```bash
python scripts/geo/process_boundaries.py --all
```

---

## 🏗️ Monorepo Structure

The project is structured as a high-performance **pnpm workspace**:

```text
canvas/
├── apps/
│   ├── web/                     # React 19 + PixiJS 8 + Vite + Tailwind CSS v4 frontend
│   │   ├── public/map/          # Spatially-tiled vector map assets (lod1, lod2, lod3, lod4)
│   │   ├── src/features/world/  # Canvas renderer, camera clamping, HUD, modals
│   │   │   ├── canvas/          # WorldRenderer (PixiJS 8 pipeline, LOD, culling)
│   │   │   ├── map/             # Multi-level geographic vector map system
│   │   │   │   ├── MapConfig.ts      # Central LOD thresholds, styles, cache & hysteresis settings
│   │   │   │   ├── projection.ts     # Equirectangular projection math & antimeridian handling
│   │   │   │   ├── TileManager.ts    # Spatial grid math & viewport tile intersection queries
│   │   │   │   ├── TileCache.ts      # Bounded LRU cache with GPU resource disposal
│   │   │   │   ├── TileLoader.ts     # In-flight deduplication & request cancellation
│   │   │   │   ├── MapLodManager.ts  # Multi-level LOD orchestrator and crossfader
│   │   │   │   ├── worldMapData.json # Natural Earth 1:110m overview dataset
│   │   │   │   └── mapLod.test.ts    # Test suite (projection, tiles, LRU, deduplication)
│   │   │   ├── background/      # Starfield procedural backdrop & ambient lighting
│   │   │   ├── components/      # CoordinateSearch, CoordinateDisplay, MessageComposer, WorldControls
│   │   │   └── utils/           # Coordinate math, viewport culling, text wrapping
│   │   └── vercel.json          # SPA rewrites & asset caching for Vercel
│   └── api/                     # Fastify 5 backend with WebSockets & PostGIS integration
├── scripts/
│   ├── generate_map_tiles.py    # Python pipeline converting shapefiles to spatial tiles
│   └── README.md                # Data pipeline documentation & dataset licensing
├── packages/
│   ├── shared-types/            # Canonical domain models, wire protocols, API contracts
│   └── validation/              # Zod validation schemas for coordinates, content & bounds
├── database/
│   └── supabase_init.sql        # Turnkey PostGIS schema, spatial indexes & RLS policies
├── render.yaml                  # 1-Click Render blueprint for the API backend
├── vercel.json                  # Root configuration for Vercel deployments
├── DEPLOYMENT.md                # Comprehensive production deployment walkthrough
└── README.md
```

---

## 🚀 Key Features

### 1. High-Performance Infinite 2D Engine
- Powered by **PixiJS 8 WebGL/WebGPU** with viewport culling, dynamic LOD, and dual-level coordinate grids.
- Browser URL synchronization (`/@x,y`), deep-linking to any coordinate in the world.
- Smooth mouse-drag inertia, trackpad pinch, and keyboard navigation (<kbd>Arrows</kbd>, <kbd>+</kbd>, <kbd>-</kbd>).
- Inset-aware camera clamping keeps boxes visible without overlapping behind the top navigation header.

### 2. Border-Only Natural Earth Vector Map Layer
- Real geographic boundaries from the **Natural Earth 1:110m Admin 0** dataset with zero third-party map tiles or external API dependencies.
- Distinct color-coded vector strokes: pale sky-blue for coastlines (`#7dd3fc`) and subtle slate-gray for shared international borders (`#94a3b8`).
- Completely outline-only: no polygon fills, no labels, no flags, preserving the sleek, minimal dark universe aesthetic.
- Seamless zoom-dependent LOD: full overview at maximum zoom-out, smooth cubic fade-out between `0.11%` and `0.88%`, completely transparent at street/note level.
- Non-interactive and pointer-transparent (`eventMode = 'none'`), ensuring messages can be clicked or composed everywhere without collision.

### 3. Intelligent Multi-Box Spatial Layout
- Short messages take a single clean 100×100 grid box.
- Long essays (up to 10,000 characters) automatically calculate bounding box dimensions (2×1, 2×2, 3×2, 3×3, etc.) and occupy neighbor cells seamlessly.
- Dedicated inner text masking ensures outer accent borders never get clipped.

### 4. Smart Coordinate Search & Input Protection
- Accepts formats: `1245, -782`, `-500 300`, `(100, 200)`.
- Input validation: strictly allows numbers, commas, negative signs, and spaces. Blocks all alphabetic letters on keypress and paste.
- Out-of-bounds warning: displays a clean, single-line amber banner when searching coordinates beyond canvas limits (X: `±1,000,000`, Y: `±500,000`).

### 5. Spatial Realtime Streaming
- WebSocket connections (`/api/v1/ws`) track the client's visible camera bounding box.
- Messages are indexed into spatial chunks ($1000 \times 1000$ units). Only watchers subscribed to overlapping chunks receive real-time updates.

### 6. Enterprise-Grade Moderation & Anti-Abuse
- Token-authenticated sessions with HMAC signing.
- Rate limiting per IP and per session (in-memory or distributed via Redis).
- Community reporting pipeline with categorical flags (`spam`, `harassment`, `hate`, `illegal`).
- Immutable audit log tracking administrative status changes.

---

## ⚡ Quickstart

### Prerequisites
- **Node.js**: `v20.x` or `v22.x` (LTS recommended)
- **pnpm**: `v9.x` or `v10.x`

### 1. Clone & Install
```bash
git clone https://github.com/bhargavdwc/canvas.git
cd canvas
pnpm install
```

### 2. Configure Environment
Copy the root `.env.example` to `.env`:
```bash
cp .env.example .env
```

*Note: The app runs locally with zero external dependencies by default (in-memory persistence with `.data/canvas.json` fallback). To use Supabase, provide your `SUPABASE_URL` and `SUPABASE_KEY`.*

### 3. Start Development Servers
Run both frontend and backend concurrently:
```bash
pnpm dev
```

Or run them in separate terminals:
```bash
# Terminal 1: Backend API (http://localhost:4000)
pnpm dev:api

# Terminal 2: Web Client (http://localhost:5173)
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Verification

The codebase includes **63 comprehensive unit and integration tests** across all monorepo packages:

```bash
# Run all workspace test suites (63 tests across validation, api, web)
pnpm test

# Run TypeScript typechecks across all monorepo workspaces
pnpm typecheck

# Build all packages for production
pnpm build
```

---

## 🚢 Production Deployment

### 1. Database (Supabase + PostGIS)
1. Open your [Supabase Dashboard](https://supabase.com/dashboard) and create a project.
2. Go to **SQL Editor** -> **New query**.
3. Paste and run [`database/supabase_init.sql`](database/supabase_init.sql).
4. Retrieve your **Project URL** and **API Key** from **Project Settings** -> **API**.

### 2. Backend (Render)
1. In the [Render Dashboard](https://dashboard.render.com/), click **New +** -> **Blueprint**.
2. Connect your Git repository. Render will automatically read [`render.yaml`](render.yaml).
3. Set your environment variables:
   - `SUPABASE_URL`: Your Supabase URL
   - `SUPABASE_KEY`: Your Supabase API Key
4. Deploy the service. Render will start the API at `https://<your-service>.onrender.com`.

### 3. Frontend (Vercel)
1. In the [Vercel Dashboard](https://vercel.com/dashboard), import your repository.
2. Under **Environment Variables**, add:
   - `VITE_API_URL`: `https://<your-service>.onrender.com` (Your Render backend URL)
3. Click **Deploy**. Vercel will build and serve the static SPA bundle with full SPA routing.

For detailed steps, see the complete [Production Deployment Guide](DEPLOYMENT.md).

---

## ⚙️ Environment Variables

### Backend (`apps/api`)
| Variable | Description | Default |
|:---|:---|:---|
| `NODE_ENV` | Environment (`development`, `production`, `test`) | `development` |
| `API_PORT` / `PORT` | Listening port (Render automatically provides `PORT`) | `4000` |
| `HOST` | Server host binding | `0.0.0.0` |
| `TRUST_PROXY` | Trust reverse proxy headers (Cloudflare, Render) | `true` in prod |
| `SESSION_SECRET` | 32+ char secret for HMAC session signing | *required in prod* |
| `CORS_ORIGIN` | Comma-separated list of allowed origins | `https://*.vercel.app,http://localhost:5173` |
| `SUPABASE_URL` | Supabase project URL | Optional (memory fallback) |
| `SUPABASE_KEY` | Supabase API key | Optional |
| `DATABASE_URL` | Direct PostgreSQL connection string with PostGIS | Optional |
| `REDIS_URL` | Redis URL for distributed rate limiting | Optional |
| `ADMIN_TOKEN` | Bearer token for accessing admin and audit routes | Optional |

### Frontend (`apps/web`)
| Variable | Description | Default |
|:---|:---|:---|
| `VITE_API_URL` | HTTP base URL of the backend API | `http://localhost:4000` |
| `VITE_WS_URL` | Optional custom WebSocket endpoint | Auto-derived from `VITE_API_URL` |

---

## 📡 API Overview

### HTTP Endpoints
- `GET /health`: Health probe returning status and uptime.
- `GET /ready`: Readiness probe verifying database connectivity.
- `POST /api/v1/session`: Initializes or resumes visitor session and returns allocated coordinates.
- `GET /api/v1/world/position`: Fetches current session reservation.
- `POST /api/v1/world/allocate-position`: Reallocates a random coordinate or reserves a target coordinate `{ x, y }`.
- `GET /api/v1/world/messages`: Spatial bounding-box query (`minX, maxX, minY, maxY, limit`).
- `GET /api/v1/world/density`: Aggregated density cells for zoomed-out camera views.
- `GET /api/v1/coordinates/:x/:y`: Fetches note at exact coordinates.
- `POST /api/v1/messages`: Publishes note content (up to 10,000 characters).
- `POST /api/v1/messages/:id/report`: Reports a message for moderation.

### WebSocket Protocol (`/api/v1/ws`)
- **Client to Server**:
  - `{ type: "subscribe", bounds: { minX, maxX, minY, maxY } }`: Watch spatial area.
  - `{ type: "unsubscribe" }`: Stop receiving spatial updates.
  - `{ type: "ping" }`: Keep-alive ping.
- **Server to Client**:
  - `{ type: "hello", maxChunks }`: Handshake confirmation.
  - `{ type: "message.created", message }`: Broadcasted when a new note appears within subscribed bounds.
  - `{ type: "message.removed", id }`: Broadcasted when a note is removed.
  - `{ type: "pong" }`: Heartbeat response.

---

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
