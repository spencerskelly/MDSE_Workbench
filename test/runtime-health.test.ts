import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeRuntimeHealth } from "../src/core/runtime-health";

test("runtime health distinguishes startup, syncing, healthy and attention without running assurance", () => {
  assert.equal(
    summarizeRuntimeHealth({
      ready: false,
      building: false,
      coreError: null,
      occurrenceError: null,
      localPending: 0,
      localQueued: 0,
      livePending: 0,
      localReadErrors: 0,
      schemaWarnings: 0,
      cacheWriteError: null,
      cacheCurrent: false,
      assurance: null,
    }).level,
    "starting",
  );

  const syncing = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: null,
    localPending: 12,
    localQueued: 0,
    livePending: 0,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: false,
    assurance: null,
  });
  assert.equal(syncing.level, "syncing");
  assert.match(syncing.label, /occurrence data loading/);

  const healthy = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: null,
    localPending: 0,
    localQueued: 0,
    livePending: 0,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: true,
    assurance: null,
  });
  assert.equal(healthy.level, "ready");
  assert.equal(healthy.label, "Workbench ✓");
  assert.match(healthy.detail, /on demand/);

  const attention = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: null,
    localPending: 0,
    localQueued: 0,
    livePending: 0,
    localReadErrors: 2,
    schemaWarnings: 1,
    cacheWriteError: "disk full",
    cacheCurrent: false,
    assurance: null,
  });
  assert.equal(attention.level, "attention");
  assert.match(attention.label, /4 issues/);
});

test("engineering findings do not turn runtime health into a runtime failure", () => {
  const h = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: null,
    localPending: 0,
    localQueued: 0,
    livePending: 0,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: true,
    assurance: { current: true, findings: 7, computedAt: 1 },
  });
  assert.equal(h.level, "ready");
  assert.match(h.label, /7 review/);
  assert.match(h.detail, /Runtime is healthy/);
});


test("coalesced live edits appear as syncing rather than runtime failure", () => {
  const h = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: null,
    localPending: 0,
    localQueued: 0,
    livePending: 3,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: false,
    assurance: null,
  });
  assert.equal(h.level, "syncing");
  assert.match(h.label, /applying 3/);
  assert.match(h.detail, /coalesced live edits/);
});


test("core and occurrence failures are reported as scoped runtime attention", () => {
  const core = summarizeRuntimeHealth({
    ready: false,
    building: false,
    coreError: "schema parser crashed",
    occurrenceError: null,
    localPending: 0,
    localQueued: 0,
    livePending: 0,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: false,
    assurance: null,
  });
  assert.equal(core.level, "attention");
  assert.match(core.label, /core unavailable/);
  assert.match(core.rows.map((r) => r[1]).join(" "), /schema parser crashed/);

  const occurrence = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: "background failure",
    localPending: 0,
    localQueued: 0,
    livePending: 0,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: false,
    assurance: null,
  });
  assert.equal(occurrence.level, "attention");
  assert.match(occurrence.rows.map((r) => r[1]).join(" "), /background failure/);
});


test("deferred occurrence work is reported as queued without implying core unavailability", () => {
  const h = summarizeRuntimeHealth({
    ready: true,
    building: false,
    coreError: null,
    occurrenceError: null,
    localPending: 12,
    localQueued: 12,
    livePending: 0,
    localReadErrors: 0,
    schemaWarnings: 0,
    cacheWriteError: null,
    cacheCurrent: false,
    assurance: null,
  });
  assert.equal(h.level, "syncing");
  assert.match(h.label, /occurrence data queued/);
  assert.match(h.detail, /Core model is ready/);
});
