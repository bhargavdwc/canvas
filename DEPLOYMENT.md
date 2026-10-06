# Production Deployment Guide: Vercel + Render + Supabase

This guide walks you through deploying the **Spatial Message World** application into production:
- **Database**: Supabase (PostgreSQL + PostGIS)
- **Backend API**: Render (Fastify Node.js Web Service)
- **Frontend**: Vercel (Vite + React SPA)

---

## 1. Supabase (Database Setup)

1. Go to your [Supabase Dashboard](https://supabase.com/dashboard) and open or create your project.
2. In the left navigation, click **SQL Editor** -> **New query**.
3. Open [`database/supabase_init.sql`](file:///d:/extra/canvas/database/supabase_init.sql), copy its entire content, paste it into the SQL Editor, and click **Run**.
   - This enables the `postgis` extension.
   - Creates the `sessions`, `reservations`, `messages`, `reports`, and `audit_logs` tables.
   - Sets up spatial indexes (`messages_xy_live`, `messages_spatial_box`, etc.) and Row Level Security policies.
4. Retrieve your Supabase keys from **Project Settings** -> **API**:
   - **Project URL** (e.g. `https://your-project.supabase.co`)
   - **anon / public key** or **service_role key**

---

## 2. Render (Backend Deployment)

You can deploy to Render either using the automated **Blueprint (`render.yaml`)** or as a **Manual Web Service**.

### Option A: 1-Click Blueprint (Recommended)
1. Push your repository to GitHub / GitLab.
2. In the [Render Dashboard](https://dashboard.render.com/), click **New +** -> **Blueprint**.
3. Connect your repository. Render will automatically detect [`render.yaml`](file:///d:/extra/canvas/render.yaml) and configure:
   - Build Command: `pnpm install --frozen-lockfile=false && pnpm --filter @canvas/shared-types build && pnpm --filter @canvas/validation build && pnpm --filter @canvas/api build`
   - Start Command: `pnpm --filter @canvas/api start`
   - Health Check Path: `/health`
4. Set the prompted environment variables:
   - `SUPABASE_URL`: Your Supabase Project URL
   - `SUPABASE_KEY`: Your Supabase API key
   - (Optional) `CORS_ORIGIN`: `https://*.vercel.app,http://localhost:5173`
5. Click **Apply**. Once built, note your backend URL (e.g. `https://spatial-canvas-api.onrender.com`).

### Option B: Manual Web Service
1. In Render Dashboard, click **New +** -> **Web Service**.
2. Connect your Git repository.
3. Configure the settings:
   - **Name**: `spatial-canvas-api`
   - **Runtime**: `Node`
   - **Build Command**:
     ```bash
     pnpm install --frozen-lockfile=false && pnpm --filter @canvas/shared-types build && pnpm --filter @canvas/validation build && pnpm --filter @canvas/api build
     ```
   - **Start Command**:
     ```bash
     pnpm --filter @canvas/api start
     ```
   - **Health Check Path**: `/health`
4. Add Environment Variables:
   - `NODE_ENV`: `production`
   - `HOST`: `0.0.0.0`
   - `TRUST_PROXY`: `true`
   - `SESSION_SECRET`: (Generate any random 32+ character string)
   - `CORS_ORIGIN`: `https://*.vercel.app,http://localhost:5173`
   - `SUPABASE_URL`: (Your Supabase URL)
   - `SUPABASE_KEY`: (Your Supabase API Key)
5. Click **Create Web Service**.

---

## 3. Vercel (Frontend Deployment)

### Method 1: Vercel Dashboard with Monorepo Root (Zero Config)
1. In the [Vercel Dashboard](https://vercel.com/dashboard), click **Add New...** -> **Project**.
2. Select your repository.
3. Vercel will detect root [`vercel.json`](file:///d:/extra/canvas/vercel.json):
   - **Framework Preset**: Vite
   - **Root Directory**: `./` (leave default)
   - **Build Command**: `pnpm --filter @canvas/shared-types build && pnpm --filter @canvas/validation build && pnpm --filter @canvas/web build`
   - **Output Directory**: `apps/web/dist`
4. In **Environment Variables**, add:
   - `VITE_API_URL`: `https://spatial-canvas-api.onrender.com` (Your live Render backend URL)
5. Click **Deploy**.

### Method 2: Vercel Dashboard with `apps/web` Root Directory
1. If you prefer pointing Vercel directly to the web app:
   - Set **Root Directory** to `apps/web`
   - Keep "Include source files outside of the Root Directory in the Build Step" checked.
2. In **Environment Variables**, add:
   - `VITE_API_URL`: `https://spatial-canvas-api.onrender.com`
3. Click **Deploy**.

---

## 4. Verification Checklist

1. **API Health**: Visit `https://your-api.onrender.com/health` in your browser. It should respond:
   ```json
   {"status":"ok","uptime":...}
   ```
2. **Frontend Connectivity**: Open your Vercel URL (`https://your-app.vercel.app`).
   - The status bar at the top should show the connected live canvas indicator.
   - Opening DevTools Network tab will show successful requests to `/health`, `/api/v1/session`, and the live WebSocket connection to `wss://your-api.onrender.com/api/v1/ws`.
3. **Placing a Message**:
   - Double-click on any grid cell or click the composer.
   - Enter your message and click **Publish to Grid**.
   - Your message will be permanently recorded in Supabase and broadcast to all connected visitors in real time!
