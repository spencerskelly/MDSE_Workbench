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


test("assurance failure is contained and cached for the current semantic revision", async () => {
  const index = new ModelIndex(fixtureSchema());
  index.upsert(note("A.md", "Object"));
  let revision = 3;
  let calls = 0;
  const manager = new AssuranceManager({
    revision: () => revision,
    settle: async () => {},
    index: () => index,
    localFindings: () => {
      calls++;
      throw new Error("validator boom");
    },
  });

  const failed = await manager.get();
  assert.equal(failed.revision, 3);
  assert.equal(failed.stale, false);
  assert.match(failed.error ?? "", /validator boom/);
  assert.equal(failed.all.length, 0);

  const same = await manager.get();
  assert.equal(same, failed);
  assert.equal(calls, 1, "repeat UI consumers reuse the scoped failure snapshot");

  revision++;
  const retried = await manager.get();
  assert.equal(retried.revision, 4);
  assert.match(retried.error ?? "", /validator boom/);
  assert.equal(calls, 2, "a semantic revision change retries assurance");
});


test("automatic assurance waits for shared background permission before scanning", async () => {
  const index = new ModelIndex(fixtureSchema());
  index.upsert(note("A.md", "Object"));
  const events: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const manager = new AssuranceManager({
    revision: () => 1,
    settle: async () => { events.push("settle"); },
    index: () => index,
    localFindings: () => { events.push("scan"); return []; },
    waitForBackgroundPermission: async () => {
      events.push("wait");
      await gate;
      events.push("allowed");
    },
  });

  const task = manager.get();
  await Promise.resolve();
  assert.deepEqual(events, ["wait"]);
  release();
  await task;
  assert.deepEqual(events, ["wait", "allowed", "settle", "scan"]);
});

test("forced assurance may start immediately but stale retry yields to shared activity policy", async () => {
  const index = new ModelIndex(fixtureSchema());
  index.upsert(note("A.md", "Object"));
  let revision = 1;
  let scans = 0;
  let waits = 0;
  const manager = new AssuranceManager({
    revision: () => revision,
    settle: async () => {},
    index: () => index,
    localFindings: () => {
      scans++;
      if (scans === 1) revision = 2;
      return [];
    },
    waitForBackgroundPermission: async () => { waits++; },
  });

  const snapshot = await manager.get(true);
  assert.equal(scans, 2);
  assert.equal(waits, 1, "only the stale retry should yield after foreground activity races the scan");
  assert.equal(snapshot.revision, 2);
  assert.equal(snapshot.stale, false);
});
