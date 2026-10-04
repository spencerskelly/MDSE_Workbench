import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeSemanticState } from "../src/core/cache";
import {
  cacheManifestPath,
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
  async atomicReplace(path: string, content: string): Promise<void> {
    this.files.set(path, content);
    this.operations.push("commit " + path);
  }
}

function sampleCache() {
  const schema = fixtureSchema();
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
      "0.1.17",
      123,
    ),
  };
}

test("generation files are written before the manifest commit marker", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });

  const commitIndex = storage.operations.findIndex((x) => x === "commit runtime/cache/manifest.json");
  assert.ok(commitIndex > 0);
  assert.equal(commitIndex, storage.operations.length - 1, "manifest must be the final persistence operation");
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("notes-00000.json")));
  assert.ok(storage.operations.slice(0, commitIndex).some((x) => x.includes("local-00000.json")));
});

test("a committed generation reads back to the same semantic cache", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), cache);
});

test("partial next generation does not replace the authoritative manifest", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "good", { notesPerShard: 1, regionsPerShard: 1 });
  const committed = storage.files.get(cacheManifestPath("runtime/cache"));

  // Simulate a crash after writing a unique next-generation shard but before atomic manifest replacement.
  storage.files.set("runtime/cache/generations/bad/notes-00000.json", "{}");
  assert.equal(storage.files.get(cacheManifestPath("runtime/cache")), committed);
  assert.deepEqual(await readSemanticCacheGeneration(storage, "runtime/cache"), cache);
});

test("missing or corrupt shards fail closed", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await writeSemanticCacheGeneration(storage, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });

  storage.files.delete("runtime/cache/generations/g0001/notes-00001.json");
  await assert.rejects(() => readSemanticCacheGeneration(storage, "runtime/cache"), /ENOENT/);

  const storage2 = new MemoryStorage();
  await writeSemanticCacheGeneration(storage2, "runtime/cache", cache, "g0001", { notesPerShard: 1, regionsPerShard: 1 });
  storage2.files.set("runtime/cache/generations/g0001/notes-00000.json", "{not json");
  await assert.rejects(() => readSemanticCacheGeneration(storage2, "runtime/cache"));
});

test("cache paths reject traversal and unsafe generation names", async () => {
  const { cache } = sampleCache();
  const storage = new MemoryStorage();
  await assert.rejects(() => writeSemanticCacheGeneration(storage, "../cache", cache, "g"));
  await assert.rejects(() => writeSemanticCacheGeneration(storage, "runtime/cache", cache, "../g"));
});
