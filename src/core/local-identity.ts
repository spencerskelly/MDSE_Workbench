import type { LocalRegion } from "./localmodel";

/**
 * Occurrence identity is authored in Markdown block IDs. Incremental reparsing must never invent,
 * renumber, or substitute IDs; this helper captures the stable identity set for regression checks.
 */
export function localIdentitySet(region: LocalRegion | null): string[] {
  if (!region) return [];
  return region.records.map((record) => record.localId).filter(Boolean).sort();
}

export function preservedLocalIdentities(before: LocalRegion | null, after: LocalRegion | null): string[] {
  const next = new Set(localIdentitySet(after));
  return localIdentitySet(before).filter((id) => next.has(id));
}
