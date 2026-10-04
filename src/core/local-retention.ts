export const DEFAULT_LOCAL_REGION_RETENTION_LIMIT = 256;

/**
 * Choose cold Local Model owner paths to evict while protecting paths needed by active work.
 * Input order is oldest-to-newest access order.
 */
export function localRegionEvictions(
  oldestToNewest: readonly string[],
  protectedPaths: ReadonlySet<string>,
  limit = DEFAULT_LOCAL_REGION_RETENTION_LIMIT,
): string[] {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Local region retention limit must be a positive integer.");
  let retained = oldestToNewest.length;
  if (retained <= limit) return [];
  const evict: string[] = [];
  for (const path of oldestToNewest) {
    if (retained <= limit) break;
    if (protectedPaths.has(path)) continue;
    evict.push(path);
    retained--;
  }
  return evict;
}
