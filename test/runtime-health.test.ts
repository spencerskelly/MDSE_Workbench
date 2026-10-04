import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRuntimeHealth, type RuntimeHealthInput } from "../src/core/runtime-health";
import { editingBlockedReason } from "../src/core/edit-availability";
import { fixtureSchema } from "./helpers";

const base = (patch: Partial<RuntimeHealthInput> = {}): RuntimeHealthInput => ({
  ready: true,
  building: false,
  coreError: null,
  occurrenceError: null,
  localPending: 0,
  localQueued: 0,
  livePending: 0,
  localReadErrors: 0,
  schemaLoaded: true,
  schemaError: null,
  schemaWarnings: 0,
  cacheWriteError: null,
  cacheCurrent: true,
  cachePending: false,
  assuranceActive: false,
  assurance: null,
  ...patch,
});

test("runtime health distinguishes startup, syncing, healthy and attention without running assurance", () => {
  assert.equal(
    summarizeRuntimeHealth(base({
      ready: false,
      schemaLoaded: false,
      cacheCurrent: false,
    })).level,
    "starting",
  );

  const syncing = summarizeRuntimeHealth(base({
    localPending: 12,
    cacheCurrent: false,
    cachePending: true,
  }));
  assert.equal(syncing.level, "syncing");
  assert.match(syncing.label, /occurrence data loading/);

  const healthy = summarizeRuntimeHealth(base());
  assert.equal(healthy.level, "ready");
  assert.equal(healthy.label, "Workbench ✓");
  assert.match(healthy.detail, /optional capabilities|healthy/);

  const attention = summarizeRuntimeHealth(base({
    localReadErrors: 2,
    schemaWarnings: 1,
    cacheWriteError: "disk full",
    cacheCurrent: false,
  }));
  assert.equal(attention.level, "attention");
  assert.equal(attention.capabilities.occurrence.state, "failed");
  assert.equal(attention.capabilities.cache.state, "failed");
  assert.equal(attention.capabilities.schema.state, "ready", "schema warnings are readiness-compatible");
});

test("engineering findings do not turn runtime health into a runtime failure", () => {
  const h = summarizeRuntimeHealth(base({
    assurance: { current: true, findings: 7, computedAt: 1 },
  }));
  assert.equal(h.level, "ready");
  assert.equal(h.capabilities.assurance.state, "ready");
  assert.match(h.label, /7 review/);
});

test("coalesced live edits appear as core pending rather than runtime failure", () => {
  const h = summarizeRuntimeHealth(base({
    ready: false,
    livePending: 3,
    cacheCurrent: false,
    cachePending: true,
  }));
  assert.equal(h.capabilities.core.state, "pending");
  assert.equal(h.capabilities.core.detail, "starting");
  assert.notEqual(h.level, "attention");
});

test("core and occurrence failures are independently reported", () => {
  const core = summarizeRuntimeHealth(base({
    ready: false,
    coreError: "index failed",
    cacheCurrent: false,
  }));
  assert.equal(core.capabilities.core.state, "failed");
  assert.equal(core.capabilities.schema.state, "ready");
  assert.match(core.rows.map((r) => r[1]).join(" "), /index failed/);

  const occurrence = summarizeRuntimeHealth(base({
    occurrenceError: "background failure",
    cacheCurrent: false,
  }));
  assert.equal(occurrence.capabilities.core.state, "ready");
  assert.equal(occurrence.capabilities.occurrence.state, "failed");
  assert.match(occurrence.rows.map((r) => r[1]).join(" "), /background failure/);
});

test("deferred occurrence work is reported as pending without implying core unavailability", () => {
  const h = summarizeRuntimeHealth(base({
    localPending: 12,
    localQueued: 12,
    cacheCurrent: false,
    cachePending: true,
  }));
  assert.equal(h.capabilities.core.state, "ready");
  assert.equal(h.capabilities.occurrence.state, "pending");
  assert.match(h.capabilities.occurrence.detail, /12 note\(s\) queued/);
});

