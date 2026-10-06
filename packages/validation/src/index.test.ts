import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS, WORLD_HALF_EXTENT } from '@canvas/shared-types';
import {
  countWords,
  createMessageSchema,
  worldPointSchema,
} from './index';

describe('countWords', () => {
  it('counts words and ignores extra whitespace', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   \n\t ')).toBe(0);
    expect(countWords('hello')).toBe(1);
    expect(countWords('  hello   big\nworld ')).toBe(3);
  });
});

describe('worldPointSchema', () => {
  it('accepts in-range integers', () => {
    expect(worldPointSchema.safeParse({ x: 1245, y: -782 }).success).toBe(true);
    expect(
      worldPointSchema.safeParse({ x: WORLD_HALF_EXTENT, y: -WORLD_HALF_EXTENT }).success,
    ).toBe(true);
  });

  it.each([
    [{ x: NaN, y: 0 }],
    [{ x: Infinity, y: 0 }],
    [{ x: 0, y: -Infinity }],
    [{ x: 1.5, y: 0 }],
    [{ x: WORLD_HALF_EXTENT + 1, y: 0 }],
    [{ x: 999999999999999999999, y: 0 }],
    [{ x: '1', y: 0 }],
  ])('rejects %j', (value) => {
    expect(worldPointSchema.safeParse(value).success).toBe(false);
  });
});

describe('createMessageSchema', () => {
  const position = { x: 10, y: 20 };

  it('accepts a normal message', () => {
    expect(createMessageSchema.safeParse({ content: 'Hello world', position }).success).toBe(true);
  });

  it('rejects empty content', () => {
    expect(createMessageSchema.safeParse({ content: '   ', position }).success).toBe(false);
  });


  it('rejects content over the character limit', () => {
    const content = 'x'.repeat(MAX_MESSAGE_CHARS + 1);
    expect(createMessageSchema.safeParse({ content, position }).success).toBe(false);
  });
});
