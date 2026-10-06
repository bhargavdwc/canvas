import crypto from 'node:crypto';
import type {
  AdminStats,
  DensityCell,
  MessageStatus,
  ReportReason,
  ReportRecord,
  ReportStatus,
  WorldBounds,
  WorldMessage,
  WorldPoint,
} from '@canvas/shared-types';
import type { Repository } from '../repo/types';
import type { RealtimeHub } from '../realtime/hub';
import type { LruCache } from '../cache/lru';
import type { Metrics } from '../metrics';
import { AppError } from '../errors';

export class MessageService {
  constructor(
    private readonly repo: Repository,
    private readonly hub: RealtimeHub,
    private readonly cache: LruCache<unknown>,
    private readonly metrics: Metrics,
  ) {}

  async createMessage(sessionId: string, content: string): Promise<WorldMessage> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const created = await this.repo.insertMessageAtReservation(
      {
        id,
        sessionId,
        content,
        createdAt: now,
      },
      now,
    );

    if (!created) {
      throw AppError.conflict(
        'RESERVATION_EXPIRED_OR_OCCUPIED',
        'No valid active reservation found for this session. Please reallocate or refresh your coordinate.',
      );
    }

    // Invalidate cached viewport/density queries
    this.cache.clear();

    // Fan-out to watching clients in this chunk
    this.hub.broadcastCreated(created);

    this.metrics.inc('messages.created');
    return created;
  }

  async getMessage(id: string): Promise<WorldMessage> {
    const m = await this.repo.getMessage(id);
    if (!m || m.status !== 'active') {
      throw AppError.notFound('Message not found.');
    }
    const { sessionId: _s, ...pub } = m;
    return pub;
  }

  async getMessageAt(point: WorldPoint): Promise<WorldMessage> {
    const m = await this.repo.getMessageAt(point);
    if (!m) {
      throw AppError.notFound('No active message at this coordinate.');
    }
    return m;
  }

  async queryViewport(bounds: WorldBounds, limit: number): Promise<WorldMessage[]> {
    const cacheKey = `vp:${bounds.minX}:${bounds.maxX}:${bounds.minY}:${bounds.maxY}:${limit}`;
    const cached = this.cache.get(cacheKey) as WorldMessage[] | undefined;
    if (cached) return cached;

    const messages = await this.repo.queryBounds(bounds, limit);
    this.cache.set(cacheKey, messages);
    return messages;
  }

  async queryDensity(
    bounds: WorldBounds,
    cellSize: number,
    maxCells: number,
  ): Promise<DensityCell[]> {
    const cacheKey = `dens:${bounds.minX}:${bounds.maxX}:${bounds.minY}:${bounds.maxY}:${cellSize}:${maxCells}`;
    const cached = this.cache.get(cacheKey) as DensityCell[] | undefined;
    if (cached) return cached;

    const cells = await this.repo.density(bounds, cellSize, maxCells);
    this.cache.set(cacheKey, cells);
    return cells;
  }

  async reportMessage(
    messageId: string,
    reporterSessionId: string,
    reason: ReportReason,
    details?: string,
  ): Promise<void> {
    const target = await this.repo.getMessage(messageId);
    if (!target) {
      throw AppError.notFound('Message not found.');
    }
    const already = await this.repo.hasReport(messageId, reporterSessionId);
    if (already) {
      throw AppError.conflict(
        'ALREADY_REPORTED',
        'You have already submitted a report for this message.',
      );
    }

    const report: ReportRecord = {
      id: crypto.randomUUID(),
      messageId,
      reason,
      details,
      reporterSessionId,
      status: 'open',
      createdAt: new Date().toISOString(),
    };

    await this.repo.createReport(report);
    this.metrics.inc('reports.created');
  }

  // ----------------------------------------------------------- Moderation

  async setStatus(
    messageId: string,
    status: MessageStatus,
    adminActor: string,
  ): Promise<boolean> {
    const target = await this.repo.getMessage(messageId);
    if (!target) throw AppError.notFound('Message not found.');

    const ok = await this.repo.setMessageStatus(messageId, status);
    if (ok) {
      this.cache.clear();
      if (status !== 'active') {
        this.hub.broadcastRemoved(messageId, target.position);
      }
      await this.repo.addAudit({
        id: crypto.randomUUID(),
        actor: adminActor,
        action: `message.status.${status}`,
        targetType: 'message',
        targetId: messageId,
        metadata: { prevStatus: target.status, newStatus: status },
        createdAt: new Date().toISOString(),
      });
    }
    return ok;
  }

  async listMessagesForAdmin(status: MessageStatus | undefined, limit: number) {
    return this.repo.listMessages(status, limit);
  }

  async listReports(status: ReportStatus | undefined, limit: number) {
    return this.repo.listReports(status, limit);
  }

  async updateReport(
    reportId: string,
    status: ReportStatus,
    adminActor: string,
  ): Promise<ReportRecord> {
    const updated = await this.repo.updateReportStatus(reportId, status);
    if (!updated) throw AppError.notFound('Report not found.');
    await this.repo.addAudit({
      id: crypto.randomUUID(),
      actor: adminActor,
      action: `report.status.${status}`,
      targetType: 'report',
      targetId: reportId,
      metadata: { newStatus: status },
      createdAt: new Date().toISOString(),
    });
    return updated;
  }

  async getAdminStats(): Promise<AdminStats> {
    const now = new Date().toISOString();
    const stats = await this.repo.stats(now);
    const occupied = await this.repo.countOccupied(now);
    const side = (await import('@canvas/shared-types')).worldSideLength(occupied);
    const totalPossibleSlots = (side / 200) ** 2;

    return {
      ...stats,
      worldSide: side,
      worldUtilization: Math.min(1, Math.round((occupied / totalPossibleSlots) * 10000) / 10000),
    };
  }
}
