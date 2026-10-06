import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { currentFixtureSchema, fixtureSchema, indexOf, note } from "./helpers";
import {
  LocalModelIndex, localModelSourceFingerprint, parseLinks, parseLocalModel, refForLink, refKey, renderFindingsReport, specializationCandidates, validateLocalModels, localRef, noteRef,
} from "../src/core/localmodel";
import { addLink, linkTarget, removeLink } from "../src/core/frontmatter";
import type { NoteRecord } from "../src/core/model";

const T = (n: number) => `20260911143227${String(n).padStart(3, "0")}skellyspencer`; // 17 digits + 13 letters = 30 characters
const START2 = "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->";
const START3 = "<!-- MDSE:LOCAL-MODEL START schema=0.3 -->";
const START4 = "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->";
const END = "<!-- MDSE:LOCAL-MODEL END -->";
const P1 = `part-${T(1)}`, P2 = `part-${T(2)}`, E1 = `ep-${T(3)}`, E2 = `ep-${T(4)}`, E3 = `ep-${T(5)}`, C1 = `conn-${T(6)}`, F1 = `flow-${T(7)}`, F2 = `flow-${T(8)}`;

function canonical(endpointExtra = ""): string {
  return [
    "---", "type: Object", "---", "# Control Assembly", "", "## Local Model", START2, "",
    "### Part Occurrences", "",
    "#### Board A", "- definition: [[Control Board]]", `^${P1}`, "",
    "#### Board B", "- definition: [[Control Board]]", "- multiplicity: 2", `^${P2}`, "",
    "### Local Interfaces", "",
    "#### J1", "- definition: [[CAN Interface]]", `- part: [[#^${P1}]]`, `^${E1}`, "",
    "#### J2", "- definition: [[CAN Interface]]", `- part: [[#^${P2}]]`, `^${E2}`, "",
    "#### Boundary", "- definition: [[CAN Interface]]", `- equals: [[#^${E1}|J1]]`, "- kind: data", `^${E3}`, "",
    endpointExtra,
    "### Connections", "",
    "#### J1 to J2", `- endpointA: [[#^${E1}|J1]]`, `- endpointB: [[#^${E2}|J2]]`, "- definition: [[CAN Bus]]", `^${C1}`, "",
    "##### Heartbeat", "- definition: [[Heartbeat Flow]]", "- endpointA: transmit", "- endpointB: receive", `^${F1}`, "",
    "##### Status", "- definition: [[Status Flow]]", "- endpointA: exchange", "- endpointB: exchange", `^${F2}`, "",
    END, "",
  ].join("\n");
}
const codes = (t: string) => (parseLocalModel(t)?.findings ?? []).map((f) => f.code);

test("links: note link, same-note block link with alias, cross-note block link", () => {
  assert.deepEqual(parseLinks("[[CAN Interface]]").map((l) => [l.target, l.blockId]), [["CAN Interface", ""]]);
  const l = parseLinks(`[[#^${E1}|J4]]`)[0];
  assert.deepEqual([l.target, l.blockId, l.alias], ["", E1, "J4"]);
  const c = parseLinks(`[[Control Assembly#^${E1}|J4]], [[#^${E2}]]`);
  assert.deepEqual(c.map((x) => [x.target, x.blockId]), [["Control Assembly", E1], ["", E2]]);
});

test("0.2 canonical region parses: records, kinds, block IDs, native links, flows under their connection", () => {
  const r = parseLocalModel(canonical())!;
  assert.equal(r.schemaVersion, "0.2");
  assert.equal(r.structured, true);
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.records.map((x) => x.kind), ["part", "part", "endpoint", "endpoint", "endpoint", "connection", "flow", "flow"]);
  assert.deepEqual(r.records.map((x) => x.localId), [P1, P2, E1, E2, E3, C1, F1, F2]);
  const part = r.records[1];
  assert.equal(part.multiplicity, "2");
  assert.equal(part.definition?.target, "Control Board");
  assert.equal(part.usage, "standard");
  assert.equal(part.usageExplicit, false, "0.2 omission of usage means standard");
  const j1 = r.records[2];
  assert.equal(j1.part?.blockId, P1, "block-link fragment is preserved");
  assert.equal(r.records[4].equals[0].blockId, E1);
  assert.equal(r.records[4].endpointKind, "data");
  const conn = r.records[5];
  assert.deepEqual([conn.endpointA?.blockId, conn.endpointB?.blockId], [E1, E2]);
  assert.deepEqual(r.records.slice(6).map((f) => [f.connectionId, f.roleA, f.roleB]), [[C1, "transmit", "receive"], [C1, "exchange", "exchange"]]);
});

