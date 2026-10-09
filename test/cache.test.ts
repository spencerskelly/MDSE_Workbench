import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_FORMAT_VERSION,
  cacheCompatibilityProblem,
  expectedCompatibility,
  restoreCoreSemanticState,
  restoreLocalSemanticState,
  restoreSemanticState,
  serializeSemanticState,
  shardSemanticCache,
  joinSemanticCache,
  planReconciliation,
  reconciliationMode,
  type FileFingerprint,
  cacheBucketForPath,
  cacheDirtyBucketsForPaths,
  MAX_INCREMENTAL_RECONCILIATION_PATHS,
} from "../src/core/cache";
import { LocalModelIndex, parseLocalModel } from "../src/core/localmodel";
import { ModelIndex, type NoteRecord } from "../src/core/model";
import { fixtureSchema } from "./helpers";
import { schemaSignature } from "../src/core/schema";

const schema = fixtureSchema();
const scope = { vaultUid: "20261003190000001skellyspencer" };
const T = "20261003170000001skellyspencer";
const P = "part-20261003170000002skellyspencer";
const E = "ep-20261003170000003skellyspencer";

function note(path: string, type: string, fields: Record<string, string[]> = {}): NoteRecord {
  return {
    path,
    name: path.replace(/\.md$/, ""),
    type,
    uid: path.startsWith("Assembly") ? T : "20261003170000004skellyspencer",
    fields: new Map(Object.entries(fields)),
    unresolved: 0,
    broken: [{ field: "dependsOn", link: "Missing" }],
    repeat: new Map([["dependsOn|Target.md", 2]]),
    abstract: false,
    localRefs: [{ field: "appliesTo", path: "Assembly.md", localId: E }],
  };
}

