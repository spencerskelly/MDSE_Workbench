import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSemanticState } from "../src/core/cache";
import {
  cacheManifestPaths,
  cacheSlotPaths,
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

  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
    this.operations.push("mkdir " + path);
  }
  async write(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.operations.push("write " + path);
  }
  async read(path: string): Promise<string> {
    const v = this.files.get(path);
    if (v === undefined) throw new Error("ENOENT " + path);
    return v;
  }
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
        ["A.md", { mtime: 10, size: 100 }],
        ["B.md", { mtime: 11, size: 20 }],
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
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });

  const [a, b] = cacheManifestPaths("runtime/cache");
  const commitIndex = storage.operations.findIndex((x) => x === "write " + a || x === "write " + b);
  assert.ok(commitIndex > 0);
  assert.equal(commitIndex, storage.operations.length - 1, "a manifest slot must be the final persistence operation");
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("notes-00000.json")));
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("local-00000.json")));
});

test("a committed generation reads back to the same semantic cache", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), cache);
});

test("dual manifest slots preserve the previous generation if the newest commit or shards are damaged", async () => {
  const first = sampleCache(100).cache;
  const second = sampleCache(200).cache;
  const storage = new MemoryStorage();

  await writeSemanticCacheGeneration(storage, "runtime/cache", first, "good-old", { notesPerShard: 1, regionsPerShard: 1 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", second, "good-new", { notesPerShard: 1, regionsPerShard: 1 });
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), second);

  // Break the newest generation. Reader must fall back to the other committed slot.
  storage.files.delete("runtime/cache/slots/b/notes-00001.json");
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
  await writeSemanticCacheGeneration(storage, "runtime/cache", first, "good-a", { notesPerShard: 1, regionsPerShard: 1 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", second, "good-b", { notesPerShard: 1, regionsPerShard: 1 });

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
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });
  storage.files.delete("runtime/cache/slots/a/notes-00001.json");
  await assert.rejects(() => readSemanticCacheGeneration(storage, "runtime/cache"), /No complete semantic cache generation/);

  const storage2 = new MemoryStorage();
  await writeSemanticCacheGeneration(storage2, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });
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

  await writeSemanticCacheGeneration(storage, "runtime/cache", newerClock, "before-rollback", { notesPerShard: 1, regionsPerShard: 1 });
  await writeSemanticCacheGeneration(storage, "runtime/cache", rolledBackClock, "after-rollback", { notesPerShard: 1, regionsPerShard: 1 });

  const [a, b] = cacheManifestPaths("runtime/cache");
  const manifests = [a, b].map((path) => JSON.parse(storage.files.get(path) ?? "{}"));
  assert.deepEqual(manifests.map((m) => m.sequence).sort((x, y) => x - y), [1, 2]);
  assert.equal((await readSemanticCacheGeneration(storage, "runtime/cache")).header.producerVersion, "after-clock-rollback");
});