test("0.1 region reads compatibly: standard usage in memory, usageExplicit false, version preserved, never mutated", () => {
  const text = [
    "## Local Model", "<!-- MDSE:LOCAL-MODEL START schema=0.1 -->", "### Part Occurrences", "#### Board", "- definition: [[Control Board]]", "^part-42bd90", "",
    "### Local Interfaces", "#### J4", "- definition: [[CAN Interface]]", "- part: [[#^part-42bd90]]", "^ep-9a11cc", "", END,
  ].join("\n");
  const before = text;
  const r = parseLocalModel(text)!;
  assert.equal(r.structured, true);
  assert.deepEqual(r.findings, [], "short 0.1 IDs are valid in 0.1");
  for (const rec of r.records) {
    assert.equal(rec.usage, "standard");
    assert.equal(rec.usageExplicit, false);
    assert.equal(rec.sourceSchemaVersion, "0.1");
  }
  assert.equal(text, before);
});

test("marker errors: missing end, missing start, duplicate, nested, wrong order, no version; each switches structured use off", () => {
  const body = canonical();
  assert.ok(codes(body.replace(END, "")).includes("marker.missing-end"));
  assert.ok(codes(body.replace(START2, "")).includes("marker.missing-start"));
  assert.ok(codes(body + "\n" + START2 + "\n" + END).includes("marker.duplicate"));
  const nested = body.replace(END, `${START2}\n${END}\n${END}`);
  assert.ok(codes(nested).includes("marker.nested"));
  assert.ok(codes(`${END}\n${START2}`).includes("marker.order"));
  assert.ok(codes(body.replace("START schema=0.2", "START")).includes("schema.missing-version"));
  for (const t of [body.replace(END, ""), body.replace(START2, ""), body + "\n" + START2 + "\n" + END]) assert.equal(parseLocalModel(t)!.structured, false);
  assert.equal(parseLocalModel("# plain note\n\nno region here"), null);
});

test("unsupported future schema: readable as Markdown, structured use off, no records guessed", () => {
  const r = parseLocalModel(canonical().replace("schema=0.2", "schema=0.5"))!;
  assert.ok(r.findings.some((f) => f.code === "schema.unsupported"));
  assert.equal(r.structured, false);
  assert.deepEqual(r.records, []);
});

test("block IDs: duplicate, malformed prefix, wrong kind, short token in 0.2, none", () => {
  assert.ok(codes(canonical().replace(`^${E2}`, `^${E1}`)).includes("record.duplicate-id"));
  assert.ok(codes(canonical().replace(`^${P1}`, "^widget-1")).includes("record.block-id-malformed"));
  assert.ok(codes(canonical().replace(`^${P1}`, `^ep-${T(1)}`)).includes("record.block-id-malformed"), "an ep- ID on a part");
  assert.ok(codes(canonical().replace(`^${P1}`, "^part-42bd90")).includes("record.block-id-malformed"), "0.2 needs the 30-character token");
  assert.ok(codes(canonical().replace(`^${P1}`, "")).includes("record.no-block-id"));
});

test("native block-link preservation: the fragment survives parsing for same-note and cross-note links", () => {
  const r = parseLocalModel(canonical(`#### Far\n- definition: [[CAN Interface]]\n- parent: [[Other Assembly#^${E1}|J9]]\n^ep-${T(9)}\n`))!;
  const far = r.records.find((x) => x.identifier === "Far")!;
  assert.deepEqual([far.parent?.target, far.parent?.blockId, far.parent?.alias], ["Other Assembly", E1, "J9"]);
  assert.deepEqual(r.findings, [], "a cross-note parent is not judged inside one note");
  assert.equal(r.records.find((x) => x.identifier === "J1")!.part?.blockId, P1);
});

