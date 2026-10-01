/**
 * Measures the pure index on a vault folder (WB-081). In Obsidian the frontmatter is
 * already parsed by Obsidian's own metadata cache, so "parse" here stands in for that
 * one-time cost; Workbench's own cost is the index, findings and view steps.
 * Usage: npm run bench -- [vaultDir=bench/vault] [schemaDir=test/fixtures]
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join } from "node:path";
import { parse } from "yaml";
import { ModelIndex, type NoteRecord } from "../src/core/model";
import { parseSchema } from "../src/core/schema";
import { STRUCTURE_PROFILE, toCanvas, traverse } from "../src/core/views";
import { linkTarget } from "../src/core/frontmatter";

const VAULT = process.argv[2] ?? "bench/vault";
const SCHEMA = process.argv[3] ?? "test/fixtures";
const schema = parseSchema(
  parse(readFileSync(join(SCHEMA, "relationships.yaml"), "utf8")),
  parse(readFileSync(join(SCHEMA, "element-types.yaml"), "utf8")),
);
const files: string[] = [];
const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : p.endsWith(".md") && files.push(p); } };
const ms = (t: number) => `${(performance.now() - t).toFixed(0)} ms`;
const heap = () => `${(process.memoryUsage().heapUsed / 1048576).toFixed(0)} MB`;

let t = performance.now();
walk(VAULT);
const raw: Array<{ path: string; fm: Record<string, unknown> }> = [];
for (const p of files) {
  const text = readFileSync(p, "utf8");
  const end = text.indexOf("\n---", 4);
  if (!text.startsWith("---") || end < 0) continue;
  raw.push({ path: p, fm: parse(text.slice(4, end)) ?? {} });
}
console.log(`files ${files.length}; read + parse frontmatter (Obsidian does this itself): ${ms(t)}`);

const heapBefore = process.memoryUsage().heapUsed;
t = performance.now();
const byName = new Map(raw.map((r) => [basename(r.path, ".md"), r.path]));
const index = new ModelIndex(schema);
for (const r of raw) {
  const fields = new Map<string, string[]>();
  let unresolved = 0;
  for (const [k, v] of Object.entries(r.fm)) {
    if (!schema.byField.has(k) && !schema.byInverse.has(k)) continue;
    for (const item of Array.isArray(v) ? v : [v]) {
      const dest = byName.get(linkTarget(item) ?? "");
      if (dest) (fields.get(k) ?? fields.set(k, []).get(k)!).push(dest);
      else unresolved++;
    }
  }
  const rec: NoteRecord = { path: r.path, name: basename(r.path, ".md"), type: String(r.fm.type ?? ""), fields, unresolved };
  index.upsert(rec);
}
console.log(`index build: ${ms(t)}; notes ${index.size}; links ${index.edgeCount()}; index heap ~${((process.memoryUsage().heapUsed - heapBefore) / 1048576).toFixed(0)} MB`);

t = performance.now();
const f = index.findings();
console.log(`findings scan: ${ms(t)}; missing inverse ${f.missingInverse.length}; orphan ${f.orphanInverse.length}; off-rule ${f.offRule.length}; provisional ${f.provisional.length}`);

t = performance.now();
const one = raw[0].path;
const r = index.notes.get(one)!;
index.upsert({ ...r, fields: new Map(r.fields) });
console.log(`incremental update of one note: ${(performance.now() - t).toFixed(2)} ms`);

const roots = [...index.notes.keys()].sort((a, b) => index.out(b).length - index.out(a).length).slice(0, 3);
for (const root of roots) {
  t = performance.now();
  const v = traverse(index, [root], STRUCTURE_PROFILE);
  const c = toCanvas(index, v);
  console.log(`view from ${basename(root)} (${index.out(root).length} out-links): ${v.depthOf.size} notes, ${c.edges.length} edges, cap ${v.capReached}; ${ms(t)}`);
}
console.log(`process heap now: ${heap()}`);
