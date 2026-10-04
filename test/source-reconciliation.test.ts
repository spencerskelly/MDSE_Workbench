import { test } from "node:test";
import assert from "node:assert/strict";
import { hasPendingSourceReconciliation, type SourceReconciliationState } from "../src/core/source-reconciliation";

const settled: SourceReconciliationState = {
  building: false,
  rebuildPending: false,
  livePending: 0,
  liveApplyTimerPending: false,
  liveApplyActive: false,
  relationshipResolvePending: false,
  relationshipResolveTimerPending: false,
  relationshipResolveActive: false,
};

test("source reconciliation is settled only when every source-path lane is idle", () => {
  assert.equal(hasPendingSourceReconciliation(settled), false);
  for (const patch of [
    { building: true },
    { rebuildPending: true },
    { livePending: 1 },
    { liveApplyTimerPending: true },
    { liveApplyActive: true },
    { relationshipResolvePending: true },
    { relationshipResolveTimerPending: true },
    { relationshipResolveActive: true },
  ]) {
    assert.equal(hasPendingSourceReconciliation({ ...settled, ...patch }), true);
  }
});
