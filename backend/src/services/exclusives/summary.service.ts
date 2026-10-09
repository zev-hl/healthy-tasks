import type { ExclusivesSummaryDto } from '@healthy-tasks/shared';
import { prisma } from '../../db/prisma.js';
import { env } from '../../config/env.js';
import { exclusivesDueAt } from '../scheduler.service.js';
import { exclusivesSweepMode } from './sweep-clock.js';
import { lastSuccessfulSweepAt } from './health.service.js';
import { ALERTS_WINDOW_MS } from './group.service.js';

/**
 * The header numbers for the Exclusives screens. Deliberately separate from
 * `status.service.ts`: that one probes Amazon and caches for five minutes, and
 * a page's header must not wait on a network call to Amazon.
 */
export async function getExclusivesSummary(now: Date = new Date()): Promise<ExclusivesSummaryDto> {
  const since = new Date(now.getTime() - ALERTS_WINDOW_MS);
  const mode = exclusivesSweepMode();

  const [alerts24h, asinsMonitored, byType, inactiveCount, lastSweep] = await Promise.all([
    prisma.alertLog.count({ where: { createdAt: { gte: since } } }),
    // Only what is really being checked: a switched-off group's ASINs are
    // skipped by the sweep, so counting them here would overstate the number.
    prisma.listing.count({ where: { group: { isActive: true } } }),
    prisma.alertGroup.groupBy({ by: ['groupType'], _count: { _all: true } }),
    prisma.alertGroup.count({ where: { isActive: false } }),
    lastSuccessfulSweepAt(),
  ]);

  const countOf = (type: string): number =>
    byType.find((r) => r.groupType === type)?._count._all ?? 0;

  // Only meaningful while sweeping is switched on; otherwise nothing is due.
  const nextSweepAt = mode.on ? await exclusivesDueAt(now) : null;

  return {
    alerts24h,
    asinsMonitored,
    groupCount: countOf('GROUP'),
    individualCount: countOf('INDIVIDUAL'),
    inactiveCount,
    lastSweepAt: lastSweep?.toISOString() ?? null,
    nextSweepAt: nextSweepAt?.toISOString() ?? null,
    sweepEnabled: mode.on,
    sweepMinutes: env.amazon.sweepMinutes,
  };
}
