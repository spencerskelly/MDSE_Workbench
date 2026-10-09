/**
 * Persistent derived semantic-cache contract (W-343 / RTA-2).
 *
 * The vault remains authoritative. This module only serializes the in-memory semantic index
 * into plain JSON-compatible data and restores it after strict compatibility checks.
 * No filesystem/Obsidian imports belong here.
 */
import { LocalModelIndex, READABLE_VERSIONS, type LinkRef, type LocalFinding, type LocalRecord, type LocalRegion } from "./localmodel";
import { ModelIndex, type NoteRecord } from "./model";
import { schemaSignature, type Schema } from "./schema";

export const CACHE_FORMAT_VERSION = 2;
/** Bump when semantic parsing/resolution meaning changes even if the JSON shape does not. */
export const CACHE_SEMANTIC_VERSION = 4;

export interface CacheScope {
  /** Binds disposable state to one initialized MDSE vault identity. */
  vaultUid: string;
}

/** Cheap evidence used to decide which files require reconciliation after warm restore. */
export interface FileFingerprint {
  /** Filesystem creation/change time from Obsidian FileStats; paired with mtime+size for cheap warm-start evidence. */
  ctime: number;
  mtime: number;
  size: number;
  /** Optional stronger evidence for callers that cannot trust mtime/size alone. */
  hash?: string;
}

export interface CacheCompatibility {
  formatVersion: number;
  semanticVersion: number;
  vaultUid: string;
  relationshipsVersion: string;
  elementTypesVersion: string;
  schemaSignature: string;
  /** Reader contract, not the active writer version. */
  localModelReadableVersions: string[];
}

export interface CacheHeader extends CacheCompatibility {
  createdAt: number;
  producerVersion: string;
}

interface CachedNoteRecord {
  path: string;
  name: string;
  authoredLinks: Array<{ field: string; link: string; linkpath: string }>;
  type?: string;
  subtype?: string;
  id?: string;
  uid?: string;
  fields: Array<[string, string[]]>;
  unresolved: number;
  broken?: Array<{ field: string; link: string }>;
  repeat?: Array<[string, number]>;
  abstract?: boolean;
  abstractInvalid?: boolean;
  variantOfFormatError?: string;
  localRefs?: Array<{ field: string; path: string; localId: string }>;
}

interface CachedLocalRecord extends Omit<LocalRecord, "fields"> {
  fields: Array<[string, string]>;
}

interface CachedLocalRegion extends Omit<LocalRegion, "records" | "findings"> {
  records: CachedLocalRecord[];
  findings: LocalFinding[];
}

export interface CoreSemanticCache {
  header: CacheHeader;
  fingerprints: Record<string, FileFingerprint>;
  notes: CachedNoteRecord[];
}

export interface LocalSemanticCache {
  header: CacheHeader;
  localRegions: Array<[string, CachedLocalRegion]>;
}

export interface SemanticCache extends CoreSemanticCache, LocalSemanticCache {}

export interface RestoredSemanticState {
  index: ModelIndex;
  local: LocalModelIndex;
  fingerprints: Map<string, FileFingerprint>;
}

export interface RestoredCoreSemanticState {
  index: ModelIndex;
  fingerprints: Map<string, FileFingerprint>;
}

export interface RestoredLocalSemanticState {
  local: LocalModelIndex;
}

export function expectedCompatibility(schema: Schema, scope: CacheScope): CacheCompatibility {
  return {
    formatVersion: CACHE_FORMAT_VERSION,
    semanticVersion: CACHE_SEMANTIC_VERSION,
    vaultUid: scope.vaultUid,
    relationshipsVersion: schema.relationshipsVersion,
    elementTypesVersion: schema.elementTypesVersion,
    schemaSignature: schemaSignature(schema),
    localModelReadableVersions: [...READABLE_VERSIONS],
  };
}

