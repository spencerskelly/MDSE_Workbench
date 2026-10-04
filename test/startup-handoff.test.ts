import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleStartupHandoff } from "../src/core/startup-handoff";

test("layout-ready handoff never runs startup synchronously", () => {
  let queued: (() => void) | null = null;
  let ran = false;

  scheduleStartupHandoff(
    (run) => {
      queued = run;
      return 1;
    },
    () => undefined,
    () => {
      ran = true;
    },
  );

  assert.equal(ran, false);
  assert.ok(queued);
  queued!();
  assert.equal(ran, true);
});

test("cancelled startup handoff cannot run later", () => {
  let queued: (() => void) | null = null;
  let cancelledHandle: unknown = null;
  let ran = false;

  const handoff = scheduleStartupHandoff(
    (run) => {
      queued = run;
      return 42;
    },
    (handle) => {
      cancelledHandle = handle;
    },
    () => {
      ran = true;
    },
  );

  handoff.cancel();
  assert.equal(cancelledHandle, 42);
  queued!();
  assert.equal(ran, false);
});