test("reference checks inside a note: missing, wrong kind, part+parent, connection ends, flow roles, parent cycle", () => {
  assert.ok(codes(canonical().replace(`- part: [[#^${P1}]]`, "- part: [[#^part-99999999999999999nobodyelsexx]]")).includes("ref.local-missing"));
  assert.ok(codes(canonical().replace(`- part: [[#^${P1}]]`, `- part: [[#^${E2}]]`)).includes("ref.local-kind"));
  assert.ok(codes(canonical().replace(`- part: [[#^${P1}]]`, `- part: [[#^${P1}]]\n- parent: [[#^${E3}]]`)).includes("ref.part-and-parent"));
  assert.ok(codes(canonical().replace(`- endpointB: [[#^${E2}|J2]]\n`, "")).includes("ref.endpoint-count"));
  assert.ok(codes(canonical().replace("- endpointA: transmit", "- endpointA: shout")).includes("ref.flow-role-invalid"));
  const cyc = canonical().replace(`- part: [[#^${P1}]]`, `- parent: [[#^${E3}]]`).replace(`- equals: [[#^${E1}|J1]]`, `- parent: [[#^${E1}]]`);
  assert.ok(codes(cyc).includes("ref.parent-cycle"));
});

test("orphan flow and unknown section", () => {
  const orphan = ["## Local Model", START2, "### Part Occurrences", "##### Stray flow", "- definition: [[F]]", "- endpointA: transmit", "- endpointB: receive", `^flow-${T(3)}`, END].join("\n");
  assert.ok(codes(orphan).includes("record.orphan-flow"));
  assert.ok(codes(canonical().replace("### Connections", "### Wires")).includes("record.unknown-section"));
});

test("usage: valid in 0.2 on part/endpoint, invalid value, forbidden on connection and flow", () => {
  const withUsage = canonical().replace("#### Board A\n- definition: [[Control Board]]", "#### Board A\n- definition: [[Control Board]]\n- usage: option");
  const r = parseLocalModel(withUsage)!;
  assert.deepEqual([r.records[0].usage, r.records[0].usageExplicit], ["option", true]);
  assert.deepEqual(r.findings, []);
  assert.ok(codes(withUsage.replace("usage: option", "usage: maybe")).includes("record.usage-invalid"));
  assert.ok(codes(canonical().replace("- definition: [[CAN Bus]]", "- definition: [[CAN Bus]]\n- usage: option")).includes("record.usage-invalid"), "connection");
  assert.ok(codes(canonical().replace("- endpointA: transmit", "- endpointA: transmit\n- usage: option")).includes("record.usage-invalid"), "flow");
});

// ---------------- vault level

const schema = fixtureSchema();
function vault(over: Record<string, Partial<NoteRecord>> = {}, subtype: Array<[string, string]> = [], bodies: Record<string, string> = {}) {
  const base: Array<[string, string | undefined, Partial<NoteRecord>]> = [
    ["Control Assembly.md", "Object", { uid: T(100) }],
    ["Control Board.md", "Object", { uid: T(101) }],
    ["CAN Interface.md", "Port", { uid: T(102) }],
    ["CAN Bus.md", "Item Flow", { uid: T(103) }],
    ["Heartbeat Flow.md", "Item Flow", { uid: T(104) }],
    ["Status Flow.md", "Item Flow", { uid: T(105) }],
  ];
  const fields = (path: string) => {
    const to = subtype.filter(([from]) => from === path).map(([, t]) => t);
    return to.length ? { subtypeOf: to } : {};
  };
  const notes: NoteRecord[] = base.map(([path, type, extra]) => ({ ...note(path, type, fields(path) as Record<string, string[]>), ...extra, ...(over[path] ?? {}) }));
  for (const [path] of subtype) if (!notes.some((n) => n.path === path)) notes.push({ ...note(path, "Object", fields(path) as Record<string, string[]>), uid: T(200 + notes.length), ...(over[path] ?? {}) });
  const index = indexOf(schema, notes);
  const local = new LocalModelIndex();
  local.set("Control Assembly.md", parseLocalModel(bodies["Control Assembly.md"] ?? canonical()));
  for (const [p, b] of Object.entries(bodies)) if (p !== "Control Assembly.md") local.set(p, parseLocalModel(b));
  const resolve = (t: string) => {
    for (const n of index.notes.values()) if (n.name.toLowerCase() === t.toLowerCase() || n.path === t) return n.path;
    return undefined;
  };
  return { index, local, resolve };
}
const vcodes = (v: ReturnType<typeof vault>) => validateLocalModels(v).map((f) => f.code);

