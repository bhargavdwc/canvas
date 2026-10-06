import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

function tryLoadDotEnv(targetEnv: NodeJS.ProcessEnv): void {
  const candidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '../../.env'),
    resolve(process.cwd(), '../.env'),
  ];
  for (const c of candidates) {
    if (existsSync(c)) {
      try {
        const content = readFileSync(c, 'utf8');
        for (const line of content.split('\n')) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith('#')) continue;
          const eq = trimmed.indexOf('=');
          if (eq > 0) {
            const key = trimmed.slice(0, eq).trim();
            const val = trimmed.slice(eq + 1).trim();
            if (targetEnv[key] === undefined) {
              targetEnv[key] = val;
            }
          }
        }
      } catch {
        // ignore
      }
    }
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  HOST: z.string().default('0.0.0.0'),
  API_PORT: z.coerce.number().int().min(0).max(65535).default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  /** When set, PostgreSQL + PostGIS is used. Otherwise Supabase or in-memory store. */
  DATABASE_URL: z.string().url().or(z.literal('')).optional(),
  /** Supabase connection parameters. When set, Supabase is used as database. */
  SUPABASE_URL: z.string().url().or(z.literal('')).optional(),
  SUPABASE_KEY: z.string().optional(),
  /** Snapshot file for the in-memory store. Set to empty to disable persistence. */
  DATA_FILE: z.string().default('.data/canvas.json'),
  /** When set, rate limits are shared through Redis. Otherwise they are per-process. */
  REDIS_URL: z.string().optional(),

  /** Used to HMAC session tokens before they are stored. */
  SESSION_SECRET: z.string().min(16).default('dev-only-session-secret-change-me'),
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  /** Comma separated list of allowed browser origins. */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** Admin endpoints are disabled unless this is set (min 16 chars). */
  ADMIN_TOKEN: z.string().min(16).optional(),
  /** Trust X-Forwarded-For (set behind Cloudflare / a load balancer). */
  TRUST_PROXY: bool.default(false),

  /** Reservation lifetime for an allocated position. */
  RESERVATION_TTL_MINUTES: z.coerce.number().int().min(1).default(24 * 60),
  /** Rate-limit knobs (requests per window). Tune after load testing. */
  RL_MESSAGES_PER_MIN_SESSION: z.coerce.number().int().min(1).default(10),
  RL_MESSAGES_PER_MIN_IP: z.coerce.number().int().min(1).default(30),
  RL_REQUESTS_PER_MIN_IP: z.coerce.number().int().min(1).default(600),
  RL_REALLOC_PER_10MIN_SESSION: z.coerce.number().int().min(1).default(6),
  RL_REPORTS_PER_MIN_SESSION: z.coerce.number().int().min(1).default(5),
  WS_MAX_CONNECTIONS_PER_IP: z.coerce.number().int().min(1).default(20),
});

export type Config = Omit<z.infer<typeof envSchema>, 'COOKIE_SECURE'> & {
  COOKIE_SECURE: boolean;
  corsOrigins: string[];
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  tryLoadDotEnv(env);
  const isRender = !!env.RENDER;
  const isProd = env.NODE_ENV === 'production' || isRender;

  const normalized = {
    ...env,
    API_PORT: env.PORT || env.API_PORT,
    TRUST_PROXY: env.TRUST_PROXY ?? (isRender ? 'true' : undefined),
    SUPABASE_URL: env.SUPABASE_URL !== undefined ? (env.SUPABASE_URL || undefined) : env.VITE_SUPABASE_URL,
    SUPABASE_KEY: env.SUPABASE_KEY !== undefined ? (env.SUPABASE_KEY || undefined) : env.VITE_SUPABASE_PUBLISHABLE_KEY,
  };
  const parsed = envSchema.safeParse(normalized);
  if (!parsed.success) {
    const detail = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${detail}`);
  }
  const cfg = parsed.data;
  const cookieSecure = cfg.COOKIE_SECURE ?? isProd;
  return {
    ...cfg,
    COOKIE_SECURE: cookieSecure,
    COOKIE_SAMESITE: env.COOKIE_SAMESITE ? cfg.COOKIE_SAMESITE : (cookieSecure ? 'none' : 'lax'),
    corsOrigins: cfg.CORS_ORIGIN.split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
}

