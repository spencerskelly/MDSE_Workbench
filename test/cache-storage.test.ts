import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSemanticState } from "../src/core/cache";
import {
  cacheManifestPaths,
  cacheSlotPaths,
  readCoreCacheGeneration,
  readLocalCacheGeneration,
  readSemanticCacheGeneration,
  writeSemanticCacheGeneration,
  type CacheStorage,
} from "../src/core/cache-storage";
import { LocalModelIndex, parseLocalModel } from "../src/core/localmodel";
import { ModelIndex } from "../src/core/model";
import { fixtureSchema, note } from "./helpers";

class MemoryStorage implements CacheStorage {
  readonly files = new Map<string, string>();
  readonly dirs = new Set<string>();
  readonly operations: string[] = [];
  readDelayMs = 0;
  activeReads = 0;
  maxActiveReads = 0;

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
    this.operations.push("mkdir " + path);
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.operations.push("write " + path);
  }
  async read(path: string): Promise<string> {
    this.activeReads++;
    this.maxActiveReads = Math.max(this.maxActiveReads, this.activeReads);
    try {
      if (this.readDelayMs) await new Promise((r) => setTimeout(r, this.readDelayMs));
      const v = this.files.get(path);
      if (v === undefined) throw new Error("ENOENT " + path);
      return v;
    } finally {
      this.activeReads--;
    }
  }
}


function committedSlots(storage: MemoryStorage, root = "runtime/cache") {
  const manifests = cacheManifestPaths(root).map((path, slot) => {
    const raw = storage.files.get(path);
    return raw ? { slot, path, manifest: JSON.parse(raw) } : null;
  }).filter(Boolean) as Array<{ slot: number; path: string; manifest: any }>;
  manifests.sort((a, b) =>
    b.manifest.sequence - a.manifest.sequence ||
    b.manifest.header.createdAt - a.manifest.header.createdAt ||
    b.manifest.generation.localeCompare(a.manifest.generation)
  );
  return manifests;
}

function sampleCache(createdAt = 123) {
  const schema = fixtureSchema();
  const scope = { vaultUid: "20261003190000001skellyspencer" };
  const index = new ModelIndex(schema);
  index.upsert({ ...note("A.md", "Object", { dependsOn: ["B.md"] }), uid: "20261003180000001skellyspencer" });
  index.upsert({ ...note("B.md", "Object"), uid: "20261003180000002skellyspencer" });
  const local = new LocalModelIndex();
  local.set("A.md", parseLocalModel([
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### B1",
    "- definition: [[B]]",
    "^part-20261003180000003skellyspencer",
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n")));
  return {
    schema,
    cache: serializeSemanticState(
      index,
      local,
      new Map([
        ["A.md", { ctime: 9, mtime: 10, size: 100 }],
        ["B.md", { ctime: 10, mtime: 11, size: 20 }],
      ]),
      schema,
      scope,
      "0.1.17",
      createdAt,
    ),
  };
}

test("generation shards are written before either commit-manifest slot", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });

  const [a, b] = cacheManifestPaths("runtime/cache");
  const commitIndex = storage.operations.findIndex((x) => x === "write " + a || x === "write " + b);
  assert.ok(commitIndex > 0);
  assert.equal(commitIndex, storage.operations.length - 1, "a manifest slot must be the final persistence operation");
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("fingerprints-00000.json")));
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("notes-00000.json")));
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("local-00000.json")));
});

test("a committed generation reads back to the same semantic cache", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), cache);
});

test("dual manifest slots preserve the previous generation if the newest commit or shards are damaged", async () => {
  const first = sampleCache(100).cache;
  const second = sampleCache(200).cache;
  const storage = new MemoryStorage();

  await writeSemanticCacheGeneration(storage, "runtime/cache", first, "good-old", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", second, "good-new", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), second);

  // Break the newest generation. Reader must fall back to the other committed slot.
  storage.files.delete("runtime/cache/slots/b/notes-00000.json");
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), first);

  // Corrupt the newest manifest slot itself; the previous slot still protects startup.
  const [a, b] = cacheManifestPaths("runtime/cache");
  const ma = storage.files.get(a) ?? "";
  const newestSlot = ma.includes("good-new") ? a : b;
  storage.files.set(newestSlot, "{broken");
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), first);
});

test("a partial uncommitted next slot cannot displace a committed generation", async () => {
  const first = sampleCache(100).cache;
  const second = sampleCache(200).cache;
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", first, "good-a", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", second, "good-b", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });

  // Next write targets the older A slot. Simulate only its first shard being overwritten
  // with a new generation token, then crash before its manifest is committed.
  const [slotA] = cacheSlotPaths("runtime/cache");
  const newerShard = JSON.parse(storage.files.get(slotA + "/notes-00000.json") ?? "{}");
  newerShard.generation = "unfinished-c";
  storage.files.set(slotA + "/notes-00000.json", JSON.stringify(newerShard));

  // A's old manifest now rejects its mixed shards; B is still a complete committed cache.
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), second);
});

test("with no complete committed generation, missing or corrupt shards fail closed", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  storage.files.delete("runtime/cache/slots/a/notes-00000.json");
  await assert.rejects(() => readSemanticCacheGeneration(storage, "runtime/cache"), /No complete semantic cache generation/);

  const storage2 = new MemoryStorage();
  await writeSemanticCacheGeneration(storage2, "runtime/cache", cache, "g0001", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  storage2.files.set("runtime/cache/slots/a/notes-00000.json", "{not json");
  await assert.rejects(() => readSemanticCacheGeneration(storage2, "runtime/cache"), /No complete semantic cache generation/);
});

