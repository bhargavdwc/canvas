import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from './config';
import { createAppContext, buildApp, type AppContext } from './app';
import { MIN_MESSAGE_DISTANCE, type WorldMessage } from '@canvas/shared-types';

describe('Spatial API Integration Tests', () => {
  let app: FastifyInstance;
  let ctx: AppContext;

  beforeEach(async () => {
    const config = loadConfig({
      NODE_ENV: 'test',
      DATABASE_URL: '',
      SUPABASE_URL: '',
      SUPABASE_KEY: '',
      DATA_FILE: '', // In-memory without file persistence
      ADMIN_TOKEN: 'super-secret-admin-test-token-12345',
      SESSION_SECRET: 'test-session-secret-at-least-16-chars',
      LOG_LEVEL: 'silent',
    });
    ctx = await createAppContext(config);
    app = await buildApp(ctx);
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    await ctx.rateLimiter.close();
    await ctx.repo.close();
  });

  it('GET /health and /ready return 200', async () => {
    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');

    const ready = await app.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200);
    expect(ready.json().status).toBe('ready');
  });

  it('manages sessions and allocates positions', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/session' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(body.data.sessionId).toBeDefined();
    expect(body.data.position).toBeDefined();
    expect(typeof body.data.position.x).toBe('number');
    expect(typeof body.data.position.y).toBe('number');

    const cookies = res.cookies;
    expect(cookies.find((c) => c.name === 'canvas_session')).toBeDefined();

    // Re-visiting with the cookie restores the session
    const check = await app.inject({
      method: 'GET',
      url: '/api/v1/world/position',
      headers: { cookie: `canvas_session=${cookies[0]!.value}` },
    });
    expect(check.statusCode).toBe(200);
    expect(check.json().data.sessionId).toBe(body.data.sessionId);
    expect(check.json().data.position).toEqual(body.data.position);
  });

  it('creates messages at allocated positions and enforces limits', async () => {
    // 1. Establish session
    const sess = await app.inject({ method: 'POST', url: '/api/v1/session' });
    const sessionCookie = sess.cookies[0]!.value;
    const reservedPos = sess.json().data.position;

    // 2. Reject empty content
    const empty = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { cookie: `canvas_session=${sessionCookie}` },
      payload: { content: '   ' },
    });
    expect(empty.statusCode).toBe(400);

    // 3. Reject over 10,000 characters
    const tooManyChars = 'x'.repeat(10_001);
    const charFail = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { cookie: `canvas_session=${sessionCookie}` },
      payload: { content: tooManyChars },
    });
    expect(charFail.statusCode).toBe(400);
    expect(charFail.json().error.code).toBe('VALIDATION_ERROR');

    // 4. Create message successfully
    const create = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { cookie: `canvas_session=${sessionCookie}` },
      payload: { content: 'Leaving a mark on the canvas.' },
    });
    expect(create.statusCode).toBe(201);
    const msg = create.json().data.message as WorldMessage;
    expect(msg.content).toBe('Leaving a mark on the canvas.');
    expect(msg.position).toEqual(reservedPos);

    // 5. Subsequent post fails because reservation was consumed
    const duplicate = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { cookie: `canvas_session=${sessionCookie}` },
      payload: { content: 'Second message' },
    });
    expect(duplicate.statusCode).toBe(409);
    expect(duplicate.json().error.code).toBe('RESERVATION_EXPIRED_OR_OCCUPIED');

    // 6. Query by coordinate
    const lookup = await app.inject({
      method: 'GET',
      url: `/api/v1/coordinates/${msg.position.x}/${msg.position.y}`,
    });
    expect(lookup.statusCode).toBe(200);
    expect(lookup.json().data.message.id).toBe(msg.id);
  });

  it('queries messages in viewport bounds and aggregates density', async () => {
    // Seed a couple messages
    const s1 = await app.inject({ method: 'POST', url: '/api/v1/session' });
    const c1 = s1.cookies[0]!.value;
    const p1 = s1.json().data.position;
    await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { cookie: `canvas_session=${c1}` },
      payload: { content: 'Message 1' },
    });

    // Query viewport covering p1
    const vp = await app.inject({
      method: 'GET',
      url: `/api/v1/world/messages?minX=${p1.x - 50}&maxX=${p1.x + 50}&minY=${p1.y - 50}&maxY=${p1.y + 50}`,
    });
    expect(vp.statusCode).toBe(200);
    expect(vp.json().data.messages).toHaveLength(1);

    // Query viewport outside p1
    const vpEmpty = await app.inject({
      method: 'GET',
      url: `/api/v1/world/messages?minX=${p1.x + 1000}&maxX=${p1.x + 2000}&minY=${p1.y + 1000}&maxY=${p1.y + 2000}`,
    });
    expect(vpEmpty.statusCode).toBe(200);
    expect(vpEmpty.json().data.messages).toHaveLength(0);

    // Density query
    const dens = await app.inject({
      method: 'GET',
      url: `/api/v1/world/density?minX=${p1.x - 500}&maxX=${p1.x + 500}&minY=${p1.y - 500}&maxY=${p1.y + 500}&cell=500`,
    });
    expect(dens.statusCode).toBe(200);
    expect(dens.json().data.cells.length).toBeGreaterThan(0);
  });

  it('handles reporting, admin moderation, and audit logs', async () => {
    // Create message
    const s1 = await app.inject({ method: 'POST', url: '/api/v1/session' });
    const c1 = s1.cookies[0]!.value;
    const post = await app.inject({
      method: 'POST',
      url: '/api/v1/messages',
      headers: { cookie: `canvas_session=${c1}` },
      payload: { content: 'Questionable text' },
    });
    const msgId = post.json().data.message.id;

    // Report message
    const s2 = await app.inject({ method: 'POST', url: '/api/v1/session' });
    const c2 = s2.cookies[0]!.value;
    const rep = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${msgId}/report`,
      headers: { cookie: `canvas_session=${c2}` },
      payload: { reason: 'spam', details: 'Automated spam' },
    });
    expect(rep.statusCode).toBe(200);
    expect(rep.json().data.reported).toBe(true);

    // Duplicate report fails
    const dupRep = await app.inject({
      method: 'POST',
      url: `/api/v1/messages/${msgId}/report`,
      headers: { cookie: `canvas_session=${c2}` },
      payload: { reason: 'spam' },
    });
    expect(dupRep.statusCode).toBe(409);

    // Admin view stats and reports
    const adminHeaders = { 'x-admin-token': 'super-secret-admin-test-token-12345' };
    const stats = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/stats',
      headers: adminHeaders,
    });
    expect(stats.statusCode).toBe(200);
    expect(stats.json().data.openReports).toBe(1);

    const reports = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/reports',
      headers: adminHeaders,
    });
    expect(reports.statusCode).toBe(200);
    expect(reports.json().data.reports).toHaveLength(1);

    // Admin hide message
    const hide = await app.inject({
      method: 'PATCH',
      url: `/api/v1/admin/messages/${msgId}`,
      headers: adminHeaders,
      payload: { status: 'hidden' },
    });
    expect(hide.statusCode).toBe(200);

    // Message is no longer visible to public
    const pubFetch = await app.inject({ method: 'GET', url: `/api/v1/messages/${msgId}` });
    expect(pubFetch.statusCode).toBe(404);

    // Check audit logs
    const audit = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/audit',
      headers: adminHeaders,
    });
    expect(audit.statusCode).toBe(200);
    expect(audit.json().data.audit.length).toBeGreaterThan(0);
  });

  it('guarantees separation across concurrent session allocations', async () => {
    const COUNT = 30;
    const promises = Array.from({ length: COUNT }, async () => {
      const res = await app.inject({ method: 'POST', url: '/api/v1/session' });
      return res.json().data.position as { x: number; y: number };
    });

    const positions = await Promise.all(promises);
    expect(positions).toHaveLength(COUNT);

    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const p1 = positions[i]!;
        const p2 = positions[j]!;
        const dist = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        expect(dist).toBeGreaterThanOrEqual(MIN_MESSAGE_DISTANCE);
      }
    }
  });
});

