/**
 * Lightweight runtime-health summary (W-351 / RTA-4).
 *
 * This is deliberately pure and must never trigger indexing, cache I/O or global assurance.
 * It summarizes already-known runtime state so the status surface stays cheap.
 */
export type RuntimeHealthLevel = "starting" | "syncing" | "ready" | "attention";
export type CapabilityHealthState = "ready" | "pending" | "failed";

export interface CapabilityHealth {
  state: CapabilityHealthState;
  detail: string;
}

export interface RuntimeCapabilities {
  core: CapabilityHealth;
  occurrence: CapabilityHealth;
  cache: CapabilityHealth;
  schema: CapabilityHealth;
  assurance: CapabilityHealth;
}

export interface RuntimeHealthInput {
  ready: boolean;
  building: boolean;
  coreError: string | null;
  occurrenceError: string | null;
  localPending: number;
  localQueued: number;
  livePending: number;
  localReadErrors: number;
  schemaLoaded: boolean;
  schemaError: string | null;
  schemaWarnings: number;
  cacheWriteError: string | null;
  cacheCurrent: boolean;
  cachePending: boolean;
  assuranceActive: boolean;
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
  capabilities: RuntimeCapabilities;
  rows: Array<[string, string, boolean?]>;
}

export function summarizeRuntimeHealth(input: RuntimeHealthInput): RuntimeHealth {
  const activeLocal = Math.max(0, input.localPending - input.localQueued);
  const assuranceCurrent = !!input.assurance?.current;
  const assuranceError = assuranceCurrent ? input.assurance?.error ?? null : null;

  const capabilities: RuntimeCapabilities = {
    core: input.coreError
      ? { state: "failed", detail: input.coreError }
      : input.ready
        ? { state: "ready", detail: input.livePending ? `${input.livePending} live update(s) pending` : "ready" }
        : { state: "pending", detail: input.building ? "indexing" : input.schemaError ? "blocked by schema" : "starting" },
    occurrence: input.occurrenceError
      ? { state: "failed", detail: input.occurrenceError }
      : input.localReadErrors
        ? { state: "failed", detail: `${input.localReadErrors} read error(s)` }
        : activeLocal
          ? { state: "pending", detail: `${activeLocal} note(s) hydrating` }
          : input.localQueued
            ? { state: "pending", detail: `${input.localQueued} note(s) queued` }
            : input.ready
              ? { state: "ready", detail: "settled" }
              : { state: "pending", detail: "not yet available" },
    cache: input.cacheWriteError
      ? { state: "failed", detail: input.cacheWriteError }
      : input.cacheCurrent
        ? { state: "ready", detail: "current" }
        : { state: "pending", detail: input.cachePending ? "pending/coalesced" : "not current" },
    schema: input.schemaError
      ? { state: "failed", detail: input.schemaError }
      : input.schemaLoaded
        ? { state: "ready", detail: input.schemaWarnings ? `${input.schemaWarnings} warning(s)` : "compatible" }
        : { state: "pending", detail: "not loaded" },
    assurance: assuranceError
      ? { state: "failed", detail: assuranceError }
      : assuranceCurrent
        ? {
            state: "ready",
            detail: input.assurance!.findings
              ? `${input.assurance!.findings} finding(s)`
              : "current · no findings",
          }
        : {
            state: "pending",
            detail: input.assuranceActive
              ? "computing"
              : input.assurance
                ? "stale; recomputes on demand"
                : "not run for current model revision",
          },
  };

  const rows: Array<[string, string, boolean?]> = [
    ["Core", `${capabilities.core.state} · ${capabilities.core.detail}`, capabilities.core.state === "failed"],
    ["Occurrence", `${capabilities.occurrence.state} · ${capabilities.occurrence.detail}`, capabilities.occurrence.state === "failed"],
    ["Cache", `${capabilities.cache.state} · ${capabilities.cache.detail}`, capabilities.cache.state === "failed"],
    ["Schema", `${capabilities.schema.state} · ${capabilities.schema.detail}`, capabilities.schema.state === "failed"],
    ["Assurance", `${capabilities.assurance.state} · ${capabilities.assurance.detail}`, capabilities.assurance.state === "failed"],
  ];

  const failed = Object.values(capabilities).filter((capability) => capability.state === "failed").length;
  if (failed) {
    return {
      level: "attention",
      label: `Workbench · ${failed} subsystem issue${failed === 1 ? "" : "s"}`,
      detail: "Capabilities are isolated; inspect runtime health for the affected subsystem.",
      capabilities,
      rows,
    };
  }

  const pending = Object.values(capabilities).filter((capability) => capability.state === "pending").length;
  if (!input.ready) {
    return {
      level: input.building ? "syncing" : "starting",
      label: input.building ? "Workbench · indexing" : "Workbench · starting",
      detail: "Core model is not ready yet; other subsystem states are reported independently.",
      capabilities,
      rows,
    };
  }

  if (input.livePending || input.localPending) {
    return {
      level: "syncing",
      label: input.livePending
        ? `Workbench ✓ · applying ${input.livePending}`
        : activeLocal
          ? "Workbench ✓ · occurrence data loading"
          : "Workbench ✓ · occurrence data queued",
      detail: "Core availability is preserved while derived capability work finishes.",
      capabilities,
      rows,
    };
  }

  if (input.assurance?.current && input.assurance.findings > 0) {
    return {
      level: "ready",
      label: `Workbench ✓ · ${input.assurance.findings} review`,
      detail: "Runtime is healthy; engineering findings are available in Review.",
      capabilities,
      rows,
    };
  }

  return {
    level: "ready",
    label: "Workbench ✓",
    detail: pending
      ? "Core runtime is healthy; one or more optional capabilities are pending."
      : "Runtime capabilities are healthy.",
    capabilities,
    rows,
  };
}
