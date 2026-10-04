import assert from "node:assert/strict";
import test from "node:test";
import { nextLocalId, planLocalRecordCreate, planLocalRecordDelete, planLocalRecordPatch } from "../src/core/localmodel-edit";
import { parseLocalModel } from "../src/core/localmodel";

const tokenA = "20261003133512742skellyspencer";
const tokenB = "20261003133512743skellyspencer";
const tokenC = "20261003133512744skellyspencer";
const tokenD = "20261003133512745skellyspencer";
const tokenE = "20261003133512746skellyspencer";

function note(version = "0.2"): string {
  return [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "Narrative before.",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=" + version + " -->",
    "### Part Occurrences",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "- identifier: K1",
    "^part-" + tokenA,
    "",
    "#### K2",
    "- definition: [[Main Contactor]]",
    "- usage: variant",
    "- identifier: K2",
    "^part-" + tokenB,
    "",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- part: [[#^part-" + tokenA + "|K1]]",
    "- kind: physical",
    "^ep-" + tokenC,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^ep-" + tokenC + "|J1]]",
    "- endpointB: [[Other Assembly#^ep-" + tokenC + "|J9]]",
    "^conn-" + tokenD,
    "##### CAN Frames",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^flow-" + tokenB,
    "<!-- MDSE:LOCAL-MODEL END -->",
    "",
    "Narrative after.",
  ].join("\n");
}