function localText(): string {
  return [
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### Board",
    "- definition: [[Board]]",
    "- multiplicity: 2",
    `^${P}`,
    "",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    `- part: [[#^${P}|Board]]`,
    "- kind: data",
    `^${E}`,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
}

function state() {
  const index = new ModelIndex(schema);
  index.upsert(note("Assembly.md", "Object", { dependsOn: ["Target.md"] }));
  index.upsert({
    path: "Target.md",
    name: "Target",
    type: "Object",
    uid: "20261003170000005skellyspencer",
    fields: new Map(),
    unresolved: 0,
  });
  const local = new LocalModelIndex();
  local.set("Assembly.md", parseLocalModel(localText()));
  const fingerprints = new Map<string, FileFingerprint>([
    ["Assembly.md", { ctime: 1200, mtime: 1234, size: 5678, hash: "abc" }],
    ["Target.md", { ctime: 1201, mtime: 1235, size: 42 }],
  ]);
  return { index, local, fingerprints };
}

test("semantic cache JSON round-trip restores notes, edges, maps, Local Model and fingerprints", () => {
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17", 999);
  assert.equal(cache.header.formatVersion, CACHE_FORMAT_VERSION);
  assert.equal(cache.header.createdAt, 999);

  // Prove the contract survives actual JSON storage rather than object identity.
  const parsed: unknown = JSON.parse(JSON.stringify(cache));
  const restored = restoreSemanticState(parsed, schema, scope);

  assert.equal(restored.index.size, 2);
  assert.deepEqual(restored.index.out("Assembly.md"), [{ from: "Assembly.md", to: "Target.md", field: "dependsOn" }]);

  const assembly = restored.index.notes.get("Assembly.md")!;
  assert.deepEqual([...assembly.fields.entries()], [["dependsOn", ["Target.md"]]]);
  assert.equal(assembly.repeat?.get("dependsOn|Target.md"), 2);
  assert.equal(assembly.localRefs?.[0].localId, E);

  const records = restored.local.recordsOf("Assembly.md");
  assert.deepEqual(records.map((r) => [r.kind, r.localId]), [["part", P], ["endpoint", E]]);
  assert.equal(records[0].fields.get("multiplicity"), "2");
  assert.equal(records[1].part?.blockId, P);
  assert.equal(records[1].endpointKind, "data");

  assert.deepEqual(restored.fingerprints.get("Assembly.md"), { ctime: 1200, mtime: 1234, size: 5678, hash: "abc" });
});

test("cache compatibility is exact for format and semantic parser/schema inputs", () => {
  const expected = expectedCompatibility(schema, scope);
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");

  assert.equal(cacheCompatibilityProblem(cache, expected), null);

  const wrongFormat = structuredClone(cache);
  wrongFormat.header.formatVersion++;
  assert.match(cacheCompatibilityProblem(wrongFormat, expected) ?? "", /cache format/);

  const wrongSemantic = structuredClone(cache);
  wrongSemantic.header.semanticVersion++;
  assert.match(cacheCompatibilityProblem(wrongSemantic, expected) ?? "", /semantic cache contract/);

  const wrongVault = structuredClone(cache);
  wrongVault.header.vaultUid = "different-vault";
  assert.match(cacheCompatibilityProblem(wrongVault, expected) ?? "", /vault identity/);

  const wrongRelationships = structuredClone(cache);
  wrongRelationships.header.relationshipsVersion = "999";
  assert.match(cacheCompatibilityProblem(wrongRelationships, expected) ?? "", /relationships schema/);

  const wrongElements = structuredClone(cache);
  wrongElements.header.elementTypesVersion = "999";
  assert.match(cacheCompatibilityProblem(wrongElements, expected) ?? "", /element-types schema/);

  const wrongSemantics = structuredClone(cache);
  wrongSemantics.header.schemaSignature = "deadbeef";
  assert.match(cacheCompatibilityProblem(wrongSemantics, expected) ?? "", /schema semantics/);

  const wrongLocal = structuredClone(cache);
  wrongLocal.header.localModelReadableVersions = ["0.2"];
  assert.match(cacheCompatibilityProblem(wrongLocal, expected) ?? "", /Local Model reader contract/);
});

test("malformed/corrupt cache fails closed instead of partially restoring semantics", () => {
  const { index, local, fingerprints } = state();
  const base = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");

  const badField = JSON.parse(JSON.stringify(base));
  badField.notes[0].fields = [["dependsOn", 7]];
  assert.throws(() => restoreSemanticState(badField, schema, scope), /Malformed cached fields/);

  const missingAuthored = JSON.parse(JSON.stringify(base));
  delete missingAuthored.notes[0].authoredLinks;
  assert.throws(() => restoreSemanticState(missingAuthored, schema, scope), /Malformed note cache entry/);

  const badFingerprint = JSON.parse(JSON.stringify(base));
  badFingerprint.fingerprints["Assembly.md"].mtime = "yesterday";
  assert.throws(() => restoreSemanticState(badFingerprint, schema, scope), /Malformed fingerprint/);

  const badLocal = JSON.parse(JSON.stringify(base));
  badLocal.localRegions[0][1].records[0].fields = [["definition", 99]];
  assert.throws(() => restoreSemanticState(badLocal, schema, scope), /Malformed Local Model field/);

  const missingPayload = { header: base.header };
  assert.throws(() => restoreSemanticState(missingPayload, schema, scope), /Malformed semantic cache payload/);
});

test("serialization is deterministic for paths regardless of insertion order", () => {
  const a = state();
  const bIndex = new ModelIndex(schema);
  bIndex.upsert(a.index.notes.get("Target.md")!);
  bIndex.upsert(a.index.notes.get("Assembly.md")!);
  const bLocal = new LocalModelIndex();
  bLocal.set("Assembly.md", parseLocalModel(localText()));
  const bFingerprints = new Map([...a.fingerprints.entries()].reverse());

  const ca = serializeSemanticState(a.index, a.local, a.fingerprints, schema, scope, "0.1.17", 1);
  const cb = serializeSemanticState(bIndex, bLocal, bFingerprints, schema, scope, "0.1.17", 1);
  assert.deepEqual(ca, cb);
});


test("bounded sharding reassembles one complete generation and rejects partial/mixed generations", () => {
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17", 5);
  const sharded = shardSemanticCache(cache, "g-0001", 2, 2, 2);

  assert.equal(sharded.manifest.notes.count, 2);
  assert.equal(sharded.manifest.localRegions.count, 2);
  assert.equal(sharded.manifest.fingerprints.count, 2);
  assert.deepEqual(
    joinSemanticCache(
      sharded.manifest,
      [...sharded.fingerprintShards].reverse(),
      [...sharded.noteShards].reverse(),
      [...sharded.localShards].reverse(),
    ),
    cache,
  );

  assert.throws(
    () => joinSemanticCache(sharded.manifest, sharded.fingerprintShards, sharded.noteShards.slice(0, 1), sharded.localShards),
    /note shard count mismatch/,
  );

  const mixed = JSON.parse(JSON.stringify(sharded.noteShards));
  mixed[0].generation = "old-generation";
  assert.throws(
    () => joinSemanticCache(sharded.manifest, sharded.fingerprintShards, mixed, sharded.localShards),
    /Malformed semantic cache note shard/,
  );

  const duplicate = JSON.parse(JSON.stringify(sharded.noteShards));
  duplicate[1].index = 0;
  assert.throws(
    () => joinSemanticCache(sharded.manifest, sharded.fingerprintShards, duplicate, sharded.localShards),
    /Duplicate semantic cache note shard index/,
  );
});

test("invalid shard sizing and empty generation are refused before anything can be persisted", () => {
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");
  assert.throws(() => shardSemanticCache(cache, "", 10, 10, 10), /generation/);
  assert.throws(() => shardSemanticCache(cache, "g", 0, 10, 10), /bucket count/);
  assert.throws(() => shardSemanticCache(cache, "g", 10, 10, 257), /bucket count/);
});


test("warm-start reconciliation identifies unchanged, changed, added and deleted files deterministically", () => {
  const cached = new Map([
    ["A.md", { ctime: 1, mtime: 1, size: 10 }],
    ["B.md", { ctime: 2, mtime: 2, size: 20, hash: "same" }],
    ["C.md", { ctime: 3, mtime: 3, size: 30 }],
    ["D.md", { ctime: 4, mtime: 4, size: 40 }],
    ["Gone.md", { ctime: 5, mtime: 5, size: 50 }],
  ]);
  const current = new Map([
    ["A.md", { ctime: 1, mtime: 1, size: 10 }],
    ["B.md", { ctime: 2, mtime: 2, size: 20, hash: "different" }],
    ["C.md", { ctime: 99, mtime: 99, size: 30 }],
    ["D.md", { ctime: 44, mtime: 4, size: 40 }],
    ["New.md", { ctime: 6, mtime: 6, size: 60 }],
  ]);

  assert.deepEqual(planReconciliation(cached, current), {
    unchanged: ["A.md"],
    changed: ["B.md", "C.md", "D.md"],
    added: ["New.md"],
    deleted: ["Gone.md"],
  });
});


test("default warm reconciliation threshold is explicit and forces full rebuild above 300 paths", () => {
  const atLimit = Array.from({ length: MAX_INCREMENTAL_RECONCILIATION_PATHS }, (_, i) => `Changed-${i}.md`);
  const overLimit = [...atLimit, "Changed-over-limit.md"];

  assert.equal(MAX_INCREMENTAL_RECONCILIATION_PATHS, 300);
  assert.equal(
    reconciliationMode({ unchanged: [], changed: atLimit, added: [], deleted: [] }),
    "incremental",
    "the exact policy limit remains eligible for bounded reconciliation",
  );
  assert.equal(
    reconciliationMode({ unchanged: [], changed: overLimit, added: [], deleted: [] }),
    "full",
    "one path beyond the policy limit must use the cooperative full rebuild",
  );
});

test("warm-start policy allows bounded path-set reconciliation with authored-link cache evidence", () => {
  assert.equal(reconciliationMode({ unchanged: ["A"], changed: [], added: [], deleted: [] }), "none");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A"], added: [], deleted: [] }), "incremental");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A"], added: ["B"], deleted: [] }), "incremental");
  assert.equal(reconciliationMode({ unchanged: [], changed: [], added: [], deleted: ["B"] }), "incremental");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A"], added: ["B"], deleted: ["C"] }, 2), "full", "the bounded startup budget still applies");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A", "B"], added: [], deleted: [] }, 1), "full", "large bursts use the proven full rebuild");
  assert.throws(() => reconciliationMode({ unchanged: [], changed: [], added: [], deleted: [] }, 0), /positive integer/);
});


