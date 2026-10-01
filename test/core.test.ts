import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureSchema, indexOf, note } from "./helpers";
import { allows, optionsBetween } from "../src/core/rules";
import { addLink, canonicalOrder, linkTarget, orderProperties, removeLink } from "../src/core/frontmatter";
import { signature, toCanvas, traverse, type ViewProfile } from "../src/core/views";
import { editingBlocked, parseSchema } from "../src/core/schema";

const schema = fixtureSchema();

test("the vault schema parses without warnings", () => {
  assert.deepEqual(schema.warnings, []);
  assert.ok(schema.byField.get("satisfies"));
  assert.equal(schema.byInverse.get("satisfiedBy")?.field, "satisfies");
  assert.equal(editingBlocked(schema), false);
});

test("endpoint rules follow relationships.yaml", () => {
  const d = (f: string) => schema.byField.get(f)!;
  assert.ok(allows(d("satisfies"), "Function", "Requirement").ok);
  assert.ok(!allows(d("satisfies"), "State", "Requirement").ok);
  assert.ok(allows(d("hasPort"), "Port", "Port").ok, "any class may own a Port (W-277)");
  assert.ok(!allows(d("hasChild"), "Object", "Object").ok, "Object to Object uses hasPart");
  assert.ok(!allows(d("subtypeOf"), "Object", "Port").ok, "same class only");
  assert.ok(allows(d("appliesTo"), "Requirement", "Port").ok, "Requirement to any (W-279)");
  assert.ok(allows(d("interfaces"), "Port", "Port").ok);
  assert.ok(!allows(d("interfaces"), "Object", "Port").ok);
});

test("options list both directions and puts the provisional relationship last", () => {
  const opts = optionsBetween(schema, "Requirement", "Function");
  const names = opts.map((o) => `${o.ownerIsFirst ? "R" : "F"}:${o.def.field}`);
  assert.ok(names.includes("F:satisfies"), "Function satisfies Requirement, written on the Function");
  assert.ok(names.includes("R:appliesTo"));
  assert.equal(opts[opts.length - 1].def.field, "tracesTo");
  assert.ok(!opts.some((o) => o.def.temporary), "temporary relationships are not offered");
});

test("an old schema blocks editing", () => {
  const s = parseSchema({ schemaVersion: "1.20", paired: [] }, { classes: [{ name: "Object" }] });
  assert.ok(editingBlocked(s));
});

test("findings: missing inverse, orphan inverse, off-rule, provisional", () => {
  const idx = indexOf(schema, [
    note("F.md", "Function", { satisfies: ["R.md"], tracesTo: ["O.md"] }),
    note("R.md", "Requirement", { satisfiedBy: ["S.md"] }),
    note("S.md", "State", { satisfies: ["R.md"] }),
    note("O.md", "Object", { tracesFrom: ["F.md"] }),
  ]);
  const f = idx.findings();
  assert.deepEqual(f.missingInverse.map((e) => `${e.from}>${e.to}`), ["F.md>R.md"]);
  assert.equal(f.orphanInverse.length, 0, "S.md does satisfy R.md");
  assert.deepEqual(f.offRule.map((e) => e.from), ["S.md"]);
  assert.equal(f.provisional.length, 1);
});

test("incremental update and removal keep incoming edges right", () => {
  const idx = indexOf(schema, [note("A.md", "Object", { hasPart: ["B.md"] }), note("B.md", "Object")]);
  assert.equal(idx.in("B.md").length, 1);
  idx.upsert(note("A.md", "Object", {}));
  assert.equal(idx.in("B.md").length, 0);
  idx.upsert(note("A.md", "Object", { hasPart: ["B.md"] }));
  idx.remove("A.md");
  assert.equal(idx.in("B.md").length, 0);
});

test("traversal: the node cap wins over depth and omissions are counted", () => {
  const kids = Array.from({ length: 10 }, (_, i) => `K${i}.md`);
  const idx = indexOf(schema, [note("Top.md", "Object", { hasPart: kids }), ...kids.map((k) => note(k, "Object"))]);
  const profile: ViewProfile = { name: "S", steps: [{ field: "hasPart", direction: "out" }], depth: 3, nodeCap: 4 };
  const v = traverse(idx, ["Top.md"], profile);
  assert.equal(v.depthOf.size, 4);
  assert.ok(v.capReached);
  assert.equal(v.omitted.get("Top.md"), 7);
  const c = toCanvas(idx, v);
  assert.ok(c.nodes.some((n) => n.type === "text" && n.text === "7 more not shown"));
  assert.equal(signature(v), signature(traverse(idx, ["Top.md"], profile)), "deterministic");
});

test("frontmatter: add, dedupe, sort and order properties", () => {
  const fm: Record<string, unknown> = { satisfies: "[[Zeta]]", tags: [], type: "Function", custom: 1, id: "FUNC-00001" };
  assert.ok(addLink(fm, "satisfies", "Alpha"));
  assert.ok(!addLink(fm, "satisfies", "alpha"), "case-insensitive duplicate");
  assert.deepEqual(fm.satisfies, ["[[Alpha]]", "[[Zeta]]"]);
  orderProperties(fm, canonicalOrder(schema));
  assert.deepEqual(Object.keys(fm), ["type", "id", "tags", "satisfies", "custom"]);
  assert.ok(removeLink(fm, "satisfies", "Zeta"));
  assert.equal(linkTarget("[[A b|alias]]"), "A b");
});
