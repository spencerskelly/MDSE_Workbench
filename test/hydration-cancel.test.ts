import { test } from "node:test";
import assert from "node:assert/strict";
import { requeueHydrationPaths } from "../src/core/hydration-cancel";

test("cancelled hydration requeues unfinished owners without duplicates", () => {
  assert.deepEqual(
    requeueHydrationPaths(["Later.md", "Shared.md"], ["Owner.md", "Shared.md"]),
    ["Later.md", "Owner.md", "Shared.md"],
  );
});

test("cancelling with no active owners preserves the deferred queue", () => {
  assert.deepEqual(requeueHydrationPaths(["B.md", "A.md"], []), ["A.md", "B.md"]);
});
