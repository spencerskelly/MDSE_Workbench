/**
 * Lightweight runtime-health summary (W-351 / RTA-4).
 *
 * This is deliberately pure and must never trigger indexing, cache I/O or global assurance.
 * It summarizes already-known runtime state so the status surface stays cheap.
 */
export type RuntimeHealthLevel = "starting" | "syncing" | "ready" | "attention";

export interface RuntimeHealthInput {
  ready: boolean;
  building: boolean;
  localPending: number;
  livePending: number;
  localReadErrors: number;
  schemaWarnings: number;
  cacheWriteError: string | null;
  cacheCurrent: boolean;
  assurance:
    | null
    | {
        current: boolean;
        findings: number;
        computedAt: number;
      };
}

export interface RuntimeHealth {
  level: RuntimeHealthLevel;
  label: string;
  detail: string;
  rows: Array<[string, string, boolean?]>;
}

export function summarizeRuntimeHealth(input: RuntimeHealthInput): RuntimeHealth {
  if (!input.ready) {
    const level: RuntimeHealthLevel = input.building ? "syncing" : "starting";
    return {
      level,
      label: input.building ? "Workbench · indexing" : "Workbench · starting",
      detail: "Model service is not ready yet.",
      rows: [
        ["Model service", input.building ? "indexing" : "starting"],
        ["Local Model", input.localPending ? `${input.localPending} pending` : "not yet available"],
      ],
    };
  }

  const rows: Array<[string, string, boolean?]> = [];
  const assuranceError = input.assurance?.current ? input.assurance.error ?? null : null;
  const hardAttention = input.localReadErrors > 0 || !!input.cacheWriteError || input.schemaWarnings > 0 || !!assuranceError;
  rows.push(["Model service", input.livePending ? `${input.livePending} live update(s) pending` : "ready"]);
  rows.push([
    "Local Model",
    input.localReadErrors
      ? `${input.localReadErrors} read error(s)`
      : input.localPending
        ? `${input.localPending} note(s) hydrating`
        : "settled",
    input.localReadErrors > 0,
  ]);
  rows.push(["Schema", input.schemaWarnings ? `${input.schemaWarnings} warning(s)` : "compatible", input.schemaWarnings > 0]);
  rows.push([
    "Semantic cache",
    input.cacheWriteError ? `write issue: ${input.cacheWriteError}` : input.cacheCurrent ? "current" : "pending/coalesced",
    !!input.cacheWriteError,
  ]);

  if (!input.assurance) {
    rows.push(["Global assurance", "not run for current model revision"]);
  } else if (!input.assurance.current) {
    rows.push(["Global assurance", "stale; recomputes on demand"]);
  } else if (input.assurance.error) {
    rows.push(["Global assurance", `unavailable: ${input.assurance.error}`, true]);
  } else {
    rows.push([
      "Global assurance",
      input.assurance.findings ? `${input.assurance.findings} finding(s)` : "current · no findings",
      input.assurance.findings > 0,
    ]);
  }

  if (hardAttention) {
    const issues = input.localReadErrors + input.schemaWarnings + (input.cacheWriteError ? 1 : 0) + (assuranceError ? 1 : 0);
    return {
      level: "attention",
      label: `Workbench · ${issues} issue${issues === 1 ? "" : "s"}`,
      detail: "The model remains readable; inspect runtime health for the affected subsystem.",
      rows,
    };
  }

  const pending = input.livePending + input.localPending;
  if (pending > 0) {
    return {
      level: "syncing",
      label: input.livePending
        ? `Workbench ✓ · applying ${input.livePending}`
        : "Workbench ✓ · occurrence data loading",
      detail: input.livePending
        ? "Core model remains usable while coalesced live edits finish."
        : "Core model is ready; occurrence-aware capabilities are loading in the background.",
      rows,
    };
  }

  if (input.assurance?.current && input.assurance.findings > 0) {
    return {
      level: "ready",
      label: `Workbench ✓ · ${input.assurance.findings} review`,
      detail: "Runtime is healthy; engineering findings are available in Review.",
      rows,
    };
  }

  return {
    level: "ready",
    label: "Workbench ✓",
    detail: input.assurance?.current ? "Runtime and current assurance are healthy." : "Runtime is healthy; global assurance runs on demand.",
    rows,
  };
}