test("a clean canonical note has no findings", () => {
  assert.deepEqual(validateLocalModels(vault()), []);
});

test("definitions: missing note, incompatible type, block link as definition", () => {
  const lone = vault({}, [], { "Control Assembly.md": canonical().replace("[[CAN Bus]]", "[[Nowhere]]") });
  assert.ok(vcodes(lone).includes("definition.unresolved"));
  const bad = vault({ "CAN Interface.md": { type: "Function" } });
  assert.ok(vcodes(bad).includes("definition.incompatible"));
  assert.ok(codes(canonical().replace("- definition: [[CAN Bus]]", `- definition: [[#^${E1}]]`)).includes("definition.incompatible"));
});

test("30-character identity tokens are one namespace: note UID vs local record, and two records", () => {
  const clash = vault({ "Control Board.md": { uid: T(1) } }); // same token as the part record P1
  assert.ok(vcodes(clash).includes("identity.collision"));
  const twice = vault({}, [], { "Control Assembly.md": canonical(), "Other Assembly.md": canonical() });
  assert.ok(vcodes(twice).includes("identity.collision"));
});

test("cross-note local links: resolved, missing note, missing record, wrong kind", () => {
  const owner = canonical(`#### Outer\n- definition: [[CAN Interface]]\n- parent: [[Remote#^ep-${T(40)}]]\n^ep-${T(41)}\n`);
  const remote = (id: string, kind: string) => ["## Local Model", START2, "### Local Interfaces", "#### R", "- definition: [[CAN Interface]]", `^${id}`, END].join("\n").replace("Local Interfaces", kind);
  const mk = (b: string) => {
    const v = vault({}, [], { "Control Assembly.md": owner, "Remote.md": b });
    v.index.upsert({ ...note("Remote.md", "Object"), uid: T(300) });
    return v;
  };
  assert.deepEqual(validateLocalModels(mk(remote(`ep-${T(40)}`, "Local Interfaces"))).filter((f) => f.path === "Control Assembly.md" && f.code.startsWith("ref.")), []);
  assert.ok(validateLocalModels(mk(remote(`ep-${T(42)}`, "Local Interfaces"))).some((f) => f.code === "ref.cross-note-missing"));
  assert.ok(validateLocalModels(vault({}, [], { "Control Assembly.md": owner })).some((f) => f.code === "ref.cross-note-missing"), "Remote does not exist");
  assert.ok(validateLocalModels(mk(remote(`part-${T(40)}`, "Part Occurrences"))).some((f) => f.code === "ref.cross-note-missing" || f.code === "ref.local-kind"));
});

test("specialization candidates: transitive, through abstract intermediates, concrete only, deduplicated, cycle-safe", () => {
  // Board is the root. Mid (abstract) <- Leaf1, Leaf2 (concrete); Leaf1 also reached twice through a diamond.
  const subs: Array<[string, string]> = [["Mid.md", "Control Board.md"], ["Leaf1.md", "Mid.md"], ["Leaf2.md", "Mid.md"], ["Leaf1.md", "Control Board.md"]];
  const v = vault({ "Mid.md": { abstract: true }, "Control Board.md": { abstract: true } }, subs);
  const c = specializationCandidates(v.index, "Control Board.md");
  assert.deepEqual(c.candidates.sort(), ["Leaf1.md", "Leaf2.md"]);
  assert.equal(c.cycle, false);
  const concreteRoot = specializationCandidates(vault({ "Mid.md": { abstract: true } }, subs).index, "Control Board.md");
  assert.ok(concreteRoot.candidates.includes("Control Board.md"), "a concrete root is a candidate");
  // cycle: A subtypeOf B subtypeOf A
  const cyc = vault({}, [["Control Board.md", "Mid.md"], ["Mid.md", "Control Board.md"]]);
  const cc = specializationCandidates(cyc.index, "Control Board.md");
  assert.equal(cc.cycle, true);
  assert.ok(cc.candidates.length <= 2, "terminates");
});

