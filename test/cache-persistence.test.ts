import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_PERSIST_QUIET_MS,
  MIN_CACHE_PERSIST_INTERVAL_MS,
  cachePersistenceDelayMs,
} from "../src/core/cache-persistence";

test("first cache persistence waits for the trailing quiet window", () => {
  assert.equal(cachePersistenceDelayMs(1000, null), CACHE_PERSIST_QUIET_MS);
});

test("rapid edit bursts cannot force another cache generation inside the minimum interval", () => {
  const lastWriteAt = 100_000;

  // Each edit re-arms the trailing timer. Even late in the burst, persistence remains bounded by
  // the 30-second generation interval rather than writing once per edit/quiet-window cycle.
  assert.equal(cachePersistenceDelayMs(101_000, lastWriteAt), 29_000);
  assert.equal(cachePersistenceDelayMs(105_000, lastWriteAt), 25_000);
  assert.equal(cachePersistenceDelayMs(115_000, lastWriteAt), 15_000);
  assert.equal(cachePersistenceDelayMs(122_000, lastWriteAt), CACHE_PERSIST_QUIET_MS);
});

test("after the minimum interval expires, persistence still requires a quiet window", () => {
  const lastWriteAt = 100_000;
  assert.equal(
    cachePersistenceDelayMs(100_000 + MIN_CACHE_PERSIST_INTERVAL_MS, lastWriteAt),
    CACHE_PERSIST_QUIET_MS,
  );
  assert.equal(
    cachePersistenceDelayMs(100_000 + MIN_CACHE_PERSIST_INTERVAL_MS + 60_000, lastWriteAt),
    CACHE_PERSIST_QUIET_MS,
  );
});

test("clock rollback does not bypass the cache persistence rate limit", () => {
  assert.equal(
    cachePersistenceDelayMs(90_000, 100_000),
    MIN_CACHE_PERSIST_INTERVAL_MS,
  );
});