export function cacheCompatibilityProblem(cache: unknown, expected: CacheCompatibility): string | null {
  if (!isObject(cache)) return "cache is not an object";
  const header = cache.header;
  if (!isObject(header)) return "cache header is missing";
  if (header.formatVersion !== expected.formatVersion) return `cache format ${String(header.formatVersion)} != ${expected.formatVersion}`;
  if (header.semanticVersion !== expected.semanticVersion) return `semantic cache contract ${String(header.semanticVersion)} != ${expected.semanticVersion}`;
  if (header.vaultUid !== expected.vaultUid) return `vault identity ${String(header.vaultUid)} != ${expected.vaultUid}`;
  if (header.relationshipsVersion !== expected.relationshipsVersion) return `relationships schema ${String(header.relationshipsVersion)} != ${expected.relationshipsVersion}`;
  if (header.elementTypesVersion !== expected.elementTypesVersion) return `element-types schema ${String(header.elementTypesVersion)} != ${expected.elementTypesVersion}`;
  if (header.schemaSignature !== expected.schemaSignature) return `schema semantics ${String(header.schemaSignature)} != ${expected.schemaSignature}`;
  if (!sameStrings(header.localModelReadableVersions, expected.localModelReadableVersions)) return "Local Model reader contract changed";
  return null;
}

export function serializeSemanticState(
  index: ModelIndex,
  local: LocalModelIndex,
  fingerprints: ReadonlyMap<string, FileFingerprint>,
  schema: Schema,
  scope: CacheScope,
  producerVersion: string,
  createdAt = Date.now(),
): SemanticCache {
  const notes = [...index.notes.values()]
    .sort((a, b) => a.path.localeCompare(b.path))
    .map(serializeNote);
  const localRegions: Array<[string, CachedLocalRegion]> = [...local.regions.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([path, region]) => [path, serializeRegion(region)]);
  return {
    header: { ...expectedCompatibility(schema, scope), createdAt, producerVersion },
    fingerprints: Object.fromEntries([...fingerprints.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    notes,
    localRegions,
  };
}

/**
 * Strictly restore a cache into fresh indexes. Any malformed structure throws and the caller
 * must discard/rebuild the cache rather than trying to "repair" derived semantics.
 */
export function restoreCoreSemanticState(cache: unknown, schema: Schema, scope: CacheScope): RestoredCoreSemanticState {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.notes) || !isObject(cache.fingerprints)) {
    throw new Error("Malformed core semantic cache payload.");
  }
  const index = new ModelIndex(schema);
  for (const raw of cache.notes) index.upsert(deserializeNote(raw));
  const fingerprints = new Map<string, FileFingerprint>();
  for (const [path, raw] of Object.entries(cache.fingerprints)) {
    if (!isFingerprint(raw)) throw new Error(`Malformed fingerprint for ${path}.`);
    fingerprints.set(path, { ...raw });
  }
  return { index, fingerprints };
}

export function restoreLocalSemanticState(cache: unknown, schema: Schema, scope: CacheScope): RestoredLocalSemanticState {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.localRegions)) throw new Error("Malformed Local Model semantic cache payload.");
  const local = new LocalModelIndex();
  for (const entry of cache.localRegions) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new Error("Malformed Local Model cache entry.");
    local.set(entry[0], deserializeRegion(entry[1]));
  }
  return { local };
}

export function restoreSemanticState(cache: unknown, schema: Schema, scope: CacheScope): RestoredSemanticState {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.notes) || !Array.isArray(cache.localRegions) || !isObject(cache.fingerprints)) {
    throw new Error("Malformed semantic cache payload.");
  }

  const index = new ModelIndex(schema);
  for (const raw of cache.notes) index.upsert(deserializeNote(raw));

  const local = new LocalModelIndex();
  for (const entry of cache.localRegions) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new Error("Malformed Local Model cache entry.");
    local.set(entry[0], deserializeRegion(entry[1]));
  }

  const fingerprints = new Map<string, FileFingerprint>();
  for (const [path, raw] of Object.entries(cache.fingerprints)) {
    if (!isFingerprint(raw)) throw new Error(`Malformed fingerprint for ${path}.`);
    fingerprints.set(path, { ...raw });
  }
  return { index, local, fingerprints };
}