test("schema signature ignores object identity but changes with parsed semantic rules", () => {
  const a = fixtureSchema();
  const b = fixtureSchema();
  assert.equal(schemaSignature(a), schemaSignature(b));

  const changed = { ...b, commonProperties: [...b.commonProperties, "newSemanticProperty"] };
  assert.notEqual(schemaSignature(a), schemaSignature(changed));
});


test("path-bucket sharding keeps existing paths in stable shard identities when unrelated notes are added", () => {
  const a = state();
  const base = serializeSemanticState(a.index, a.local, a.fingerprints, schema, scope, "0.1.17", 1);
  const before = shardSemanticCache(base, "g1", 8, 4, 8);

  const addedIndex = new ModelIndex(schema);
  for (const rec of a.index.notes.values()) addedIndex.upsert(rec);
  addedIndex.upsert({
    path: "ZZZ/New Note.md",
    name: "New Note",
    type: "Object",
    uid: "20261003170000006skellyspencer",
    authoredLinks: [],
    fields: new Map(),
    unresolved: 0,
  });
  const addedFp = new Map(a.fingerprints);
  addedFp.set("ZZZ/New Note.md", { ctime: 2000, mtime: 2000, size: 100 });
  const next = serializeSemanticState(addedIndex, a.local, addedFp, schema, scope, "0.1.17", 2);
  const after = shardSemanticCache(next, "g2", 8, 4, 8);

  const bucketOf = (shards: Array<{ index: number; notes: Array<{ path: string }> }>, path: string) =>
    shards.find((s) => s.notes.some((n) => n.path === path))?.index;
  for (const path of ["Assembly.md", "Target.md"]) {
    assert.equal(bucketOf(before.noteShards, path), bucketOf(after.noteShards, path));
  }
});


