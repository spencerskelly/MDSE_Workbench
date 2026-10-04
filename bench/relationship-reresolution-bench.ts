/**
 * Representative-scale warm relationship re-resolution benchmark (stability Step 37).
 *
 * Usage: npm run bench:relationships -- [notes=60000]
 *
 * This isolates the warm path-set reconciliation seam after semantic state already exists:
 * candidate lookup + authored-link re-resolution. It compares targeted work against the exact
 * same whole-graph resolver for add, delete, and rename path-set changes at several fan-outs.
 *
 * It deliberately excludes Obsidian UI startup and Markdown body I/O. Those belong to later
 * integrated acceptance steps; this benchmark answers whether targeted invalidation continues
 * to earn its complexity at representative semantic-graph scale.
 */
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import { ReversePathDependencyIndex } from "../src/core/relationship-dependencies";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import type { NoteRecord } from "../src/core/model";
import { parseSchema } from "../src/core/schema";

const N = Number(process.argv[2] ?? 60000);
if (!Number.isInteger(N) || N < 1000) throw new Error("notes must be an integer >= 1000.");

const schema = parseSchema(
  parse(readFileSync(join("test", "fixtures", "relationships.yaml"), "utf8")),
  parse(readFileSync(join("test", "fixtures", "element-types.yaml"), "utf8")),
);

const requestedFanOuts = [10, 100, 1000, 5000, 10000].filter((n) => n < N);
const fanOuts = [...new Set([...requestedFanOuts, Math.min(N - 1, 20000)])].sort((a, b) => a - b);

interface BenchNote extends NoteRecord {
  authoredLinks: NonNullable<NoteRecord["authoredLinks"]>;
}

function makeNotes(fanOut: number): BenchNote[] {
  const notes: BenchNote[] = [];
  for (let i = 0; i < N; i++) {
    const hot = i < fanOut;
    const linkpath = hot ? "HotTarget" : `Stable-${String(i).padStart(6, "0")}`;
    const target = hot ? "Targets/HotTarget.md" : `Stable/${linkpath}.md`;
    notes.push({
      path: `Source/S-${String(i).padStart(6, "0")}.md`,
      name: `S-${String(i).padStart(6, "0")}`,
      type: "Object",
      authoredLinks: [{ field: "dependsOn", link: linkpath, linkpath }],
      fields: new Map([["dependsOn", [target]]]),
      unresolved: 0,
    });
  }
  return notes;
}

function buildDependencies(notes: BenchNote[]): ReversePathDependencyIndex {
  const index = new ReversePathDependencyIndex();
  for (const note of notes) {
    const targets = note.fields.get("dependsOn") ?? [];
    index.set(note.path, targets, note.authoredLinks.map((link) => link.linkpath));
  }
  return index;
}

function stableTarget(linkpath: string): string {
  return `Stable/${linkpath}.md`;
}

type Scenario = "add" | "delete" | "rename";

function resolverFor(scenario: Scenario, phase: "before" | "after") {
  return (linkpath: string): string | undefined => {
    if (linkpath !== "HotTarget") return stableTarget(linkpath);
    if (scenario === "add") return phase === "before" ? undefined : "Targets/HotTarget.md";
    if (scenario === "delete") return phase === "before" ? "Targets/HotTarget.md" : undefined;
    return phase === "before" ? "Old/HotTarget.md" : "New/HotTarget.md";
  };
}

function changedPathsFor(scenario: Scenario): string[] {
  if (scenario === "add") return ["Targets/HotTarget.md"];
  if (scenario === "delete") return ["Targets/HotTarget.md"];
  return ["Old/HotTarget.md", "New/HotTarget.md"];
}

function resolveNotes(notes: readonly BenchNote[], resolver: (linkpath: string) => string | undefined): number {
  let changed = 0;
  for (const note of notes) {
    const next = resolveAuthoredRelationshipLinks(
      note.authoredLinks,
      note.path,
      schema,
      (linkpath) => resolver(linkpath),
    );
    const current = note.fields.get("dependsOn") ?? [];
    const after = next.fields.get("dependsOn") ?? [];
    if (
      note.unresolved !== next.unresolved ||
      current.length !== after.length ||
      current.some((value, i) => value !== after[i])
    ) {
      changed++;
    }
  }
  return changed;
}

function time<T>(fn: () => T): { value: T; ms: number } {
  const started = performance.now();
  const value = fn();
  return { value, ms: performance.now() - started };
}

console.log(`relationship re-resolution benchmark · notes ${N}`);
console.log("scenario,fanout,candidates,targeted_ms,full_ms,speedup,changed_targeted,changed_full");

for (const fanOut of fanOuts) {
  const notes = makeNotes(fanOut);
  const deps = buildDependencies(notes);

  for (const scenario of ["add", "delete", "rename"] as const) {
    // Seed the note evidence to the scenario's "before" state so both measured paths evaluate
    // exactly the same semantic change.
    const before = resolverFor(scenario, "before");
    for (const note of notes) {
      const resolved = resolveAuthoredRelationshipLinks(note.authoredLinks, note.path, schema, (linkpath) => before(linkpath));
      note.fields = resolved.fields;
      note.unresolved = resolved.unresolved;
    }

    const paths = changedPathsFor(scenario);
    const candidateResult = time(() => deps.candidatesForPathChanges(paths));
    const candidates = candidateResult.value;
    const candidateSet = new Set(candidates);
    const targetedNotes = notes.filter((note) => candidateSet.has(note.path));

    const after = resolverFor(scenario, "after");
    const targeted = time(() => resolveNotes(targetedNotes, after));
    const full = time(() => resolveNotes(notes, after));

    if (targeted.value !== full.value) {
      throw new Error(
        `semantic mismatch for ${scenario} fanout ${fanOut}: targeted changed ${targeted.value}, full changed ${full.value}`,
      );
    }
    if (candidates.length < fanOut) {
      throw new Error(
        `candidate underflow for ${scenario} fanout ${fanOut}: expected at least ${fanOut}, got ${candidates.length}`,
      );
    }

    const targetedMs = candidateResult.ms + targeted.ms;
    const speedup = targetedMs > 0 ? full.ms / targetedMs : Number.POSITIVE_INFINITY;
    console.log([
      scenario,
      fanOut,
      candidates.length,
      targetedMs.toFixed(3),
      full.ms.toFixed(3),
      Number.isFinite(speedup) ? speedup.toFixed(2) : "n/a",
      targeted.value,
      full.value,
    ].join(","));
  }
}
