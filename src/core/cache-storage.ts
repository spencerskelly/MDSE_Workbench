/**
 * Storage-neutral persistence for the sharded semantic cache (W-343 / RTA-2).
 *
 * Portability rule: do not depend on filesystem-specific atomic overwrite semantics.
 * Two fixed cache slots (A/B) are alternated. Each shard embeds a unique generation token.
 * A target slot's shards are written first and its small manifest is written last.
 *
 * If a crash occurs while writing slot A, slot B remains untouched. The old A manifest also
 * cannot accidentally accept a mixture of old/new shards because joinSemanticCache requires
 * every shard generation token to match its manifest.
 *
 * The design therefore has bounded disk usage and fail-closed recovery without rename tricks.
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

const SLOT_NAMES = ["a", "b"] as const;
const MANIFEST_NAMES = ["manifest-a.json", "manifest-b.json"] as const;

/** Exposed for diagnostics/tests; normal callers use the read/write APIs. */
export function cacheManifestPaths(root: string): [string, string] {
  const clean = cleanRoot(root);
  return [`${clean}/${MANIFEST_NAMES[0]}`, `${clean}/${MANIFEST_NAMES[1]}`];
}

export function cacheSlotPaths(root: string): [string, string] {
  const clean = cleanRoot(root);
  return [`${clean}/slots/${SLOT_NAMES[0]}`, `${clean}/slots/${SLOT_NAMES[1]}`];
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

  await storage.mkdir(clean);
  await storage.mkdir(`${clean}/slots`);

  // Preserve the newest valid manifest by writing into the absent/invalid/older slot.
  const manifests = await readManifestSlots(storage, clean);
  sharded.manifest.sequence = Math.max(
    manifests[0].manifest?.sequence ?? 0,
    manifests[1].manifest?.sequence ?? 0,
  ) + 1;
  const slot = chooseWriteSlot(manifests);
  const slotRoot = cacheSlotPaths(clean)[slot];
  await storage.mkdir(slotRoot);

  // Stale extra shard files from a previous larger generation are harmless: the new manifest
  // names the exact count, and every consumed shard must carry the new generation token.
  for (const shard of sharded.noteShards) {
    await storage.write(`${slotRoot}/notes-${pad(shard.index)}.json`, JSON.stringify(shard));
  }
  for (const shard of sharded.localShards) {
    await storage.write(`${slotRoot}/local-${pad(shard.index)}.json`, JSON.stringify(shard));
  }

  // Commit marker last. A torn/corrupt manifest leaves the opposite slot available.
  await storage.write(cacheManifestPaths(clean)[slot], JSON.stringify(sharded.manifest));
  return sharded.manifest;
}

export async function readSemanticCacheGeneration(storage: CacheStorage, root: string): Promise<SemanticCache> {
  const clean = cleanRoot(root);
  const manifests = await readManifestSlots(storage, clean);
  const candidates = manifests
    .flatMap((x, slot) => x.manifest ? [{ slot: slot as 0 | 1, manifest: x.manifest }] : [])
    .sort((a, b) =>
      b.manifest.sequence - a.manifest.sequence ||
      b.manifest.header.createdAt - a.manifest.header.createdAt ||
      b.manifest.generation.localeCompare(a.manifest.generation),
    );

  if (!candidates.length) throw new Error("No semantic cache manifest is available.");

  const errors: string[] = [];
  for (const { slot, manifest } of candidates) {
    try {
      return await readSlot(storage, clean, slot, manifest);
    } catch (e) {
      errors.push(`${MANIFEST_NAMES[slot]}: ${(e as Error).message}`);
    }
  }
  throw new Error(`No complete semantic cache generation is readable. ${errors.join(" | ")}`);
}

async function readSlot(
  storage: CacheStorage,
  clean: string,
  slot: 0 | 1,
  manifest: CacheDiskManifest,
): Promise<SemanticCache> {
  assertGeneration(manifest.generation);
  const slotRoot = cacheSlotPaths(clean)[slot];
  const noteShards: unknown[] = [];
  for (let i = 0; i < manifest.notes.count; i++) {
    noteShards.push(JSON.parse(await storage.read(`${slotRoot}/notes-${pad(i)}.json`)) as unknown);
  }
  const localShards: unknown[] = [];
  for (let i = 0; i < manifest.localRegions.count; i++) {
    localShards.push(JSON.parse(await storage.read(`${slotRoot}/local-${pad(i)}.json`)) as unknown);
  }
  return joinSemanticCache(manifest, noteShards, localShards);
}

interface ManifestSlot {
  manifest: CacheDiskManifest | null;
}

async function readManifestSlots(storage: CacheStorage, clean: string): Promise<[ManifestSlot, ManifestSlot]> {
  const paths = cacheManifestPaths(clean);
  const out: ManifestSlot[] = [];
  for (const path of paths) {
    try {
      const parsed = JSON.parse(await storage.read(path)) as unknown;
      out.push(isManifestShape(parsed) ? { manifest: parsed } : { manifest: null });
    } catch {
      out.push({ manifest: null });
    }
  }
  return out as [ManifestSlot, ManifestSlot];
}

function chooseWriteSlot(slots: [ManifestSlot, ManifestSlot]): 0 | 1 {
  if (!slots[0].manifest) return 0;
  if (!slots[1].manifest) return 1;
  const a = slots[0].manifest;
  const b = slots[1].manifest;
  if (a.sequence !== b.sequence) return a.sequence < b.sequence ? 0 : 1;
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
  if (!isObject(v) || typeof v.manifestVersion !== "number" || !Number.isInteger(v.sequence) || (v.sequence as number) < 0 || typeof v.generation !== "string" || !isObject(v.header) || !isObject(v.fingerprints)) return false;
  if (!isObject(v.notes) || !isObject(v.localRegions)) return false;
  return Number.isInteger(v.notes.count) && (v.notes.count as number) >= 0 &&
    Number.isInteger(v.notes.total) && (v.notes.total as number) >= 0 &&
    Number.isInteger(v.localRegions.count) && (v.localRegions.count as number) >= 0 &&
    Number.isInteger(v.localRegions.total) && (v.localRegions.total as number) >= 0 &&
    typeof v.header.createdAt === "number";
}
