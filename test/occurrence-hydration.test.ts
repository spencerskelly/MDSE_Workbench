import { test } from "node:test";
import assert from "node:assert/strict";
import { canPublishOccurrence, shouldPauseBackgroundOccurrence } from "../src/core/occurrence-hydration";
import { SingleFlightByKey } from "../src/core/single-flight";

test("requested occurrence work pauses background hydration unless the same task was explicitly demanded", () => {
  assert.equal(
    shouldPauseBackgroundOccurrence({
      demanded: false,
      backgroundIdle: true,
      liveUpdatePending: 0,
      requestedActive: 1,
    }),
    true,
  );
  assert.equal(
    shouldPauseBackgroundOccurrence({
      demanded: false,
      backgroundIdle: true,
      liveUpdatePending: 0,
      requestedActive: 0,
    }),
    false,
  );
  assert.equal(
    shouldPauseBackgroundOccurrence({
      demanded: true,
      backgroundIdle: false,
      liveUpdatePending: 5,
      requestedActive: 2,
    }),
    false,
  );
});

test("background and requested hydration for one owner share one body read", async () => {
  const reads = new SingleFlightByKey<string, { text: string }>();
  let bodyReads = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });

  const background = reads.run("Owner.md", async () => {
    bodyReads++;
    await gate;
    return { text: "same body" };
  });
  const requested = reads.run("Owner.md", async () => {
    bodyReads++;
    return { text: "duplicate body" };
  });

  assert.equal(background, requested);
  assert.equal(bodyReads, 1);
  release();
  assert.deepEqual(await requested, { text: "same body" });
});

test("newer requested owner revision makes older background publication stale", () => {
  const epoch = 7;
  const backgroundRevision = 10;
  const requestedRevision = 11;

  assert.equal(canPublishOccurrence(epoch, epoch, backgroundRevision, requestedRevision), false);
  assert.equal(canPublishOccurrence(epoch, epoch, requestedRevision, requestedRevision), true);
});

test("source epoch change blocks both background and requested stale publication", () => {
  assert.equal(canPublishOccurrence(4, 5, 20, 20), false);
  assert.equal(canPublishOccurrence(5, 5, 20, 20), true);
});
