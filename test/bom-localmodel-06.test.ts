import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalModel } from "../src/core/localmodel";

const token = "20260911143227001skellyspencer";
function part(schema: string, lines: string[]) {
  const section = ["0.6", "0.5", "0.4"].includes(schema) ? "Parts" : "Part Occurrences";
  return ["## Local Model", `<!-- MDSE:LOCAL-MODEL START schema=${schema} -->`,
    `### ${section}`, "#### Wire", "- definition: [[Wire]]", ...lines, `^part-${token}`,
    "<!-- MDSE:LOCAL-MODEL END -->"].join("\n");
}
function run(version: string, fields: string[]) {
  const parsed = parseLocalModel(part(version, fields));
  assert.ok(parsed);
  return parsed!;
}
function issue(version: string, fields: string[], code: string) {
  assert.ok(run(version, fields).findings.some(f => f.code === code), code);
}

test("0.6 quantity/UOM are read as exact strings; writer remains 0.5", async () => {
  const mod = await import("../src/core/localmodel");
  assert.equal(mod.WRITABLE_VERSION, "0.5");
  const p = run("0.6", ["- multiplicity: 2", "- quantity: 0.3500000001", "- unitOfMeasure: m"]);
  assert.deepEqual(p.findings, []);
  assert.equal(p.records[0].quantity, "0.3500000001");
  assert.equal(p.records[0].unitOfMeasure, "m");
  assert.equal(p.records[0].multiplicity, "2");
});
test("0.6 missing pairs and invalid values", () => {
  issue("0.6", ["- quantity: 0.5"], "part.unit-required");
  issue("0.6", ["- unitOfMeasure: m"], "part.quantity-required");
  for (const q of ["0", "-1", "1e3", "NaN", "0.0", "+1"]) {
    issue("0.6", [`- quantity: ${q}`, "- unitOfMeasure: m"], "part.quantity-invalid");
  }
  issue("0.6", ["- quantity: 1", "- unitOfMeasure: furlongs"], "part.unit-unknown");
  issue("0.6", ["- multiplicity: 3", "- quantity: 2", "- unitOfMeasure: ea"], "part.ea-double-count");
});
test("0.5 legacy rejects added units; 0.6 retains normal Parts semantics", () => {
  issue("0.5", ["- quantity: 0.5", "- unitOfMeasure: m"], "record.unknown-field");
  assert.deepEqual(run("0.5", ["- multiplicity: 2"]).findings, []);
  assert.deepEqual(run("0.6", ["- multiplicity: 2"]).findings, []);
});

test("0.6 explicitly empty values fail rather than being treated as omissions", () => {
  issue("0.6", ["- quantity: ", "- unitOfMeasure: m"], "part.quantity-invalid");
  issue("0.6", ["- quantity: 0.5", "- unitOfMeasure: "], "part.unit-required");
});
test("0.1 through 0.5 preserve their existing part interpretation", () => {
  for (const version of ["0.1", "0.2", "0.3", "0.4", "0.5"]) {
    const result = run(version, ["- multiplicity: 2"]);
    assert.equal(result.structured, true);
    assert.equal(result.records[0].multiplicity, "2");
    assert.equal(result.records[0].quantity, null);
    assert.equal(result.records[0].unitOfMeasure, null);
  }
});
