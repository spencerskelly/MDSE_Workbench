import { test } from "node:test";
import assert from "node:assert/strict";
import { currentFixtureSchema, fixtureSchema, indexOf, note } from "./helpers";
import { allows, optionsBetween } from "../src/core/rules";
import { addLink, canonicalOrder, linkTarget, orderProperties, removeLink } from "../src/core/frontmatter";
import { FUNCTIONAL_PROFILE, INTERFACES_PROFILE, INTERNAL_PROFILE, PROFILES, REQUIREMENTS_PROFILE, profileNeedsLocalOccurrences, signature, STRUCTURE_PROFILE, toCanvas, traverse, WHERE_USED_PROFILE, withLocalInterfaces, withLocalOccurrences, withLocalRequirements, withLocalStructure, withLocalWhereUsed, type ViewProfile } from "../src/core/views";
import { buildInternalView, preserveInternalLayout } from "../src/core/internal-view";
import { LocalModelIndex, parseLocalModel } from "../src/core/localmodel";
import { editingBlocked, parseSchema } from "../src/core/schema";

const schema = fixtureSchema();
const currentSchema = currentFixtureSchema();

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
  assert.equal(f.orphanInverse.length, 0, "the stored inverse pair is present even though State -> Requirement is off-rule");
  assert.deepEqual(f.offRule.map((e) => e.from), ["S.md"]);
  assert.equal(f.provisional.length, 1);
});

test("lifecycle impact sees forward and inverse-authored governed uses", () => {
  const idx = indexOf(schema, [
    note("Parent.md", "Object", { hasPart: ["Child.md"] }),
    note("Child.md", "Object", { partOf: ["Container.md"] }),
    note("Container.md", "Object"),
  ]);
  assert.deepEqual(
    idx.authoredUsesOf("Child.md").map((e) => [e.from, e.field]),
    [["Parent.md", "hasPart"]],
  );
  assert.deepEqual(
    idx.authoredUsesOf("Container.md").map((e) => [e.from, e.field]),
    [["Child.md", "partOf"]],
  );
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

test("WB-106 Structure shows local part occurrences without flattening child internals", () => {
  const ownerUid = "20261003123456789assemblyowner";
  const token = "20261003123456789abcdefghijklm";
  const idx = indexOf(schema, [
    { ...note("Assembly.md", "Object"), uid: ownerUid },
    note("Pump.md", "Object", { hasPart: ["Impeller.md"] }),
    note("Impeller.md", "Object"),
  ]);
  const local = new LocalModelIndex();
  const region = parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "## Local Model",
    "### Part Occurrences",
    "#### Pump A",
    "- definition: [[Pump]]",
    "- multiplicity: 2",
    `^part-${token}`,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n"));
  assert.ok(region?.structured);
  local.set("Assembly.md", region);

  const view = withLocalStructure(idx, local, traverse(idx, ["Assembly.md"], STRUCTURE_PROFILE), STRUCTURE_PROFILE);
  assert.equal(view.localNodes.size, 1);
  assert.equal(view.depthOf.size, 2, "assembly + local occurrence only");
  assert.ok(!view.depthOf.has("Pump.md"), "definition is linked from the occurrence, not flattened into the parent structure");
  const localId = [...view.localNodes.keys()][0];
  assert.match(localId, /^local:/);
  const link = view.tree.find((x) => x.child === localId)!;
  assert.equal(link.field, "part occurrence");

  const canvas = toCanvas(idx, view, STRUCTURE_PROFILE);
  const node = canvas.nodes.find((n) => n.type === "text" && n.text?.includes("Pump A"))!;
  assert.ok(node.text?.includes(`Assembly#^part-${token}`), "occurrence card keeps the native block link");
  assert.ok(node.text?.includes("[[Pump]]"));
  assert.ok(node.text?.includes("Multiplicity: 2"));

  const region2 = parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "## Local Model",
    "### Part Occurrences",
    "#### Pump A",
    "- definition: [[Pump]]",
    "- multiplicity: 3",
    `^part-${token}`,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n"));
  local.set("Assembly.md", region2);
  const changed = withLocalStructure(idx, local, traverse(idx, ["Assembly.md"], STRUCTURE_PROFILE), STRUCTURE_PROFILE);
  assert.notEqual(signature(view), signature(changed), "stale-view signature includes local occurrence data");
});


test("WB-106 Interfaces renders local endpoints, connections and connection-scoped flows", () => {
  const idx = indexOf(schema, [
    { ...note("Assembly.md", "Object"), uid: "20261003123456789assemblyowner" },
    note("PortDef.md", "Port"),
    note("FlowDef.md", "Item Flow"),
  ]);
  const ids = {
    a: "20261003123456789aaaaaaaaaaaaa",
    b: "20261003123456789bbbbbbbbbbbbb",
    c: "20261003123456789ccccccccccccc",
    f: "20261003123456789fffffffffffff",
  };
  const local = new LocalModelIndex();
  local.set("Assembly.md", parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "## Local Model",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[PortDef]]",
    `^ep-${ids.a}`,
    "#### J2",
    "- definition: [[PortDef]]",
    `- exposes: [[#^ep-${ids.a}|J1]]`,
    `^ep-${ids.b}`,
    "### Connections",
    "#### Harness",
    `- endpointA: [[#^ep-${ids.a}|J1]]`,
    `- endpointB: [[#^ep-${ids.b}|J2]]`,
    `^conn-${ids.c}`,
    "##### CAN Tx",
    "- definition: [[FlowDef]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    `^flow-${ids.f}`,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n")));
  const resolve = (target: string) => `${target}.md`;
  const view = withLocalInterfaces(idx, local, resolve, traverse(idx, ["Assembly.md"], INTERFACES_PROFILE), INTERFACES_PROFILE);
  assert.equal(view.localNodes.size, 4);
  assert.ok(view.localEdges.some((e) => e.field === "endpointA"));
  assert.ok(view.localEdges.some((e) => e.field === "endpointB"));
  assert.ok(view.localEdges.some((e) => e.field === "exposes"));
  const flowKey = [...view.localNodes].find(([, n]) => n.record.kind === "flow")?.[0];
  const connKey = [...view.localNodes].find(([, n]) => n.record.kind === "connection")?.[0];
  assert.ok(flowKey && connKey && view.tree.some((e) => e.parent === connKey && e.child === flowKey));
  assert.equal(toCanvas(idx, view, INTERFACES_PROFILE).nodes.length, 5);
});

