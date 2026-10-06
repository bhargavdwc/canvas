import { z } from 'zod';
import {
  DEFAULT_MESSAGE_LIMIT,
  MAX_MESSAGE_CHARS,
  MAX_MESSAGE_LIMIT,
  MAX_MESSAGE_QUERY_SPAN,
  REPORT_REASONS,
  WORLD_HALF_EXTENT,
} from '@canvas/shared-types';

/** Whitespace-delimited word count. Empty / whitespace-only text has 0 words. */
export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/u).length;
}

/** Integer in the world range. z.number() already rejects NaN; int() rejects +/-Infinity. */
export const coordinateValueSchema = z
  .number()
  .int()
  .min(-WORLD_HALF_EXTENT)
  .max(WORLD_HALF_EXTENT);

export const worldPointSchema = z.object({
  x: coordinateValueSchema,
  y: coordinateValueSchema,
});

export const messageContentSchema = z
  .string()
  .trim()
  .min(1, 'Message cannot be empty.')
  .max(MAX_MESSAGE_CHARS, `Message cannot exceed ${MAX_MESSAGE_CHARS} characters.`);

export const createMessageSchema = z.object({
  content: messageContentSchema,
  position: worldPointSchema,
});

export type CreateMessageInput = z.infer<typeof createMessageSchema>;

/** Body of POST /messages. The position is NEVER taken from the client; the server uses the session's reservation. */
export const postMessageBodySchema = z.object({ content: messageContentSchema });

const finiteCoord = z.coerce.number().finite().min(-WORLD_HALF_EXTENT).max(WORLD_HALF_EXTENT);

const boundsShape = {
  minX: finiteCoord,
  maxX: finiteCoord,
  minY: finiteCoord,
  maxY: finiteCoord,
};

const boundsOrdered = (b: { minX: number; maxX: number; minY: number; maxY: number }) =>
  b.minX <= b.maxX && b.minY <= b.maxY;

/** Query string of GET /world/messages. */
export const messagesQuerySchema = z
  .object({
    ...boundsShape,
    limit: z.coerce.number().int().min(1).max(MAX_MESSAGE_LIMIT).default(DEFAULT_MESSAGE_LIMIT),
  })
  .refine(boundsOrdered, { message: 'minX/minY must not exceed maxX/maxY.' })
  .refine(
    (b) => b.maxX - b.minX <= MAX_MESSAGE_QUERY_SPAN && b.maxY - b.minY <= MAX_MESSAGE_QUERY_SPAN,
    { message: `Query area too large (max ${MAX_MESSAGE_QUERY_SPAN} units per side).` },
  );

/** Query string of GET /world/density. */
export const densityQuerySchema = z
  .object({
    ...boundsShape,
    cell: z.coerce.number().int().min(100).max(WORLD_HALF_EXTENT).default(1000),
  })
  .refine(boundsOrdered, { message: 'minX/minY must not exceed maxX/maxY.' });

/** Route params of GET /coordinates/:x/:y. */
export const coordinateParamsSchema = z.object({
  x: z.coerce.number().int().min(-WORLD_HALF_EXTENT).max(WORLD_HALF_EXTENT),
  y: z.coerce.number().int().min(-WORLD_HALF_EXTENT).max(WORLD_HALF_EXTENT),
});

export const reportBodySchema = z.object({
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(500).optional(),
});

export const adminMessageStatusSchema = z.object({
  status: z.enum(['active', 'hidden', 'deleted']),
});

export const adminReportStatusSchema = z.object({
  status: z.enum(['open', 'resolved', 'dismissed']),
});

export const adminListQuerySchema = z.object({
  status: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/** Messages a client may send over the WebSocket. */
export const clientWsMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('subscribe'),
    bounds: z
      .object(boundsShape)
      .refine(boundsOrdered, { message: 'minX/minY must not exceed maxX/maxY.' }),
  }),
  z.object({ type: z.literal('unsubscribe') }),
  z.object({ type: z.literal('ping') }),
]);
