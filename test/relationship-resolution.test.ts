import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import { fixtureSchema } from "./helpers";

const schema = fixtureSchema();

test("authored relationship evidence re-resolves note targets without body reads", () => {
  const authored = [
    { field: "dependsOn", link: "Target", linkpath: "Target" },
    { field: "dependsOn", link: "Target", linkpath: "Target" },
    { field: "appliesTo", link: "Assembly#^ep-20261003190000001skellyspencer|CAN", linkpath: "Assembly" },
    { field: "dependsOn", link: "Missing", linkpath: "Missing" },
  ];
  const paths = new Map([
    ["Target", "Folder/Target.md"],
    ["Assembly", "Assembly.md"],
  ]);
  const r = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, (linkpath) => paths.get(linkpath));

  assert.deepEqual([...r.fields.entries()], [["dependsOn", ["Folder/Target.md"]]]);
  assert.equal(r.repeat?.get("dependsOn|Folder/Target.md"), 2);
  assert.equal(r.unresolved, 1);
  assert.deepEqual(r.broken, [{ field: "dependsOn", link: "Missing" }]);
  assert.deepEqual(r.localRefs, [{
    field: "appliesTo",
    path: "Assembly.md",
    localId: "ep-20261003190000001skellyspencer",
  }]);
});

test("same authored evidence can resolve differently after path-set changes", () => {
  const authored = [{ field: "dependsOn", link: "Controller", linkpath: "Controller" }];
  const before = resolveAuthoredRelationshipLinks(authored, "A/Source.md", schema, () => "A/Controller.md");
  const after = resolveAuthoredRelationshipLinks(authored, "A/Source.md", schema, () => "B/Controller.md");

  assert.deepEqual(before.fields.get("dependsOn"), ["A/Controller.md"]);
  assert.deepEqual(after.fields.get("dependsOn"), ["B/Controller.md"]);
});

test("unknown/nonrelationship authored fields are ignored defensively", () => {
  const r = resolveAuthoredRelationshipLinks(
    [{ field: "notARelationship", link: "X", linkpath: "X" }],
    "Source.md",
    schema,
    () => "X.md",
  );
  assert.equal(r.fields.size, 0);
  assert.equal(r.unresolved, 0);
  assert.deepEqual(r.broken, []);
});