function serializeNote(n: NoteRecord): CachedNoteRecord {
  return {
    path: n.path,
    name: n.name,
    ...(n.type !== undefined ? { type: n.type } : {}),
    ...(n.subtype !== undefined ? { subtype: n.subtype } : {}),
    ...(n.id !== undefined ? { id: n.id } : {}),
    ...(n.uid !== undefined ? { uid: n.uid } : {}),
    authoredLinks: (n.authoredLinks ?? []).map((x) => ({ ...x })),
    fields: [...n.fields.entries()].map(([k, v]) => [k, [...v]]),
    unresolved: n.unresolved,
    ...(n.broken ? { broken: n.broken.map((x) => ({ ...x })) } : {}),
    ...(n.repeat ? { repeat: [...n.repeat.entries()] } : {}),
    ...(n.abstract !== undefined ? { abstract: n.abstract } : {}),
    ...(n.abstractInvalid !== undefined ? { abstractInvalid: n.abstractInvalid } : {}),
    ...(n.variantOfFormatError !== undefined ? { variantOfFormatError: n.variantOfFormatError } : {}),
    ...(n.localRefs ? { localRefs: n.localRefs.map((x) => ({ ...x })) } : {}),
  };
}

function deserializeNote(raw: unknown): NoteRecord {
  if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.name !== "string" || typeof raw.unresolved !== "number" || !Array.isArray(raw.fields) || !arrayOfAuthoredLinks(raw.authoredLinks)) {
    throw new Error("Malformed note cache entry.");
  }
  const fields = new Map<string, string[]>();
  for (const entry of raw.fields) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1]) || !entry[1].every((x) => typeof x === "string")) {
      throw new Error(`Malformed cached fields for ${raw.path}.`);
    }
    fields.set(entry[0], [...entry[1]]);
  }
  const repeat = raw.repeat === undefined ? undefined : pairsNumber(raw.repeat, "repeat");
  const type = optionalString(raw, "type");
  const subtype = optionalString(raw, "subtype");
  const id = optionalString(raw, "id");
  const uid = optionalString(raw, "uid");
  let broken: Array<{ field: string; link: string }> | undefined;
  if (raw.broken !== undefined) {
    if (!arrayOfBroken(raw.broken)) throw new Error(`Malformed cached broken links for ${raw.path}.`);
    broken = raw.broken.map((x) => ({ ...x }));
  }
  let localRefs: Array<{ field: string; path: string; localId: string }> | undefined;
  if (raw.localRefs !== undefined) {
    if (!arrayOfLocalRefs(raw.localRefs)) throw new Error(`Malformed cached local references for ${raw.path}.`);
    localRefs = raw.localRefs.map((x) => ({ ...x }));
  }
  const abstract = optionalBoolean(raw, "abstract", raw.path);
  const abstractInvalid = optionalBoolean(raw, "abstractInvalid", raw.path);
  const variantOfFormatError = optionalString(raw, "variantOfFormatError");
  return {
    path: raw.path,
    name: raw.name,
    ...(type !== undefined ? { type } : {}),
    ...(subtype !== undefined ? { subtype } : {}),
    ...(id !== undefined ? { id } : {}),
    ...(uid !== undefined ? { uid } : {}),
    authoredLinks: raw.authoredLinks.map((x) => ({ ...x })),
    fields,
    unresolved: raw.unresolved,
    ...(broken ? { broken } : {}),
    ...(repeat ? { repeat } : {}),
    ...(abstract !== undefined ? { abstract } : {}),
    ...(abstractInvalid !== undefined ? { abstractInvalid } : {}),
    ...(variantOfFormatError !== undefined ? { variantOfFormatError } : {}),
    ...(localRefs ? { localRefs } : {}),
  };
}

function serializeRegion(r: LocalRegion): CachedLocalRegion {
  return {
    sourceFingerprint: r.sourceFingerprint,
    schemaVersion: r.schemaVersion,
    startLine: r.startLine,
    endLine: r.endLine,
    structured: r.structured,
    findings: r.findings.map(serializeFinding),
    records: r.records.map(serializeLocalRecord),
  };
}

