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


test("creates an endpoint attached to an existing part occurrence", () => {
  const endpointId = "ep-20261004234700000skellyspencer";
  const result = planLocalRecordCreate(note(), {
    kind: "endpoint",
    localId: endpointId,
    heading: "J2",
    fields: {
      definition: "[[CAN Port]]",
      part: "[[#^part-" + tokenA + "|K1]]",
      kind: "physical",
      usage: "standard",
      multiplicity: "1",
    },
  });

  const endpoint = parseLocalModel(result.after)?.records.find((record) => record.localId === endpointId);
  assert.equal(endpoint?.kind, "endpoint");
  assert.equal(endpoint?.part?.blockId, "part-" + tokenA);
  assert.equal(endpoint?.part?.target, "");
  assert.equal(endpoint?.endpointKind, "physical");
  assert.equal(endpoint?.multiplicity, "1");
  assert.equal(endpoint?.usage, "standard");
  assert.equal(endpoint?.usageExplicit, false);
});

test("endpoint creation rejects a missing local part target through validation findings", () => {
  const endpointId = "ep-20261004234700001skellyspencer";
  const result = planLocalRecordCreate(note(), {
    kind: "endpoint",
    localId: endpointId,
    heading: "JX",
    fields: {
      definition: "[[CAN Port]]",
      part: "[[#^part-20261004234700099skellyspencer|Missing]]",
    },
  });
  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});


test("endpoint deletion reports connection endpoint dependencies", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordDelete(note(), endpointId);
  assert.equal(result.kind, "endpoint");
  assert.equal(result.identifier, "J1");
  assert.ok(result.impacts.some((impact) =>
    impact.sourceKind === "connection" &&
    impact.sourceIdentifier === "Harness" &&
    impact.field === "endpointA"
  ));
  assert.doesNotMatch(result.after, /#### J1/);
});

test("endpoint deletion reports parent exposes and equals dependencies", () => {
  const endpointA = "ep-20261004235500000skellyspencer";
  const endpointB = "ep-20261004235500001skellyspencer";
  const endpointC = "ep-20261004235500002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J-A",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J-B",
    "- definition: [[CAN Port]]",
    "- parent: [[#^" + endpointA + "|J-A]]",
    "^" + endpointB,
    "",
    "#### J-C",
    "- definition: [[CAN Port]]",
    "- exposes: [[#^" + endpointA + "|J-A]]",
    "- equals: [[#^" + endpointA + "|J-A]]",
    "^" + endpointC,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordDelete(text, endpointA);
  assert.ok(result.impacts.some((impact) => impact.sourceLocalId === endpointB && impact.field === "parent"));
  assert.ok(result.impacts.some((impact) => impact.sourceLocalId === endpointC && impact.field === "exposes"));
  assert.ok(result.impacts.some((impact) => impact.sourceLocalId === endpointC && impact.field === "equals"));
});

