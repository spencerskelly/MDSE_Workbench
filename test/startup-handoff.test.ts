import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleStartupHandoff } from "../src/core/startup-handoff";

test("layout-ready handoff never runs startup synchronously", () => {
  const queued: Array<() => void> = [];
  let ran = false;

  scheduleStartupHandoff(
    (run) => {
      queued.push(run);
      return 1;
    },
    () => undefined,
    () => {
      ran = true;
    },
  );

  assert.equal(ran, false);
  assert.equal(queued.length, 1);
  queued[0]();
  assert.equal(ran, true);
});

test("cancelled startup handoff cannot run later", () => {
  const queued: Array<() => void> = [];
  let cancelledHandle: unknown = null;
  let ran = false;

  const handoff = scheduleStartupHandoff(
    (run) => {
      queued.push(run);
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
  assert.equal(queued.length, 1);
  queued[0]();
  assert.equal(ran, false);
});
