import { test } from "node:test";
import assert from "node:assert/strict";
import { MetadataChangeBurst } from "../src/core/metadata-burst";

test("repeated metadata events for one path count once within a burst", () => {
  const burst = new MetadataChangeBurst(10_000);
  assert.deepEqual(burst.record("A.md", 1_000), { distinct: true, uniquePaths: 1 });
  assert.deepEqual(burst.record("A.md", 1_100), { distinct: false, uniquePaths: 1 });
  assert.deepEqual(burst.record("B.md", 1_200), { distinct: true, uniquePaths: 2 });
});

test("metadata burst resets after the quiet window", () => {
  const burst = new MetadataChangeBurst(10_000);
  burst.record("A.md", 1_000);
  assert.deepEqual(burst.record("A.md", 11_001), { distinct: true, uniquePaths: 1 });
});

test("metadata burst can be reset explicitly after a rebuild", () => {
  const burst = new MetadataChangeBurst(10_000);
  burst.record("A.md", 1_000);
  burst.record("B.md", 1_100);
  burst.reset();
  assert.deepEqual(burst.record("A.md", 1_200), { distinct: true, uniquePaths: 1 });
});
