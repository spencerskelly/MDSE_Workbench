import { test } from "node:test";
import assert from "node:assert/strict";
import { CacheMutationGate } from "../src/core/cache-mutation";

test("cache clear closes the write gate immediately and waits for active persistence", async () => {
  const gate = new CacheMutationGate();
  const order: string[] = [];
  let finishWrite!: () => void;
  const activeWrite = new Promise<void>((resolve) => {
    finishWrite = () => {
      order.push("write-finished");
      resolve();
    };
  });

  const clear = gate.clear(activeWrite, async () => {
    order.push("cache-removed");
  });

  assert.equal(gate.clearing, true);
  assert.equal(gate.writesAllowed(), false);
  assert.deepEqual(order, []);

  finishWrite();
  await clear;

  assert.deepEqual(order, ["write-finished", "cache-removed"]);
  assert.equal(gate.clearing, false);
  assert.equal(gate.writesAllowed(), true);
});

test("concurrent clear requests share one deletion task", async () => {
  const gate = new CacheMutationGate();
  let removals = 0;
  let finishRemoval!: () => void;
  const remove = () =>
    new Promise<void>((resolve) => {
      removals++;
      finishRemoval = resolve;
    });

  const first = gate.clear(null, remove);
  const second = gate.clear(null, remove);

  assert.equal(first, second);
  assert.equal(removals, 1);
  assert.equal(gate.writesAllowed(), false);

  finishRemoval();
  await Promise.all([first, second]);

  assert.equal(removals, 1);
  assert.equal(gate.writesAllowed(), true);
});

test("failed active write prevents destructive clear and reopens the gate", async () => {
  const gate = new CacheMutationGate();
  let removed = false;
  const failedWrite = Promise.reject(new Error("write failed"));

  await assert.rejects(
    () => gate.clear(failedWrite, async () => {
      removed = true;
    }),
    /write failed/,
  );

  assert.equal(removed, false);
  assert.equal(gate.clearing, false);
  assert.equal(gate.writesAllowed(), true);
});
