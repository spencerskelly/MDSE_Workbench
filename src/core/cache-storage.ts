/**
 * Storage-neutral persistence for the sharded semantic cache (W-343 / RTA-2).
 *
 * Portability rule: do not depend on filesystem-specific atomic overwrite semantics.
 * Every cache generation is immutable. Two small commit-manifest slots are alternated;
 * a new slot is written only after all generation shards exist. If a crash corrupts the
 * slot being written, the other slot remains a complete previous generation.
 */
import {
  joinSemanticCache,
  shardSemanticCache,
  type CacheDiskManifest,
  type SemanticCache,
  type ShardedSemanticCache,
} from "./cache";

export interface CacheStorage {
  mkdir(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
}

export interface CacheStoreOptions {
  notesPerShard?: number;
  regionsPerShard?: number;
}

const MANIFEST_SLOTS = ["manifest-a.json", "manifest-b.json"] as const;

/** Kept exported for diagnostics/tests; normal callers should use both slots through the read/write APIs. */
export function cacheManifestPaths(root: string): [string, string] {
  const clean = cleanRoot(root);
  return [`${clean}/${MANIFEST_SLOTS[0]}`, `${clean}/${MANIFEST_SLOTS[1]}`];
}

export async function writeSemanticCacheGeneration(
  storage: CacheStorage,
  root: string,
  cache: SemanticCache,
  generation: string,
  options: CacheStoreOptions = {},
): Promise<ShardedSemanticCache["manifest"]> {
  assertGeneration(generation);
  const clean = cleanRoot(root);
  const sharded = shardSemanticCache(cache, generation, options.notesPerShard, options.regionsPerShard);
  const generationRoot = `${clean}/generations/${generation}`;
  await storage.mkdir(clean);
  await storage.mkdir(`${clean}/generations`);
  await storage.mkdir(generationRoot);

  for (const shard of sharded.noteShards) {
    await storage.write(`${generationRoot}/notes-${pad(shard.index)}.json`, JSON.stringify(shard));
  }
  for (const shard of sharded.localShards) {
    await storage.write(`${generationRoot}/local-${pad(shard.index)}.json`, JSON.stringify(shard));
  }

  // Commit last. Pick the absent/invalid/older slot, preserving the newest known-good slot.
  const slots = await readManifestSlots(storage, clean);
  const target = chooseWriteSlot(slots);
  await storage.write(cacheManifestPaths(clean)[target], JSON.stringify(sharded.manifest));
  return sharded.manifest;
}

export async function readSemanticCacheGeneration(storage: CacheStorage, root: string): Promise<SemanticCache> {
  const clean = cleanRoot(root);
  const slots = await readManifestSlots(storage, clean);
  const candidates = slots
    .flatMap((x, slot) => x.manifest ? [{ slot, manifest: x.manifest }] : [])
    .sort((a, b) =>
      b.manifest.header.createdAt - a.manifest.header.createdAt ||
      b.manifest.generation.localeCompare(a.manifest.generation),
    );

  if (!candidates.length) throw new Error("No semantic cache manifest is available.");

  const errors: string[] = [];
  for (const { slot, manifest } of candidates) {
    try {
      return await readGeneration(storage, clean, manifest);
    } catch (e) {
      errors.push(`${MANIFEST_SLOTS[slot]}: ${(e as Error).message}`);
    }
  }
  throw new Error(`No complete semantic cache generation is readable. ${errors.join(" | ")}`);
}

async function readGeneration(storage: CacheStorage, clean: string, manifest: CacheDiskManifest): Promise<SemanticCache> {
  assertGeneration(manifest.generation);
  const generationRoot = `${clean}/generations/${manifest.generation}`;
  const noteShards: unknown[] = [];
  for (let i = 0; i < manifest.notes.count; i++) {
    noteShards.push(JSON.parse(await storage.read(`${generationRoot}/notes-${pad(i)}.json`)) as unknown);
  }
  const localShards: unknown[] = [];
  for (let i = 0; i < manifest.localRegions.count; i++) {
    localShards.push(JSON.parse(await storage.read(`${generationRoot}/local-${pad(i)}.json`)) as unknown);
  }
  return joinSemanticCache(manifest, noteShards, localShards);
}

interface ManifestSlot {
  manifest: CacheDiskManifest | null;
  rawError?: string;
}

async function readManifestSlots(storage: CacheStorage, clean: string): Promise<[ManifestSlot, ManifestSlot]> {
  const paths = cacheManifestPaths(clean);
  const out: ManifestSlot[] = [];
  for (const path of paths) {
    try {
      const parsed = JSON.parse(await storage.read(path)) as unknown;
      out.push(isManifestShape(parsed) ? { manifest: parsed } : { manifest: null, rawError: "malformed" });
    } catch (e) {
      out.push({ manifest: null, rawError: (e as Error).message });
    }
  }
  return out as [ManifestSlot, ManifestSlot];
}

function chooseWriteSlot(slots: [ManifestSlot, ManifestSlot]): 0 | 1 {
  if (!slots[0].manifest) return 0;
  if (!slots[1].manifest) return 1;
  const a = slots[0].manifest;
  const b = slots[1].manifest;
  // Overwrite the older commit record; never overwrite the newest one first.
  if (a.header.createdAt !== b.header.createdAt) return a.header.createdAt < b.header.createdAt ? 0 : 1;
  return a.generation.localeCompare(b.generation) <= 0 ? 0 : 1;
}

function cleanRoot(root: string): string {
  const clean = root.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid semantic cache root.");
  return clean;
}

function assertGeneration(generation: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(generation)) throw new Error("Invalid semantic cache generation.");
}

function pad(index: number): string {
  return String(index).padStart(5, "0");
}

type Obj = Record<string, unknown>;
function isObject(v: unknown): v is Obj {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isManifestShape(v: unknown): v is CacheDiskManifest {
  if (!isObject(v) || typeof v.manifestVersion !== "number" || typeof v.generation !== "string" || !isObject(v.header) || !isObject(v.fingerprints)) return false;
  if (!isObject(v.notes) || !isObject(v.localRegions)) return false;
  return Number.isInteger(v.notes.count) && (v.notes.count as number) >= 0 &&
    Number.isInteger(v.notes.total) && (v.notes.total as number) >= 0 &&
    Number.isInteger(v.localRegions.count) && (v.localRegions.count as number) >= 0 &&
    Number.isInteger(v.localRegions.total) && (v.localRegions.total as number) >= 0 &&
    typeof v.header.createdAt === "number";
}