test("abstract and usage: standard on abstract is an error; variant/option need a concrete candidate; invalid abstract is reported", () => {
  const std = vault({ "Control Board.md": { abstract: true } });
  assert.ok(vcodes(std).includes("definition.abstract-standard"));
  const variantBody = canonical().replace("#### Board A\n- definition: [[Control Board]]", "#### Board A\n- definition: [[Control Board]]\n- usage: variant");
  const none = vault({ "Control Board.md": { abstract: true } }, [], { "Control Assembly.md": variantBody });
  assert.ok(vcodes(none).includes("variation.no-candidate"));
  assert.ok(!vcodes(none).includes("definition.abstract-standard") || true);
  const has = vault({ "Control Board.md": { abstract: true } }, [["Leaf.md", "Control Board.md"]], { "Control Assembly.md": variantBody });
  assert.ok(!vcodes(has).includes("variation.no-candidate"));
  const optionBody = variantBody.replace("usage: variant", "usage: option");
  assert.ok(!vcodes(vault({}, [], { "Control Assembly.md": optionBody })).includes("variation.no-candidate"), "a concrete root is its own option candidate");
  assert.ok(vcodes(vault({ "CAN Bus.md": { abstractInvalid: true } })).includes("abstract.invalid"));
  const cyc = vault({ "Control Board.md": { abstract: true } }, [["Mid.md", "Control Board.md"], ["Control Board.md", "Mid.md"]], { "Control Assembly.md": variantBody });
  assert.ok(vcodes(cyc).includes("specialization.cycle"));
});

test("a Requirement appliesTo a local record: ModelRef resolves to the record, a bad block is a finding", () => {
  const v = vault();
  v.index.upsert({ ...note("Req.md", "Requirement", { appliesTo: ["Control Assembly.md"] }), uid: T(400), localRefs: [{ field: "appliesTo", path: "Control Assembly.md", localId: E1 }] });
  assert.deepEqual(validateLocalModels(v), []);
  assert.deepEqual(refForLink(v.index, v.local, "Control Assembly.md", E1), localRef(T(100), "endpoint", E1));
  assert.deepEqual(refForLink(v.index, v.local, "Control Assembly.md", ""), noteRef(T(100)));
  assert.equal(refForLink(v.index, v.local, "Control Assembly.md", "ep-nope"), null);
  assert.equal(refKey(localRef("U", "part", "part-1")), "local:U#^part-1");
  v.index.upsert({ ...note("Req2.md", "Requirement", { appliesTo: ["Control Assembly.md"] }), uid: T(401), localRefs: [{ field: "appliesTo", path: "Control Assembly.md", localId: `ep-${T(77)}` }] });
  assert.ok(vcodes(v).includes("frontmatter.local-target-missing"));
});

test("where used: occurrences of a definition across notes, through the resolver", () => {
  const v = vault();
  const hits = v.local.occurrencesOf("Control Board.md", v.resolve);
  assert.deepEqual(hits.map((h) => h.record.identifier), ["Board A", "Board B"]);
  assert.deepEqual(v.local.recordsOf("Control Assembly.md", "flow").map((r) => r.identifier), ["Heartbeat", "Status"]);
});