test("patches one part without changing identity or surrounding narrative", () => {
  const before = note();
  const id = "part-" + tokenA;
  const result = planLocalRecordPatch(before, id, {
    heading: "Main Contactor K1",
    fields: { identifier: "K1-MAIN", multiplicity: "1" },
  });

  assert.equal(result.changed, true);
  assert.match(result.after, /#### Main Contactor K1\n- definition: \[\[Main Contactor\]\]\n- identifier: K1-MAIN\n- multiplicity: 1\n\^part-/);
  assert.match(result.after, /#### K2\n- definition: \[\[Main Contactor\]\]\n- usage: variant/);
  assert.match(result.after, /Narrative before\./);
  assert.match(result.after, /Narrative after\./);
  assert.equal((result.after.match(new RegExp("^\\^" + id + "$", "gm")) ?? []).length, 1, "the native block ID is declared once; links may legitimately reference it");
  assert.equal(parseLocalModel(result.after)?.structured, true);
});

test("standard usage is canonically omitted", () => {
  const id = "part-" + tokenB;
  const result = planLocalRecordPatch(note(), id, { fields: { usage: "standard" } });
  const record = parseLocalModel(result.after)?.records.find((r) => r.localId === id);
  assert.equal(record?.usage, "standard");
  assert.equal(record?.usageExplicit, false);
  const block = result.after.slice(result.after.indexOf("#### K2"), result.after.indexOf("### Local Interfaces"));
  assert.doesNotMatch(block, /- usage:/);
});

test("null removes an optional field", () => {
  const id = "part-" + tokenA;
  const result = planLocalRecordPatch(note(), id, { fields: { identifier: null } });
  const record = parseLocalModel(result.after)?.records.find((r) => r.localId === id);
  assert.equal(record?.fields.has("identifier"), false);
});

test("schema 0.1 is read-compatible but structured edits are refused", () => {
  assert.throws(() => planLocalRecordPatch(note("0.1"), "part-" + tokenA, { fields: { identifier: "X" } }), /read-only/);
});

test("unknown fields are not introduced by a patch", () => {
  assert.throws(
    () => planLocalRecordPatch(note(), "part-" + tokenA, { fields: { notAField: "x" } }),
    /not a governed field/,
  );
});

test("a flow edit leaves its owning connection intact", () => {
  const id = "flow-" + tokenB;
  const result = planLocalRecordPatch(note(), id, { heading: "CAN Command Frames", fields: { endpointA: "exchange" } });
  assert.match(result.after, /#### Harness\n- endpointA:/);
  assert.match(result.after, /##### CAN Command Frames\n- definition: \[\[CAN Data\]\]\n- endpointA: exchange\n- endpointB: receive/);
  assert.equal(parseLocalModel(result.after)?.records.find((r) => r.localId === id)?.roleA, "exchange");
});

test("a connection cannot be given an unknown usage field", () => {
  assert.throws(
    () => planLocalRecordPatch(note(), "conn-" + tokenD, { fields: { usage: "variant" } }),
    /not a governed field|not valid/,
  );
});


test("creates a first governed region using importer-compatible section formatting", () => {
  const before = ["---", "type: Object", "---", "", "# Empty assembly", "", "Narrative."].join("\n");
  const id = "part-" + tokenA;
  const result = planLocalRecordCreate(before, {
    kind: "part",
    localId: id,
    heading: "K1",
    fields: { definition: "[[Main Contactor]]", identifier: "K1", usage: "standard" },
  });
  assert.match(result.after, /## Local Model\n<!-- MDSE:LOCAL-MODEL START schema=0\.2 -->/);
  assert.match(result.after, /### Part Occurrences\n\n#### K1\n- definition: \[\[Main Contactor\]\]\n- identifier: K1\n\^part-/);
  assert.doesNotMatch(result.after, /- usage: standard/);
  assert.equal(parseLocalModel(result.after)?.records.find((r) => r.localId === id)?.kind, "part");
});

test("creates a missing section in canonical order", () => {
  const id = "endpoint-" + tokenE;
  const endpointId = "ep-" + tokenE;
  const result = planLocalRecordCreate(note(), {
    kind: "endpoint",
    localId: endpointId,
    heading: "J2",
    fields: { definition: "[[CAN Port]]", part: "[[#^part-" + tokenA + "|K1]]" },
  });
  assert.ok(result.after.indexOf("### Local Interfaces") < result.after.indexOf("### Connections"));
  assert.equal(parseLocalModel(result.after)?.records.find((r) => r.localId === endpointId)?.kind, "endpoint");
  assert.ok(id.length > 0);
});

test("creates a flow under its addressed connection", () => {
  const id = "flow-" + tokenD;
  const result = planLocalRecordCreate(note(), {
    kind: "flow",
    localId: id,
    connectionId: "conn-" + tokenD,
    heading: "Status",
    fields: { definition: "[[Status Data]]", endpointA: "transmit", endpointB: "receive" },
  });
  const connectionPos = result.after.indexOf("#### Harness");
  const flowPos = result.after.indexOf("##### Status");
  const endPos = result.after.indexOf("<!-- MDSE:LOCAL-MODEL END -->");
  assert.ok(connectionPos < flowPos && flowPos < endPos);
  assert.equal(parseLocalModel(result.after)?.records.find((r) => r.localId === id)?.kind, "flow");
});

test("does not commandeer an ambiguous ungoverned Local Model heading", () => {
  const before = "# Note\n\n## Local Model\n\nNarrative only.";
  assert.throws(
    () => planLocalRecordCreate(before, {
      kind: "part",
      localId: "part-" + tokenA,
      heading: "K1",
      fields: { definition: "[[Main Contactor]]" },
    }),
    /ungoverned Local Model heading/,
  );
});


test("an atomic patch cannot remove a required definition", () => {
  assert.throws(
    () => planLocalRecordPatch(note(), "part-" + tokenA, { fields: { definition: null } }),
    /is invalid:.*no definition/i,
  );
});

test("a staged planner may represent temporary invalidity when explicitly requested", () => {
  const result=planLocalRecordPatch(
    note(),
    "part-" + tokenA,
    { fields: { definition: null } },
    { allowInvalidTarget: true },
  );
  assert.ok(result.findings.some((x)=>x.localId==="part-"+tokenA && x.code==="record.missing-definition"));
});


test("generates governed Local Model IDs from UTC timestamp and owner author suffix", () => {
  const id = nextLocalId("part", "20261003130000000skellyspencer", new Date("2026-10-04T23:30:45.123Z"));
  assert.equal(id, "part-20261004233045123skellyspencer");
});

test("refuses Local Model ID generation when the owner UID has no governed author suffix", () => {
  assert.throws(
    () => nextLocalId("part", "bad-owner-uid", new Date("2026-10-04T23:30:45.123Z")),
    /governed 30-character identity/,
  );
});


test("plans clean deletion of an unreferenced part occurrence", () => {
  const result = planLocalRecordDelete(note(), "part-" + tokenB);
  assert.equal(result.kind, "part");
  assert.equal(result.identifier, "K2");
  assert.equal(result.impacts.length, 0);
  assert.doesNotMatch(result.after, /#### K2/);
  assert.match(result.after, /#### K1/);
  assert.equal(parseLocalModel(result.after)?.structured, true);
});

test("part deletion reports same-note endpoint dependencies", () => {
  const result = planLocalRecordDelete(note(), "part-" + tokenA);
  assert.ok(result.impacts.some((impact) =>
    impact.sourceKind === "endpoint" &&
    impact.sourceIdentifier === "J1" &&
    impact.field === "part"
  ));
  assert.doesNotMatch(result.after, /#### K1/);
});

test("deletion slice refuses non-part Local Model records", () => {
  assert.throws(
    () => planLocalRecordDelete(note(), "ep-" + tokenC),
    /part occurrences only/,
  );
});
