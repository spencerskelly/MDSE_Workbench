import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeHydrationCosts } from "../src/core/hydration-metrics";

test("hydration cost summary reports averages and slowest owner", () => {
  const summary = summarizeHydrationCosts([
    { path: "A.md", readMs: 2, parseMs: 1, totalMs: 3, bytes: 100, records: 2 },
    { path: "B.md", readMs: 6, parseMs: 2, totalMs: 8, bytes: 200, records: 4 },
  ]);
  assert.equal(summary.owners, 2);
  assert.equal(summary.averageMs, 5.5);
  assert.equal(summary.averageReadMs, 4);
  assert.equal(summary.averageParseMs, 1.5);
  assert.equal(summary.maxMs, 8);
  assert.equal(summary.maxPath, "B.md");
});

test("empty hydration cost summary is explicit and finite", () => {
  assert.deepEqual(summarizeHydrationCosts([]), {
    owners: 0, averageMs: 0, maxMs: 0, maxPath: null, averageReadMs: 0, averageParseMs: 0,
  });
});
