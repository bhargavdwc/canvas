import {
  CHUNK_SIZE,
  type ServerWsMessage,
  type WorldBounds,
  type WorldMessage,
  type WorldPoint,
} from '@canvas/shared-types';

/** The subset of a `ws` socket the hub needs (keeps the hub testable without sockets). */
export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readonly readyState: number;
  readonly bufferedAmount?: number;
}

export interface HubClient {
  socket: SocketLike;
  ip: string;
  chunks: Set<string>;
}

const OPEN = 1;
const MAX_BUFFERED_BYTES = 1_000_000;
const chunkIdx = (v: number) => Math.floor(v / CHUNK_SIZE);
const ckey = (cx: number, cy: number) => `${cx},${cy}`;

/**
 * Spatially-aware fan-out. A client subscribes to the viewport it is looking at; the hub indexes
 * it by chunk, so a new message is sent only to clients watching that message's chunk —
 * never broadcast to everyone.
 */
export class RealtimeHub {
  private readonly clients = new Set<HubClient>();
  private readonly byChunk = new Map<string, Set<HubClient>>();

  constructor(readonly maxChunks = 400) {}

  get size(): number {
    return this.clients.size;
  }

  connectionsFromIp(ip: string): number {
    let n = 0;
    for (const c of this.clients) if (c.ip === ip) n++;
    return n;
  }

  add(socket: SocketLike, ip: string): HubClient {
    const client: HubClient = { socket, ip, chunks: new Set() };
    this.clients.add(client);
    return client;
  }

  remove(client: HubClient): void {
    this.unsubscribe(client);
    this.clients.delete(client);
  }

  /** Returns the number of chunks subscribed, or null when the viewport is too large. */
  subscribe(client: HubClient, bounds: WorldBounds): number | null {
    const minCx = chunkIdx(bounds.minX);
    const maxCx = chunkIdx(bounds.maxX);
    const minCy = chunkIdx(bounds.minY);
    const maxCy = chunkIdx(bounds.maxY);
    const count = (maxCx - minCx + 1) * (maxCy - minCy + 1);
    if (count > this.maxChunks) return null;

    this.unsubscribe(client);
    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = ckey(cx, cy);
        client.chunks.add(key);
        const set = this.byChunk.get(key);
        if (set) set.add(client);
        else this.byChunk.set(key, new Set([client]));
      }
    }
    return count;
  }

  unsubscribe(client: HubClient): void {
    for (const key of client.chunks) {
      const set = this.byChunk.get(key);
      set?.delete(client);
      if (set && set.size === 0) this.byChunk.delete(key);
    }
    client.chunks.clear();
  }

  broadcastCreated(message: WorldMessage): number {
    return this.fanOut(message.position, { type: 'message.created', message });
  }

  broadcastRemoved(id: string, position: WorldPoint): number {
    return this.fanOut(position, { type: 'message.removed', id });
  }

  send(client: HubClient, payload: ServerWsMessage): void {
    if (client.socket.readyState !== OPEN) return;
    if ((client.socket.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
      client.socket.close(1013, 'Slow consumer');
      return;
    }
    client.socket.send(JSON.stringify(payload));
  }

  private fanOut(position: WorldPoint, payload: ServerWsMessage): number {
    const watchers = this.byChunk.get(ckey(chunkIdx(position.x), chunkIdx(position.y)));
    if (!watchers) return 0;
    const data = JSON.stringify(payload);
    let sent = 0;
    for (const client of watchers) {
      if (client.socket.readyState !== OPEN) continue;
      if ((client.socket.bufferedAmount ?? 0) > MAX_BUFFERED_BYTES) {
        client.socket.close(1013, 'Slow consumer');
        continue;
      }
      client.socket.send(data);
      sent++;
    }
    return sent;
  }
}