test("stable cache bucket planning changes only buckets addressed by changed paths", () => {
  const paths = ["A.md", "Folder/B.md", "Other/C.md"];
  const planned = cacheDirtyBucketsForPaths(paths, 8, 4, 8);

  assert.deepEqual(
    planned.notes,
    [...new Set(paths.map((p) => cacheBucketForPath(p, 8)))].sort((a, b) => a - b),
  );
  assert.deepEqual(
    planned.localRegions,
    [...new Set(paths.map((p) => cacheBucketForPath(p, 4)))].sort((a, b) => a - b),
  );
  assert.deepEqual(planned.fingerprints, planned.notes);

  const one = cacheDirtyBucketsForPaths(["A.md"], 8, 4, 8);
  assert.equal(one.notes.length, 1);
  assert.equal(one.localRegions.length, 1);
  assert.equal(one.fingerprints.length, 1);
});


test("all restore surfaces reject incompatible schema before deserializing payloads", () => {
  const { index, local, fingerprints } = state();
  const base = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");

  const mutations: Array<[string, (cache: any) => void, RegExp]> = [
    ["format", (cache) => { cache.header.formatVersion++; }, /cache format/],
    ["semantic contract", (cache) => { cache.header.semanticVersion++; }, /semantic cache contract/],
    ["relationships schema", (cache) => { cache.header.relationshipsVersion = "999"; }, /relationships schema/],
    ["element-types schema", (cache) => { cache.header.elementTypesVersion = "999"; }, /element-types schema/],
    ["schema signature", (cache) => { cache.header.schemaSignature = "deadbeef"; }, /schema semantics/],
    ["Local Model reader", (cache) => { cache.header.localModelReadableVersions = ["9.9"]; }, /Local Model reader contract/],
  ];

  for (const [name, mutate, expected] of mutations) {
    const bad: any = structuredClone(base);
    mutate(bad);
    // If compatibility were checked too late, these malformed payloads would fail for the wrong reason.
    bad.notes = [{ nonsense: true }];
    bad.fingerprints = { "A.md": { mtime: "not-a-number" } };
    bad.localRegions = [["A.md", { nonsense: true }]];

    assert.throws(
      () => restoreCoreSemanticState(bad, schema, scope),
      (error: unknown) => error instanceof Error && /Incompatible semantic cache/.test(error.message) && expected.test(error.message),
      name + " must reject before core payload deserialization",
    );
    assert.throws(
      () => restoreLocalSemanticState(bad, schema, scope),
      (error: unknown) => error instanceof Error && /Incompatible semantic cache/.test(error.message) && expected.test(error.message),
      name + " must reject before Local Model payload deserialization",
    );
    assert.throws(
      () => restoreSemanticState(bad, schema, scope),
      (error: unknown) => error instanceof Error && /Incompatible semantic cache/.test(error.message) && expected.test(error.message),
      name + " must reject before full payload deserialization",
    );
  }
});