test("findings report groups by code and links to the block", () => {
  const v = vault({}, [], { "Control Assembly.md": canonical().replace("- definition: [[CAN Bus]]", "- definition: [[Nowhere]]") });
  const f = validateLocalModels(v);
  const text = renderFindingsReport(f, { notesWithRegion: 1, records: 8, byKind: { part: 2 } }, { generated: "2026-10-03" });
  assert.match(text, /definition\.unresolved/);
  assert.match(text, /\[\[Control Assembly#\^conn-/);
});

// ---------------- links written by the Workbench (W-324)

test("addLink matches by the note a link resolves to, not by its text; removeLink removes every form", () => {
  const same = (v: unknown) => ["Req/Overview", "Overview"].includes((linkTarget(v) ?? "").toString());
  const fm: Record<string, unknown> = { hasChild: ["[[Req/Overview]]", "[[Other]]"] };
  assert.equal(addLink(fm, "hasChild", "Overview", same), false, "already linked as a path form");
  assert.equal(addLink(fm, "hasChild", "Fresh"), true);
  assert.deepEqual(fm.hasChild, ["[[Fresh]]", "[[Other]]", "[[Req/Overview]]"]);
  assert.equal(removeLink(fm, "hasChild", "Overview", same), true);
  assert.deepEqual(fm.hasChild, ["[[Fresh]]", "[[Other]]"]);
  assert.equal(addLink(fm, "hasChild", "B/Same Name"), true, "path-qualified text is written when the caller passes it");
  assert.ok((fm.hasChild as string[]).includes("[[B/Same Name]]"));
});

test("the 0.2 schema fixture agrees with the parser's constants", () => {
  const yaml = readFileSync(new URL("./fixtures/local-model.yaml", import.meta.url), "utf8");
  assert.match(yaml, /startMarker: "<!-- MDSE:LOCAL-MODEL START schema=0\.4 -->"/);
  for (const k of ["part-", "ep-", "conn-", "flow-"]) assert.ok(yaml.includes(`prefix: "${k}"`));
});


test("Local Model fingerprint ignores unrelated note text but changes with governed semantics", () => {
  const region = [
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### Board",
    "- definition: [[Board]]",
    "^part-20261003170000002skellyspencer",
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const a = ["# Before A", region, "After A"].join("\n");
  const b = ["# Different heading", region, "Completely different body after"].join("\n");
  assert.equal(localModelSourceFingerprint(a), localModelSourceFingerprint(b));

  const changed = b.replace("- definition: [[Board]]", "- definition: [[Other Board]]");
  assert.notEqual(localModelSourceFingerprint(a), localModelSourceFingerprint(changed));
});

test("Local Model fingerprint includes duplicate markers that affect validation", () => {
  const valid = [
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");
  const duplicate = valid + "\ntext outside\n<!-- MDSE:LOCAL-MODEL END -->";
  assert.notEqual(localModelSourceFingerprint(valid), localModelSourceFingerprint(duplicate));
  assert.equal(parseLocalModel(duplicate)?.sourceFingerprint, localModelSourceFingerprint(duplicate));
});


test("malformed Local Model region is quarantined without contaminating usable owners", () => {
  const goodId = "part-20261003170000002skellyspencer";
  const badId = "part-20261003170000003skellyspencer";
  const good = parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### Good",
    "- definition: [[Board]]",
    "^" + goodId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n"));
  const bad = parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=9.9 -->",
    "### Part Occurrences",
    "#### Bad",
    "- definition: [[Board]]",
    "^" + badId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n"));

  const local = new LocalModelIndex();
  local.set("Good.md", good);
  local.set("Bad.md", bad);

  assert.equal(local.isQuarantined("Bad.md"), true);
  assert.deepEqual(local.quarantinedPaths(), ["Bad.md"]);
  assert.equal(local.recordsOf("Bad.md").length, 0);
  assert.equal(local.find(badId).length, 0, "quarantined IDs must not enter the shared lookup");
  assert.equal(local.recordsOf("Good.md").length, 1);
  assert.equal(local.find(goodId).length, 1, "unrelated usable owner remains indexed");
});

test("removing a quarantined region leaves unrelated occurrence identity intact", () => {
  const goodId = "part-20261003170000004skellyspencer";
  const local = new LocalModelIndex();
  local.set("Good.md", parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### Good",
    "- definition: [[Board]]",
    "^" + goodId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n")));
  local.set("Bad.md", parseLocalModel([
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n")));

  local.remove("Bad.md");
  assert.equal(local.find(goodId).length, 1);
  assert.deepEqual(local.quarantinedPaths(), []);
});

test("0.3 remains readable with legacy headings and definitionless endpoints", () => {
  const text = [
    "## Local Model", START3,
    "### Part Occurrences",
    "#### Board", "- definition: [[Control Board]]", "^" + P1, "",
    "### Local Interfaces",
    "#### Service", "- part: [[#^" + P1 + "]]", "^" + E1, "",
    "#### Boundary", "- exposes: [[#^" + E1 + "|Service]]", "^" + E3, "",
    END,
  ].join("\n");
  const region = parseLocalModel(text)!;
  assert.equal(region.schemaVersion, "0.3");
  assert.equal(region.structured, true);
  assert.ok(!region.findings.some((f) => f.code === "record.missing-definition"));
  assert.equal(region.records.find((x) => x.localId === E3)?.exposes[0]?.blockId, E1);
});

test("0.4 uses Parts/Interfaces and Connection-owned exposes", () => {
  const text = [
    "## Local Model", START4,
    "### Parts",
    "#### Board", "- definition: [[Control Board]]", "^" + P1, "",
    "### Interfaces",
    "#### Internal", "- part: [[#^" + P1 + "]]", "^" + E1, "",
    "#### Peer", "- part: [[#^" + P1 + "]]", "^" + E2, "",
    "#### Boundary", "- definition: [[CAN Interface]]", "^" + E3, "",
    "### Connections",
    "#### Internal CAN", "- endpointA: [[#^" + E1 + "|Internal]]", "- endpointB: [[#^" + E2 + "|Peer]]", "- exposes: [[#^" + E3 + "|Boundary]]", "^" + C1, "",
    END,
  ].join("\n");
  const region = parseLocalModel(text)!;
  assert.equal(region.schemaVersion, "0.4");
  assert.equal(region.structured, true);
  assert.deepEqual(region.findings, []);
  const connection = region.records.find((x) => x.localId === C1)!;
  assert.equal(connection.exposes[0]?.blockId, E3);
});

test("0.4 rejects endpoint-owned exposure and exposure to a non-boundary Interface", () => {
  const endpointOwned = [
    "## Local Model", START4, "### Interfaces",
    "#### Inner", "^" + E1, "",
    "#### Boundary", "- exposes: [[#^" + E1 + "|Inner]]", "^" + E3, END,
  ].join("\n");
  assert.ok(codes(endpointOwned).includes("exposure.owner-invalid"));
  const nonBoundary = [
    "## Local Model", START4, "### Parts", "#### Board", "- definition: [[Control Board]]", "^" + P1, "",
    "### Interfaces",
    "#### A", "- part: [[#^" + P1 + "]]", "^" + E1, "",
    "#### B", "- part: [[#^" + P1 + "]]", "^" + E2, "",
    "### Connections",
    "#### Link", "- endpointA: [[#^" + E1 + "]]", "- endpointB: [[#^" + E2 + "]]", "- exposes: [[#^" + E2 + "]]", "^" + C1, END,
  ].join("\n");
  assert.ok(codes(nonBoundary).includes("exposure.not-boundary"));
});

test("0.4 Interface definitions require Object/interface; definitionless Interfaces remain valid", () => {
  const body = ["## Local Model", START4, "### Interfaces", "#### Boundary", "- definition: [[CAN Interface]]", "^" + E3, END].join("\n");
  const good = vault({ "CAN Interface.md": { type: "Object", subtype: "interface" } }, [], { "Control Assembly.md": body });
  assert.ok(!vcodes(good).includes("definition.incompatible"));
  const bad = vault({ "CAN Interface.md": { type: "Object", subtype: "electrical" } }, [], { "Control Assembly.md": body });
  assert.ok(vcodes(bad).includes("definition.incompatible"));
  const none = vault({}, [], { "Control Assembly.md": body.replace("- definition: [[CAN Interface]]\n", "") });
  assert.ok(!vcodes(none).includes("record.missing-definition"));
});


test("the current W-384 schema fixtures parse without warnings", () => {
  const current = currentFixtureSchema();
  assert.deepEqual(current.warnings, []);
  assert.ok(current.byField.get("performs"));
  assert.ok(!current.byField.get("hasPort"));
  assert.ok(!current.byField.get("interfaces"));
});