test("schema failure remains distinct from core failure", () => {
  const h = summarizeRuntimeHealth(base({
    ready: false,
    schemaLoaded: false,
    schemaError: "relationships.yaml parse error",
    cacheCurrent: false,
  }));
  assert.equal(h.capabilities.schema.state, "failed");
  assert.equal(h.capabilities.core.state, "pending");
  assert.match(h.capabilities.core.detail, /blocked by schema/);
  assert.equal(h.level, "attention");
});

test("cache readiness and failure are independently visible", () => {
  const pending = summarizeRuntimeHealth(base({
    cacheCurrent: false,
    cachePending: true,
  }));
  assert.equal(pending.capabilities.cache.state, "pending");
  assert.match(pending.capabilities.cache.detail, /pending/);

  const failed = summarizeRuntimeHealth(base({
    cacheCurrent: false,
    cachePending: true,
    cacheWriteError: "quota exceeded",
  }));
  assert.equal(failed.capabilities.cache.state, "failed");
  assert.equal(failed.capabilities.core.state, "ready");
});

test("assurance pending, ready and failed are independent capability states", () => {
  const computing = summarizeRuntimeHealth(base({
    assuranceActive: true,
  }));
  assert.equal(computing.capabilities.assurance.state, "pending");
  assert.equal(computing.capabilities.assurance.detail, "computing");

  const ready = summarizeRuntimeHealth(base({
    assurance: { current: true, findings: 0, computedAt: 1 },
  }));
  assert.equal(ready.capabilities.assurance.state, "ready");

  const failed = summarizeRuntimeHealth(base({
    assurance: { current: true, findings: 0, computedAt: 1, error: "validator unavailable" },
  }));
  assert.equal(failed.capabilities.assurance.state, "failed");
  assert.equal(failed.capabilities.core.state, "ready");
});


test("injected occurrence failure leaves core, schema, cache and editing available", () => {
  const h = summarizeRuntimeHealth(base({
    occurrenceError: "injected occurrence failure",
    assurance: { current: true, findings: 0, computedAt: 1 },
  }));

  assert.equal(h.capabilities.occurrence.state, "failed");
  assert.equal(h.capabilities.core.state, "ready");
  assert.equal(h.capabilities.schema.state, "ready");
  assert.equal(h.capabilities.cache.state, "ready");
  assert.equal(h.capabilities.assurance.state, "ready");
  assert.equal(editingBlockedReason(true, fixtureSchema()), null);
});

test("injected cache failure leaves core, occurrence, schema, assurance and editing available", () => {
  const h = summarizeRuntimeHealth(base({
    cacheWriteError: "injected cache failure",
    cacheCurrent: false,
    assurance: { current: true, findings: 0, computedAt: 1 },
  }));

  assert.equal(h.capabilities.cache.state, "failed");
  assert.equal(h.capabilities.core.state, "ready");
  assert.equal(h.capabilities.occurrence.state, "ready");
  assert.equal(h.capabilities.schema.state, "ready");
  assert.equal(h.capabilities.assurance.state, "ready");
  assert.equal(editingBlockedReason(true, fixtureSchema()), null);
});

test("injected assurance failure leaves core, occurrence, cache, schema and editing available", () => {
  const h = summarizeRuntimeHealth(base({
    assurance: {
      current: true,
      findings: 0,
      computedAt: 1,
      error: "injected assurance failure",
    },
  }));

  assert.equal(h.capabilities.assurance.state, "failed");
  assert.equal(h.capabilities.core.state, "ready");
  assert.equal(h.capabilities.occurrence.state, "ready");
  assert.equal(h.capabilities.cache.state, "ready");
  assert.equal(h.capabilities.schema.state, "ready");
  assert.equal(editingBlockedReason(true, fixtureSchema()), null);
});

test("editing gate fails closed only for authoritative core or schema conditions", () => {
  const schema = fixtureSchema();
  assert.match(editingBlockedReason(false, schema) ?? "", /still indexing/);
  assert.match(editingBlockedReason(true, null) ?? "", /schema is not available/);

  const oldSchema = { ...schema, relationshipsVersion: "0" };
  assert.match(editingBlockedReason(true, oldSchema) ?? "", /schema is older/);
});