test("clean endpoint deletion is allowed when nothing targets the endpoint", () => {
  const endpointId = "ep-20261004235600000skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### Service Port",
    "- definition: [[CAN Port]]",
    "^" + endpointId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordDelete(text, endpointId);
  assert.equal(result.impacts.length, 0);
  assert.doesNotMatch(result.after, /#### Service Port/);
  assert.equal(parseLocalModel(result.after)?.structured, true);
});


test("creates a connection between two existing endpoint occurrences", () => {
  const endpointA = "ep-20261005000000000skellyspencer";
  const endpointB = "ep-20261005000000001skellyspencer";
  const connectionId = "conn-20261005000000002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordCreate(text, {
    kind: "connection",
    localId: connectionId,
    heading: "CAN Harness",
    fields: {
      endpointA: "[[#^" + endpointA + "|J1]]",
      endpointB: "[[#^" + endpointB + "|J2]]",
      definition: "[[CAN Harness]]",
    },
  });

  const connection = parseLocalModel(result.after)?.records.find((record) => record.localId === connectionId);
  assert.equal(connection?.kind, "connection");
  assert.equal(connection?.endpointA?.blockId, endpointA);
  assert.equal(connection?.endpointB?.blockId, endpointB);
  assert.equal(connection?.definition?.target, "CAN Harness");
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("connection creation surfaces a missing endpoint target as blocking validation", () => {
  const endpointA = "ep-20261005000100000skellyspencer";
  const connectionId = "conn-20261005000100002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordCreate(text, {
    kind: "connection",
    localId: connectionId,
    heading: "Broken Harness",
    fields: {
      endpointA: "[[#^" + endpointA + "|J1]]",
      endpointB: "[[#^ep-20261005000100099skellyspencer|Missing]]",
    },
  });

  assert.ok(result.findings.some((finding) =>
    finding.localId === connectionId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});


test("connection deletion reports child flow dependency", () => {
  const endpointA = "ep-20261005001000000skellyspencer";
  const endpointB = "ep-20261005001000001skellyspencer";
  const connectionId = "conn-20261005001000002skellyspencer";
  const flowId = "flow-20261005001000003skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "^" + connectionId,
    "##### Commands",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordDelete(text, connectionId);
  assert.equal(result.kind, "connection");
  assert.ok(result.impacts.some((impact) =>
    impact.sourceKind === "flow" &&
    impact.sourceLocalId === flowId &&
    impact.field === "connection"
  ));
});

test("clean connection deletion is allowed when it has no child flows or external impacts", () => {
  const endpointA = "ep-20261005001100000skellyspencer";
  const endpointB = "ep-20261005001100001skellyspencer";
  const connectionId = "conn-20261005001100002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordDelete(text, connectionId);
  assert.equal(result.impacts.length, 0);
  assert.doesNotMatch(result.after, /#### Harness/);
  assert.equal(parseLocalModel(result.after)?.structured, true);
});


test("creates a flow under the addressed connection with reviewed endpoint roles", () => {
  const connectionId = "conn-20261005002000000skellyspencer";
  const flowId = "flow-20261005002000001skellyspencer";
  const endpointA = "ep-20261005002000002skellyspencer";
  const endpointB = "ep-20261005002000003skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordCreate(text, {
    kind: "flow",
    localId: flowId,
    connectionId,
    heading: "Commands",
    fields: {
      definition: "[[CAN Data]]",
      endpointA: "transmit",
      endpointB: "receive",
    },
  });

  const flow = parseLocalModel(result.after)?.records.find((record) => record.localId === flowId);
  assert.equal(flow?.kind, "flow");
  assert.equal(flow?.connectionId, connectionId);
  assert.equal(flow?.roleA, "transmit");
  assert.equal(flow?.roleB, "receive");
  assert.equal(flow?.definition?.target, "CAN Data");
  assert.ok(result.after.indexOf("#### Harness") < result.after.indexOf("##### Commands"));
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("flow creation rejects a missing structural owner connection", () => {
  assert.throws(
    () => planLocalRecordCreate(note(), {
      kind: "flow",
      localId: "flow-20261005002100000skellyspencer",
      connectionId: "conn-20261005002100099skellyspencer",
      heading: "Commands",
      fields: { definition: "[[CAN Data]]", endpointA: "transmit", endpointB: "receive" },
    }),
    /parent connection .* does not exist/,
  );
});

test("flow creation requires a definition and both endpoint roles", () => {
  const connectionId = "conn-" + tokenD;
  assert.throws(
    () => planLocalRecordCreate(note(), {
      kind: "flow",
      localId: "flow-20261005002200000skellyspencer",
      connectionId,
      heading: "Commands",
      fields: { endpointA: "transmit", endpointB: "receive" },
    }),
    /requires a definition/,
  );
  assert.throws(
    () => planLocalRecordCreate(note(), {
      kind: "flow",
      localId: "flow-20261005002200001skellyspencer",
      connectionId,
      heading: "Commands",
      fields: { definition: "[[CAN Data]]", endpointA: "transmit" },
    }),
    /requires endpointA and endpointB roles/,
  );
});


test("clean flow deletion removes only the addressed flow and keeps its connection", () => {
  const connectionId = "conn-20261005003000000skellyspencer";
  const flowA = "flow-20261005003000001skellyspencer";
  const flowB = "flow-20261005003000002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^ep-20261005003000010skellyspencer|J1]]",
    "- endpointB: [[#^ep-20261005003000011skellyspencer|J2]]",
    "^" + connectionId,
    "##### Commands",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowA,
    "",
    "##### Status",
    "- definition: [[CAN Data]]",
    "- endpointA: receive",
    "- endpointB: transmit",
    "^" + flowB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordDelete(text, flowA);
  assert.equal(result.kind, "flow");
  assert.equal(result.impacts.length, 0);
  assert.doesNotMatch(result.after, /##### Commands/);
  assert.match(result.after, /#### Harness/);
  assert.match(result.after, /##### Status/);
  assert.equal(parseLocalModel(result.after)?.records.find((record) => record.localId === flowB)?.connectionId, connectionId);
});

test("flow deletion still reports local block references when present", () => {
  const flowId = "flow-20261005003100000skellyspencer";
  const noteText = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^ep-20261005003100010skellyspencer|J1]]",
    "- endpointB: [[#^ep-20261005003100011skellyspencer|J2]]",
    "^conn-20261005003100020skellyspencer",
    "##### Commands",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowId,
    "",
    "##### Derived",
    "- definition: [[CAN Data]]",
    "- endpointA: [[#^" + flowId + "|Commands]]",
    "- endpointB: receive",
    "^flow-20261005003100001skellyspencer",
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordDelete(noteText, flowId);
  assert.ok(result.impacts.some((impact) =>
    impact.sourceKind === "flow" &&
    impact.field === "endpointA"
  ));
});


test("plans endpoint part reassignment without changing endpoint identity", () => {
  const endpointId = "ep-" + tokenC;
  const targetPartId = "part-" + tokenB;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { part: "[[#^" + targetPartId + "|K2]]" } },
    { allowInvalidTarget: true },
  );

  const endpoint = parseLocalModel(result.after)?.records.find((record) => record.localId === endpointId);
  assert.equal(endpoint?.kind, "endpoint");
  assert.equal(endpoint?.localId, endpointId);
  assert.equal(endpoint?.part?.blockId, targetPartId);
  assert.equal(endpoint?.part?.target, "");
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("endpoint part reassignment surfaces a missing target as blocking validation", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { part: "[[#^part-20261005004000099skellyspencer|Missing]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});


test("plans endpoint parent reassignment by clearing direct part ownership", () => {
  const endpointId = "ep-20261005005000002skellyspencer";
  const parentId = "ep-20261005005000003skellyspencer";
  const partId = "part-20261005005000000skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Part Occurrences",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partId,
    "",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + endpointId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + parentId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    endpointId,
    { fields: { part: null, parent: "[[#^" + parentId + "|J2]]" } },
    { allowInvalidTarget: true },
  );

  const endpoint = parseLocalModel(result.after)?.records.find((record) => record.localId === endpointId);
  assert.equal(endpoint?.localId, endpointId);
  assert.equal(endpoint?.part, null);
  assert.equal(endpoint?.parent?.blockId, parentId);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("plans clearing an endpoint parent while preserving other endpoint topology", () => {
  const endpointId = "ep-20261005005100002skellyspencer";
  const parentId = "ep-20261005005100003skellyspencer";
  const exposedId = "ep-20261005005100004skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- parent: [[#^" + parentId + "|J2]]",
    "- exposes: [[#^" + exposedId + "|J3]]",
    "^" + endpointId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + parentId,
    "",
    "#### J3",
    "- definition: [[CAN Port]]",
    "^" + exposedId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    endpointId,
    { fields: { parent: null } },
    { allowInvalidTarget: true },
  );

  const endpoint = parseLocalModel(result.after)?.records.find((record) => record.localId === endpointId);
  assert.equal(endpoint?.parent, null);
  assert.equal(endpoint?.exposes[0]?.blockId, exposedId);
});

test("endpoint parent reassignment surfaces a missing target as blocking validation", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { parent: "[[#^ep-20261005005200099skellyspencer|Missing]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});


test("plans adding one endpoint exposure while preserving existing exposure links", () => {
  const sourceId = "ep-20261005007000000skellyspencer";
  const existingId = "ep-20261005007000001skellyspencer";
  const addId = "ep-20261005007000002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- exposes: [[#^" + existingId + "|J1]] [[External#^ep-20261005007000009skellyspencer|Remote]]",
    "^" + sourceId,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + existingId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + addId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    sourceId,
    { fields: { exposes: "[[#^" + existingId + "|J1]] [[External#^ep-20261005007000009skellyspencer|Remote]] [[#^" + addId + "|J2]]" } },
    { allowInvalidTarget: true },
  );

  const source = parseLocalModel(result.after)?.records.find((record) => record.localId === sourceId);
  assert.deepEqual(source?.exposes.map((link) => [link.target, link.blockId]), [
    ["", existingId],
    ["External", "ep-20261005007000009skellyspencer"],
    ["", addId],
  ]);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("plans removing one endpoint exposure without changing other exposures", () => {
  const sourceId = "ep-20261005007100000skellyspencer";
  const removeId = "ep-20261005007100001skellyspencer";
  const keepId = "ep-20261005007100002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- exposes: [[#^" + removeId + "|J1]] [[#^" + keepId + "|J2]]",
    "^" + sourceId,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + removeId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + keepId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    sourceId,
    { fields: { exposes: "[[#^" + keepId + "|J2]]" } },
    { allowInvalidTarget: true },
  );

  const source = parseLocalModel(result.after)?.records.find((record) => record.localId === sourceId);
  assert.deepEqual(source?.exposes.map((link) => link.blockId), [keepId]);
});

test("endpoint exposes edit surfaces a missing same-note target as blocking validation", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { exposes: "[[#^ep-20261005007200099skellyspencer|Missing]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});


test("plans adding one endpoint equals target while preserving existing equals links", () => {
  const sourceId = "ep-20261005009000000skellyspencer";
  const existingId = "ep-20261005009000001skellyspencer";
  const addId = "ep-20261005009000002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- equals: [[#^" + existingId + "|J1]] [[External#^ep-20261005009000009skellyspencer|Remote]]",
    "^" + sourceId,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + existingId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + addId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    sourceId,
    { fields: { equals: "[[#^" + existingId + "|J1]] [[External#^ep-20261005009000009skellyspencer|Remote]] [[#^" + addId + "|J2]]" } },
    { allowInvalidTarget: true },
  );

  const source = parseLocalModel(result.after)?.records.find((record) => record.localId === sourceId);
  assert.deepEqual(source?.equals.map((link) => [link.target, link.blockId]), [
    ["", existingId],
    ["External", "ep-20261005009000009skellyspencer"],
    ["", addId],
  ]);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("plans removing one endpoint equals target without changing the others", () => {
  const sourceId = "ep-20261005009100000skellyspencer";
  const removeId = "ep-20261005009100001skellyspencer";
  const keepId = "ep-20261005009100002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
    "### Local Interfaces",
    "#### Boundary",
    "- definition: [[CAN Port]]",
    "- equals: [[#^" + removeId + "|J1]] [[#^" + keepId + "|J2]]",
    "^" + sourceId,
    "",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + removeId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + keepId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    sourceId,
    { fields: { equals: "[[#^" + keepId + "|J2]]" } },
    { allowInvalidTarget: true },
  );

  const source = parseLocalModel(result.after)?.records.find((record) => record.localId === sourceId);
  assert.deepEqual(source?.equals.map((link) => link.blockId), [keepId]);
});

test("endpoint equals edit surfaces a missing same-note target as blocking validation", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { equals: "[[#^ep-20261005009200099skellyspencer|Missing]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});
