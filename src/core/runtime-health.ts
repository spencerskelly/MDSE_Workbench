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
  coreError: string | null;
  occurrenceError: string | null;
  localPending: number;
  localQueued: number;
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
        error?: string | null;
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
    if (input.coreError) {
      return {
        level: "attention",
        label: "Workbench · core unavailable",
        detail: "Workbench core model startup failed, but Obsidian remains usable.",
        rows: [
          ["Model service", "unavailable", true],
          ["Core error", input.coreError, true],
          ["Recovery", "Correct the reported issue, then run Rebuild index"],
        ],
      };
    }
    const level: RuntimeHealthLevel = input.building ? "syncing" : "starting";
    return {
      level,
      label: input.building ? "Workbench · indexing" : "Workbench · starting",
      detail: "Model service is not ready yet.",
      rows: [
        ["Model service", input.building ? "indexing" : "starting"],
        ["Local Model", input.localQueued ? `${input.localQueued} queued` : input.localPending ? `${input.localPending} pending` : "not yet available"],
      ],
    };
  }

  const rows: Array<[string, string, boolean?]> = [];
  const assuranceError = input.assurance?.current ? input.assurance.error ?? null : null;
  const hardAttention = input.localReadErrors > 0 || !!input.occurrenceError || !!input.cacheWriteError || input.schemaWarnings > 0 || !!assuranceError;
  rows.push(["Model service", input.livePending ? `${input.livePending} live update(s) pending` : "ready"]);
  const activeLocal = Math.max(0, input.localPending - input.localQueued);
  rows.push([
    "Local Model",
    input.occurrenceError
      ? `background processing issue: ${input.occurrenceError}`
      : input.localReadErrors
        ? `${input.localReadErrors} read error(s)`
        : activeLocal
          ? `${activeLocal} note(s) hydrating`
          : input.localQueued
            ? `${input.localQueued} note(s) queued for later`
            : "settled",
    !!input.occurrenceError || input.localReadErrors > 0,
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
    const issues = input.localReadErrors + input.schemaWarnings + (input.occurrenceError ? 1 : 0) + (input.cacheWriteError ? 1 : 0) + (assuranceError ? 1 : 0);
    return {
      level: "attention",
      label: `Workbench · ${issues} issue${issues === 1 ? "" : "s"}`,
      detail: "The model remains readable; inspect runtime health for the affected subsystem.",
      rows,
    };
  }

  const pending = input.livePending + input.localPending;
  if (pending > 0) {
    const activeOccurrence = Math.max(0, input.localPending - input.localQueued);
    return {
      level: "syncing",
      label: input.livePending
        ? `Workbench ✓ · applying ${input.livePending}`
        : activeOccurrence
          ? "Workbench ✓ · occurrence data loading"
          : "Workbench ✓ · occurrence data queued",
      detail: input.livePending
        ? "Core model remains usable while coalesced live edits finish."
        : activeOccurrence
          ? "Core model is ready; occurrence-aware capabilities are loading in the background."
          : "Core model is ready; occurrence-aware capabilities are intentionally deferred until the vault is quiet or one is requested.",
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
