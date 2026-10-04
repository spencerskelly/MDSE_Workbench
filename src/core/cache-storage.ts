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
  joinCoreSemanticCache,
  joinLocalSemanticCache,
  joinSemanticCache,
  shardSemanticCache,
  type CacheDiskManifest,
  type CoreSemanticCache,
  type LocalSemanticCache,
  type SemanticCache,
  type ShardedSemanticCache,
} from "./cache";

export interface CacheStorage {
  mkdir(path: string): Promise<void>;
  write(path: string, content: string): Promise<void>;
  read(path: string): Promise<string>;
}

export interface CacheStoreOptions {
  noteBuckets?: number;
  localBuckets?: number;
  fingerprintBuckets?: number;
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
  const sharded = shardSemanticCache(cache, generation, options.noteBuckets, options.localBuckets, options.fingerprintBuckets);

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

  // Stable path buckets keep shard identities fixed across generations. Reuse an unchanged shard
  // already present in the inactive slot and record its generation token in the new manifest.
  // Changed/missing/corrupt shards are rewritten with the new generation token. The manifest is
  // still the single publication point, so readers never accept a mixed set accidentally.
  for (const shard of sharded.fingerprintShards) {
    const path = `${slotRoot}/fingerprints-${pad(shard.index)}.json`;
    sharded.manifest.fingerprints.generations![shard.index] =
      await writeShardIfChanged(storage, path, shard, "fingerprints");
  }
  for (const shard of sharded.noteShards) {
    const path = `${slotRoot}/notes-${pad(shard.index)}.json`;
    sharded.manifest.notes.generations![shard.index] =
      await writeShardIfChanged(storage, path, shard, "notes");
  }
  for (const shard of sharded.localShards) {
    const path = `${slotRoot}/local-${pad(shard.index)}.json`;
    sharded.manifest.localRegions.generations![shard.index] =
      await writeShardIfChanged(storage, path, shard, "localRegions");
  }

  // Commit marker last. A torn/corrupt manifest leaves the opposite slot available.
  await storage.write(cacheManifestPaths(clean)[slot], JSON.stringify(sharded.manifest));
  return sharded.manifest;
}

async function cacheCandidates(storage: CacheStorage, clean: string): Promise<Array<{ slot: 0 | 1; manifest: CacheDiskManifest }>> {
  const manifests = await readManifestSlots(storage, clean);
  return manifests
    .flatMap((x, slot) => x.manifest ? [{ slot: slot as 0 | 1, manifest: x.manifest }] : [])
    .sort((a, b) =>
      b.manifest.sequence - a.manifest.sequence ||
      b.manifest.header.createdAt - a.manifest.header.createdAt ||
      b.manifest.generation.localeCompare(a.manifest.generation),
    );
}

/** Read only core note/fingerprint shards; Local Model shards stay cold until requested. */
export async function readCoreCacheGeneration(storage: CacheStorage, root: string): Promise<CoreSemanticCache> {
  const clean = cleanRoot(root);
  const candidates = await cacheCandidates(storage, clean);
  if (!candidates.length) throw new Error("No semantic cache manifest is available.");
  const errors: string[] = [];
  for (const { slot, manifest } of candidates) {
    try {
      assertGeneration(manifest.generation);
      const slotRoot = cacheSlotPaths(clean)[slot];
      const [fingerprintShards, noteShards] = await Promise.all([
        readJsonSeries(storage, Array.from({ length: manifest.fingerprints.count }, (_, i) => `${slotRoot}/fingerprints-${pad(i)}.json`)),
        readJsonSeries(storage, Array.from({ length: manifest.notes.count }, (_, i) => `${slotRoot}/notes-${pad(i)}.json`)),
      ]);
      return joinCoreSemanticCache(manifest, fingerprintShards, noteShards);
    } catch (e) {
      errors.push(`${MANIFEST_NAMES[slot]}: ${(e as Error).message}`);
    }
  }
  throw new Error(`No complete core semantic cache generation is readable. ${errors.join(" | ")}`);
}

