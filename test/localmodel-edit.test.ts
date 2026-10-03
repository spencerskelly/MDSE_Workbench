import assert from "node:assert/strict";
import test from "node:test";
import { planLocalRecordPatch } from "../src/core/localmodel-edit";
import { parseLocalModel } from "../src/core/localmodel";

const tokenA = "20261003133512742skellyspencer";
const tokenB = "20261003133512743skellyspencer";
const tokenC = "20261003133512744skellyspencer";
const tokenD = "20261003133512745skellyspencer";

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
  assert.equal((result.after.match(new RegExp(id, "g")) ?? []).length, 1);
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
