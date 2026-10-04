import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CACHE_FORMAT_VERSION,
  cacheCompatibilityProblem,
  expectedCompatibility,
  restoreSemanticState,
  serializeSemanticState,
  shardSemanticCache,
  joinSemanticCache,
  planReconciliation,
  reconciliationMode,
  type FileFingerprint,
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
    ["Assembly.md", { mtime: 1234, size: 5678, hash: "abc" }],
    ["Target.md", { mtime: 1235, size: 42 }],
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

  assert.deepEqual(restored.fingerprints.get("Assembly.md"), { mtime: 1234, size: 5678, hash: "abc" });
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
  const sharded = shardSemanticCache(cache, "g-0001", 1, 1);

  assert.equal(sharded.manifest.notes.count, 2);
  assert.equal(sharded.manifest.localRegions.count, 1);
  assert.deepEqual(joinSemanticCache(sharded.manifest, [...sharded.noteShards].reverse(), sharded.localShards), cache);

  assert.throws(
    () => joinSemanticCache(sharded.manifest, sharded.noteShards.slice(0, 1), sharded.localShards),
    /note shard count mismatch/,
  );

  const mixed = JSON.parse(JSON.stringify(sharded.noteShards));
  mixed[0].generation = "old-generation";
  assert.throws(
    () => joinSemanticCache(sharded.manifest, mixed, sharded.localShards),
    /Malformed semantic cache note shard/,
  );

  const duplicate = JSON.parse(JSON.stringify(sharded.noteShards));
  duplicate[1].index = 0;
  assert.throws(
    () => joinSemanticCache(sharded.manifest, duplicate, sharded.localShards),
    /Duplicate semantic cache note shard index/,
  );
});

test("invalid shard sizing and empty generation are refused before anything can be persisted", () => {
  const { index, local, fingerprints } = state();
  const cache = serializeSemanticState(index, local, fingerprints, schema, scope, "0.1.17");
  assert.throws(() => shardSemanticCache(cache, "", 10, 10), /generation/);
  assert.throws(() => shardSemanticCache(cache, "g", 0, 10), /positive integers/);
});


test("warm-start reconciliation identifies unchanged, changed, added and deleted files deterministically", () => {
  const cached = new Map([
    ["A.md", { mtime: 1, size: 10 }],
    ["B.md", { mtime: 2, size: 20, hash: "same" }],
    ["C.md", { mtime: 3, size: 30 }],
    ["Gone.md", { mtime: 4, size: 40 }],
  ]);
  const current = new Map([
    ["A.md", { mtime: 1, size: 10 }],
    ["B.md", { mtime: 2, size: 20, hash: "different" }],
    ["C.md", { mtime: 99, size: 30 }],
    ["New.md", { mtime: 5, size: 50 }],
  ]);

  assert.deepEqual(planReconciliation(cached, current), {
    unchanged: ["A.md"],
    changed: ["B.md", "C.md"],
    added: ["New.md"],
    deleted: ["Gone.md"],
  });
});


test("warm-start policy stays incremental only while the path set is stable", () => {
  assert.equal(reconciliationMode({ unchanged: ["A"], changed: [], added: [], deleted: [] }), "none");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A"], added: [], deleted: [] }), "incremental");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A"], added: ["B"], deleted: [] }), "full", "adding a path can change wikilink resolution");
  assert.equal(reconciliationMode({ unchanged: [], changed: [], added: [], deleted: ["B"] }), "full", "deleting/renaming a path can change wikilink resolution");
  assert.equal(reconciliationMode({ unchanged: [], changed: ["A", "B"], added: [], deleted: [] }, 1), "full", "large stable-path bursts use the proven full rebuild");
  assert.throws(() => reconciliationMode({ unchanged: [], changed: [], added: [], deleted: [] }, 0), /positive integer/);
});


test("schema signature ignores object identity but changes with parsed semantic rules", () => {
  const a = fixtureSchema();
  const b = fixtureSchema();
  assert.equal(schemaSignature(a), schemaSignature(b));

  const changed = { ...b, commonProperties: [...b.commonProperties, "newSemanticProperty"] };
  assert.notEqual(schemaSignature(a), schemaSignature(changed));
});
