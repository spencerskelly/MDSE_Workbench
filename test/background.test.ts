import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_MAX_DEFERRAL_MS, BACKGROUND_RESUME_QUIET_MS, canRunBackgroundWork, canStartRuntimeWork, RuntimeWorkPriority } from "../src/core/background";

const idle = {
  unloaded: false,
  ready: true,
  building: false,
  rebuildPending: false,
  liveUpdatePending: 0,
  quietForMs: 3000,
  minimumQuietMs: 3000,
};

test("background work runs only when the shared foreground gate is idle", () => {
  assert.equal(canRunBackgroundWork(idle), true);
  assert.equal(canRunBackgroundWork({ ...idle, unloaded: true }), false);
  assert.equal(canRunBackgroundWork({ ...idle, ready: false }), false);
  assert.equal(canRunBackgroundWork({ ...idle, building: true }), false);
  assert.equal(canRunBackgroundWork({ ...idle, rebuildPending: true }), false);
  assert.equal(canRunBackgroundWork({ ...idle, liveUpdatePending: 1 }), false);
  assert.equal(canRunBackgroundWork({ ...idle, quietForMs: 2999 }), false);
});


test("runtime work priority is explicit and ordered", () => {
  assert.ok(RuntimeWorkPriority.indexing > RuntimeWorkPriority.requestedHydration);
  assert.ok(RuntimeWorkPriority.requestedHydration > RuntimeWorkPriority.backgroundHydration);
  assert.ok(RuntimeWorkPriority.backgroundHydration > RuntimeWorkPriority.assurance);
  assert.ok(RuntimeWorkPriority.assurance > RuntimeWorkPriority.cacheWrite);

  assert.equal(canStartRuntimeWork("cacheWrite", ["assurance"]), false);
  assert.equal(canStartRuntimeWork("assurance", ["backgroundHydration"]), false);
  assert.equal(canStartRuntimeWork("backgroundHydration", ["requestedHydration"]), false);
  assert.equal(canStartRuntimeWork("requestedHydration", ["backgroundHydration"]), true);
  assert.equal(canStartRuntimeWork("indexing", ["requestedHydration", "cacheWrite"]), true);
});


test("background resume policy requires a 3 second foreground-quiet window", () => {
  assert.equal(BACKGROUND_RESUME_QUIET_MS, 3000);
  assert.equal(canRunBackgroundWork({ ...idle, quietForMs: BACKGROUND_RESUME_QUIET_MS - 1, minimumQuietMs: BACKGROUND_RESUME_QUIET_MS }), false);
  assert.equal(canRunBackgroundWork({ ...idle, quietForMs: BACKGROUND_RESUME_QUIET_MS, minimumQuietMs: BACKGROUND_RESUME_QUIET_MS }), true);
});


test("background starvation bound eventually overrides only the quiet-window requirement", () => {
  assert.equal(BACKGROUND_MAX_DEFERRAL_MS, 30000);

  const intermittentlyBusy = {
    ...idle,
    quietForMs: 500,
    minimumQuietMs: BACKGROUND_RESUME_QUIET_MS,
    waitingForMs: BACKGROUND_MAX_DEFERRAL_MS,
    maxDeferralMs: BACKGROUND_MAX_DEFERRAL_MS,
  };

  assert.equal(
    canRunBackgroundWork({ ...intermittentlyBusy, waitingForMs: BACKGROUND_MAX_DEFERRAL_MS - 1 }),
    false,
    "before the bound, intermittent edits still defer optional work",
  );
  assert.equal(
    canRunBackgroundWork(intermittentlyBusy),
    true,
    "at the bound, quiet-window starvation is relieved",
  );
});

test("starvation relief never overrides hard foreground safety blockers", () => {
  const aged = {
    ...idle,
    quietForMs: 0,
    waitingForMs: BACKGROUND_MAX_DEFERRAL_MS * 2,
    maxDeferralMs: BACKGROUND_MAX_DEFERRAL_MS,
  };

  assert.equal(canRunBackgroundWork({ ...aged, unloaded: true }), false);
  assert.equal(canRunBackgroundWork({ ...aged, ready: false }), false);
  assert.equal(canRunBackgroundWork({ ...aged, building: true }), false);
  assert.equal(canRunBackgroundWork({ ...aged, rebuildPending: true }), false);
  assert.equal(canRunBackgroundWork({ ...aged, liveUpdatePending: 1 }), false);
});

test("without a pending-age bound the normal quiet window remains authoritative", () => {
  assert.equal(
    canRunBackgroundWork({
      ...idle,
      quietForMs: BACKGROUND_RESUME_QUIET_MS - 1,
      minimumQuietMs: BACKGROUND_RESUME_QUIET_MS,
    }),
    false,
  );
});
