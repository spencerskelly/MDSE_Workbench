import { test } from "node:test";
import assert from "node:assert/strict";
import {\n  ReversePathDependencyIndex,\n  TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES,\n  shouldUseFullRelationshipReresolution,\n} from "../src/core/relationship-dependencies";

test("reverse dependency index finds source notes by resolved target path", () => {
  const index = new ReversePathDependencyIndex();
  index.set("A.md", ["Target.md", "Shared.md"]);
  index.set("B.md", ["Shared.md"]);

  assert.deepEqual(index.dependentsOf(["Target.md"]), ["A.md"]);
  assert.deepEqual(index.dependentsOf(["Shared.md"]), ["A.md", "B.md"]);
  assert.deepEqual(index.dependentsOf(["Target.md", "Shared.md"]), ["A.md", "B.md"]);
  assert.deepEqual(index.targetsOf("A.md"), ["Shared.md", "Target.md"]);
});

test("updating a source removes stale reverse dependencies before adding new ones", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", ["Old/Controller.md"]);
  index.set("Source.md", ["New/Controller.md"]);

  assert.deepEqual(index.dependentsOf(["Old/Controller.md"]), []);
  assert.deepEqual(index.dependentsOf(["New/Controller.md"]), ["Source.md"]);
  assert.deepEqual(index.targetsOf("Source.md"), ["New/Controller.md"]);
});

test("removing a source clears every reverse-path entry it contributed", () => {
  const index = new ReversePathDependencyIndex();
  index.set("A.md", ["X.md", "Y.md"]);
  index.set("B.md", ["Y.md"]);

  index.remove("A.md");

  assert.deepEqual(index.dependentsOf(["X.md"]), []);
  assert.deepEqual(index.dependentsOf(["Y.md"]), ["B.md"]);
  assert.equal(index.sourceCount, 1);
  assert.equal(index.targetCount, 1);
});

test("duplicate target evidence stays canonical and self-dependencies are ignored", () => {
  const index = new ReversePathDependencyIndex();
  index.set("A.md", ["B.md", "B.md", "A.md"]);

  assert.deepEqual(index.targetsOf("A.md"), ["B.md"]);
  assert.deepEqual(index.dependentsOf(["B.md"]), ["A.md"]);
});


test("path-change candidates include previously unresolved authored linkpaths", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", [], ["Target"]);

  assert.deepEqual(index.candidatesForPathChanges(["Target.md"]), ["Source.md"]);
  assert.deepEqual(index.candidatesForPathChanges(["Folder/Target.md"]), ["Source.md"]);
});

test("path-change candidates union resolved dependencies with authored basename matches", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Resolved.md", ["Folder/Controller.md"], ["Folder/Controller"]);
  index.set("Broken.md", [], ["Controller"]);

  assert.deepEqual(
    index.candidatesForPathChanges(["Folder/Controller.md"]),
    ["Broken.md", "Resolved.md"],
  );
});

test("updating authored linkpaths removes stale add candidates", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", [], ["Old"]);
  index.set("Source.md", [], ["New"]);

  assert.deepEqual(index.candidatesForPathChanges(["Old.md"]), []);
  assert.deepEqual(index.candidatesForPathChanges(["New.md"]), ["Source.md"]);
});


test("path-change fan-out reports conservative source counts per changed path without changing candidate semantics", () => {
  const index = new ReversePathDependencyIndex();
  index.set("A.md", ["Folder/Controller.md"], ["Controller"]);
  index.set("B.md", [], ["Controller"]);
  index.set("C.md", ["Other.md"], ["Other"]);

  assert.deepEqual(index.candidateFanOutForPathChanges(["Other.md", "Folder/Controller.md", "Other.md"]), [
    { path: "Folder/Controller.md", candidates: 2 },
    { path: "Other.md", candidates: 1 },
  ]);
  assert.deepEqual(index.candidatesForPathChanges(["Folder/Controller.md", "Other.md"]), ["A.md", "B.md", "C.md"]);
});


test("targeted relationship re-resolution uses the defined candidate threshold", () => {
  assert.equal(
    shouldUseFullRelationshipReresolution(TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES - 1),
    false,
  );
  assert.equal(
    shouldUseFullRelationshipReresolution(TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES),
    false,
  );
  assert.equal(
    shouldUseFullRelationshipReresolution(TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES + 1),
    true,
  );
});
