/**
 * Paired cold/warm core-startup benchmark against one identical synthetic repository state.
 *
 * Usage: npm run bench:startup -- [notes=60000]
 *
 * This deliberately excludes Obsidian UI startup and filesystem latency. Both measured paths begin
 * after source metadata/fingerprints are available, matching the point where Workbench chooses
 * between a full core rebuild and semantic-cache restore/reconciliation.
 */
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import {
  joinCoreSemanticCache,
  planReconciliation,
  reconciliationMode,
  restoreCoreSemanticState,
  serializeSemanticState,
  shardSemanticCache,
  type FileFingerprint,
} from "../src/core/cache";
import { LocalModelIndex } from "../src/core/localmodel";
import { ModelIndex, type NoteRecord } from "../src/core/model";
import { parseSchema } from "../src/core/schema";

const N = Number(process.argv[2] ?? 60000);
if (!Number.isInteger(N) || N < 1) throw new Error("notes must be a positive integer.");

const schema = parseSchema(
  parse(readFileSync(join("test", "fixtures", "relationships.yaml"), "utf8")),
  parse(readFileSync(join("test", "fixtures", "element-types.yaml"), "utf8")),
);
const scope = { vaultUid: "20261004000000001startupbench-" };
const notes: NoteRecord[] = [];
const fingerprints = new Map<string, FileFingerprint>();

for (let i = 0; i < N; i++) {
  const path = `Object/O-${String(i).padStart(6, "0")}.md`;
  const previous = i ? `Object/O-${String(i - 1).padStart(6, "0")}.md` : null;
  const fields = new Map<string, string[]>();
  const authoredLinks: NoteRecord["authoredLinks"] = [];
  if (previous) {
    fields.set("dependsOn", [previous]);
    authoredLinks.push({
      field: "dependsOn",
      link: `O-${String(i - 1).padStart(6, "0")}`,
      linkpath: `O-${String(i - 1).padStart(6, "0")}`,
    });
  }
  notes.push({
    path,
    name: `O-${String(i).padStart(6, "0")}`,
    type: "Object",
    uid: `20261004000000${String(i % 1000).padStart(3, "0")}startup------`.slice(0, 30),
    authoredLinks,
    fields,
    unresolved: 0,
  });
  fingerprints.set(path, { ctime: i + 1, mtime: i + 1, size: 512 + (i % 100) });
}

function buildColdIndex(): ModelIndex {
  const index = new ModelIndex(schema);
  for (const note of notes) {
    index.upsert({
      ...note,
      authoredLinks: note.authoredLinks?.map((link) => ({ ...link })),
      fields: new Map([...note.fields].map(([field, targets]) => [field, [...targets]])),
    });
  }
  return index;
}

// Produce the warm-start artifact from the exact source state used by the cold path.
// Preparation is intentionally outside the measured warm-start interval because a real warm
// startup begins with a cache produced by a previous run.
const sourceIndex = buildColdIndex();
const cache = serializeSemanticState(
  sourceIndex,
  new LocalModelIndex(),
  fingerprints,
  schema,
  scope,
  "startup-bench",
  1,
);
const sharded = shardSemanticCache(cache, "startup-bench-generation");
const persisted = {
  manifest: JSON.stringify(sharded.manifest),
  fingerprints: sharded.fingerprintShards.map((shard) => JSON.stringify(shard)),
  notes: sharded.noteShards.map((shard) => JSON.stringify(shard)),
};

const tCold = performance.now();
const coldIndex = buildColdIndex();
const coldMs = performance.now() - tCold;

const tWarm = performance.now();
const manifest = JSON.parse(persisted.manifest);
const fingerprintShards = persisted.fingerprints.map((json) => JSON.parse(json));
const noteShards = persisted.notes.map((json) => JSON.parse(json));
const joined = joinCoreSemanticCache(manifest, fingerprintShards, noteShards);
const restored = restoreCoreSemanticState(joined, schema, scope);
const plan = planReconciliation(restored.fingerprints, fingerprints);
const mode = reconciliationMode(plan);
const warmMs = performance.now() - tWarm;

if (mode !== "none") {
  throw new Error(
    `Invalid paired benchmark: warm path saw repository changes (${plan.changed.length} changed, ${plan.added.length} added, ${plan.deleted.length} deleted).`,
  );
}
if (coldIndex.size !== restored.index.size || coldIndex.edgeCount() !== restored.index.edgeCount()) {
  throw new Error("Invalid paired benchmark: cold and warm semantic results differ.");
}

const ratio = warmMs > 0 ? coldMs / warmMs : Number.POSITIVE_INFINITY;
console.log(`repository state: identical · ${fingerprints.size} fingerprints · reconciliation none`);
console.log(`cold core rebuild: ${coldMs.toFixed(1)} ms · notes ${coldIndex.size} · links ${coldIndex.edgeCount()}`);
console.log(`warm core restore + validation: ${warmMs.toFixed(1)} ms · notes ${restored.index.size} · links ${restored.index.edgeCount()}`);
console.log(`cold/warm ratio: ${Number.isFinite(ratio) ? ratio.toFixed(2) + "x" : "n/a"}`);