function serializeLocalRecord(r: LocalRecord): CachedLocalRecord {
  return {
    ...r,
    fields: [...r.fields.entries()],
    definition: serializeLink(r.definition),
    part: serializeLink(r.part),
    parent: serializeLink(r.parent),
    exposes: r.exposes.map((x) => serializeLink(x) as LinkRef),
    equals: r.equals.map((x) => serializeLink(x) as LinkRef),
    endpointA: serializeLink(r.endpointA),
    endpointB: serializeLink(r.endpointB),
  };
}

function serializeLink(link: LinkRef | null): LinkRef | null {
  if (!link) return null;
  return {
    text: link.text,
    target: link.target,
    blockId: link.blockId,
    ...(link.alias !== undefined ? { alias: link.alias } : {}),
  };
}

function serializeFinding(f: LocalFinding): LocalFinding {
  return {
    code: f.code,
    severity: f.severity,
    message: f.message,
    ...(f.path !== undefined ? { path: f.path } : {}),
    ...(f.localId !== undefined ? { localId: f.localId } : {}),
    ...(f.line !== undefined ? { line: f.line } : {}),
  };
}

function deserializeRegion(raw: unknown): LocalRegion {
  if (!isObject(raw) || !Array.isArray(raw.records) || !Array.isArray(raw.findings) || typeof raw.structured !== "boolean") {
    throw new Error("Malformed Local Model region cache entry.");
  }
  const records = raw.records.map((record) => deserializeLocalRecord(record));
  const findings = raw.findings.map((finding) => {
    if (!isFinding(finding)) throw new Error("Malformed Local Model finding cache entry.");
    return { ...finding };
  });
  if (typeof raw.sourceFingerprint !== "string" || !/^[0-9a-f]{8}$/.test(raw.sourceFingerprint)) throw new Error("Malformed Local Model source fingerprint in cache.");
  if (!(raw.schemaVersion === null || typeof raw.schemaVersion === "string")) throw new Error("Malformed Local Model schema version in cache.");
  if (!(raw.startLine === null || typeof raw.startLine === "number")) throw new Error("Malformed Local Model start line in cache.");
  if (!(raw.endLine === null || typeof raw.endLine === "number")) throw new Error("Malformed Local Model end line in cache.");
  return {
    sourceFingerprint: raw.sourceFingerprint,
    schemaVersion: raw.schemaVersion,
    startLine: raw.startLine,
    endLine: raw.endLine,
    records,
    findings,
    structured: raw.structured,
  };
}

