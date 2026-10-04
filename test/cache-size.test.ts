import { test } from "node:test";
import assert from "node:assert/strict";
import { cacheTreeSizeBytes, formatCacheBytes, type CacheSizeStorage } from "../src/core/cache-size";

class MemoryTree implements CacheSizeStorage {
  constructor(
    private readonly folders: Record<string, { files: string[]; folders: string[] }>,
    private readonly sizes: Record<string, number>,
  ) {}

  async list(path: string) {
    return this.folders[path] ?? { files: [], folders: [] };
  }

  async stat(path: string) {
    return Object.prototype.hasOwnProperty.call(this.sizes, path) ? { size: this.sizes[path] } : null;
  }
}

test("semantic cache size sums files across both cache slots without reading contents", async () => {
  const storage = new MemoryTree(
    {
      cache: { files: ["cache/manifest-a.json", "cache/manifest-b.json"], folders: ["cache/slots"] },
      "cache/slots": { files: [], folders: ["cache/slots/a", "cache/slots/b"] },
      "cache/slots/a": { files: ["cache/slots/a/notes-00000.json"], folders: [] },
      "cache/slots/b": { files: ["cache/slots/b/notes-00000.json", "cache/slots/b/local-00000.json"], folders: [] },
    },
    {
      "cache/manifest-a.json": 100,
      "cache/manifest-b.json": 120,
      "cache/slots/a/notes-00000.json": 1000,
      "cache/slots/b/notes-00000.json": 1100,
      "cache/slots/b/local-00000.json": 2200,
    },
  );

  assert.equal(await cacheTreeSizeBytes(storage, "cache"), 4520);
});

test("cache size formatting stays readable across diagnostic scales", () => {
  assert.equal(formatCacheBytes(512), "512 B");
  assert.equal(formatCacheBytes(1536), "1.5 KiB");
  assert.equal(formatCacheBytes(5 * 1024 * 1024), "5.0 MiB");
  assert.equal(formatCacheBytes(2 * 1024 * 1024 * 1024), "2.00 GiB");
});
