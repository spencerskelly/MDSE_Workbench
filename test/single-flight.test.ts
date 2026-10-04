import { test } from "node:test";
import assert from "node:assert/strict";
import { SingleFlightByKey } from "../src/core/single-flight";

test("concurrent callers for one key share one in-flight task", async () => {
  const flights = new SingleFlightByKey<string, number>();
  let starts = 0;
  let resolve!: (value: number) => void;
  const first = flights.run("Owner.md", () => {
    starts++;
    return new Promise<number>((r) => { resolve = r; });
  });
  const second = flights.run("Owner.md", async () => {
    starts++;
    return 99;
  });

  assert.equal(first, second);
  assert.equal(starts, 1);
  assert.equal(flights.size, 1);
  resolve(42);
  assert.equal(await second, 42);
  await Promise.resolve();
  assert.equal(flights.size, 0);
});

test("different owner keys can run independently", async () => {
  const flights = new SingleFlightByKey<string, string>();
  let starts = 0;
  const a = flights.run("A.md", async () => { starts++; return "A"; });
  const b = flights.run("B.md", async () => { starts++; return "B"; });
  assert.equal(starts, 2);
  assert.deepEqual(await Promise.all([a, b]), ["A", "B"]);
});
