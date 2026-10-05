import assert from "node:assert/strict";
import test from "node:test";
import { definitionTypeForLocalKind, planDefinitionCreation } from "../src/core/definition-create";

const uid = "20261005052400000skellyspencer";

test("definition creation maps occurrence kinds to governed reusable-definition classes", () => {
  assert.equal(definitionTypeForLocalKind("part"), "Object");
  assert.equal(definitionTypeForLocalKind("endpoint"), "Port");
  assert.equal(definitionTypeForLocalKind("flow"), "Item Flow");
  assert.equal(definitionTypeForLocalKind("connection"), null);
});

test("definition creation renders canonical sparse Markdown without inventing relationships", () => {
  const plan = planDefinitionCreation({
    localKind: "endpoint",
    name: "  CAN Service Port  ",
    uid,
    path: "40_Interfaces/CAN Service Port.md",
  });

  assert.equal(plan.type, "Port");
  assert.equal(plan.name, "CAN Service Port");
  assert.equal(plan.path, "40_Interfaces/CAN Service Port.md");
  assert.equal(
    plan.text,
    [
      "---",
      "type: Port",
      "uid: " + uid,
      "---",
      "",
      "# CAN Service Port",
      "",
    ].join("\n"),
  );
  assert.doesNotMatch(plan.text, /partOf|hasPart|subtypeOf|definition:/);
});

test("definition creation refuses kinds without a governed reusable-definition class", () => {
  assert.throws(
    () => planDefinitionCreation({
      localKind: "connection",
      name: "Harness",
      uid,
      path: "Harness.md",
    }),
    /do not have a governed reusable-definition class/,
  );
});

test("definition creation requires governed durable identity and a Markdown destination", () => {
  assert.throws(
    () => planDefinitionCreation({ localKind: "part", name: "Contactor", uid: "short", path: "Contactor.md" }),
    /30-character/,
  );
  assert.throws(
    () => planDefinitionCreation({ localKind: "part", name: "Contactor", uid, path: "Contactor" }),
    /Markdown file path/,
  );
  assert.throws(
    () => planDefinitionCreation({ localKind: "part", name: "   ", uid, path: "Contactor.md" }),
    /name is required/,
  );
});