test("cache paths reject traversal and unsafe generation names", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await assert.rejects(() => writeSemanticCacheGeneration(storage, "../cache", cache, "g"));
  await assert.rejects(() => writeSemanticCacheGeneration(storage, "runtime/cache", cache, "../g"));
});


test("cache commit order is monotonic even if the system clock moves backward", async () => {
  const newerClock = sampleCache(200).cache;
  const rolledBackClock = sampleCache(100).cache;
  rolledBackClock.header.producerVersion = "after-clock-rollback";
  const storage = new MemoryStorage();

  await writeSemanticCacheGeneration(storage, "runtime/cache", newerClock, "before-rollback", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", rolledBackClock, "after-rollback", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });

  const [a, b] = cacheManifestPaths("runtime/cache");
  const manifests = [a, b].map((path) => JSON.parse(storage.files.get(path) ?? "{}"));
  assert.deepEqual(manifests.map((m) => m.sequence).sort((x, y) => x - y), [1, 2]);
  assert.equal((await readSemanticCacheGeneration(storage, "runtime/cache")).header.producerVersion, "after-clock-rollback");
});


test("warm restore reads cache shards with bounded parallelism", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "parallel", {
    noteBuckets: 8,
    localBuckets: 8,
    fingerprintBuckets: 8,
  });
  storage.readDelayMs = 2;
  storage.maxActiveReads = 0;

  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), cache);
  assert.ok(storage.maxActiveReads > 1, "warm restore should overlap independent shard reads");
  assert.ok(storage.maxActiveReads <= 12, `bounded read concurrency exceeded: ${storage.maxActiveReads}`);
});


test("core and Local Model cache components can be read independently", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "split", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });

  storage.operations.length = 0;
  const core = await readCoreCacheGeneration(storage, "runtime/cache");
  assert.deepEqual(core.header, cache.header);
  assert.deepEqual(core.notes, cache.notes);
  assert.deepEqual(core.fingerprints, cache.fingerprints);
  assert.equal(storage.operations.some((x) => x.includes("/local-")), false, "core restore must not read Local Model shards");

  storage.operations.length = 0;
  const local = await readLocalCacheGeneration(storage, "runtime/cache");
  assert.deepEqual(local.header, cache.header);
  assert.deepEqual(local.localRegions, cache.localRegions);
  assert.equal(storage.operations.some((x) => x.includes("/notes-")), false, "Local Model restore must not read note shards");
  assert.equal(storage.operations.some((x) => x.includes("/fingerprints-")), false, "Local Model restore must not read fingerprint shards");
});


test("A/B fallback deterministically prefers committed sequence, independent of physical slot", async () => {
  const oldCache = sampleCache(100).cache;
  oldCache.header.producerVersion = "old";
  const newCache = sampleCache(200).cache;
  newCache.header.producerVersion = "new";
  const storage = new MemoryStorage();

  await writeSemanticCacheGeneration(storage, "runtime/cache", oldCache, "generation-z", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", newCache, "generation-a", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });

  const slots = committedSlots(storage);
  assert.deepEqual(slots.map((x) => x.manifest.sequence), [2, 1]);
  assert.equal((await readSemanticCacheGeneration(storage, "runtime/cache")).header.producerVersion, "new");

  const newestRoot = cacheSlotPaths("runtime/cache")[slots[0].slot];
  storage.files.delete(newestRoot + "/notes-00000.json");
  assert.equal((await readSemanticCacheGeneration(storage, "runtime/cache")).header.producerVersion, "old");
});

test("core-only and Local-Model-only readers independently fall back from a corrupt newest generation", async () => {
  const oldCache = sampleCache(100).cache;
  oldCache.header.producerVersion = "old-component";
  const newCache = sampleCache(200).cache;
  newCache.header.producerVersion = "new-component";

  {
    const storage = new MemoryStorage();
    await writeSemanticCacheGeneration(storage, "runtime/cache", oldCache, "old-core", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
    await writeSemanticCacheGeneration(storage, "runtime/cache", newCache, "new-core", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
    const newest = committedSlots(storage)[0];
    const newestRoot = cacheSlotPaths("runtime/cache")[newest.slot];
    storage.files.set(newestRoot + "/fingerprints-00000.json", "{broken");
    assert.equal((await readCoreCacheGeneration(storage, "runtime/cache")).header.producerVersion, "old-component");
  }

  {
    const storage = new MemoryStorage();
    await writeSemanticCacheGeneration(storage, "runtime/cache", oldCache, "old-local", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
    await writeSemanticCacheGeneration(storage, "runtime/cache", newCache, "new-local", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
    const newest = committedSlots(storage)[0];
    const newestRoot = cacheSlotPaths("runtime/cache")[newest.slot];
    storage.files.delete(newestRoot + "/local-00000.json");
    assert.equal((await readLocalCacheGeneration(storage, "runtime/cache")).header.producerVersion, "old-component");
  }
});

test("corrupt newest manifest is ignored deterministically without touching the older committed slot", async () => {
  const oldCache = sampleCache(100).cache;
  oldCache.header.producerVersion = "manifest-old";
  const newCache = sampleCache(200).cache;
  newCache.header.producerVersion = "manifest-new";
  const storage = new MemoryStorage();

  await writeSemanticCacheGeneration(storage, "runtime/cache", oldCache, "manifest-old", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", newCache, "manifest-new", { noteBuckets: 2, localBuckets: 2, fingerprintBuckets: 2 });

  const newest = committedSlots(storage)[0];
  storage.files.set(newest.path, "{broken");
  assert.equal((await readSemanticCacheGeneration(storage, "runtime/cache")).header.producerVersion, "manifest-old");
});