function deserializeLocalRecord(raw: unknown): LocalRecord {
  if (!isObject(raw) || !isLocalKind(raw.kind) || typeof raw.localId !== "string" || typeof raw.identifier !== "string" || typeof raw.line !== "number" || !Array.isArray(raw.fields)) {
    throw new Error("Malformed Local Model record cache entry.");
  }
  const fields = new Map<string, string>();
  for (const entry of raw.fields) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") throw new Error("Malformed Local Model field cache entry.");
    fields.set(entry[0], entry[1]);
  }
  if (typeof raw.usage !== "string" || typeof raw.usageExplicit !== "boolean" || typeof raw.sourceSchemaVersion !== "string") {
    throw new Error("Malformed Local Model scalar cache entry.");
  }
  return {
    kind: raw.kind,
    localId: raw.localId,
    identifier: raw.identifier,
    line: raw.line,
    fields,
    definition: strictLinkOrNull(raw.definition, "definition"),
    usage: raw.usage,
    usageExplicit: raw.usageExplicit,
    part: strictLinkOrNull(raw.part, "part"),
    parent: strictLinkOrNull(raw.parent, "parent"),
    exposes: strictLinks(raw.exposes, "exposes"),
    equals: strictLinks(raw.equals, "equals"),
    endpointA: strictLinkOrNull(raw.endpointA, "endpointA"),
    endpointB: strictLinkOrNull(raw.endpointB, "endpointB"),
    roleA: strictNullableString(raw.roleA, "roleA"),
    roleB: strictNullableString(raw.roleB, "roleB"),
    multiplicity: strictNullableString(raw.multiplicity, "multiplicity"),
    quantity: strictNullableString(raw.quantity ?? null, "quantity"),
    unitOfMeasure: strictNullableString(raw.unitOfMeasure ?? null, "unitOfMeasure"),
    endpointKind: strictNullableString(raw.endpointKind, "endpointKind"),
    connectionId: strictNullableString(raw.connectionId, "connectionId"),
    sourceSchemaVersion: raw.sourceSchemaVersion,
  };
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sameStrings = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
function optionalString(o: Obj, k: string): string | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== "string") throw new Error(`Malformed cached ${k}.`);
  return v;
}
function optionalBoolean(o: Obj, k: string, path: string): boolean | undefined {
  const v = o[k];
  if (v === undefined) return undefined;
  if (typeof v !== "boolean") throw new Error(`Malformed cached ${k} value for ${path}.`);
  return v;
}
function strictNullableString(v: unknown, field: string): string | null {
  if (v === null) return null;
  if (typeof v === "string") return v;
  throw new Error(`Malformed Local Model ${field} cache entry.`);
}
const isLocalKind = (v: unknown): v is LocalRecord["kind"] => v === "part" || v === "endpoint" || v === "connection" || v === "flow";
const isFingerprint = (v: unknown): v is FileFingerprint => isObject(v) && typeof v.ctime === "number" && typeof v.mtime === "number" && typeof v.size === "number" && (v.hash === undefined || typeof v.hash === "string");
const isLink = (v: unknown): v is LinkRef => isObject(v) && typeof v.text === "string" && typeof v.target === "string" && typeof v.blockId === "string" && (v.alias === undefined || typeof v.alias === "string");
function strictLinkOrNull(v: unknown, field: string): LinkRef | null {
  if (v === null) return null;
  if (!isLink(v)) throw new Error(`Malformed Local Model ${field} link cache entry.`);
  return { ...v };
}
function strictLinks(v: unknown, field: string): LinkRef[] {
  if (!Array.isArray(v) || !v.every(isLink)) throw new Error(`Malformed Local Model ${field} links cache entry.`);
  return v.map((x) => ({ ...x }));
}
const isFinding = (v: unknown): v is LocalFinding => isObject(v) && typeof v.code === "string" && (v.severity === "error" || v.severity === "warning") && typeof v.message === "string";
const arrayOfBroken = (v: unknown): v is Array<{ field: string; link: string }> => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.link === "string");
const arrayOfLocalRefs = (v: unknown): v is Array<{ field: string; path: string; localId: string }> => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.path === "string" && typeof x.localId === "string");
const arrayOfAuthoredLinks = (v: unknown): v is Array<{ field: string; link: string; linkpath: string }> => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.link === "string" && typeof x.linkpath === "string");

function pairsNumber(v: unknown, label: string): Map<string, number> {
  if (!Array.isArray(v)) throw new Error(`Malformed cached ${label}.`);
  const out = new Map<string, number>();
  for (const x of v) {
    if (!Array.isArray(x) || x.length !== 2 || typeof x[0] !== "string" || typeof x[1] !== "number") throw new Error(`Malformed cached ${label}.`);
    out.set(x[0], x[1]);
  }
  return out;
}


/** On-disk cache container version. Independent from the semantic payload format. */
export const CACHE_MANIFEST_VERSION = 3;

export interface CacheShardSet {
  count: number;
  total: number;
  /**
   * Expected generation token for each fixed-path shard. This lets publication reuse an
   * unchanged shard already present in the inactive slot without weakening mixed-write checks.
   * Older manifests may omit this and implicitly expect the manifest generation for every shard.
   */
  generations?: string[];
}

export interface CacheDiskManifest {
  manifestVersion: number;
  /** Monotonic commit order inside this local cache, independent of wall-clock changes. */
  sequence: number;
  generation: string;
  header: CacheHeader;
  /** Fixed path-hash buckets keep the manifest small and make future dirty-bucket writes possible. */
  fingerprints: CacheShardSet;
  notes: CacheShardSet;
  localRegions: CacheShardSet;
}

export interface NoteCacheShard {
  generation: string;
  index: number;
  notes: CachedNoteRecord[];
}

