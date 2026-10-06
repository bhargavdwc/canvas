import type { WorldMessage } from '@canvas/shared-types';
import { ChunkedMessageCache } from '../utils/messageCache';

let cached: { all: WorldMessage[]; index: ChunkedMessageCache } | null = null;

/**
 * Empty cache used as a fallback structure when completely offline.
 * Contains no hardcoded or fake messages.
 */
export function getMockWorld() {
  if (!cached) {
    const all: WorldMessage[] = [];
    const index = new ChunkedMessageCache();
    cached = { all, index };
  }
  return cached;
}

