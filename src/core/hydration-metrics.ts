export interface HydrationCost {
  path: string;
  readMs: number;
  parseMs: number;
  totalMs: number;
  bytes: number;
  records: number;
}

export interface HydrationCostSummary {
  owners: number;
  averageMs: number;
  maxMs: number;
  maxPath: string | null;
  averageReadMs: number;
  averageParseMs: number;
}

export function summarizeHydrationCosts(costs: Iterable<HydrationCost>): HydrationCostSummary {
  const rows = [...costs];
  if (!rows.length) return { owners: 0, averageMs: 0, maxMs: 0, maxPath: null, averageReadMs: 0, averageParseMs: 0 };
  let total = 0;
  let read = 0;
  let parse = 0;
  let max = rows[0];
  for (const row of rows) {
    total += row.totalMs;
    read += row.readMs;
    parse += row.parseMs;
    if (row.totalMs > max.totalMs || (row.totalMs === max.totalMs && row.path.localeCompare(max.path) < 0)) max = row;
  }
  return {
    owners: rows.length,
    averageMs: total / rows.length,
    maxMs: max.totalMs,
    maxPath: max.path,
    averageReadMs: read / rows.length,
    averageParseMs: parse / rows.length,
  };
}