/** Read only Local Model shards from the newest valid cache generation. */
export async function readLocalCacheGeneration(storage: CacheStorage, root: string): Promise<LocalSemanticCache> {
  const clean = cleanRoot(root);
  const candidates = await cacheCandidates(storage, clean);
  if (!candidates.length) throw new Error("No semantic cache manifest is available.");
  const errors: string[] = [];
  for (const { slot, manifest } of candidates) {
    try {
      assertGeneration(manifest.generation);
      const slotRoot = cacheSlotPaths(clean)[slot];
      const localShards = await readJsonSeries(
        storage,
        Array.from({ length: manifest.localRegions.count }, (_, i) => `${slotRoot}/local-${pad(i)}.json`),
      );
      return joinLocalSemanticCache(manifest, localShards);
    } catch (e) {
      errors.push(`${MANIFEST_NAMES[slot]}: ${(e as Error).message}`);
    }
  }
  throw new Error(`No complete Local Model cache generation is readable. ${errors.join(" | ")}`);
}

export async function readSemanticCacheGeneration(storage: CacheStorage, root: string): Promise<SemanticCache> {
  const clean = cleanRoot(root);
  const candidates = await cacheCandidates(storage, clean);

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

  // Warm restore is latency-sensitive, but issuing every shard read at once can create its own
  // filesystem/adapter spike. Read with bounded parallelism and preserve deterministic order.
  const [fingerprintShards, noteShards, localShards] = await Promise.all([
    readJsonSeries(storage, Array.from({ length: manifest.fingerprints.count }, (_, i) => `${slotRoot}/fingerprints-${pad(i)}.json`)),
    readJsonSeries(storage, Array.from({ length: manifest.notes.count }, (_, i) => `${slotRoot}/notes-${pad(i)}.json`)),
    readJsonSeries(storage, Array.from({ length: manifest.localRegions.count }, (_, i) => `${slotRoot}/local-${pad(i)}.json`)),
  ]);
  return joinSemanticCache(manifest, fingerprintShards, noteShards, localShards);
}

async function writeShardIfChanged<T extends { generation: string; index: number }>(
  storage: CacheStorage,
  path: string,
  desired: T,
  payloadKey: "fingerprints" | "notes" | "localRegions",
): Promise<string> {
  const desiredPayload = (desired as unknown as Record<string, unknown>)[payloadKey];
  try {
    const existing = JSON.parse(await storage.read(path)) as unknown;
    if (
      isObject(existing) &&
      typeof existing.generation === "string" &&
      typeof existing.index === "number" &&
      existing.index === desired.index &&
      Array.isArray(existing[payloadKey]) &&
      Array.isArray(desiredPayload) &&
      JSON.stringify(existing[payloadKey]) === JSON.stringify(desiredPayload)
    ) {
      assertGeneration(existing.generation);
      return existing.generation;
    }
  } catch {
    // Missing, corrupt, or unsafe existing shard: rewrite it normally.
  }
  await storage.write(path, JSON.stringify(desired));
  return desired.generation;
}

async function readJsonSeries(storage: CacheStorage, paths: readonly string[], concurrency = 4): Promise<unknown[]> {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Cache read concurrency must be a positive integer.");
  const out = new Array<unknown>(paths.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= paths.length) return;
      out[i] = JSON.parse(await storage.read(paths[i])) as unknown;
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()));
  return out;
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
  if (!isObject(v) || typeof v.manifestVersion !== "number" || !Number.isInteger(v.sequence) || (v.sequence as number) < 0 || typeof v.generation !== "string" || !isObject(v.header)) return false;
  if (!isObject(v.fingerprints) || !isObject(v.notes) || !isObject(v.localRegions)) return false;
  const shardSet = (x: Obj) => {
    if (!Number.isInteger(x.count) || (x.count as number) < 0 ||
        !Number.isInteger(x.total) || (x.total as number) < 0) return false;
    if (x.generations === undefined) return true;
    return Array.isArray(x.generations) &&
      x.generations.length === x.count &&
      x.generations.every((generation) => typeof generation === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(generation));
  };
  return shardSet(v.fingerprints) && shardSet(v.notes) && shardSet(v.localRegions) &&
    typeof v.header.createdAt === "number";
}
