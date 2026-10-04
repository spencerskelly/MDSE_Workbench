/**
 * Measures the disposable semantic-cache pipeline without Obsidian.
 *
 * Usage: npm run bench:cache -- [notes=60000] [changed=25]
 * This exercises the same serialization/sharding/JSON/restore/reconciliation planning used by
 * warm startup. It intentionally contains no filesystem writes so numbers focus on Workbench cost.
 */
import { performance } from "node:perf_hooks";
import { parse } from "yaml";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  joinSemanticCache,
  planReconciliation,
  reconciliationMode,
  restoreSemanticState,
  serializeSemanticState,
  shardSemanticCache,
  type FileFingerprint,
} from "../src/core/cache";
import { LocalModelIndex } from "../src/core/localmodel";
import { ModelIndex, type NoteRecord } from "../src/core/model";
import { parseSchema } from "../src/core/schema";

const N = Number(process.argv[2] ?? 60000);
const CHANGED = Number(process.argv[3] ?? 25);
if (!Number.isInteger(N) || N < 1 || !Number.isInteger(CHANGED) || CHANGED < 0) throw new Error("notes and changed must be non-negative integers.");

const schema = parseSchema(
  parse(readFileSync(join("test", "fixtures", "relationships.yaml"), "utf8")),
  parse(readFileSync(join("test", "fixtures", "element-types.yaml"), "utf8")),
);
const index = new ModelIndex(schema);
const local = new LocalModelIndex();
const fingerprints = new Map<string, FileFingerprint>();

for (let i = 0; i < N; i++) {
  const path = `Object/O-${String(i).padStart(6, "0")}.md`;
  const target = i ? `Object/O-${String(i - 1).padStart(6, "0")}.md` : null;
  const fields = new Map<string, string[]>();
  const authoredLinks: NoteRecord["authoredLinks"] = [];
  if (target) {
    fields.set("dependsOn", [target]);
    authoredLinks.push({ field: "dependsOn", link: `O-${String(i - 1).padStart(6, "0")}`, linkpath: `O-${String(i - 1).padStart(6, "0")}` });
  }
  index.upsert({
    path,
    name: `O-${String(i).padStart(6, "0")}`,
    type: "Object",
    uid: `20261003000000${String(i % 1000).padStart(3, "0")}synthetic----`.slice(0, 30),
    authoredLinks,
    fields,
    unresolved: 0,
  });
  fingerprints.set(path, { ctime: i + 1, mtime: i + 1, size: 512 + (i % 100) });
}

const fmt = (ms: number) => `${ms.toFixed(1)} ms`;
const mem = () => `${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`;

let t = performance.now();
const cache = serializeSemanticState(index, local, fingerprints, schema, { vaultUid: "20261003190000001skellyspencer" }, "bench", 1);
console.log(`serialize ${N} notes: ${fmt(performance.now() - t)}; heap ${mem()}`);

t = performance.now();
const sharded = shardSemanticCache(cache, "bench-generation");
const shardJson = [
  JSON.stringify(sharded.manifest),
  ...sharded.fingerprintShards.map((x) => JSON.stringify(x)),
  ...sharded.noteShards.map((x) => JSON.stringify(x)),
  ...sharded.localShards.map((x) => JSON.stringify(x)),
];
const jsonBytes = shardJson.reduce((n, s) => n + Buffer.byteLength(s), 0);
console.log(`bucket + JSON: ${fmt(performance.now() - t)}; ${sharded.fingerprintShards.length} fingerprint + ${sharded.noteShards.length} note + ${sharded.localShards.length} local buckets; ${(jsonBytes / 1048576).toFixed(1)} MB`);

t = performance.now();
const parsedManifest = JSON.parse(shardJson[0]);
const fingerprintJson = shardJson.slice(1, 1 + sharded.fingerprintShards.length).map((s) => JSON.parse(s));
const noteStart = 1 + sharded.fingerprintShards.length;
const noteJson = shardJson.slice(noteStart, noteStart + sharded.noteShards.length).map((s) => JSON.parse(s));
const localJson = shardJson.slice(noteStart + sharded.noteShards.length).map((s) => JSON.parse(s));
const joined = joinSemanticCache(parsedManifest, fingerprintJson, noteJson, localJson);
const restored = restoreSemanticState(joined, schema, { vaultUid: "20261003190000001skellyspencer" });
console.log(`JSON parse + restore: ${fmt(performance.now() - t)}; notes ${restored.index.size}; links ${restored.index.edgeCount()}; heap ${mem()}`);

const current = new Map(restored.fingerprints);
for (let i = 0; i < Math.min(CHANGED, N); i++) {
  const path = `Object/O-${String(i).padStart(6, "0")}.md`;
  const fp = current.get(path)!;
  current.set(path, { ...fp, ctime: fp.ctime + 1000000, mtime: fp.mtime + 1000000 });
}
t = performance.now();
const plan = planReconciliation(restored.fingerprints, current);
const mode = reconciliationMode(plan);
console.log(`plan ${CHANGED} changed among ${N}: ${fmt(performance.now() - t)}; detected ${plan.changed.length}; mode ${mode}`);
