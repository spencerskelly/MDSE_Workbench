import assert from "node:assert/strict";
import test from "node:test";
import { nextAvailableLocalId, nextLocalId, planLocalFlowMove, planLocalRecordCreate, planLocalRecordDelete, planLocalRecordPatch } from "../src/core/localmodel-edit";
import { parseLocalModel } from "../src/core/localmodel";

const tokenA = "20261003133512742skellyspencer";
const tokenB = "20261003133512743skellyspencer";
const tokenC = "20261003133512744skellyspencer";
const tokenD = "20261003133512745skellyspencer";
const tokenE = "20261003133512746skellyspencer";

function note(version = "0.4"): string {
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
    "### Parts",
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
    "### Interfaces",
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
  const block = result.after.slice(result.after.indexOf("#### K2"), result.after.indexOf("### Interfaces"));
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
  assert.match(result.after, /## Local Model\n<!-- MDSE:LOCAL-MODEL START schema=0\.4 -->/);
  assert.match(result.after, /### Parts\n\n#### K1\n- definition: \[\[Main Contactor\]\]\n- identifier: K1\n\^part-/);
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
  assert.ok(result.after.indexOf("### Interfaces") < result.after.indexOf("### Connections"));
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


test("retries Local Model ID collisions by +1 ms until unique", () => {
  const ownerUid = "20261003130000000skellyspencer";
  const now = new Date("2026-10-04T23:30:45.123Z");
  const first = nextLocalId("part", ownerUid, now);
  const second = nextLocalId("part", ownerUid, new Date(now.getTime() + 1));
  const third = nextLocalId("part", ownerUid, new Date(now.getTime() + 2));

  assert.equal(
    nextAvailableLocalId("part", ownerUid, new Set([first, second]), now),
    third,
  );
});

test("collision retry preserves governed prefixes for every Local Model kind", () => {
  const ownerUid = "20261003130000000skellyspencer";
  const now = new Date("2026-10-04T23:30:45.123Z");
  for (const kind of ["part", "endpoint", "connection", "flow"] as const) {
    const first = nextLocalId(kind, ownerUid, now);
    const expected = nextLocalId(kind, ownerUid, new Date(now.getTime() + 1));
    const actual = nextAvailableLocalId(kind, ownerUid, [first], now);
    assert.equal(actual, expected);
  }
});

test("collision retry treats IDs from other Local Model kinds as non-colliding", () => {
  const ownerUid = "20261003130000000skellyspencer";
  const now = new Date("2026-10-04T23:30:45.123Z");
  const endpointAtSameMillisecond = nextLocalId("endpoint", ownerUid, now);
  const partAtSameMillisecond = nextLocalId("part", ownerUid, now);

  assert.equal(
    nextAvailableLocalId("part", ownerUid, [endpointAtSameMillisecond], now),
    partAtSameMillisecond,
  );
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partId,
    "",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- parent: [[#^" + parentId + "|J2]]",
    "- equals: [[#^" + exposedId + "|J3]]",
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
  assert.equal(endpoint?.equals[0]?.blockId, exposedId);
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


test("plans adding one Connection exposure while preserving existing exposure links", () => {
  const endpointA = "ep-20261005007000000skellyspencer";
  const endpointB = "ep-20261005007000001skellyspencer";
  const existingId = "ep-20261005007000002skellyspencer";
  const addId = "ep-20261005007000003skellyspencer";
  const connectionId = "conn-20261005007000004skellyspencer";
  const text = [
    "---", "type: Object", "uid: 20261003130000000skellyspencer", "---", "", "# Assembly", "",
    "## Local Model", "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
    "#### J1", "^" + endpointA, "",
    "#### J2", "^" + endpointB, "",
    "#### Boundary A", "^" + existingId, "",
    "#### Boundary B", "^" + addId, "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "- exposes: [[#^" + existingId + "|Boundary A]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    connectionId,
    { fields: { exposes: "[[#^" + existingId + "|Boundary A]] [[#^" + addId + "|Boundary B]]" } },
    { allowInvalidTarget: true },
  );

  const connection = parseLocalModel(result.after)?.records.find((record) => record.localId === connectionId);
  assert.deepEqual(connection?.exposes.map((link) => link.blockId), [existingId, addId]);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("plans removing one Connection exposure without changing the remaining exposure", () => {
  const endpointA = "ep-20261005007100000skellyspencer";
  const endpointB = "ep-20261005007100001skellyspencer";
  const removeId = "ep-20261005007100002skellyspencer";
  const keepId = "ep-20261005007100003skellyspencer";
  const connectionId = "conn-20261005007100004skellyspencer";
  const text = [
    "---", "type: Object", "uid: 20261003130000000skellyspencer", "---", "", "# Assembly", "",
    "## Local Model", "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
    "#### J1", "^" + endpointA, "",
    "#### J2", "^" + endpointB, "",
    "#### Boundary A", "^" + removeId, "",
    "#### Boundary B", "^" + keepId, "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointA + "|J1]]",
    "- endpointB: [[#^" + endpointB + "|J2]]",
    "- exposes: [[#^" + removeId + "|Boundary A]] [[#^" + keepId + "|Boundary B]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    connectionId,
    { fields: { exposes: "[[#^" + keepId + "|Boundary B]]" } },
    { allowInvalidTarget: true },
  );

  const connection = parseLocalModel(result.after)?.records.find((record) => record.localId === connectionId);
  assert.deepEqual(connection?.exposes.map((link) => link.blockId), [keepId]);
});

test("Connection exposes edit surfaces a missing same-note target as blocking validation", () => {
  const connectionId = "conn-" + tokenD;
  const result = planLocalRecordPatch(
    note(),
    connectionId,
    { fields: { exposes: "[[#^ep-20261005007200099skellyspencer|Missing]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === connectionId &&
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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


test("plans rewiring one connection endpoint while preserving the opposite end and child flow", () => {
  const endpointA = "ep-20261005011000000skellyspencer";
  const endpointB = "ep-20261005011000001skellyspencer";
  const endpointC = "ep-20261005011000002skellyspencer";
  const connectionId = "conn-20261005011000003skellyspencer";
  const flowId = "flow-20261005011000004skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "^" + endpointA,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + endpointB,
    "",
    "#### J3",
    "- definition: [[CAN Port]]",
    "^" + endpointC,
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

  const result = planLocalRecordPatch(
    text,
    connectionId,
    { fields: { endpointA: "[[#^" + endpointC + "|J3]]" } },
    { allowInvalidTarget: true },
  );

  const region = parseLocalModel(result.after);
  const connection = region?.records.find((record) => record.localId === connectionId);
  const flow = region?.records.find((record) => record.localId === flowId);
  assert.equal(connection?.endpointA?.blockId, endpointC);
  assert.equal(connection?.endpointB?.blockId, endpointB);
  assert.equal(flow?.connectionId, connectionId);
  assert.equal(flow?.roleA, "transmit");
  assert.equal(flow?.roleB, "receive");
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("connection endpoint rewire surfaces a missing endpoint as blocking validation", () => {
  const connectionId = "conn-" + tokenD;
  const result = planLocalRecordPatch(
    note(),
    connectionId,
    { fields: { endpointA: "[[#^ep-20261005011100099skellyspencer|Missing]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === connectionId &&
    finding.code === "ref.local-missing" &&
    finding.severity === "error"
  ));
});

test("connection endpoint rewire rejects a non-endpoint local target", () => {
  const connectionId = "conn-" + tokenD;
  const result = planLocalRecordPatch(
    note(),
    connectionId,
    { fields: { endpointA: "[[#^part-" + tokenA + "|P1]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === connectionId &&
    finding.code === "ref.local-kind" &&
    finding.severity === "error"
  ));
});


test("plans connection definition change while preserving endpoints and child flow", () => {
  const endpointA = "ep-20261005013000000skellyspencer";
  const endpointB = "ep-20261005013000001skellyspencer";
  const connectionId = "conn-20261005013000002skellyspencer";
  const flowId = "flow-20261005013000003skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "- definition: [[Old Bus]]",
    "^" + connectionId,
    "##### Commands",
    "- definition: [[CAN Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    connectionId,
    { fields: { definition: "[[New Bus]]" } },
    { allowInvalidTarget: true },
  );

  const region = parseLocalModel(result.after);
  const connection = region?.records.find((record) => record.localId === connectionId);
  const flow = region?.records.find((record) => record.localId === flowId);
  assert.equal(connection?.definition?.target, "New Bus");
  assert.equal(connection?.endpointA?.blockId, endpointA);
  assert.equal(connection?.endpointB?.blockId, endpointB);
  assert.equal(flow?.connectionId, connectionId);
  assert.equal(flow?.roleA, "transmit");
  assert.equal(flow?.roleB, "receive");
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("plans clearing an optional connection definition without changing topology", () => {
  const connectionId = "conn-" + tokenD;
  const result = planLocalRecordPatch(
    note(),
    connectionId,
    { fields: { definition: null } },
    { allowInvalidTarget: true },
  );

  const connection = parseLocalModel(result.after)?.records.find((record) => record.localId === connectionId);
  assert.equal(connection?.definition, null);
  assert.ok(connection?.endpointA);
  assert.ok(connection?.endpointB);
});

test("connection definition edit rejects a block-fragment definition", () => {
  const connectionId = "conn-" + tokenD;
  const result = planLocalRecordPatch(
    note(),
    connectionId,
    { fields: { definition: "[[Some Note#^ep-" + tokenC + "|Bad]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === connectionId &&
    finding.code === "definition.incompatible" &&
    finding.severity === "error"
  ));
});


test("plans part definition change while preserving attached endpoint topology", () => {
  const partId = "part-20261005014000000skellyspencer";
  const endpointId = "ep-20261005014000001skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Old Contactor]]",
    "- usage: option",
    "- multiplicity: 2",
    "^" + partId,
    "",
    "### Interfaces",
    "#### J1",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + endpointId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    partId,
    { fields: { definition: "[[New Contactor]]" } },
    { allowInvalidTarget: true },
  );

  const region = parseLocalModel(result.after);
  const part = region?.records.find((record) => record.localId === partId);
  const endpoint = region?.records.find((record) => record.localId === endpointId);
  assert.equal(part?.definition?.target, "New Contactor");
  assert.equal(part?.usage, "option");
  assert.equal(part?.multiplicity, "2");
  assert.equal(endpoint?.part?.blockId, partId);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("part definition cannot be cleared because the definition is required", () => {
  const partId = "part-" + tokenA;
  const result = planLocalRecordPatch(
    note(),
    partId,
    { fields: { definition: null } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === partId &&
    finding.code === "record.missing-definition" &&
    finding.severity === "error"
  ));
});

test("part definition edit rejects a block-fragment definition", () => {
  const partId = "part-" + tokenA;
  const result = planLocalRecordPatch(
    note(),
    partId,
    { fields: { definition: "[[Some Note#^ep-" + tokenC + "|Bad]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === partId &&
    finding.code === "definition.incompatible" &&
    finding.severity === "error"
  ));
});


test("plans endpoint definition change while preserving endpoint topology and connection references", () => {
  const partId = "part-20261005016000000skellyspencer";
  const endpointId = "ep-20261005016000001skellyspencer";
  const peerId = "ep-20261005016000002skellyspencer";
  const exposureId = "ep-20261005016000003skellyspencer";
  const equalsId = "ep-20261005016000004skellyspencer";
  const connectionId = "conn-20261005016000005skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Contactor]]",
    "^" + partId,
    "",
    "### Interfaces",
    "#### J1",
    "- definition: [[Old Port]]",
    "- usage: option",
    "- multiplicity: 2",
    "- part: [[#^" + partId + "|K1]]",
    "- equals: [[#^" + equalsId + "|J4]]",
    "^" + endpointId,
    "",
    "#### J2",
    "- definition: [[CAN Port]]",
    "^" + peerId,
    "",
    "#### J3",
    "- definition: [[CAN Port]]",
    "^" + exposureId,
    "",
    "#### J4",
    "- definition: [[CAN Port]]",
    "^" + equalsId,
    "",
    "### Connections",
    "#### Harness",
    "- endpointA: [[#^" + endpointId + "|J1]]",
    "- endpointB: [[#^" + peerId + "|J2]]",
    "- exposes: [[#^" + exposureId + "|J3]]",
    "^" + connectionId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    endpointId,
    { fields: { definition: "[[New Port]]" } },
    { allowInvalidTarget: true },
  );

  const region = parseLocalModel(result.after);
  const endpoint = region?.records.find((record) => record.localId === endpointId);
  const connection = region?.records.find((record) => record.localId === connectionId);
  assert.equal(endpoint?.definition?.target, "New Port");
  assert.equal(endpoint?.usage, "option");
  assert.equal(endpoint?.multiplicity, "2");
  assert.equal(endpoint?.part?.blockId, partId);
  assert.equal(endpoint?.equals[0]?.blockId, equalsId);
  assert.equal(connection?.exposes[0]?.blockId, exposureId);
  assert.equal(connection?.endpointA?.blockId, endpointId);
  assert.equal(connection?.endpointB?.blockId, peerId);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("0.4 Interface definition may be cleared when usage is not set", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { definition: null } },
    { allowInvalidTarget: true },
  );

  const endpoint = parseLocalModel(result.after)?.records.find((record) => record.localId === endpointId);
  assert.equal(endpoint?.definition, null);
  assert.ok(!result.findings.some((finding) =>
    finding.localId === endpointId && finding.code === "record.missing-definition"
  ));
});

test("0.4 Interface with usage still requires a definition", () => {
  const endpointId = "ep-" + tokenC;
  const withUsage = planLocalRecordPatch(note(), endpointId, { fields: { usage: "option" } }).after;
  const result = planLocalRecordPatch(
    withUsage,
    endpointId,
    { fields: { definition: null } },
    { allowInvalidTarget: true },
  );
  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "record.missing-definition" &&
    finding.severity === "error"
  ));
});

test("endpoint definition edit rejects a block-fragment definition", () => {
  const endpointId = "ep-" + tokenC;
  const result = planLocalRecordPatch(
    note(),
    endpointId,
    { fields: { definition: "[[Some Note#^ep-" + tokenC + "|Bad]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === endpointId &&
    finding.code === "definition.incompatible" &&
    finding.severity === "error"
  ));
});


test("plans flow definition change while preserving owning connection and endpoint roles", () => {
  const endpointA = "ep-20261005018000000skellyspencer";
  const endpointB = "ep-20261005018000001skellyspencer";
  const connectionId = "conn-20261005018000002skellyspencer";
  const flowId = "flow-20261005018000003skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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
    "- definition: [[Old Data]]",
    "- endpointA: transmit",
    "- endpointB: receive",
    "^" + flowId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    flowId,
    { fields: { definition: "[[New Data]]" } },
    { allowInvalidTarget: true },
  );

  const flow = parseLocalModel(result.after)?.records.find((record) => record.localId === flowId);
  assert.equal(flow?.definition?.target, "New Data");
  assert.equal(flow?.connectionId, connectionId);
  assert.equal(flow?.roleA, "transmit");
  assert.equal(flow?.roleB, "receive");
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("flow definition cannot be cleared because the definition is required", () => {
  const flowId = "flow-" + tokenB;
  const result = planLocalRecordPatch(
    note(),
    flowId,
    { fields: { definition: null } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === flowId &&
    finding.code === "record.missing-definition" &&
    finding.severity === "error"
  ));
});

test("flow definition edit rejects a block-fragment definition", () => {
  const flowId = "flow-" + tokenB;
  const result = planLocalRecordPatch(
    note(),
    flowId,
    { fields: { definition: "[[Some Note#^ep-" + tokenC + "|Bad]]" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === flowId &&
    finding.code === "definition.incompatible" &&
    finding.severity === "error"
  ));
});


test("plans endpoint part assignment by clearing an existing parent in the same patch", () => {
  const partId = "part-20261005022000000skellyspencer";
  const parentId = "ep-20261005022000001skellyspencer";
  const endpointId = "ep-20261005022000002skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Parts",
    "#### K1",
    "- definition: [[Main Contactor]]",
    "^" + partId,
    "",
    "### Interfaces",
    "#### Parent",
    "- definition: [[CAN Port]]",
    "- part: [[#^" + partId + "|K1]]",
    "^" + parentId,
    "",
    "#### Child",
    "- definition: [[CAN Port]]",
    "- parent: [[#^" + parentId + "|Parent]]",
    "^" + endpointId,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalRecordPatch(
    text,
    endpointId,
    {
      fields: {
        part: "[[#^" + partId + "|K1]]",
        parent: null,
      },
    },
    { allowInvalidTarget: true },
  );

  const endpoint = parseLocalModel(result.after)?.records.find((record) => record.localId === endpointId);
  assert.equal(endpoint?.part?.blockId, partId);
  assert.equal(endpoint?.parent, null);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});


test("plans flow endpoint-role change while preserving definition and owning connection", () => {
  const endpointA = "ep-20261005023000000skellyspencer";
  const endpointB = "ep-20261005023000001skellyspencer";
  const connectionId = "conn-20261005023000002skellyspencer";
  const flowId = "flow-20261005023000003skellyspencer";
  const text = [
    "---",
    "type: Object",
    "uid: 20261003130000000skellyspencer",
    "---",
    "",
    "# Assembly",
    "",
    "## Local Model",
    "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
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

  const result = planLocalRecordPatch(
    text,
    flowId,
    { fields: { endpointA: "exchange", endpointB: "unspecified" } },
    { allowInvalidTarget: true },
  );

  const flow = parseLocalModel(result.after)?.records.find((record) => record.localId === flowId);
  assert.equal(flow?.roleA, "exchange");
  assert.equal(flow?.roleB, "unspecified");
  assert.equal(flow?.definition?.target, "CAN Data");
  assert.equal(flow?.connectionId, connectionId);
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
});

test("flow endpoint-role edit rejects values outside the governed role set", () => {
  const flowId = "flow-" + tokenB;
  const result = planLocalRecordPatch(
    note(),
    flowId,
    { fields: { endpointA: "source", endpointB: "receive" } },
    { allowInvalidTarget: true },
  );

  assert.ok(result.findings.some((finding) =>
    finding.localId === flowId &&
    finding.code === "ref.flow-role-invalid" &&
    finding.severity === "error"
  ));
});


test("moves a flow between existing connections while preserving flow identity and fields", () => {
  const endpointA = "ep-20261005024000000skellyspencer";
  const endpointB = "ep-20261005024000001skellyspencer";
  const connectionA = "conn-20261005024000002skellyspencer";
  const connectionB = "conn-20261005024000003skellyspencer";
  const flowId = "flow-20261005024000004skellyspencer";
  const text = [
    "---", "type: Object", "uid: 20261003130000000skellyspencer", "---", "", "# Assembly", "",
    "## Local Model", "<!-- MDSE:LOCAL-MODEL START schema=0.4 -->",
    "### Interfaces",
    "#### J1", "- definition: [[CAN Port]]", "^" + endpointA, "",
    "#### J2", "- definition: [[CAN Port]]", "^" + endpointB, "",
    "### Connections",
    "#### Primary", "- endpointA: [[#^" + endpointA + "|J1]]", "- endpointB: [[#^" + endpointB + "|J2]]", "^" + connectionA,
    "##### Commands", "- definition: [[CAN Data]]", "- endpointA: transmit", "- endpointB: receive", "^" + flowId, "",
    "#### Backup", "- endpointA: [[#^" + endpointA + "|J1]]", "- endpointB: [[#^" + endpointB + "|J2]]", "^" + connectionB,
    "<!-- MDSE:LOCAL-MODEL END -->",
  ].join("\n");

  const result = planLocalFlowMove(text, flowId, connectionB);
  const moved = parseLocalModel(result.after)?.records.find((record) => record.localId === flowId);
  assert.equal(moved?.connectionId, connectionB);
  assert.equal(moved?.definition?.target, "CAN Data");
  assert.equal(moved?.roleA, "transmit");
  assert.equal(moved?.roleB, "receive");
  assert.equal(result.findings.filter((finding) => finding.severity === "error").length, 0);
  assert.ok(result.after.indexOf("^" + connectionB) < result.after.indexOf("^" + flowId));
});

test("flow move refuses a missing target connection", () => {
  const flowId = "flow-" + tokenB;
  assert.throws(
    () => planLocalFlowMove(note(), flowId, "conn-20261005024000099skellyspencer"),
    /Target connection .* does not exist/,
  );
});


test("older Local Model regions remain read-only for structured mutation", () => {
  const legacy = note().replace("schema=0.4", "schema=0.3").replace("### Parts", "### Part Occurrences").replace("### Interfaces", "### Local Interfaces");
  assert.throws(
    () => planLocalRecordPatch(legacy, "part-" + tokenA, { heading: "Renamed" }),
    /read-only.*schema 0\.4/i,
  );
});