test("vault identity mismatch rejects every restore surface before state installation", () => {
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");
  cache.header.vaultUid = "different-vault";

  assert.throws(() => restoreCoreSemanticState(cache, schema, scope), /Incompatible semantic cache: vault identity/);
  assert.throws(() => restoreLocalSemanticState(cache, schema, scope), /Incompatible semantic cache: vault identity/);
  assert.throws(() => restoreSemanticState(cache, schema, scope), /Incompatible semantic cache: vault identity/);
});


test("relationship semantic changes invalidate cache even without a schema-version bump", () => {
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");
  const first = schema.relationships[0];
  assert.ok(first, "fixture must contain at least one relationship");

  const changedRelationship = {
    ...first,
    sameClass: !first.sameClass,
  };
  const changedSchema = {
    ...schema,
    relationships: [changedRelationship, ...schema.relationships.slice(1)],
    // Keep the human-readable versions deliberately identical. The semantic signature must still
    // protect every restore surface when the rules themselves change.
    relationshipsVersion: schema.relationshipsVersion,
    elementTypesVersion: schema.elementTypesVersion,
  };

  assert.notEqual(schemaSignature(changedSchema), schemaSignature(schema));
  assert.throws(
    () => restoreCoreSemanticState(cache, changedSchema, scope),
    /Incompatible semantic cache: schema semantics/,
  );
  assert.throws(
    () => restoreLocalSemanticState(cache, changedSchema, scope),
    /Incompatible semantic cache: schema semantics/,
  );
  assert.throws(
    () => restoreSemanticState(cache, changedSchema, scope),
    /Incompatible semantic cache: schema semantics/,
  );
});

test("relationship schema signature covers edge interpretation fields", () => {
  const base = schema.relationships[0];
  assert.ok(base, "fixture must contain at least one relationship");
  const signature = schemaSignature(schema);
  const variants = [
    { ...base, field: base.field + "Changed" },
    { ...base, inverse: (base.inverse ?? "inverse") + "Changed" },
    { ...base, kind: base.kind === "paired" ? "oneWay" as const : "paired" as const },
    { ...base, from: base.from === "any" ? ["Object"] : "any" as const },
    { ...base, to: base.to === "any" ? ["Object"] : "any" as const },
    { ...base, sameClass: !base.sameClass },
    { ...base, provisional: !base.provisional },
    { ...base, temporary: !base.temporary },
  ];

  for (const relationship of variants) {
    const changedSchema = {
      ...schema,
      relationships: [relationship, ...schema.relationships.slice(1)],
    };
    assert.notEqual(schemaSignature(changedSchema), signature);
  }
});

test("variantOf invalid YAML survives semantic cache roundtrip", () => {
  const { index, local, fingerprints } = state();
  const source = index.notes.get("Assembly.md")!;
  source.variantOfFormatError = "variantOf must contain exactly one note-level [[Target]] link.";
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");
  const restored = restoreSemanticState(JSON.parse(JSON.stringify(cache)), schema, scope);
  assert.equal(restored.index.notes.get("Assembly.md")?.variantOfFormatError, source.variantOfFormatError);
  const cached = restored.index.notes.get("Assembly.md")!;
  assert.equal(cached.repeat?.get("dependsOn|Target.md"), 2);
  assert.equal(cached.broken?.[0].link, "Missing");
});
