import { test } from "node:test";
import assert from "node:assert/strict";
import { canPublishCoreReady, type CoreReadyState } from "../src/core/core-readiness";

const ready: CoreReadyState = {
  publicationGate: true,
  schemaLoaded: true,
  writerReady: true,
  statsAvailable: true,
  sourceReconciliationPending: false,
  building: false,
};

test("core-ready publishes only after the explicit gate and every readiness prerequisite", () => {
  assert.equal(canPublishCoreReady(ready), true);

  for (const patch of [
    { publicationGate: false },
    { schemaLoaded: false },
    { writerReady: false },
    { statsAvailable: false },
    { sourceReconciliationPending: true },
    { building: true },
  ]) {
    assert.equal(canPublishCoreReady({ ...ready, ...patch }), false);
  }
});

test("restored stats alone never make warm startup core-ready", () => {
  assert.equal(
    canPublishCoreReady({
      publicationGate: false,
      schemaLoaded: true,
      writerReady: true,
      statsAvailable: true,
      sourceReconciliationPending: true,
      building: false,
    }),
    false,
  );
});
