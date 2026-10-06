import type { WorldBounds, WorldMessage } from '@canvas/shared-types';
import { chunkCount, chunkIndex, chunkKey, chunkRange } from './chunks';

/**
 * In-memory spatial index of messages, bucketed by chunk.
 * Used by the client as its local cache and by the mock API as its "database".
 */
export class ChunkedMessageCache {
  private readonly byId = new Map<string, WorldMessage>();
  private readonly buckets = new Map<string, WorldMessage[]>();

  get size(): number {
    return this.byId.size;
  }

  upsertMany(messages: Iterable<WorldMessage>): void {
    for (const message of messages) {
      if (this.byId.has(message.id)) continue;
      this.byId.set(message.id, message);
      const key = chunkKey(chunkIndex(message.position.x), chunkIndex(message.position.y));
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(message);
      else this.buckets.set(key, [message]);
    }
  }

  /** All messages whose position lies inside `bounds` (inclusive). */
  queryBounds(bounds: WorldBounds): WorldMessage[] {
    const out: WorldMessage[] = [];
    const collect = (bucket: WorldMessage[]) => {
      for (const m of bucket) {
        const { x, y } = m.position;
        if (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY) {
          out.push(m);
        }
      }
    };

    if (chunkCount(bounds) > this.buckets.size) {
      // Cheaper to scan the occupied buckets than to enumerate a huge empty range.
      for (const bucket of this.buckets.values()) collect(bucket);
      return out;
    }

    const r = chunkRange(bounds);
    for (let cx = r.minCx; cx <= r.maxCx; cx++) {
      for (let cy = r.minCy; cy <= r.maxCy; cy++) {
        const bucket = this.buckets.get(chunkKey(cx, cy));
        if (bucket) collect(bucket);
      }
    }
    return out;
  }

  /** Drop everything outside `keep`. */
  prune(keep: WorldBounds): void {
    for (const [key, bucket] of this.buckets) {
      const kept = bucket.filter((m) => {
        const { x, y } = m.position;
        return x >= keep.minX && x <= keep.maxX && y >= keep.minY && y <= keep.maxY;
      });
      if (kept.length === bucket.length) continue;
      for (const m of bucket) {
        if (!kept.includes(m)) this.byId.delete(m.id);
      }
      if (kept.length === 0) this.buckets.delete(key);
      else this.buckets.set(key, kept);
    }
  }

  clear(): void {
    this.byId.clear();
    this.buckets.clear();
  }
}
