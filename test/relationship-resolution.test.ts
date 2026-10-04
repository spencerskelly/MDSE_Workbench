import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import { planReconciliation, type FileFingerprint } from "../src/core/cache";
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


const fp = (n: number): FileFingerprint => ({ ctime: n, mtime: n, size: n });

test("warm path-set add re-resolves previously broken authored links instead of retaining unresolved cache state", () => {
  const authored = [{ field: "dependsOn", link: "Target", linkpath: "Target" }];
  const cachedFingerprints = new Map<string, FileFingerprint>([["Source.md", fp(1)]]);
  const currentFingerprints = new Map<string, FileFingerprint>([
    ["Source.md", fp(1)],
    ["Target.md", fp(2)],
  ]);

  const plan = planReconciliation(cachedFingerprints, currentFingerprints);
  assert.deepEqual(plan.added, ["Target.md"]);

  const before = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, () => undefined);
  const after = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, (linkpath) =>
    linkpath === "Target" ? "Target.md" : undefined,
  );

  assert.equal(before.unresolved, 1);
  assert.equal(after.unresolved, 0);
  assert.deepEqual(after.fields.get("dependsOn"), ["Target.md"]);
});

test("warm path-set delete removes stale resolved targets and restores broken-link evidence", () => {
  const authored = [{ field: "dependsOn", link: "Target", linkpath: "Target" }];
  const cachedFingerprints = new Map<string, FileFingerprint>([
    ["Source.md", fp(1)],
    ["Target.md", fp(2)],
  ]);
  const currentFingerprints = new Map<string, FileFingerprint>([["Source.md", fp(1)]]);

  const plan = planReconciliation(cachedFingerprints, currentFingerprints);
  assert.deepEqual(plan.deleted, ["Target.md"]);

  const before = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, () => "Target.md");
  const after = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, () => undefined);

  assert.deepEqual(before.fields.get("dependsOn"), ["Target.md"]);
  assert.equal(after.fields.has("dependsOn"), false);
  assert.equal(after.unresolved, 1);
  assert.deepEqual(after.broken, [{ field: "dependsOn", link: "Target" }]);
});

test("warm path-set rename cannot retain the old resolved path", () => {
  const authored = [{ field: "dependsOn", link: "Controller", linkpath: "Controller" }];
  const cachedFingerprints = new Map<string, FileFingerprint>([
    ["Source.md", fp(1)],
    ["A/Controller.md", fp(2)],
  ]);
  const currentFingerprints = new Map<string, FileFingerprint>([
    ["Source.md", fp(1)],
    ["B/Controller.md", fp(3)],
  ]);

  const plan = planReconciliation(cachedFingerprints, currentFingerprints);
  assert.deepEqual(plan.deleted, ["A/Controller.md"]);
  assert.deepEqual(plan.added, ["B/Controller.md"]);

  const before = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, () => "A/Controller.md");
  const after = resolveAuthoredRelationshipLinks(authored, "Source.md", schema, () => "B/Controller.md");

  assert.deepEqual(before.fields.get("dependsOn"), ["A/Controller.md"]);
  assert.deepEqual(after.fields.get("dependsOn"), ["B/Controller.md"]);
  assert.equal(after.fields.get("dependsOn")?.includes("A/Controller.md"), false);
});
