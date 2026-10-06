-- ==============================================================================
-- Spatial Message World — Supabase Schema Initialization
-- Run this in your Supabase Dashboard -> SQL Editor -> New query -> Run
-- ==============================================================================

-- 1. Enable PostGIS Extension (Built into Supabase)
CREATE EXTENSION IF NOT EXISTS postgis;

-- 2. Sessions table
CREATE TABLE IF NOT EXISTS public.sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  blocked      boolean NOT NULL DEFAULT false
);

-- 3. Reservations table (positions allocated to visitors)
CREATE TABLE IF NOT EXISTS public.reservations (
  session_id uuid PRIMARY KEY REFERENCES public.sessions(id) ON DELETE CASCADE,
  x          integer NOT NULL,
  y          integer NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS reservations_xy_idx ON public.reservations (x, y);
CREATE INDEX IF NOT EXISTS reservations_expires_idx ON public.reservations (expires_at);

-- 4. Messages table (permanent spatial notes)
CREATE TABLE IF NOT EXISTS public.messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  content    text NOT NULL,
  x          integer NOT NULL,
  y          integer NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_coord_range CHECK (abs(x) <= 1000000 AND abs(y) <= 1000000),
  CONSTRAINT messages_content_chars CHECK (char_length(content) BETWEEN 1 AND 10000)
);

CREATE UNIQUE INDEX IF NOT EXISTS messages_xy_live ON public.messages (x, y) WHERE status <> 'deleted';
CREATE INDEX IF NOT EXISTS messages_spatial_box ON public.messages (x, y);
CREATE INDEX IF NOT EXISTS messages_session_idx ON public.messages (session_id);
CREATE INDEX IF NOT EXISTS messages_created_at_idx ON public.messages (created_at DESC);
CREATE INDEX IF NOT EXISTS messages_status_idx ON public.messages (status);

-- 5. Reports table (abuse moderation)
CREATE TABLE IF NOT EXISTS public.reports (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id          uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  reason              text NOT NULL,
  details             text,
  reporter_session_id uuid NOT NULL REFERENCES public.sessions(id) ON DELETE CASCADE,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_session_id)
);

CREATE INDEX IF NOT EXISTS reports_status_idx ON public.reports (status, created_at DESC);

-- 6. Audit logs table (admin immutable logs)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor       text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  ip          text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON public.audit_logs (created_at DESC);

-- 7. Row Level Security (RLS) Configuration
ALTER TABLE public.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Allow public access for application operations
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public access to messages') THEN
    CREATE POLICY "Public access to messages" ON public.messages FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public access to sessions') THEN
    CREATE POLICY "Public access to sessions" ON public.sessions FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public access to reservations') THEN
    CREATE POLICY "Public access to reservations" ON public.reservations FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public access to reports') THEN
    CREATE POLICY "Public access to reports" ON public.reports FOR ALL USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE policyname = 'Public access to audit_logs') THEN
    CREATE POLICY "Public access to audit_logs" ON public.audit_logs FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
