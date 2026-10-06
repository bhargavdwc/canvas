-- 001_init: core schema. Requires PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE sessions (
  id           uuid PRIMARY KEY,
  token_hash   text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  blocked      boolean NOT NULL DEFAULT false
);

-- A position handed to a visitor until they write there (or it expires).
CREATE TABLE reservations (
  session_id uuid PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  x          integer NOT NULL,
  y          integer NOT NULL,
  location   geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x, y), 0)) STORED,
  expires_at timestamptz NOT NULL
);
CREATE INDEX reservations_location_gix ON reservations USING GIST (location);

CREATE TABLE messages (
  id         uuid PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES sessions(id),
  content    text NOT NULL,
  x          integer NOT NULL,
  y          integer NOT NULL,
  location   geometry(Point, 0) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(x, y), 0)) STORED,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_coord_range CHECK (abs(x) <= 1000000 AND abs(y) <= 1000000),
  CONSTRAINT messages_content_chars CHECK (char_length(content) BETWEEN 1 AND 10000),
  CONSTRAINT messages_content_words CHECK (
    array_length(regexp_split_to_array(btrim(content), '\s+'), 1) <= 1000
  )
);
-- One live message per coordinate: hard backstop behind the application-level spacing check.
CREATE UNIQUE INDEX messages_xy_live ON messages (x, y) WHERE status <> 'deleted';
CREATE INDEX messages_location_gix ON messages USING GIST (location);
CREATE INDEX messages_session_idx ON messages (session_id);
CREATE INDEX messages_created_at_idx ON messages (created_at);
CREATE INDEX messages_status_idx ON messages (status);

CREATE TABLE reports (
  id                  uuid PRIMARY KEY,
  message_id          uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  reason              text NOT NULL,
  details             text,
  reporter_session_id uuid NOT NULL REFERENCES sessions(id),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, reporter_session_id)
);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);

CREATE TABLE audit_logs (
  id          uuid PRIMARY KEY,
  actor       text NOT NULL,
  action      text NOT NULL,
  target_type text NOT NULL,
  target_id   text NOT NULL,
  ip          text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_created_at_idx ON audit_logs (created_at DESC);