test("WB-106 Where Used includes each contextual occurrence of a definition", () => {
  const idx = indexOf(schema, [
    note("PortDef.md", "Port"),
    { ...note("A.md", "Object"), uid: "20261003123456789aaaaaaaaaaaaa" },
    { ...note("B.md", "Object"), uid: "20261003123456789bbbbbbbbbbbbb" },
  ]);
  const local = new LocalModelIndex();
  const region = (token: string, name: string) => parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->", "## Local Model", "### Local Interfaces", `#### ${name}`,
    "- definition: [[PortDef]]", `^ep-${token}`, "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n"));
  local.set("A.md", region("20261003123456789ccccccccccccc", "J1"));
  local.set("B.md", region("20261003123456789ddddddddddddd", "J2"));
  const view = withLocalWhereUsed(idx, local, (t) => `${t}.md`, traverse(idx, ["PortDef.md"], WHERE_USED_PROFILE), WHERE_USED_PROFILE);
  assert.equal(view.localNodes.size, 2);
  assert.deepEqual(view.tree.filter((e) => e.field === "occurrence").map((e) => view.localNodes.get(e.child)?.record.identifier).sort(), ["J1", "J2"]);
});

test("WB-106 Requirements keeps appliesTo on the exact local occurrence", () => {
  const partToken = "20261003123456789ppppppppppppp";
  const req = { ...note("Req.md", "Requirement"), localRefs: [{ field: "appliesTo", path: "Assembly.md", localId: `part-${partToken}` }] };
  const idx = indexOf(schema, [req, { ...note("Assembly.md", "Object"), uid: "20261003123456789assemblyowner" }, note("Pump.md", "Object")]);
  const local = new LocalModelIndex();
  local.set("Assembly.md", parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->", "## Local Model", "### Part Occurrences", "#### Pump A",
    "- definition: [[Pump]]", `^part-${partToken}`, "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n")));
  const view = withLocalRequirements(idx, local, traverse(idx, ["Req.md"], REQUIREMENTS_PROFILE), REQUIREMENTS_PROFILE);
  assert.equal(view.localNodes.size, 1);
  assert.ok(view.tree.some((e) => e.parent === "Req.md" && e.field === "appliesTo"));
  assert.ok(!view.depthOf.has("Assembly.md"), "local appliesTo must not degrade into appliesTo the owning note");
});

test("frontmatter: add, dedupe, sort and order properties", () => {
  const fm: Record<string, unknown> = { satisfies: "[[Zeta]]", tags: [], type: "Function", custom: 1, id: "FUNC-00001" };
  assert.ok(addLink(fm, "satisfies", "Alpha"));
  assert.ok(!addLink(fm, "satisfies", "alpha"), "case-insensitive duplicate");
  assert.deepEqual(fm.satisfies, ["[[Alpha]]", "[[Zeta]]"]);
  orderProperties(fm, canonicalOrder(schema));
  assert.deepEqual(Object.keys(fm), ["type", "id", "tags", "satisfies", "custom"]);
  const withAbstract: Record<string, unknown> = { satisfies: ["[[Zeta]]"], abstract: true, tags: [], type: "Function", id: "FUNC-00002" };
  orderProperties(withAbstract, canonicalOrder(schema));
  assert.deepEqual(Object.keys(withAbstract), ["type", "id", "tags", "abstract", "satisfies"], "abstract ordering");
  assert.ok(removeLink(fm, "satisfies", "Zeta"));
  assert.deepEqual(fm.satisfies, ["[[Alpha]]"]);
  assert.ok(removeLink(fm, "satisfies", "Alpha"));
  assert.ok(!("satisfies" in fm), "empty relationship fields stay sparse");
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
  const list = toFindings(idx.findings(), [{ code: "ref.local-kind", severity: "error", message: "Endpoint points at the wrong local kind.", path: "F.md", localId: "ep-test" }]);
  const n = countByCategory(list);
  assert.deepEqual([n.provisional, n.missingInverse, n.orphanInverse, n.offRule, n.broken, n.localModel], [1, 1, 0, 1, 1, 1]);
  assert.equal(new Set(list.map((x) => x.key)).size, list.length, "keys are unique");
  assert.deepEqual(list.map((x) => x.category), ["provisional", "missingInverse", "offRule", "broken", "localModel"], "category order");
  assert.equal(filterFindings(list, idx, { category: "offRule" }).length, 1);
  assert.equal(filterFindings(list, idx, { type: "Function" }).length, 4);
  assert.equal(filterFindings(list, idx, { text: "ghost" }).length, 1);
  assert.equal(filterFindings(list, idx, { field: "tracesTo" })[0].to, "O.md");
  const skip = new Set([list[1].key]);
  assert.equal(neighbour(list, 0, 1, skip), 2, "next skips a resolved finding");
  assert.equal(neighbour(list, 2, -1, skip), 0, "previous skips it too");
  assert.equal(neighbour(list, 4, 1, skip), -1, "no finding after the last");
});

