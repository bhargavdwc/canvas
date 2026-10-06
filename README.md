# Spatial Message World 🌐

> A persistent, multiplayer infinite 2D spatial message canvas powered by **React 19**, **PixiJS 8**, **Fastify**, and **Supabase (PostgreSQL + PostGIS)**.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/React-19.x-61dafb.svg)](https://react.dev/)
[![PixiJS](https://img.shields.io/badge/PixiJS-8.x-e72264.svg)](https://pixijs.com/)
[![Fastify](https://img.shields.io/badge/Fastify-5.x-black.svg)](https://fastify.dev/)
[![PostGIS](https://img.shields.io/badge/PostGIS-Spatial_DB-336791.svg)](https://postgis.net/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-v4-38bdf8.svg)](https://tailwindcss.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 🌟 Overview

**Spatial Message World** is an infinite 2D canvas where users can explore, write, and read persistent notes anchored to exact world coordinates. 

- **Infinite Exploration**: Seamless pan, smooth inertia, wheel/pinch zoom, coordinate grids, and teleportation.
- **Dynamic Multi-Box Allocation**: Notes scale gracefully up to **10,000 characters**, automatically allocating neighbor grid boxes on a 100-unit snapped grid.
- **Spatial Real-time Broadcasting**: Real-time WebSockets powered by a spatial chunk hub (`RealtimeHub`)—users only receive live updates for notes created in their visible viewport.
- **Authoritative Server Allocation**: Prevents coordinate camping and ensures minimum distance separation between notes using PostGIS spatial indexes and HMAC session tokens.
- **Production Ready**: Fully configured for **Vercel** (Frontend) and **Render** (Backend) with **Supabase** (Postgres + PostGIS).

---

## 🏗️ Monorepo Architecture

The repository is organized as a high-performance **pnpm workspace**:

```text
canvas/
├── apps/
│   ├── web/                     # React 19 + PixiJS 8 + Vite + Tailwind CSS v4 frontend
│   │   ├── src/features/world/  # Canvas renderer, camera system, composer, modals
│   │   └── vercel.json          # SPA rewrites & asset caching for Vercel
│   └── api/                     # Fastify 5 backend with WebSockets & PostGIS integration
│       ├── src/repo/            # Database repository adapters (Supabase, Postgres, Memory)
│       ├── src/services/        # Session allocation, anti-camping, message lifecycle
│       └── src/realtime/        # Chunk-based spatial WebSocket hub
├── packages/
│   ├── shared-types/            # Canonical domain models, wire protocols, API contracts
│   └── validation/              # Zod validation schemas for coordinates, content & bounds
├── database/
│   └── supabase_init.sql        # Turnkey PostGIS schema, spatial indexes & RLS policies
├── render.yaml                  # 1-Click Render blueprint for the API backend
├── vercel.json                  # Root configuration for Vercel deployments
└── DEPLOYMENT.md                # Step-by-step production deployment guide
```

---

## 🚀 Key Features

### 1. High-Performance Infinite 2D Engine
- Built on **PixiJS 8 WebGL/WebGPU** with viewport culling, dynamic LOD (Level of Detail), and dual-level coordinate grids.
- Synchronized camera with browser URL routing (`/@x,y`), deep-linking to any location in the world.
- Smooth keyboard navigation (Arrow keys / WASD), trackpad pinch, and mouse-drag inertia.

### 2. Intelligent Multi-Box Spatial Layout
- Short messages take a single clean 100×100 grid box.
- Long essays (up to 10,000 characters) automatically calculate bounding box dimensions (2×1, 2×2, 3×2, 3×3, etc.) and occupy neighbor cells seamlessly.
- Text wraps dynamically with clear typographic hierarchy on a dark slate canvas.

### 3. Spatial Realtime Streaming
- WebSocket connections (`/api/v1/ws`) track the client's visible camera bounding box.
- Messages are hashed into spatial chunks ($1000 \times 1000$ units). Only watchers subscribed to overlapping chunks receive real-time notifications.

### 4. Enterprise-Grade Moderation & Anti-Abuse
- Token-authenticated sessions with HMAC signing.
- Rate limiting per IP and per session (in-memory or distributed via Redis).
- Community reporting pipeline with categorical flags (`spam`, `harassment`, `hate`, `illegal`, etc.).
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

Default local configuration runs with zero external dependencies (in-memory persistence with `.data/canvas.json` fallback). To use Supabase, provide your `SUPABASE_URL` and `SUPABASE_KEY`.

### 3. Start Development Servers
Run both frontend and backend concurrently:
```bash
pnpm dev
```

Or run them individually in separate terminal windows:
```bash
# Terminal 1: Backend API (http://localhost:4000)
pnpm dev:api

# Terminal 2: Web Client (http://localhost:5173)
pnpm dev:web
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 🧪 Testing & Verification

The codebase includes comprehensive unit and integration tests across all packages:

```bash
# Run all workspace test suites (46 tests)
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
| `SUPABASE_URL` | Supabase project URL | Optional (falls back to memory store) |
| `SUPABASE_KEY` | Supabase API key | Optional |
| `DATABASE_URL` | Direct PostgreSQL connection string with PostGIS | Optional |
| `REDIS_URL` | Redis URL for distributed rate limiting | Optional (in-memory default) |
| `ADMIN_TOKEN` | Bearer token for accessing admin and audit routes | Optional |

### Frontend (`apps/web`)
| Variable | Description | Default |
|:---|:---|:---|
| `VITE_API_URL` | HTTP base URL of the backend API | `http://localhost:4000` (or relative) |
| `VITE_WS_URL` | Optional custom WebSocket endpoint | Auto-derived from `VITE_API_URL` (`wss://...`) |

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
