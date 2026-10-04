/**
 * Persistent derived semantic-cache contract (W-343 / RTA-2).
 *
 * The vault remains authoritative. This module only serializes the in-memory semantic index
 * into plain JSON-compatible data and restores it after strict compatibility checks.
 * No filesystem/Obsidian imports belong here.
 */
import { LocalModelIndex, READABLE_VERSIONS, type LocalFinding, type LocalRecord, type LocalRegion } from "./localmodel";
import { ModelIndex, type NoteRecord } from "./model";
import type { Schema } from "./schema";

export const CACHE_FORMAT_VERSION = 1;

/** Cheap evidence used to decide which files require reconciliation after warm restore. */
export interface FileFingerprint {
  mtime: number;
  size: number;
  /** Optional stronger evidence for callers that cannot trust mtime/size alone. */
  hash?: string;
}

export interface CacheCompatibility {
  formatVersion: number;
  relationshipsVersion: string;
  elementTypesVersion: string;
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
  type?: string;
  id?: string;
  uid?: string;
  fields: Array<[string, string[]]>;
  unresolved: number;
  broken?: Array<{ field: string; link: string }>;
  repeat?: Array<[string, number]>;
  abstract?: boolean;
  abstractInvalid?: boolean;
  localRefs?: Array<{ field: string; path: string; localId: string }>;
}

interface CachedLocalRecord extends Omit<LocalRecord, "fields"> {
  fields: Array<[string, string]>;
}

interface CachedLocalRegion extends Omit<LocalRegion, "records" | "findings"> {
  records: CachedLocalRecord[];
  findings: LocalFinding[];
}

export interface SemanticCache {
  header: CacheHeader;
  fingerprints: Record<string, FileFingerprint>;
  notes: CachedNoteRecord[];
  localRegions: Array<[string, CachedLocalRegion]>;
}

export interface RestoredSemanticState {
  index: ModelIndex;
  local: LocalModelIndex;
  fingerprints: Map<string, FileFingerprint>;
}

export function expectedCompatibility(schema: Schema): CacheCompatibility {
  return {
    formatVersion: CACHE_FORMAT_VERSION,
    relationshipsVersion: schema.relationshipsVersion,
    elementTypesVersion: schema.elementTypesVersion,
    localModelReadableVersions: [...READABLE_VERSIONS],
  };
}

export function cacheCompatibilityProblem(cache: unknown, expected: CacheCompatibility): string | null {
  if (!isObject(cache)) return "cache is not an object";
  const header = cache.header;
  if (!isObject(header)) return "cache header is missing";
  if (header.formatVersion !== expected.formatVersion) return `cache format ${String(header.formatVersion)} != ${expected.formatVersion}`;
  if (header.relationshipsVersion !== expected.relationshipsVersion) return `relationships schema ${String(header.relationshipsVersion)} != ${expected.relationshipsVersion}`;
  if (header.elementTypesVersion !== expected.elementTypesVersion) return `element-types schema ${String(header.elementTypesVersion)} != ${expected.elementTypesVersion}`;
  if (!sameStrings(header.localModelReadableVersions, expected.localModelReadableVersions)) return "Local Model reader contract changed";
  return null;
}

export function serializeSemanticState(
  index: ModelIndex,
  local: LocalModelIndex,
  fingerprints: ReadonlyMap<string, FileFingerprint>,
  schema: Schema,
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
    header: { ...expectedCompatibility(schema), createdAt, producerVersion },
    fingerprints: Object.fromEntries([...fingerprints.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    notes,
    localRegions,
  };
}

/**
 * Strictly restore a cache into fresh indexes. Any malformed structure throws and the caller
 * must discard/rebuild the cache rather than trying to "repair" derived semantics.
 */
export function restoreSemanticState(cache: unknown, schema: Schema): RestoredSemanticState {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema));
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
    ...(n.id !== undefined ? { id: n.id } : {}),
    ...(n.uid !== undefined ? { uid: n.uid } : {}),
    fields: [...n.fields.entries()].map(([k, v]) => [k, [...v]]),
    unresolved: n.unresolved,
    ...(n.broken ? { broken: n.broken.map((x) => ({ ...x })) } : {}),
    ...(n.repeat ? { repeat: [...n.repeat.entries()] } : {}),
    ...(n.abstract !== undefined ? { abstract: n.abstract } : {}),
    ...(n.abstractInvalid !== undefined ? { abstractInvalid: n.abstractInvalid } : {}),
    ...(n.localRefs ? { localRefs: n.localRefs.map((x) => ({ ...x })) } : {}),
  };
}