test("duplicate relationship entries are visible but never treated as engineering quantity (W-310)", () => {
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
  assert.deepEqual(labels, ["hasPart", "hasPart (duplicate ×3)"]);
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
  assert.equal(c.edges.find((e) => e.toNode === card.id)!.label, "hasPart (duplicate ×2)");
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

test("colors: every Structure relationship has its own edge color and none is the undefined-card red (WB-096)", () => {
  const steps = STRUCTURE_PROFILE.steps.map((s) => s.field);
  const idx = indexOf(schema, [
    note("Top.md", "Object", { hasPart: ["A.md"], hasChild: ["B.md"], hasState: ["S.md"], includes: ["C.md"], hasPort: ["P.md"] }),
    note("A.md", "Object"), note("B.md", "Function"), note("S.md", "State"), note("C.md", "Function"),
    note("P.md", "Port", { exposes: ["Q.md"], hasFlow: ["F.md"] }),
    note("Q.md", "Port"), note("F.md", "Item Flow"),
  ]);
  const v = traverse(idx, ["Top.md"], STRUCTURE_PROFILE);
  const c = toCanvas(idx, v);
  const byLabel = new Map(c.edges.map((e) => [e.label, e.color]));
  assert.deepEqual([...byLabel.keys()].sort(), [...steps].sort());
  const colors = [...byLabel.values()];
  assert.equal(new Set(colors).size, steps.length, "one color per relationship");
  assert.ok(!colors.includes("1"), "red is reserved for undefined cards");
});

function functionalIndex() {
  return indexOf(schema, [
    note("Pump.md", "Object", { performs: ["Move.md", "Cool.md"], hasChild: ["Nope.md"] }),
    note("Move.md", "Function", { hasChild: ["Lift.md", "Req1.md"], precedes: ["Cool.md"], satisfies: ["Req1.md"] }),
    note("Cool.md", "Function", { satisfies: ["Req2.md"] }),
    note("Lift.md", "Function"),
    note("Other.md", "Object", { performs: ["Move.md"] }),
    note("Nope.md", "Function"),
    note("Req1.md", "Requirement"),
    note("Req2.md", "Requirement"),
  ]);
}

test("functional view from an Object: its functions, their sub-functions and flow, no requirements (WB-097, WB-103)", () => {
  const idx = functionalIndex();
  const v = traverse(idx, ["Pump.md"], FUNCTIONAL_PROFILE);
  assert.deepEqual([...v.depthOf].map(([p, d]) => `${d}:${p}`).sort(), ["0:Pump.md", "1:Cool.md", "1:Move.md", "2:Lift.md", "2:Other.md"]);
  assert.ok(![...v.depthOf.keys()].some((k) => k.startsWith("Req")), "satisfied requirements are not shown (WB-103)");
  assert.ok(!v.depthOf.has("Nope.md"), "an Object's own hasChild is not followed");
  assert.equal(v.depthOf.get("Other.md"), 2, "a function also performed by another Object shows that Object (shared allocation)");
});

test("functional view from a Function: performer, parent, sub-functions, before and after, with arrows in the stored direction (WB-097, WB-103)", () => {
  const idx = indexOf(schema, [
    note("Top.md", "Function", { hasChild: ["Mid.md"] }),
    note("Mid.md", "Function", { hasChild: ["Low.md"], precedes: ["After.md"], satisfies: ["R.md"] }),
    note("Before.md", "Function", { precedes: ["Mid.md"] }),
    note("After.md", "Function"),
    note("Low.md", "Function"),
    note("Pump.md", "Object", { performs: ["Mid.md", "Elsewhere.md"] }),
    note("Elsewhere.md", "Function"),
    note("R.md", "Requirement"),
  ]);
  const v = traverse(idx, ["Mid.md"], FUNCTIONAL_PROFILE);
  assert.deepEqual([...v.depthOf.keys()].sort(), ["After.md", "Before.md", "Low.md", "Mid.md", "Pump.md", "Top.md"]);
  assert.ok(!v.depthOf.has("Elsewhere.md"));
  const c = toCanvas(idx, v, FUNCTIONAL_PROFILE);
  const idOfFile = (f: string) => c.nodes.find((n) => n.file === f)?.id;
  const edge = (a: string, b: string) => c.edges.find((e) => e.fromNode === idOfFile(a) && e.toNode === idOfFile(b));
  assert.equal(edge("Pump.md", "Mid.md")?.label, "performs", "performer to function");
  assert.equal(edge("Top.md", "Mid.md")?.label, "hasChild", "parent to sub-function");
  assert.equal(edge("Before.md", "Mid.md")?.label, "precedes");
  assert.equal(edge("Mid.md", "After.md")?.label, "precedes");
  assert.equal(edge("Mid.md", "Low.md")?.label, "hasChild");
  assert.equal(edge("Mid.md", "R.md"), undefined, "no satisfies link in the Functional view");
  assert.ok(c.edges.every((e) => e.fromNode && e.toNode), "no unfilled edge ends");
});

test("functional view: a missing function shows as undefined, a missing child of unknown type or a missing requirement does not (WB-097, WB-103, WB-092)", () => {
  const f = { ...note("F.md", "Function", {}), broken: [{ field: "satisfies", link: "Req gone" }, { field: "hasChild", link: "Thing gone" }, { field: "precedes", link: "Next gone" }] };
  const v = traverse(indexOf(schema, [f]), ["F.md"], FUNCTIONAL_PROFILE);
  assert.deepEqual([...v.depthOf.keys()].filter((k) => k !== "F.md").sort(), ["undefined:Next gone"]);
});

test("functional view: starts only from an Object or a Function; stale signature differs between profiles", () => {
  assert.deepEqual(FUNCTIONAL_PROFILE.startTypes, ["Object", "Behavior"]);
  const idx = functionalIndex();
  assert.notEqual(signature(traverse(idx, ["Pump.md"], FUNCTIONAL_PROFILE)), signature(traverse(idx, ["Pump.md"], STRUCTURE_PROFILE)));
});

test("requirements view from a Requirement: owner, parent, children, derivation, satisfiers and verifiers with arrows as stored (WB-098)", () => {
  const idx = indexOf(schema, [
    note("Owner.md", "Object", { hasChild: ["Parent.md"] }),
    note("Parent.md", "Requirement", { hasChild: ["R.md"] }),
    note("R.md", "Requirement", { hasChild: ["Kid.md"], derivedFrom: ["Source.md"], refines: ["Broad.md"], references: ["Std.md"], appliesTo: ["Owner.md"] }),
    note("Kid.md", "Requirement"),
    note("Source.md", "Requirement"),
    note("Broad.md", "Requirement"),
    note("Std.md", "Document"),
    note("Derived.md", "Requirement", { derivedFrom: ["R.md"] }),
    note("Fn.md", "Function", { satisfies: ["R.md", "Other.md"] }),
    note("Other.md", "Requirement"),
    note("V.md", "Verification", { verifies: ["R.md"] }),
    note("UC.md", "Use Case", { drives: ["R.md"] }),
  ]);
  const v = traverse(idx, ["R.md"], REQUIREMENTS_PROFILE);
  assert.ok(!v.depthOf.has("Other.md"), "a satisfier's other requirements are not pulled in");
  assert.deepEqual([...v.depthOf.keys()].sort(), ["Broad.md", "Derived.md", "Fn.md", "Kid.md", "Owner.md", "Parent.md", "R.md", "Source.md", "Std.md", "UC.md", "V.md"]);
  const c = toCanvas(idx, v, REQUIREMENTS_PROFILE);
  const id = (f: string) => c.nodes.find((n) => n.file === f)!.id;
  const edge = (a: string, b: string) => c.edges.find((e) => e.fromNode === id(a) && e.toNode === id(b))?.label;
  assert.equal(edge("Parent.md", "R.md"), "hasChild");
  assert.equal(edge("R.md", "Kid.md"), "hasChild");
  assert.equal(edge("R.md", "Source.md"), "derivedFrom");
  assert.equal(edge("Derived.md", "R.md"), "derivedFrom", "a requirement derived from this one points at it");
  assert.equal(edge("R.md", "Broad.md"), "refines");
  assert.equal(edge("Fn.md", "R.md"), "satisfies");
  assert.equal(edge("V.md", "R.md"), "verifies");
  assert.equal(edge("UC.md", "R.md"), "drives");
  assert.equal(edge("R.md", "Std.md"), "references");
  assert.ok(c.edges.every((e) => e.fromNode && e.toNode));
});

test("requirements view from a Function, Object, State and Verification: valid satisfaction, applicability and verification only (WB-098, W-327)", () => {
  const idx = indexOf(schema, [
    note("Fn.md", "Function", { satisfies: ["R1.md"], hasChild: ["R2.md"] }),
    note("Obj.md", "Object"),
    note("State.md", "State"),
    note("R1.md", "Requirement", { hasChild: ["R1a.md"] }),
    note("R1a.md", "Requirement"),
    note("R2.md", "Requirement"),
    note("R3.md", "Requirement", { appliesTo: ["Obj.md"] }),
    note("R4.md", "Requirement", { appliesTo: ["State.md"] }),
    note("Ver.md", "Verification", { verifies: ["R2.md"] }),
    note("Fn2.md", "Function", { satisfies: ["R1.md"] }),
  ]);
  const fn = traverse(idx, ["Fn.md"], REQUIREMENTS_PROFILE);
  assert.deepEqual([...fn.depthOf.keys()].sort(), ["Fn.md", "Fn2.md", "R1.md", "R1a.md", "R2.md", "Ver.md"], "co-satisfier and verifier come in at the second level");
  assert.deepEqual([...traverse(idx, ["Obj.md"], REQUIREMENTS_PROFILE).depthOf.keys()].sort(), ["Obj.md", "R3.md"]);
  assert.deepEqual([...traverse(idx, ["State.md"], REQUIREMENTS_PROFILE).depthOf.keys()].sort(), ["R4.md", "State.md"], "State reaches scoped requirements only through appliesTo");
  assert.deepEqual([...traverse(idx, ["Ver.md"], REQUIREMENTS_PROFILE).depthOf.keys()].sort(), ["R2.md", "Ver.md"], "the owner of a requirement is shown only when the requirement is the start");
});

test("requirements view: a missing requirement or source shows as undefined; start types; every profile has one color per relationship and no red (WB-098)", () => {
  const f = { ...note("F.md", "Function", {}), broken: [{ field: "satisfies", link: "Req gone" }, { field: "hasChild", link: "Unknown gone" }] };
  const r = { ...note("R.md", "Requirement", {}), broken: [{ field: "derivedFrom", link: "Parent req gone" }, { field: "references", link: "Std gone" }, { field: "hasChild", link: "Kid gone" }] };
  const idx = indexOf(schema, [f, r]);
  assert.deepEqual([...traverse(idx, ["F.md"], REQUIREMENTS_PROFILE).depthOf.keys()].filter((k) => k !== "F.md"), ["undefined:Req gone"]);
  assert.deepEqual([...traverse(idx, ["R.md"], REQUIREMENTS_PROFILE).depthOf.keys()].filter((k) => k !== "R.md"), ["undefined:Parent req gone"]);
  assert.ok(REQUIREMENTS_PROFILE.startTypes!.includes("Requirement") && !REQUIREMENTS_PROFILE.startTypes!.includes("Port"));
  for (const profile of Object.values(PROFILES)) {
    const fields = [...new Set(profile.steps.map((s) => s.field))];
    const colors = new Set<string>();
    const dummy = indexOf(schema, [note("X.md", "Object")]);
    const canvas = toCanvas(dummy, { ...traverse(dummy, ["X.md"], profile), tree: fields.map((fl, i) => ({ parent: "X.md", child: `C${i}.md`, field: fl, direction: "out" as const, count: 1 })) }, profile);
    for (const e of canvas.edges) if (e.color) colors.add(e.color);
    assert.equal(colors.size, fields.length, `${profile.name}: one color per relationship`);
    assert.ok(!colors.has("1"), `${profile.name}: no red`);
  }
});

test("detail popup helpers: body without properties, card position, node match, undefined name, property rows (WB-099)", async () => {
  const { bodyOf, parseTranslate, nodeAt, undefinedName, propertyRows } = await import("../src/core/detail");
  const text = "---\ntype: Function\nid: F-1\n---\n\n# Title\n\nBody line.\n";
  assert.equal(bodyOf(text), "# Title\n\nBody line.\n");
  assert.equal(bodyOf(text, text.indexOf("---\n\n# Title") + 3), "# Title\n\nBody line.\n");
  assert.equal(bodyOf("No properties here\n"), "No properties here\n");
  assert.deepEqual(parseTranslate("transform: translate(460px, -80.5px); width: 300px;"), { x: 460, y: -80.5 });
  assert.equal(parseTranslate("width: 300px"), null);
  const nodes = [
    { id: "a", type: "file", x: 0, y: 0, width: 300, height: 80, file: "A.md" },
    { id: "b", type: "text", x: 460, y: 100, width: 300, height: 80, text: "**Ghost**\n*undefined*" },
  ];
  assert.equal(nodeAt(nodes, 460, 100.4)?.id, "b");
  assert.equal(nodeAt(nodes, 461.5, 100), undefined);
  assert.equal(undefinedName(nodes[1].text), "Ghost");
  assert.equal(undefinedName("**+3 more**"), null);
  const rows = propertyRows({ type: "Object", hasPart: ["[[Wire]]", "[[Jacket|the jacket]]"], tags: [], note: "see [[X#Sec]] now", position: {} }, new Set(["id"]));
  assert.deepEqual(rows.map((r) => r.key), ["type", "hasPart", "note"]);
  assert.deepEqual(rows[1].parts, [{ text: "Wire", link: "Wire" }, { text: ", " }, { text: "the jacket", link: "Jacket" }]);
  assert.deepEqual(rows[2].parts, [{ text: "see " }, { text: "X", link: "X" }, { text: " now" }]);
});

test("detail popup relationships: only relationship fields, a repeated link once with its quantity (WB-100)", async () => {
  const { propertyRows, relationshipRows } = await import("../src/core/detail");
  const fm = { type: "Object", id: "O-1", hasPart: ["[[Wire]]", "[[Wire]]", "[[Wire]]", "[[Jacket]]"], hasPort: ["[[P1]]"], partOf: [], tags: ["a"] };
  const fields = new Set(["hasPart", "hasPort", "partOf"]);
  const rel = relationshipRows(fm, fields);
  assert.deepEqual(rel.map((r) => [r.key, r.count]), [["hasPart", 2], ["hasPort", 1]], "empty partOf is left out");
  assert.deepEqual(rel[0].parts, [{ text: "Wire", link: "Wire" }, { text: " (duplicate ×3)" }, { text: ", " }, { text: "Jacket", link: "Jacket" }]);
  assert.deepEqual(propertyRows(fm, fields).map((r) => r.key), ["type", "id", "tags"], "relationships are not repeated under Properties");
});

test("popup editing rules: what may be edited and how it is read back (WB-101)", async () => {
  const { propertyEditor, parseListInput, coerceValue, replaceBody, bodyUnchanged } = await import("../src/core/edit");
  const { bodyOf } = await import("../src/core/detail");
  const ctx = { relationFields: new Set(["hasPart", "partOf"]), translatedOnly: new Set(["eaType"]), subtypes: ["electrical", "part"] };
  assert.equal(propertyEditor("type", "Object", ctx).kind, "readonly");
  assert.equal(propertyEditor("id", "OBJ-1", ctx).kind, "readonly");
  assert.equal(propertyEditor("uid", "2026", ctx).kind, "readonly");
  assert.equal(propertyEditor("hasPart", [], ctx).kind, "readonly");
  assert.equal(propertyEditor("eaType", "Class", ctx).kind, "readonly");
  assert.equal(propertyEditor("status", "Draft", ctx).kind, "status");
  assert.equal(propertyEditor("tags", [], ctx).kind, "list");
  assert.equal(propertyEditor("other", "x", ctx).kind, "text");
  assert.equal(propertyEditor("nested", { a: 1 }, ctx).kind, "readonly");
  assert.deepEqual(propertyEditor("subtype", "part", ctx), { kind: "select", options: ["", "electrical", "part"] });
  assert.deepEqual(propertyEditor("subtype", "legacy", ctx), { kind: "select", options: ["", "electrical", "part", "legacy"] }, "a value outside the schema stays selectable");
  assert.equal(propertyEditor("subtype", "", { ...ctx, subtypes: [] }).kind, "readonly");
  assert.equal(propertyEditor("subtype", "", { ...ctx, subtypes: null }).kind, "readonly");
  assert.deepEqual(parseListInput(" a, b ,, c, a "), ["a", "b", "c"]);
  assert.deepEqual(parseListInput(""), []);
  assert.equal(coerceValue(3, " 7 "), 7);
  assert.equal(coerceValue(3, "x"), "x");
  assert.equal(coerceValue(true, "false"), false);
  assert.equal(coerceValue("Draft", " Active "), "Active");
  const text = '---\ntype: "State"\nid: S-1\n---\n\n# Title\n\nOld body.\n';
  assert.equal(replaceBody(text, bodyOf(text)), text, "saving an unchanged body writes the same file");
  assert.equal(replaceBody(text, "# Title\n\nNew body.\n"), '---\ntype: "State"\nid: S-1\n---\n\n# Title\n\nNew body.\n', "properties block kept byte for byte");
  assert.equal(replaceBody("Plain note\n", "Changed\n"), "Changed\n");
  assert.equal(replaceBody("---\na: 1\n---\nTight\n", "Looser\n"), "---\na: 1\n---\nLooser\n", "no blank line stays none");
  assert.ok(bodyUnchanged(text, "# Title\n\nOld body.\n"));
  assert.ok(!bodyUnchanged(text.replace("Old", "Edited"), "# Title\n\nOld body.\n"));
});

test("popup editing: empty properties get a row only in edit mode, so they can be filled in (WB-101)", async () => {
  const { propertyRows } = await import("../src/core/detail");
  const fm = { type: "Requirement", subtype: "", status: "Draft", tags: [] };
  assert.deepEqual(propertyRows(fm).map((r) => r.key), ["type", "status"]);
  assert.deepEqual(propertyRows(fm, new Set(), true).map((r) => r.key), ["type", "subtype", "status", "tags"]);
});

const views = () => PROFILES;
const keysOf = (idx: ReturnType<typeof indexOf>, start: string, name: string) => [...traverse(idx, [start], views()[name]).depthOf.keys()].sort();
const arrow = (idx: ReturnType<typeof indexOf>, start: string, name: string) => {
  const c = toCanvas(idx, traverse(idx, [start], views()[name]), views()[name]);
  const id = (f: string) => c.nodes.find((n) => n.file === f)?.id;
  return (a: string, b: string) => c.edges.find((e) => e.fromNode === id(a) && e.toNode === id(b));
};

test("every view uses only relationship fields and classes that exist in the schema (WB-102)", () => {
  for (const [name, profile] of Object.entries(PROFILES)) {
    assert.ok(profile.description, `${name} has a description for the picker`);
    for (const st of profile.steps) {
      assert.ok(currentSchema.byField.has(st.field), `${name}: ${st.field} is a forward relationship field`);
      for (const c of [...(st.from ?? []), ...(st.to ?? []), ...(profile.startTypes ?? [])]) assert.ok(currentSchema.classNames.has(c), `${name}: class ${c} exists`);
    }
  }
  assert.deepEqual(Object.keys(PROFILES).sort(), ["Behavior", "Design", "Evidence", "Failure and risk", "Functional", "Interfaces", "Internal", "Requirements", "Scenario", "Structure", "Verification", "Where Used"]);
});

test("where used: parents, owners, performers and dependants, followed upward, arrows as stored (WB-102)", () => {
  const idx = indexOf(schema, [
    note("Product.md", "Object", { hasPart: ["Cable.md"] }),
    note("Cable.md", "Object", { hasPart: ["Wire.md"], hasPort: ["P.md"] }),
    note("Wire.md", "Object"),
    note("Fn.md", "Function"),
    note("Wire2.md", "Object", { performs: ["Fn.md"] }),
    note("Other.md", "Object", { dependsOn: ["Wire.md"] }),
    note("P.md", "Port"),
    note("Box.md", "Object", { hasPart: ["Wire.md"] }),
    note("UC.md", "Use Case", { realizedBy: ["Fn.md"], participants: ["Wire.md"] }),
  ]);
  assert.deepEqual(keysOf(idx, "Wire.md", "Where Used"), ["Box.md", "Cable.md", "Other.md", "Product.md", "UC.md", "Wire.md"], "three levels up through assemblies");
  assert.equal(arrow(idx, "Wire.md", "Where Used")("Cable.md", "Wire.md")?.label, "hasPart", "the assembly points at its part");
  assert.deepEqual(keysOf(idx, "Fn.md", "Where Used"), ["Fn.md", "UC.md", "Wire2.md"]);
  assert.deepEqual(keysOf(idx, "P.md", "Where Used"), ["P.md"], "legacy first-class Port ownership is no longer part of the current Where Used profile");
});

test("Interfaces profile does not reinterpret legacy first-class Port relationships after W-384", () => {
  const idx = indexOf(schema, [
    note("A.md", "Object", { hasPort: ["PA.md"] }),
    note("PA.md", "Port", { interfaces: ["PB.md"], transmits: ["Flow.md"] }),
    note("PB.md", "Port", { interfaces: ["PA.md"] }),
    note("Flow.md", "Item Flow"),
  ]);

  assert.deepEqual(keysOf(idx, "A.md", "Interfaces"), ["A.md"]);
  assert.deepEqual(keysOf(idx, "PA.md", "Interfaces"), ["PA.md"]);
  assert.deepEqual(keysOf(idx, "Flow.md", "Interfaces"), ["Flow.md"]);
});

test("verification, design, scenario (WB-102)", () => {
  const v = indexOf(schema, [
    note("R.md", "Requirement"), note("R2.md", "Requirement"),
    note("V.md", "Verification", { verifies: ["R.md", "R2.md"] }),
    note("Fn.md", "Function", { satisfies: ["R.md"] }),
    note("Des.md", "Design", { satisfies: ["R2.md"] }),
  ]);
  assert.deepEqual(keysOf(v, "R.md", "Verification"), ["Fn.md", "R.md", "R2.md", "V.md"], "verifier, its other requirement, satisfier");
  assert.deepEqual(keysOf(v, "V.md", "Verification"), ["Des.md", "Fn.md", "R.md", "R2.md", "V.md"], "requirements verified, then valid Function/Design satisfiers");
  assert.deepEqual(keysOf(v, "Fn.md", "Verification"), ["Fn.md", "R.md", "V.md"]);
  assert.equal(arrow(v, "R.md", "Verification")("V.md", "R.md")?.label, "verifies");

  const d = indexOf(schema, [
    note("Obj.md", "Object", { hasDesign: ["D1.md"] }),
    note("D1.md", "Design", { hasChild: ["D2.md"], satisfies: ["Req.md"] }),
    note("D2.md", "Design", { satisfies: ["Req2.md"] }),
    note("Req.md", "Requirement"), note("Req2.md", "Requirement"),
  ]);
  assert.deepEqual(keysOf(d, "Obj.md", "Design"), ["D1.md", "D2.md", "Obj.md", "Req.md"]);
  assert.deepEqual(keysOf(d, "D2.md", "Design"), ["D1.md", "D2.md", "Req.md", "Req2.md"], "parent design, own requirement, and the parent's requirement; the owner Object belongs to the parent");

  const s = indexOf(schema, [
    note("UC.md", "Use Case", { participants: ["Actor.md", "Obj.md"], realizedBy: ["F1.md"], hasChild: ["UC2.md"], optionOf: ["UC3.md"], drives: ["Req.md"] }),
    note("UC4.md", "Use Case", { optionOf: ["UC.md"] }),
    note("Actor.md", "Actor"), note("Obj.md", "Object"), note("UC2.md", "Use Case"), note("UC3.md", "Use Case"), note("Req.md", "Requirement"),
    note("F1.md", "Function", { precedes: ["F2.md"] }), note("F2.md", "Function"),
  ]);
  assert.deepEqual(keysOf(s, "UC.md", "Scenario"), ["Actor.md", "F1.md", "F2.md", "Obj.md", "Req.md", "UC.md", "UC2.md", "UC3.md", "UC4.md"]);
  assert.equal(arrow(s, "UC.md", "Scenario")("UC4.md", "UC.md")?.label, "optionOf", "a variant points at its base use case");
});

test("behavior, failure and risk, evidence (WB-102)", () => {
  const b = indexOf(schema, [
    note("Obj.md", "Object", { hasState: ["SM.md"] }),
    note("SM.md", "State Machine", { hasState: ["S1.md", "S2.md"], initialState: ["S1.md"] }),
    note("S1.md", "State", { precedes: ["S2.md"], triggeredBy: ["Fn.md"] }),
    note("S2.md", "State", { hasChild: ["S3.md"] }), note("S3.md", "State"), note("Fn.md", "Function"),
  ]);
  assert.deepEqual(keysOf(b, "Obj.md", "Behavior"), ["Obj.md", "S1.md", "S2.md", "SM.md"]);
  assert.deepEqual(keysOf(b, "S1.md", "Behavior"), ["Fn.md", "S1.md", "S2.md", "S3.md", "SM.md"], "owner, next state, trigger, and the next state's nested state");
  assert.deepEqual(keysOf(b, "S2.md", "Behavior"), ["Fn.md", "S1.md", "S2.md", "S3.md", "SM.md"], "previous state, owner, nested state, and what triggers the previous state");

  const f = indexOf(schema, [
    note("Iss.md", "Issue", { affects: ["Fn.md"] }),
    note("Fn.md", "Function", { satisfies: ["Req.md"] }), note("Req.md", "Requirement"),
    note("Perf.md", "Object", { performs: ["Fn.md"] }),
    note("Iss2.md", "Issue", { affects: ["Perf.md"] }),
  ]);
  assert.deepEqual(keysOf(f, "Iss.md", "Failure and risk"), ["Fn.md", "Iss.md", "Perf.md", "Req.md"]);
  assert.deepEqual(keysOf(f, "Perf.md", "Failure and risk"), ["Iss2.md", "Perf.md"], "what affects an element");

  const e = indexOf(schema, [
    note("Req.md", "Requirement", { hasChild: ["Art2.md"] }),
    note("Req2.md", "Requirement"),
    note("Art.md", "Artifact", { describes: ["Req.md", "Req2.md"] }),
    note("Art2.md", "Artifact"),
  ]);
  assert.deepEqual(keysOf(e, "Req.md", "Evidence"), ["Art.md", "Art2.md", "Req.md", "Req2.md"]);
  assert.deepEqual(keysOf(e, "Art.md", "Evidence"), ["Art.md", "Req.md", "Req2.md", "Art2.md"].sort());
  assert.equal(arrow(e, "Req.md", "Evidence")("Art.md", "Req.md")?.label, "describes");
});


test("Internal view uses the owner as a group boundary and keeps interfaces simple", () => {
  const idx=indexOf(schema,[
    {...note("Assembly.md","Object"),uid:"20261003123456789assemblyowner"},
    note("Pump.md","Object"),{...note("PortDef.md","Object"),subtype:"interface"},note("FlowDef.md","Item Flow"),
  ]);
  const local=new LocalModelIndex();
  const p="20261003123456789ppppppppppppp";
  const inner="20261003123456789iiiiiiiiiiiii";
  const outer="20261003123456789ooooooooooooo";
  const conn="20261003123456789ccccccccccccc";
  const flow="20261003123456789fffffffffffff";
  local.set("Assembly.md",parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->","## Local Model",
    "### Parts","#### Pump A","- definition: [[Pump]]","^part-"+p,
    "### Interfaces","#### P1","- definition: [[PortDef]]","- part: [[#^part-"+p+"|Pump A]]","^ep-"+inner,
    "#### J1","- definition: [[PortDef]]","^ep-"+outer,
    "### Connections","#### Harness","- endpointA: [[#^ep-"+outer+"|J1]]","- endpointB: [[#^ep-"+inner+"|P1]]","- exposes: [[#^ep-"+outer+"|J1]]","^conn-"+conn,
    "##### Power","- definition: [[FlowDef]]","- endpointA: transmit","- endpointB: receive","^flow-"+flow,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n")));
  const result=buildInternalView(idx,local,"Assembly.md",(target)=>target+".md");
  const group=result.canvas.nodes.find((n)=>n.type==="group");
  assert.equal(group?.label,"Assembly");
  assert.ok(result.canvas.nodes.some((n)=>n.id==="local:part-"+p));
  const boundary=result.canvas.nodes.find((n)=>n.id==="local:ep-"+outer)!;
  assert.ok(boundary.x<0 || boundary.x+boundary.width>group!.width,"boundary interface straddles the owner boundary");
  assert.ok(result.canvas.edges.some((e)=>e.id==="expose:conn-"+conn+":ep-"+outer && e.label==="Harness exposes"));
  assert.ok(result.canvas.edges.some((e)=>e.id==="connection:conn-"+conn && e.label?.includes("Harness") && e.label?.includes("Power")));
  assert.equal(PROFILES.Internal,INTERNAL_PROFILE);
});

test("Internal curated refresh preserves stable node placement",()=>{
  const generated={nodes:[
    {id:"internal:boundary",type:"group" as const,label:"A",x:0,y:0,width:1000,height:700},
    {id:"local:part-x",type:"text" as const,text:"x",x:100,y:100,width:200,height:100},
    {id:"local:part-new",type:"text" as const,text:"new",x:400,y:100,width:200,height:100},
  ],edges:[]};
  const existing={nodes:[
    {id:"internal:boundary",type:"group" as const,label:"A",x:20,y:30,width:1200,height:800},
    {id:"local:part-x",type:"text" as const,text:"old",x:777,y:333,width:240,height:130},
  ],edges:[]};
  const merged=preserveInternalLayout(generated,existing);
  const kept=merged.nodes.find((n)=>n.id==="local:part-x")!;
  assert.deepEqual([kept.x,kept.y,kept.width,kept.height],[777,333,240,130]);
  const added=merged.nodes.find((n)=>n.id==="local:part-new")!;
  assert.deepEqual([added.x,added.y],[400,100]);
});


test("definition-only profiles never touch Local Model data", () => {
  const idx = indexOf(schema, [note("Function.md", "Function")]);
  const base = traverse(idx, ["Function.md"], FUNCTIONAL_PROFILE);
  const local = new Proxy(new LocalModelIndex(), {
    get() {
      throw new Error("definition-only profile touched Local Model data");
    },
  });
  assert.equal(profileNeedsLocalOccurrences(FUNCTIONAL_PROFILE), false);
  assert.equal(withLocalOccurrences(idx, local, () => undefined, base, FUNCTIONAL_PROFILE), base);
});

test("only explicitly occurrence-aware profiles request Local Model data", () => {
  const occurrenceAware = new Set(["Structure", "Internal", "Requirements", "Where Used", "Interfaces"]);
  for (const profile of Object.values(PROFILES)) {
    assert.equal(profileNeedsLocalOccurrences(profile), occurrenceAware.has(profile.name), profile.name);
  }
});
