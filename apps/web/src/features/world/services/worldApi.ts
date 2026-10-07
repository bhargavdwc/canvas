import {
  WORLD_HALF_EXTENT,
  type ApiResponse,
  type ReportReason,
  type SessionInfo,
  type WorldBounds,
  type WorldMessage,
  type WorldPoint,
} from '@canvas/shared-types';
import { getMockWorld } from './mockWorld';

const API_BASE = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '');

let backendAvailable: boolean | null = null;
let lastCheckAt = 0;
let currentSession: SessionInfo | null = null;
let cachedTotal = 0;

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const url = `${API_BASE}${path}`;
  const headers = new Headers(init?.headers);
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('canvas_session_token') : null;
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, {
    ...init,
    headers,
    credentials: 'include',
  });
}

export async function checkBackend(): Promise<boolean> {
  const now = Date.now();
  if (backendAvailable === true && now - lastCheckAt < 10_000) return true;
  if (backendAvailable === false && now - lastCheckAt < 2_000) return false;

  try {
    const res = await apiFetch('/health', { method: 'GET' });
    backendAvailable = res.ok;
    lastCheckAt = now;
  } catch {
    backendAvailable = false;
    lastCheckAt = now;
  }
  return backendAvailable;
}

export function isBackendConnected(): boolean {
  return backendAvailable === true;
}

export async function initSession(): Promise<SessionInfo> {
  const isLive = await checkBackend();
  if (isLive) {
    try {
      const res = await apiFetch('/api/v1/session', {
        method: 'POST',
      });
      if (res.ok) {
        const body = (await res.json()) as ApiResponse<SessionInfo>;
        if (body.success) {
          currentSession = body.data;
          if (body.data.token && typeof localStorage !== 'undefined') {
            localStorage.setItem('canvas_session_token', body.data.token);
          }
          return currentSession;
        }
      }
    } catch {
      backendAvailable = false;
    }
  }

  // Fallback blank session
  if (!currentSession) {
    const mockPoint: WorldPoint = {
      x: Math.round((Math.random() * 2 - 1) * 1000),
      y: Math.round((Math.random() * 2 - 1) * 1000),
    };
    currentSession = {
      sessionId: 'local-session',
      position: mockPoint,
      worldSide: 10_000,
      limits: { maxWords: 1000, maxChars: 10_000 },
    };
  }
  return currentSession;
}

export async function reallocateSession(target?: WorldPoint): Promise<SessionInfo> {
  if (await checkBackend()) {
    const res = await apiFetch('/api/v1/world/allocate-position', {
      method: 'POST',
      headers: target ? { 'Content-Type': 'application/json' } : undefined,
      body: target ? JSON.stringify(target) : undefined,
    });
    const body = (await res.json()) as ApiResponse<SessionInfo>;
    if (body.success) {
      currentSession = body.data;
      if (body.data.token && typeof localStorage !== 'undefined') {
        localStorage.setItem('canvas_session_token', body.data.token);
      }
      return currentSession;
    }
    throw new Error(body.error.message || 'Failed to allocate position.');
  }

  const mockPoint: WorldPoint = target
    ? { x: target.x, y: target.y }
    : {
        x: Math.round((Math.random() * 2 - 1) * 1000),
        y: Math.round((Math.random() * 2 - 1) * 1000),
      };
  currentSession = {
    sessionId: 'local-session',
    position: mockPoint,
    worldSide: 10_000,
    limits: { maxWords: 1000, maxChars: 10_000 },
  };
  return currentSession;
}

export async function fetchMessagesInBounds(
  bounds: WorldBounds,
  signal?: AbortSignal,
): Promise<WorldMessage[]> {
  const isLive = await checkBackend();
  if (isLive) {
    try {
      const minX = Math.max(-WORLD_HALF_EXTENT, Math.min(WORLD_HALF_EXTENT, Math.round(bounds.minX)));
      const maxX = Math.max(-WORLD_HALF_EXTENT, Math.min(WORLD_HALF_EXTENT, Math.round(bounds.maxX)));
      const minY = Math.max(-WORLD_HALF_EXTENT, Math.min(WORLD_HALF_EXTENT, Math.round(bounds.minY)));
      const maxY = Math.max(-WORLD_HALF_EXTENT, Math.min(WORLD_HALF_EXTENT, Math.round(bounds.maxY)));
      if (minX > maxX || minY > maxY) return [];

      const params = new URLSearchParams({
        minX: String(minX),
        maxX: String(maxX),
        minY: String(minY),
        maxY: String(maxY),
        limit: '2000',
      });
      const res = await apiFetch(`/api/v1/world/messages?${params.toString()}`, { signal });
      if (res.ok) {
        const body = (await res.json()) as ApiResponse<{ messages: WorldMessage[] }>;
        if (body.success) {
          return body.data.messages;
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') throw err;
      backendAvailable = false;
    }
  }

  return getMockWorld().index.queryBounds(bounds).slice(0, 5000);
}

export async function createMessage(content: string): Promise<WorldMessage> {
  if (await checkBackend()) {
    const res = await apiFetch('/api/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content }),
    });
    const body = (await res.json()) as ApiResponse<{ message: WorldMessage }>;
    if (body.success) {
      cachedTotal++;
      return body.data.message;
    }
    throw new Error(body.error.message || 'Failed to create message');
  }

  const session = await initSession();
  const newMsg: WorldMessage = {
    id: `local-${Date.now()}`,
    content,
    position: session.position || { x: 0, y: 0 },
    createdAt: new Date().toISOString(),
    status: 'active',
  };
  getMockWorld().all.push(newMsg);
  getMockWorld().index.upsertMany([newMsg]);
  cachedTotal = getMockWorld().all.length;
  return newMsg;
}

export async function reportMessage(
  messageId: string,
  reason: ReportReason,
  details?: string,
): Promise<void> {
  if (await checkBackend()) {
    const res = await apiFetch(`/api/v1/messages/${messageId}/report`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason, details }),
    });
    const body = (await res.json()) as ApiResponse<{ reported: boolean }>;
    if (!body.success) {
      throw new Error(body.error.message || 'Failed to submit report');
    }
  }
}

export async function fetchWorldStats(): Promise<{ totalMessages: number }> {
  if (await checkBackend()) {
    try {
      const res = await apiFetch('/api/v1/world/stats');
      if (res.ok) {
        const body = (await res.json()) as ApiResponse<{ totalMessages: number }>;
        if (body.success) {
          cachedTotal = body.data.totalMessages;
          return { totalMessages: cachedTotal };
        }
      }
    } catch {
      // ignore
    }
  }
  cachedTotal = getMockWorld().all.length;
  return { totalMessages: cachedTotal };
}

export function getWorldStats(): { totalMessages: number } {
  return { totalMessages: cachedTotal };
}

export function pickDiscoveryPoint(): WorldPoint {
  // Pick random coordinates across the vast canvas (-350,000 to +350,000), snapped to 100 units
  // Guaranteed minimum distance of 15,000 units from (0,0) so it never clusters near origin
  const signX = Math.random() < 0.5 ? -1 : 1;
  const signY = Math.random() < 0.5 ? -1 : 1;
  const minDist = 15_000;
  const maxDist = 350_000;
  const rawX = minDist + Math.random() * (maxDist - minDist);
  const rawY = minDist + Math.random() * (maxDist - minDist);
  return {
    x: Math.round((signX * rawX) / 100) * 100,
    y: Math.round((signY * rawY) / 100) * 100,
  };
}