export interface LocalCacheShard {
  generation: string;
  index: number;
  localRegions: Array<[string, CachedLocalRegion]>;
}

export interface FingerprintCacheShard {
  generation: string;
  index: number;
  fingerprints: Array<[string, FileFingerprint]>;
}

export interface ShardedSemanticCache {
  manifest: CacheDiskManifest;
  fingerprintShards: FingerprintCacheShard[];
  noteShards: NoteCacheShard[];
  localShards: LocalCacheShard[];
}

/**
 * Split a semantic cache into bounded deterministic shards. The manifest is intended to be
 * committed last by the storage adapter, so an interrupted new generation cannot make a
 * partially written generation authoritative.
 */
export function shardSemanticCache(
  cache: SemanticCache,
  generation: string,
  noteBuckets = 32,
  localBuckets = 16,
  fingerprintBuckets = 32,
): ShardedSemanticCache {
  if (!generation.trim()) throw new Error("Cache generation must not be empty.");
  for (const [label, n] of [["note", noteBuckets], ["Local Model", localBuckets], ["fingerprint", fingerprintBuckets]] as const) {
    if (!Number.isInteger(n) || n < 1 || n > 256) throw new Error(`${label} cache bucket count must be an integer from 1 to 256.`);
  }

  const noteShards: NoteCacheShard[] = Array.from({ length: noteBuckets }, (_, index) => ({ generation, index, notes: [] }));
  for (const rec of cache.notes) noteShards[cacheBucketForPath(rec.path, noteBuckets)].notes.push(rec);
  for (const shard of noteShards) shard.notes.sort((a, b) => a.path.localeCompare(b.path));

  const localShards: LocalCacheShard[] = Array.from({ length: localBuckets }, (_, index) => ({ generation, index, localRegions: [] }));
  for (const entry of cache.localRegions) localShards[cacheBucketForPath(entry[0], localBuckets)].localRegions.push(entry);
  for (const shard of localShards) shard.localRegions.sort((a, b) => a[0].localeCompare(b[0]));

  const fingerprintShards: FingerprintCacheShard[] = Array.from({ length: fingerprintBuckets }, (_, index) => ({ generation, index, fingerprints: [] }));
  for (const entry of Object.entries(cache.fingerprints)) fingerprintShards[cacheBucketForPath(entry[0], fingerprintBuckets)].fingerprints.push(entry);
  for (const shard of fingerprintShards) shard.fingerprints.sort((a, b) => a[0].localeCompare(b[0]));

  return {
    manifest: {
      manifestVersion: CACHE_MANIFEST_VERSION,
      sequence: 0,
      generation,
      header: cache.header,
      fingerprints: { count: fingerprintShards.length, total: Object.keys(cache.fingerprints).length, generations: fingerprintShards.map(() => generation) },
      notes: { count: noteShards.length, total: cache.notes.length, generations: noteShards.map(() => generation) },
      localRegions: { count: localShards.length, total: cache.localRegions.length, generations: localShards.map(() => generation) },
    },
    fingerprintShards,
    noteShards,
    localShards,
  };
}

/**
 * Reassemble one complete generation. Any missing, duplicate, out-of-generation or miscounted
 * shard fails closed; callers discard that generation and rebuild from the vault.
 */
export function joinSemanticCache(
  manifest: unknown,
  fingerprintShards: readonly unknown[],
  noteShards: readonly unknown[],
  localShards: readonly unknown[],
): SemanticCache {
  if (!isDiskManifest(manifest)) throw new Error("Malformed semantic cache manifest.");
  if (manifest.manifestVersion !== CACHE_MANIFEST_VERSION) throw new Error(`Unsupported cache manifest version ${manifest.manifestVersion}.`);
  return {
    ...joinCoreSemanticCache(manifest, fingerprintShards, noteShards),
    ...joinLocalSemanticCache(manifest, localShards),
  };
}

export function joinCoreSemanticCache(
  manifest: CacheDiskManifest,
  fingerprintShards: readonly unknown[],
  noteShards: readonly unknown[],
): CoreSemanticCache {
  return {
    header: manifest.header,
    fingerprints: joinFingerprintShards(manifest, fingerprintShards),
    notes: joinNoteShards(manifest, noteShards),
  };
}

