/**
 * Storage-neutral persistence for the sharded semantic cache (W-343 / RTA-2).
 *
 * The storage adapter supplies ordinary writes for unique generation files and one atomic
 * replacement primitive for the manifest. The manifest is always committed last, so a crash
 * while writing a new generation leaves the previous manifest authoritative.
 */
import {
  joinSemanticCache,
  shardSemanticCache,
  type SemanticCache,
  type ShardedSemanticCache,
} from "./cache";

export interface CacheStorage {
  mkdir(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
  /** Atomically replace one small file, or provide equivalent all-or-old semantics. */
  atomicReplace(path: string, content: string): Promise<void>;
}

export interface CacheStoreOptions {
  notesPerShard?: number;
  regionsPerShard?: number;
}

export function cacheManifestPath(root: string): string {
  return `${cleanRoot(root)}/manifest.json`;
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

  // Commit marker. Nothing from the new generation is authoritative before this succeeds.
  await storage.atomicReplace(cacheManifestPath(clean), JSON.stringify(sharded.manifest));
  return sharded.manifest;
}

export async function readSemanticCacheGeneration(storage: CacheStorage, root: string): Promise<SemanticCache> {
  const clean = cleanRoot(root);
  const manifest = JSON.parse(await storage.read(cacheManifestPath(clean))) as unknown;
  if (!isManifestShape(manifest)) throw new Error("Malformed semantic cache manifest.");
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

function isManifestShape(v: unknown): v is {
  generation: string;
  notes: { count: number };
  localRegions: { count: number };
} {
  if (!isObject(v) || typeof v.generation !== "string" || !isObject(v.notes) || !isObject(v.localRegions)) return false;
  return Number.isInteger(v.notes.count) && (v.notes.count as number) >= 0 && Number.isInteger(v.localRegions.count) && (v.localRegions.count as number) >= 0;
}
