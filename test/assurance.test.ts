import { test } from "node:test";
import assert from "node:assert/strict";
import { AssuranceManager } from "../src/obsidian/assurance";
import { ModelIndex } from "../src/core/model";
import { fixtureSchema, note } from "./helpers";

test("assurance snapshot is reused until semantic revision changes", async () => {
  const index = new ModelIndex(fixtureSchema());
  index.upsert(note("A.md", "Object"));
  let revision = 1;
  let localCalls = 0;
  const manager = new AssuranceManager({
    revision: () => revision,
    settle: async () => {},
    index: () => index,
    localFindings: () => {
      localCalls++;
      return [];
    },
  });

  const a = await manager.get();
  const b = await manager.get();
  assert.equal(a, b);
  assert.equal(localCalls, 1);

  revision++;
  const c = await manager.get();
  assert.notEqual(c, a);
  assert.equal(c.revision, 2);
  assert.equal(localCalls, 2);
});

test("forced assurance refresh recomputes even when revision is unchanged", async () => {
  const index = new ModelIndex(fixtureSchema());
  index.upsert(note("A.md", "Object"));
  let localCalls = 0;
  const manager = new AssuranceManager({
    revision: () => 7,
    settle: async () => {},
    index: () => index,
    localFindings: () => {
      localCalls++;
      return [];
    },
  });

  await manager.get();
  await manager.get(true);
  assert.equal(localCalls, 2);
});

test("assurance retries once when the semantic revision changes during a scan", async () => {
  const index = new ModelIndex(fixtureSchema());
  index.upsert(note("A.md", "Object"));
  let revision = 1;
  let localCalls = 0;
  const manager = new AssuranceManager({
    revision: () => revision,
    settle: async () => {},
    index: () => index,
    localFindings: () => {
      localCalls++;
      if (localCalls === 1) revision = 2;
      return [];
    },
  });

  const snapshot = await manager.get();
  assert.equal(localCalls, 2);
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.stale, false);
  assert.equal(manager.peek(), snapshot);
});