export function joinLocalSemanticCache(
  manifest: CacheDiskManifest,
  localShards: readonly unknown[],
): LocalSemanticCache {
  return {
    header: manifest.header,
    localRegions: joinLocalShards(manifest, localShards),
  };
}

function joinFingerprintShards(manifest: CacheDiskManifest, shards: readonly unknown[]): Record<string, FileFingerprint> {
  if (shards.length !== manifest.fingerprints.count) throw new Error("Semantic cache fingerprint shard count mismatch.");
  const ordered = new Array<FingerprintCacheShard>(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || raw.generation !== expectedShardGeneration(manifest.fingerprints, raw.index, manifest.generation) || !Array.isArray(raw.fingerprints)) {
      throw new Error("Malformed semantic cache fingerprint shard.");
    }
    if (ordered[raw.index]) throw new Error("Duplicate semantic cache fingerprint shard index.");
    ordered[raw.index] = raw as unknown as FingerprintCacheShard;
  }
  const out: Record<string, FileFingerprint> = {};
  let total = 0;
  for (const shard of ordered) {
    for (const entry of shard.fingerprints) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isFingerprint(entry[1])) throw new Error("Malformed semantic cache fingerprint entry.");
      if (out[entry[0]]) throw new Error(`Duplicate semantic cache fingerprint path ${entry[0]}.`);
      out[entry[0]] = { ...entry[1] };
      total++;
    }
  }
  if (total !== manifest.fingerprints.total) throw new Error("Semantic cache fingerprint total mismatch.");
  return out;
}

function joinNoteShards(manifest: CacheDiskManifest, shards: readonly unknown[]): CachedNoteRecord[] {
  if (shards.length !== manifest.notes.count) throw new Error("Semantic cache note shard count mismatch.");
  const ordered = new Array<NoteCacheShard>(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || raw.generation !== expectedShardGeneration(manifest.notes, raw.index, manifest.generation) || !Array.isArray(raw.notes)) {
      throw new Error("Malformed semantic cache note shard.");
    }
    if (ordered[raw.index]) throw new Error("Duplicate semantic cache note shard index.");
    ordered[raw.index] = raw as unknown as NoteCacheShard;
  }
  const notes = ordered.flatMap((s) => s.notes).sort((a, b) => a.path.localeCompare(b.path));
  if (notes.length !== manifest.notes.total) throw new Error("Semantic cache note total mismatch.");
  return notes;
}

function joinLocalShards(manifest: CacheDiskManifest, shards: readonly unknown[]): Array<[string, CachedLocalRegion]> {
  if (shards.length !== manifest.localRegions.count) throw new Error("Semantic cache Local Model shard count mismatch.");
  const ordered = new Array<LocalCacheShard>(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || raw.generation !== expectedShardGeneration(manifest.localRegions, raw.index, manifest.generation) || !Array.isArray(raw.localRegions)) {
      throw new Error("Malformed semantic cache Local Model shard.");
    }
    if (ordered[raw.index]) throw new Error("Duplicate semantic cache Local Model shard index.");
    ordered[raw.index] = raw as unknown as LocalCacheShard;
  }
  const regions = ordered.flatMap((s) => s.localRegions).sort((a, b) => a[0].localeCompare(b[0]));
  if (regions.length !== manifest.localRegions.total) throw new Error("Semantic cache Local Model total mismatch.");
  return regions;
}

export function cacheBucketForPath(path: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) throw new Error("Cache bucket count must be a positive integer.");
  // FNV-1a 32-bit: fast, deterministic across runtimes, and sufficient for local cache distribution.
  let h = 0x811c9dc5;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % count;
}

export interface CacheDirtyBuckets {
  fingerprints: number[];
  notes: number[];
  localRegions: number[];
}

/**
 * Map changed vault paths to the stable cache buckets they can affect. This is intentionally pure:
 * the persistence layer can later rewrite only these buckets while a manifest commit keeps the
 * previous complete generation recoverable.
 */
