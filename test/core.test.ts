import { test } from "node:test";
import assert from "node:assert/strict";
import { fixtureSchema, indexOf, note } from "./helpers";
import { allows, optionsBetween } from "../src/core/rules";
import { addLink, canonicalOrder, linkTarget, orderProperties, removeLink } from "../src/core/frontmatter";
import { signature, STRUCTURE_PROFILE, toCanvas, traverse, type ViewProfile } from "../src/core/views";
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
  const c = toCanvas(idx, v, profile);
  assert.ok(c.nodes.some((n) => n.type === "text" && n.text === "**+7 more**"));
  assert.ok(c.edges.every((e) => e.fromNode && e.toNode), "every edge has both ends");
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

test("layout: per-parent limit, a relationship label on every link (WB-095), children beside their parent", () => {
  const ports = ["P1.md", "P2.md", "P3.md"];
  const parts = Array.from({ length: 5 }, (_, i) => `C${i}.md`);
  const idx = indexOf(schema, [
    note("Top.md", "Object", { hasPart: parts, hasPort: ports }),
    ...parts.map((p) => note(p, "Object")),
    ...ports.map((p) => note(p, "Port")),
  ]);
  const profile: ViewProfile = {
    name: "S",
    steps: [{ field: "hasPart", direction: "out" }, { field: "hasPort", direction: "out" }],
    depth: 1,
    nodeCap: 100,
    perParent: 6,
  };
  const v = traverse(idx, ["Top.md"], profile);
  assert.equal(v.depthOf.size, 7, "Top + 6 children");
  assert.equal(v.omitted.get("Top.md"), 2);
  const c = toCanvas(idx, v, profile);
  const labels = c.edges.map((e) => e.label).filter(Boolean);
  assert.deepEqual(labels, ["hasPart", "hasPart", "hasPart", "hasPart", "hasPart", "hasPort"]);
  const top = c.nodes.find((n) => n.file === "Top.md")!;
  const ys = c.nodes.filter((n) => n.x > top.x).map((n) => n.y + n.height / 2);
  const mid = (Math.min(...ys) + Math.max(...ys)) / 2;
  assert.equal(top.y + top.height / 2, mid, "parent centred on its children");
});

test("review: findings list, counts, filters and Previous / Next skipping", async () => {
  const { toFindings, countByCategory, filterFindings, neighbour } = await import("../src/core/review");
  const f1 = note("F.md", "Function", { satisfies: ["R.md"], tracesTo: ["O.md"] });
  f1.broken = [{ field: "satisfies", link: "Ghost" }];
  const idx = indexOf(schema, [
    f1,
    note("R.md", "Requirement", { satisfiedBy: ["S.md"] }),
    note("S.md", "State", { satisfies: ["R.md"] }),
    note("O.md", "Object", { tracesFrom: ["F.md"] }),
  ]);
  const list = toFindings(idx.findings());
  const n = countByCategory(list);
  assert.deepEqual([n.provisional, n.missingInverse, n.orphanInverse, n.offRule, n.broken], [1, 1, 0, 1, 1]);
  assert.equal(new Set(list.map((x) => x.key)).size, list.length, "keys are unique");
  assert.deepEqual(list.map((x) => x.category), ["provisional", "missingInverse", "offRule", "broken"], "category order");
  assert.equal(filterFindings(list, idx, { category: "offRule" }).length, 1);
  assert.equal(filterFindings(list, idx, { type: "Function" }).length, 3);
  assert.equal(filterFindings(list, idx, { text: "ghost" }).length, 1);
  assert.equal(filterFindings(list, idx, { field: "tracesTo" })[0].to, "O.md");
  const skip = new Set([list[1].key]);
  assert.equal(neighbour(list, 0, 1, skip), 2, "next skips a resolved finding");
  assert.equal(neighbour(list, 2, -1, skip), 0, "previous skips it too");
  assert.equal(neighbour(list, 3, 1, skip), -1, "no finding after the last");
});

