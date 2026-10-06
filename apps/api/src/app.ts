import Fastify, { type FastifyInstance, type FastifyRequest, type FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import cookie from '@fastify/cookie';
import websocket from '@fastify/websocket';
import { ZodError } from 'zod';
import {
  adminListQuerySchema,
  adminMessageStatusSchema,
  adminReportStatusSchema,
  clientWsMessageSchema,
  coordinateParamsSchema,
  densityQuerySchema,
  messagesQuerySchema,
  postMessageBodySchema,
  reportBodySchema,
} from '@canvas/validation';
import type { ApiResponse } from '@canvas/shared-types';
import type { Config } from './config';
import { AppError } from './errors';
import { Metrics } from './metrics';
import { RealtimeHub } from './realtime/hub';
import { LruCache } from './cache/lru';
import { MemoryRateLimiter, RedisRateLimiter, type RateLimiter } from './ratelimit/rateLimiter';
import { MemoryRepository } from './repo/memoryRepository';
import { PostgresRepository } from './repo/postgresRepository';
import { SupabaseRepository } from './repo/supabaseRepository';
import type { Repository, SessionRecord } from './repo/types';
import { AllocationService } from './services/allocationService';
import { SessionService } from './services/sessionService';
import { MessageService } from './services/messageService';
import Redis from 'ioredis';

declare module 'fastify' {
  interface FastifyRequest {
    session?: SessionRecord;
    sessionToken?: string;
  }
}

export interface AppContext {
  config: Config;
  repo: Repository;
  rateLimiter: RateLimiter;
  hub: RealtimeHub;
  metrics: Metrics;
  sessionService: SessionService;
  messageService: MessageService;
}

export async function createAppContext(config: Config): Promise<AppContext> {
  const metrics = new Metrics();
  const hub = new RealtimeHub();
  const cache = new LruCache<unknown>(2000);

  let repo: Repository;
  if (config.DATABASE_URL) {
    repo = new PostgresRepository(config.DATABASE_URL, (msg) => console.log(`[db] ${msg}`));
    await repo.init();
  } else if (config.SUPABASE_URL && config.SUPABASE_KEY) {
    const supabaseRepo = new SupabaseRepository(config.SUPABASE_URL, config.SUPABASE_KEY);
    await supabaseRepo.init();
    if (supabaseRepo.ready) {
      repo = supabaseRepo;
    } else {
      console.warn(`[storage] Running with local storage until Supabase tables are initialized.`);
      repo = new MemoryRepository(config.DATA_FILE);
      await repo.init();
    }
  } else {
    repo = new MemoryRepository(config.DATA_FILE);
    await repo.init();
  }

  let rateLimiter: RateLimiter;
  if (config.REDIS_URL) {
    const redis = new Redis(config.REDIS_URL);
    rateLimiter = new RedisRateLimiter(redis);
  } else {
    rateLimiter = new MemoryRateLimiter();
  }

  const allocationService = new AllocationService(repo, config.RESERVATION_TTL_MINUTES);
  const sessionService = new SessionService(
    repo,
    allocationService,
    rateLimiter,
    config.SESSION_SECRET,
    config.RL_REALLOC_PER_10MIN_SESSION,
  );
  const messageService = new MessageService(repo, hub, cache, metrics);

  metrics.gauge('connections.ws', () => hub.size);

  return {
    config,
    repo,
    rateLimiter,
    hub,
    metrics,
    sessionService,
    messageService,
  };
}

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const { config, repo, rateLimiter, hub, metrics, sessionService, messageService } = ctx;

  const app = Fastify({
    logger: {
      level: config.LOG_LEVEL,
    },
    trustProxy: config.TRUST_PROXY,
  });

  // Security plugins
  await app.register(helmet, {
    contentSecurityPolicy: false, // Served as an API backend
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  });

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin) {
        cb(null, true);
        return;
      }
      if (
        config.corsOrigins.includes('*') ||
        config.corsOrigins.includes(origin)
      ) {
        cb(null, true);
        return;
      }
      try {
        const parsed = new URL(origin);
        if (
          parsed.hostname.endsWith('.vercel.app') ||
          parsed.hostname === 'localhost' ||
          parsed.hostname === '127.0.0.1'
        ) {
          cb(null, true);
          return;
        }
      } catch {
        // invalid URL
      }
      cb(null, false);
    },
    credentials: true,
  });

  await app.register(cookie, {
    secret: config.SESSION_SECRET,
  });

  await app.register(websocket);

  // Global hooks: Request timing & metrics
  app.addHook('onRequest', async (req) => {
    (req.raw as unknown as { _startTime: number })._startTime = Date.now();
    metrics.inc('http.requests');

    // Global IP rate limiting
    const ip = req.ip || '127.0.0.1';
    const ipRl = await rateLimiter.hit(`ip:${ip}`, config.RL_REQUESTS_PER_MIN_IP, 60_000);
    if (!ipRl.allowed) {
      throw AppError.tooMany(ipRl.retryAfterSec, 'Global IP request rate limit exceeded.');
    }
  });

  app.addHook('onResponse', async (req, reply) => {
    const start = (req.raw as unknown as { _startTime?: number })._startTime;
    if (start) {
      const dur = Date.now() - start;
      metrics.observeLatency(dur);
    }
    if (reply.statusCode >= 500) {
      metrics.inc('http.errors.5xx');
    } else if (reply.statusCode >= 400) {
      metrics.inc('http.errors.4xx');
    }
  });

  // Helper for setting session cookie
  const setSessionCookie = (reply: FastifyReply, token: string) => {
    reply.setCookie('canvas_session', token, {
      path: '/',
      httpOnly: true,
      secure: config.COOKIE_SECURE,
      sameSite: config.COOKIE_SAMESITE,
      maxAge: 365 * 24 * 3600,
    });
  };

  // Helper for resolving current session
  const resolveSession = async (req: FastifyRequest, reply: FastifyReply) => {
    const headerToken = req.headers.authorization?.replace(/^Bearer\s+/i, '');
    const cookieToken = req.cookies.canvas_session;
    const token = headerToken || cookieToken;

    const { session, rawToken, isNew } = await sessionService.getOrCreateSession(token);
    req.session = session;
    req.sessionToken = rawToken;

    if (isNew || !cookieToken) {
      setSessionCookie(reply, rawToken);
    }
    return session;
  };

  // Admin authentication check
  const requireAdmin = async (req: FastifyRequest) => {
    if (!config.ADMIN_TOKEN) {
      throw AppError.forbidden('ADMIN_DISABLED', 'Admin interface is disabled on this server.');
    }
    const token =
      req.headers['x-admin-token'] || req.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (token !== config.ADMIN_TOKEN) {
      throw AppError.unauthorized('Invalid or missing admin token.');
    }
  };

  // Global error handler
  app.setErrorHandler((error, _req, reply) => {
    if (error instanceof AppError) {
      for (const [k, v] of Object.entries(error.headers)) {
        reply.header(k, v);
      }
      return reply.status(error.status).send({
        success: false,
        error: { code: error.code, message: error.message },
      } satisfies ApiResponse<never>);
    }

    if (error instanceof ZodError) {
      const msg = error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: msg },
      } satisfies ApiResponse<never>);
    }

    app.log.error(error);
    return reply.status(500).send({
      success: false,
      error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected server error occurred.' },
    } satisfies ApiResponse<never>);
  });

  // ------------------------------------------------------------- Health
  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));
  app.get('/ready', async () => {
    await repo.ping();
    return { status: 'ready' };
  });

  // ------------------------------------------------------------- Sessions & Allocations
  app.post('/api/v1/session', async (req, reply) => {
    const session = await resolveSession(req, reply);
    const info = await sessionService.getSessionInfo(session.id);
    return {
      success: true,
      data: { ...info, token: req.sessionToken },
    } satisfies ApiResponse<typeof info>;
  });

  app.get('/api/v1/world/position', async (req, reply) => {
    const session = await resolveSession(req, reply);
    const info = await sessionService.getSessionInfo(session.id);
    return {
      success: true,
      data: { ...info, token: req.sessionToken },
    } satisfies ApiResponse<typeof info>;
  });

  app.post('/api/v1/world/allocate-position', async (req, reply) => {
    const session = await resolveSession(req, reply);
    const body = req.body as { x?: unknown; y?: unknown } | undefined;
    let info;
    if (typeof body?.x === 'number' && typeof body?.y === 'number') {
      info = await sessionService.reservePosition(session.id, { x: body.x, y: body.y });
    } else {
      info = await sessionService.reallocatePosition(session.id);
    }
    return {
      success: true,
      data: { ...info, token: req.sessionToken },
    } satisfies ApiResponse<typeof info>;
  });

  // ------------------------------------------------------------- Spatial Viewport Queries
  app.get('/api/v1/world/messages', async (req) => {
    const q = messagesQuerySchema.parse(req.query);
    const messages = await messageService.queryViewport(
      { minX: q.minX, maxX: q.maxX, minY: q.minY, maxY: q.maxY },
      q.limit,
    );
    return {
      success: true,
      data: { messages },
      meta: { count: messages.length },
    };
  });

  app.get('/api/v1/world/stats', async () => {
    const stats = await repo.stats(new Date().toISOString());
    return {
      success: true,
      data: {
        totalMessages: stats.totalMessages,
        activeMessages: stats.activeMessages,
      },
    };
  });

  app.get('/api/v1/world/density', async (req) => {
    const q = densityQuerySchema.parse(req.query);
    const cells = await messageService.queryDensity(
      { minX: q.minX, maxX: q.maxX, minY: q.minY, maxY: q.maxY },
      q.cell,
      (await import('@canvas/shared-types')).MAX_DENSITY_CELLS,
    );
    return {
      success: true,
      data: { cells },
      meta: { count: cells.length },
    };
  });

  app.get('/api/v1/coordinates/:x/:y', async (req) => {
    const params = coordinateParamsSchema.parse(req.params);
    const message = await messageService.getMessageAt({ x: params.x, y: params.y });
    return { success: true, data: { message } };
  });

  // ------------------------------------------------------------- Messages CRUD
  app.post('/api/v1/messages', async (req, reply) => {
    const session = await resolveSession(req, reply);

    // Rate limit per session
    const rlSession = await rateLimiter.hit(
      `msg:sess:${session.id}`,
      config.RL_MESSAGES_PER_MIN_SESSION,
      60_000,
    );
    if (!rlSession.allowed) {
      throw AppError.tooMany(rlSession.retryAfterSec, 'Message creation rate limit exceeded.');
    }

    // Rate limit per IP
    const ip = req.ip || '127.0.0.1';
    const rlIp = await rateLimiter.hit(
      `msg:ip:${ip}`,
      config.RL_MESSAGES_PER_MIN_IP,
      60_000,
    );
    if (!rlIp.allowed) {
      throw AppError.tooMany(rlIp.retryAfterSec, 'IP message creation rate limit exceeded.');
    }

    const body = postMessageBodySchema.parse(req.body);
    const message = await messageService.createMessage(session.id, body.content);

    return reply.status(201).send({
      success: true,
      data: { message },
    } satisfies ApiResponse<{ message: typeof message }>);
  });

  app.get('/api/v1/messages/:id', async (req) => {
    const { id } = req.params as { id: string };
    const message = await messageService.getMessage(id);
    return { success: true, data: { message } };
  });

  app.post('/api/v1/messages/:id/report', async (req, reply) => {
    const session = await resolveSession(req, reply);
    const { id } = req.params as { id: string };

    const rlReport = await rateLimiter.hit(
      `rep:sess:${session.id}`,
      config.RL_REPORTS_PER_MIN_SESSION,
      60_000,
    );
    if (!rlReport.allowed) {
      throw AppError.tooMany(rlReport.retryAfterSec, 'Report submission rate limit reached.');
    }

    const body = reportBodySchema.parse(req.body);
    await messageService.reportMessage(id, session.id, body.reason, body.details);

    return { success: true, data: { reported: true } };
  });

  // ------------------------------------------------------------- Realtime WebSocket
  app.get('/api/v1/ws', { websocket: true }, (socket, req) => {
    const ip = req.ip || '127.0.0.1';
    if (hub.connectionsFromIp(ip) >= config.WS_MAX_CONNECTIONS_PER_IP) {
      socket.close(1008, 'Connection limit exceeded per IP');
      return;
    }

    const client = hub.add(socket, ip);
    hub.send(client, { type: 'hello', maxChunks: hub.maxChunks });

    socket.on('message', (raw) => {
      try {
        const text = raw.toString();
        const parsed = clientWsMessageSchema.safeParse(JSON.parse(text));
        if (!parsed.success) {
          hub.send(client, {
            type: 'error',
            code: 'INVALID_PAYLOAD',
            message: 'Malformed websocket payload.',
          });
          return;
        }

        const msg = parsed.data;
        if (msg.type === 'subscribe') {
          const subscribed = hub.subscribe(client, msg.bounds);
          if (subscribed === null) {
            hub.send(client, {
              type: 'error',
              code: 'VIEWPORT_TOO_LARGE',
              message: `Requested viewport spans more than ${hub.maxChunks} chunks.`,
            });
          } else {
            hub.send(client, { type: 'subscribed', chunks: subscribed });
          }
        } else if (msg.type === 'unsubscribe') {
          hub.unsubscribe(client);
        } else if (msg.type === 'ping') {
          hub.send(client, { type: 'pong' });
        }
      } catch {
        hub.send(client, {
          type: 'error',
          code: 'PARSE_ERROR',
          message: 'Failed to parse JSON.',
        });
      }
    });

    socket.on('close', () => {
      hub.remove(client);
    });
  });

  // ------------------------------------------------------------- Admin Endpoints
  app.get('/api/v1/admin/stats', async (req) => {
    await requireAdmin(req);
    const stats = await messageService.getAdminStats();
    return { success: true, data: stats };
  });

  app.get('/api/v1/admin/messages', async (req) => {
    await requireAdmin(req);
    const q = adminListQuerySchema.parse(req.query);
    const messages = await messageService.listMessagesForAdmin(
      q.status as import('@canvas/shared-types').MessageStatus | undefined,
      q.limit,
    );
    return { success: true, data: { messages } };
  });

  app.patch('/api/v1/admin/messages/:id', async (req) => {
    await requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = adminMessageStatusSchema.parse(req.body);
    const ok = await messageService.setStatus(id, body.status, 'admin');
    return { success: true, data: { updated: ok } };
  });

  app.delete('/api/v1/admin/messages/:id', async (req) => {
    await requireAdmin(req);
    const { id } = req.params as { id: string };
    const ok = await messageService.setStatus(id, 'deleted', 'admin');
    return { success: true, data: { deleted: ok } };
  });

  app.get('/api/v1/admin/reports', async (req) => {
    await requireAdmin(req);
    const q = adminListQuerySchema.parse(req.query);
    const reports = await messageService.listReports(
      q.status as import('@canvas/shared-types').ReportStatus | undefined,
      q.limit,
    );
    return { success: true, data: { reports } };
  });

  app.patch('/api/v1/admin/reports/:id', async (req) => {
    await requireAdmin(req);
    const { id } = req.params as { id: string };
    const body = adminReportStatusSchema.parse(req.body);
    const report = await messageService.updateReport(id, body.status, 'admin');
    return { success: true, data: { report } };
  });

  app.get('/api/v1/admin/audit', async (req) => {
    await requireAdmin(req);
    const q = adminListQuerySchema.parse(req.query);
    const logs = await repo.listAudit(q.limit);
    return { success: true, data: { audit: logs } };
  });

  app.get('/api/v1/admin/metrics', async (req) => {
    await requireAdmin(req);
    return { success: true, data: metrics.snapshot() };
  });

  return app;
}