export function cacheDirtyBucketsForPaths(
  paths: Iterable<string>,
  noteBuckets = 32,
  localBuckets = 16,
  fingerprintBuckets = 32,
): CacheDirtyBuckets {
  const fp = new Set<number>();
  const notes = new Set<number>();
  const local = new Set<number>();
  for (const path of paths) {
    fp.add(cacheBucketForPath(path, fingerprintBuckets));
    notes.add(cacheBucketForPath(path, noteBuckets));
    local.add(cacheBucketForPath(path, localBuckets));
  }
  const sorted = (s: Set<number>) => [...s].sort((a, b) => a - b);
  return { fingerprints: sorted(fp), notes: sorted(notes), localRegions: sorted(local) };
}

function isDiskManifest(v: unknown): v is CacheDiskManifest {
  if (!isObject(v) || typeof v.manifestVersion !== "number" || !Number.isInteger(v.sequence) || (v.sequence as number) < 0 || typeof v.generation !== "string" || !isObject(v.header)) return false;
  return isShardSet(v.fingerprints) && isShardSet(v.notes) && isShardSet(v.localRegions);
}

function isShardSet(v: unknown): v is CacheShardSet {
  if (!isObject(v) || !Number.isInteger(v.count) || !Number.isInteger(v.total) || (v.count as number) < 0 || (v.total as number) < 0) return false;
  if (v.generations === undefined) return true;
  return Array.isArray(v.generations) &&
    v.generations.length === v.count &&
    v.generations.every((generation) => typeof generation === "string" && generation.length > 0);
}

function expectedShardGeneration(set: CacheShardSet, index: number, fallback: string): string {
  return set.generations?.[index] ?? fallback;
}


export interface ReconciliationPlan {
  unchanged: string[];
  changed: string[];
  added: string[];
  deleted: string[];
}

/**
 * Compare cached file evidence with the current vault without reading model bodies.
 * A hash is authoritative when both sides provide one; otherwise mtime+size is the cheap
 * warm-start discriminator. Callers may choose to add hashes for suspicious/coarse filesystems.
 */
export function planReconciliation(
  cached: ReadonlyMap<string, FileFingerprint>,
  current: ReadonlyMap<string, FileFingerprint>,
): ReconciliationPlan {
  const unchanged: string[] = [];
  const changed: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  for (const path of [...current.keys()].sort()) {
    const now = current.get(path) as FileFingerprint;
    const before = cached.get(path);
    if (!before) {
      added.push(path);
      continue;
    }
    const basicSame = before.ctime === now.ctime && before.mtime === now.mtime && before.size === now.size;
    const hashSame = before.hash !== undefined && now.hash !== undefined ? before.hash === now.hash : true;
    (basicSame && hashSame ? unchanged : changed).push(path);
  }
  for (const path of [...cached.keys()].sort()) if (!current.has(path)) deleted.push(path);
  return { unchanged, changed, added, deleted };
}


export type ReconciliationMode = "none" | "incremental" | "full";

/**
 * Maximum number of changed/added/deleted Markdown paths allowed in one warm-start
 * reconciliation. Above this point the proven cooperative full rebuild is safer and bounded.
 */
export const MAX_INCREMENTAL_RECONCILIATION_PATHS = 300;

/**
 * Warm-start policy after semantic-cache v2.
 *
 * Cached notes retain their authored relationship-link evidence, so added/deleted/renamed paths
 * no longer require body rereads of unchanged notes: Workbench can re-resolve those links against
 * Obsidian's current metadata cache. Large bursts still fall back to the proven chunked full rebuild
 * so incremental startup cannot become an unbounded foreground job.
 */
export function reconciliationMode(
  plan: ReconciliationPlan,
  incrementalLimit = MAX_INCREMENTAL_RECONCILIATION_PATHS,
): ReconciliationMode {
  if (!Number.isInteger(incrementalLimit) || incrementalLimit < 1) throw new Error("incrementalLimit must be a positive integer.");
  const changed = plan.changed.length + plan.added.length + plan.deleted.length;
  if (!changed) return "none";
  return changed <= incrementalLimit ? "incremental" : "full";
}
