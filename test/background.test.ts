import { test } from "node:test";
import assert from "node:assert/strict";
import { canRunBackgroundWork } from "../src/core/background";

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
