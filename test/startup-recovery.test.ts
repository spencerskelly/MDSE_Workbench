import { test } from "node:test";
import assert from "node:assert/strict";
import { recoverWithColdBuild } from "../src/core/startup-recovery";

test("cold recovery discards provisional state before authoritative build starts", async () => {
  const events: string[] = [];

  const result = await recoverWithColdBuild(
    async () => {
      events.push("discard:start");
      await Promise.resolve();
      events.push("discard:done");
    },
    async () => {
      events.push("build:start");
      await Promise.resolve();
      events.push("build:done");
      return "full";
    },
  );

  assert.equal(result, "full");
  assert.deepEqual(events, ["discard:start", "discard:done", "build:start", "build:done"]);
});

test("cold recovery never starts the build if provisional-state discard fails", async () => {
  let buildStarted = false;

  await assert.rejects(
    () => recoverWithColdBuild(
      async () => {
        throw new Error("discard failed");
      },
      async () => {
        buildStarted = true;
        return "unexpected";
      },
    ),
    /discard failed/,
  );

  assert.equal(buildStarted, false);
});

test("cold recovery propagates cold-build failure only after provisional state is gone", async () => {
  let discarded = false;

  await assert.rejects(
    () => recoverWithColdBuild(
      async () => {
        discarded = true;
      },
      async () => {
        assert.equal(discarded, true);
        throw new Error("cold build failed");
      },
    ),
    /cold build failed/,
  );

  assert.equal(discarded, true);
});
