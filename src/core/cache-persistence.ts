export const CACHE_PERSIST_QUIET_MS = 8000;
export const MIN_CACHE_PERSIST_INTERVAL_MS = 30000;

/**
 * Earliest delay for a semantic-cache persistence attempt.
 *
 * Every edit burst re-schedules the timer, so CACHE_PERSIST_QUIET_MS acts as a trailing quiet
 * window. The minimum interval separately prevents repeated persistence generations when several
 * bursts land close together.
 */
export function cachePersistenceDelayMs(
  nowMs: number,
  lastWriteAt: number | null,
  quietMs = CACHE_PERSIST_QUIET_MS,
  minimumIntervalMs = MIN_CACHE_PERSIST_INTERVAL_MS,
): number {
  const sinceLast = lastWriteAt === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - lastWriteAt);
  return Math.max(quietMs, minimumIntervalMs - sinceLast, 0);
}
