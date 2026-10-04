import { test } from "node:test";
import assert from "node:assert/strict";
import { CooperativeBudget } from "../src/core/cooperative";

test("cooperative budget yields by elapsed work time rather than item count", async () => {
  let now = 0;
  let yields = 0;
  const budget = new CooperativeBudget(10, () => now);

  now = 5;
  assert.equal(await budget.checkpoint(async () => { yields++; }), false);
  assert.equal(yields, 0);

  now = 10;
  assert.equal(await budget.checkpoint(async () => { yields++; }), true);
  assert.equal(yields, 1);

  now = 15;
  assert.equal(await budget.checkpoint(async () => { yields++; }), false, "budget resets after yielding");
  now = 20;
  assert.equal(await budget.checkpoint(async () => { yields++; }), true);
  assert.equal(yields, 2);
});

test("cooperative budget refuses invalid durations", () => {
  assert.throws(() => new CooperativeBudget(0), /positive finite/);
  assert.throws(() => new CooperativeBudget(Number.NaN), /positive finite/);
});