test("quantity: a child listed several times is one card with a x-count label (WB-091)", () => {
  const idx = indexOf(schema, [
    { ...note("Top.md", "Object", { hasPart: ["Wire.md", "Jacket.md"] }), repeat: new Map([["hasPart|Wire.md", 3]]) },
    note("Wire.md", "Object"),
    note("Jacket.md", "Object"),
  ]);
  const profile: ViewProfile = { name: "S", steps: [{ field: "hasPart", direction: "out" }], depth: 1, nodeCap: 10 };
  const v = traverse(idx, ["Top.md"], profile);
  assert.equal(v.depthOf.size, 3, "one card per distinct child");
  assert.equal(idx.edgeCount(), 2, "links stay one per distinct target, so Review counts do not change");
  assert.deepEqual(v.tree.map((l) => [l.child, l.count]), [["Jacket.md", 1], ["Wire.md", 3]]);
  const labels = toCanvas(idx, v, profile).edges.map((e) => e.label);
  assert.deepEqual(labels, ["hasPart", "hasPart ×3"]);
  const once = indexOf(schema, [note("Top.md", "Object", { hasPart: ["Wire.md"] }), note("Wire.md", "Object")]);
  assert.notEqual(signature(v), signature(traverse(once, ["Top.md"], profile)));
});

test("undefined: a link to a note that does not exist is an undefined card, not an omission (WB-092)", () => {
  const top = { ...note("Top.md", "Object", { hasPart: ["Real.md"] }), broken: [{ field: "hasPart", link: "Ghost" }, { field: "hasPart", link: "Ghost" }, { field: "hasPort", link: "Port x" }, { field: "subtypeOf", link: "Other" }] };
  const idx = indexOf(schema, [top, note("Real.md", "Object")]);
  const profile: ViewProfile = { name: "S", steps: [{ field: "hasPart", direction: "out" }, { field: "hasPort", direction: "out" }], depth: 1, nodeCap: 10 };
  const v = traverse(idx, ["Top.md"], profile);
  assert.equal(v.undefinedCount, 2, "Ghost and Port x; subtypeOf is not in the profile");
  assert.equal(v.omitted.size, 0);
  const ghost = v.tree.find((l) => l.child.endsWith("Ghost"))!;
  assert.equal(ghost.count, 2);
  const c = toCanvas(idx, v, profile);
  const card = c.nodes.find((n) => n.type === "text" && n.text?.includes("Ghost"))!;
  assert.ok(card.text!.includes("undefined") && card.color === "1");
  assert.ok(c.nodes.filter((n) => n.type === "file").every((n) => n.file === "Top.md" || n.file === "Real.md"));
  assert.equal(c.edges.find((e) => e.toNode === card.id)!.label, "hasPart ×2");
  assert.equal(idx.edgeCount(), 1, "Review counts unchanged");
});

test("hasState/stateOf (W-291): an Object or a State Machine has a State, and the inverse is stateOf", () => {
  const def = schema.byField.get("hasState")!;
  assert.equal(def.inverse, "stateOf");
  assert.ok(schema.byInverse.has("stateOf"));
  assert.ok(allows(def, "Object", "State").ok);
  assert.ok(allows(def, "Object", "State Machine").ok, "an Object has a State Machine (W-292)");
  assert.ok(allows(def, "State Machine", "State").ok);
  assert.ok(!allows(def, "State Machine", "State Machine").ok);
  assert.ok(!allows(def, "Function", "State").ok);
  assert.ok(!allows(def, "Object", "Object").ok);
  const child = schema.byField.get("hasChild")!;
  for (const [o, c] of [["Object", "State"], ["Object", "State Machine"], ["State Machine", "State"]]) assert.ok(!allows(child, o, c).ok, `hasChild must not be used for ${o} to ${c}`);
  assert.ok(allows(child, "Function", "State").ok);
  assert.ok(optionsBetween(schema, "Object", "State").some((o) => o.def.field === "hasState" && o.ownerIsFirst));
  const idx = indexOf(schema, [note("Obj.md", "Object", { hasState: ["S.md"] }), note("S.md", "State", { stateOf: ["Obj.md"] })]);
  const f = idx.findings();
  assert.equal(f.missingInverse.length + f.orphanInverse.length + f.offRule.length, 0);
});

test("Structure view: a State under an Object (hasState) is shown, with its relationship label (W-292)", () => {
  const idx = indexOf(schema, [
    note("Obj.md", "Object", { hasState: ["Idle.md", "Machine.md"] }),
    note("Idle.md", "State", { stateOf: ["Obj.md"] }),
    note("Machine.md", "State Machine", { stateOf: ["Obj.md"], hasState: ["Run.md"] }),
    note("Run.md", "State", { stateOf: ["Machine.md"] }),
  ]);
  const v = traverse(idx, ["Obj.md"], STRUCTURE_PROFILE);
  assert.deepEqual([...v.depthOf.keys()].sort(), ["Idle.md", "Machine.md", "Obj.md", "Run.md"]);
  assert.ok(toCanvas(idx, v).edges.some((e) => e.label === "hasState"));
});
