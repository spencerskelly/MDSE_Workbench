import { test } from "node:test";
import assert from "node:assert/strict";
import { localRegionEvictions } from "../src/core/local-retention";

test("retention evicts oldest cold owners first", () => {
  assert.deepEqual(
    localRegionEvictions(["A.md", "B.md", "C.md", "D.md"], new Set(), 2),
    ["A.md", "B.md"],
  );
});

test("protected active owners may temporarily exceed the steady-state cap", () => {
  assert.deepEqual(
    localRegionEvictions(["A.md", "B.md", "C.md"], new Set(["A.md", "B.md"]), 1),
    ["C.md"],
  );
});

test("invalid retention limits fail closed", () => {
  assert.throws(() => localRegionEvictions(["A.md"], new Set(), 0), /positive integer/);
});