function deserializeNote(raw: unknown): NoteRecord {
  if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.name !== "string" || typeof raw.unresolved !== "number" || !Array.isArray(raw.fields)) {
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
  return {
    path: raw.path,
    name: raw.name,
    ...(stringProp(raw, "type") !== undefined ? { type: stringProp(raw, "type") } : {}),
    ...(stringProp(raw, "id") !== undefined ? { id: stringProp(raw, "id") } : {}),
    ...(stringProp(raw, "uid") !== undefined ? { uid: stringProp(raw, "uid") } : {}),
    fields,
    unresolved: raw.unresolved,
    ...(arrayOfBroken(raw.broken) ? { broken: raw.broken.map((x) => ({ ...x })) } : {}),
    ...(repeat ? { repeat } : {}),
    ...(typeof raw.abstract === "boolean" ? { abstract: raw.abstract } : {}),
    ...(typeof raw.abstractInvalid === "boolean" ? { abstractInvalid: raw.abstractInvalid } : {}),
    ...(arrayOfLocalRefs(raw.localRefs) ? { localRefs: raw.localRefs.map((x) => ({ ...x })) } : {}),
  };
}

function serializeRegion(r: LocalRegion): CachedLocalRegion {
  return {
    schemaVersion: r.schemaVersion,
    startLine: r.startLine,
    endLine: r.endLine,
    structured: r.structured,
    findings: r.findings.map((x) => ({ ...x })),
    records: r.records.map((x) => ({ ...x, fields: [...x.fields.entries()] })),
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
  return {
    schemaVersion: raw.schemaVersion === null || typeof raw.schemaVersion === "string" ? raw.schemaVersion : null,
    startLine: raw.startLine === null || typeof raw.startLine === "number" ? raw.startLine : null,
    endLine: raw.endLine === null || typeof raw.endLine === "number" ? raw.endLine : null,
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
  return {
    kind: raw.kind,
    localId: raw.localId,
    identifier: raw.identifier,
    line: raw.line,
    fields,
    definition: linkOrNull(raw.definition),
    usage: typeof raw.usage === "string" ? raw.usage : "standard",
    usageExplicit: raw.usageExplicit === true,
    part: linkOrNull(raw.part),
    parent: linkOrNull(raw.parent),
    exposes: links(raw.exposes),
    equals: links(raw.equals),
    endpointA: linkOrNull(raw.endpointA),
    endpointB: linkOrNull(raw.endpointB),
    roleA: nullableString(raw.roleA),
    roleB: nullableString(raw.roleB),
    multiplicity: nullableString(raw.multiplicity),
    endpointKind: nullableString(raw.endpointKind),
    connectionId: nullableString(raw.connectionId),
    sourceSchemaVersion: typeof raw.sourceSchemaVersion === "string" ? raw.sourceSchemaVersion : "",
  };
}

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const sameStrings = (a: unknown, b: readonly string[]) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
const stringProp = (o: Obj, k: string) => (o[k] === undefined ? undefined : typeof o[k] === "string" ? o[k] as string : undefined);
const nullableString = (v: unknown): string | null => v === null || v === undefined ? null : typeof v === "string" ? v : null;
const isLocalKind = (v: unknown): v is LocalRecord["kind"] => v === "part" || v === "endpoint" || v === "connection" || v === "flow";
const isFingerprint = (v: unknown): v is FileFingerprint => isObject(v) && typeof v.mtime === "number" && typeof v.size === "number" && (v.hash === undefined || typeof v.hash === "string");
const isLink = (v: unknown) => isObject(v) && typeof v.text === "string" && typeof v.target === "string" && typeof v.blockId === "string" && (v.alias === undefined || typeof v.alias === "string");
const linkOrNull = (v: unknown): LocalRecord["definition"] => v === null || v === undefined ? null : isLink(v) ? { text: v.text, target: v.target, blockId: v.blockId, ...(typeof v.alias === "string" ? { alias: v.alias } : {}) } : null;
const links = (v: unknown) => Array.isArray(v) ? v.filter(isLink).map((x) => linkOrNull(x)!).filter(Boolean) : [];
const isFinding = (v: unknown): v is LocalFinding => isObject(v) && typeof v.code === "string" && (v.severity === "error" || v.severity === "warning") && typeof v.message === "string";
const arrayOfBroken = (v: unknown): v is Array<{ field: string; link: string }> => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.link === "string");
const arrayOfLocalRefs = (v: unknown): v is Array<{ field: string; path: string; localId: string }> => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.path === "string" && typeof x.localId === "string");

function pairsNumber(v: unknown, label: string): Map<string, number> {
  if (!Array.isArray(v)) throw new Error(`Malformed cached ${label}.`);
  const out = new Map<string, number>();
  for (const x of v) {
    if (!Array.isArray(x) || x.length !== 2 || typeof x[0] !== "string" || typeof x[1] !== "number") throw new Error(`Malformed cached ${label}.`);
    out.set(x[0], x[1]);
  }
  return out;
}
