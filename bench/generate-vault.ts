/**
 * Synthetic MDSE vault for Phase 0 measurements (WB-081) until the importer writes a real
 * one. Shape follows the EA export counts loosely: mostly Objects and Requirements, a deep
 * hasChild tree, structure, allocation and requirement links, with inverses written.
 * Usage: npm run bench:generate -- [notes=60000] [outDir=bench/vault]
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const N = Number(process.argv[2] ?? 60000);
const OUT = process.argv[3] ?? "bench/vault";
let seed = 42;
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = <T>(a: T[]) => a[Math.floor(rnd() * a.length)];

const mix: Array<[string, number]> = [
  ["Object", 0.25], ["Requirement", 0.25], ["Port", 0.1], ["Function", 0.08], ["Design", 0.05],
  ["Item Flow", 0.05], ["Use Case", 0.03], ["State", 0.03], ["Verification", 0.03], ["Info", 0.03],
  ["Artifact", 0.02], ["Issue", 0.02], ["Actor", 0.01], ["State Machine", 0.01], ["Failure Mode", 0.01],
];
const types: string[] = [];
for (let i = 0; i < N; i++) {
  let r = rnd(), acc = 0;
  types.push((mix.find(([, w]) => (acc += w) >= r) ?? mix[0])[0]);
}
const name = (i: number) => `${types[i]} ${String(i).padStart(6, "0")}`;
const byType = new Map<string, number[]>();
types.forEach((t, i) => (byType.get(t) ?? byType.set(t, []).get(t)!).push(i));

const fields: Array<Map<string, Set<number>>> = types.map(() => new Map());
const link = (from: number, f: string, to: number, inv?: string) => {
  if (from === to) return;
  (fields[from].get(f) ?? fields[from].set(f, new Set()).get(f)!).add(to);
  if (inv) (fields[to].get(inv) ?? fields[to].set(inv, new Set()).get(inv)!).add(from);
};

// Placement tree: every note but the roots has an owner (hasChild), fan-out ~8.
for (let i = 50; i < N; i++) {
  const owner = Math.floor(rnd() * Math.min(i, Math.max(50, i / 8)));
  if (types[owner] === "Object" && types[i] === "Object") link(owner, "hasPart", i, "partOf");
  else link(owner, "hasChild", i, "childOf");
}
const ids = (t: string) => byType.get(t) ?? [];
for (const o of ids("Object")) for (let k = 0; k < 2; k++) if (rnd() < 0.5) link(o, "hasPort", pick(ids("Port")), "portOf");
for (const f of ids("Function")) { link(f, "satisfies", pick(ids("Requirement")), "satisfiedBy"); link(pick(ids("Object")), "performs", f, "performedBy"); }
for (const r of ids("Requirement")) { if (rnd() < 0.6) link(r, "appliesTo", pick(ids("Object")), "applies"); if (rnd() < 0.3) link(r, "derivedFrom", pick(ids("Requirement")), "derivedBy"); }
for (const v of ids("Verification")) link(v, "verifies", pick(ids("Requirement")), "verifiedBy");
for (const p of ids("Port")) if (rnd() < 0.3) { const q = pick(ids("Port")); link(p, "interfaces", q, "interfaces"); }
for (const t of ids("Info")) link(t, "describes", Math.floor(rnd() * N), "describedBy");

rmSync(OUT, { recursive: true, force: true });
const filler = "Lorem ipsum engineering text for size realism. ".repeat(30);
let bytes = 0;
for (let i = 0; i < N; i++) {
  const dir = join(OUT, types[i].replace(/ /g, "_"), String(Math.floor(i / 1000)));
  mkdirSync(dir, { recursive: true });
  const lines = ["---", `type: ${types[i]}`, "subtype:", `id: X-${String(i).padStart(5, "0")}`, `uid: 20260930000000000synthetic${String(i % 1000).padStart(3, "0")}`, "status: Draft", "tags: []"];
  for (const [f, set] of fields[i]) {
    lines.push(`${f}:`);
    for (const t of [...set].sort((a, b) => a - b)) lines.push(`  - "[[${name(t)}]]"`);
  }
  lines.push("---", "", `# ${name(i)}`, "", "## Definition", "", filler, "");
  const text = lines.join("\n");
  bytes += text.length;
  writeFileSync(join(dir, `${name(i)}.md`), text);
}
console.log(`Wrote ${N} notes (${(bytes / 1048576).toFixed(0)} MB) to ${OUT}`);
