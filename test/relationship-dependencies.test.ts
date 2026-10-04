import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ReversePathDependencyIndex,
  TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES,
  shouldUseFullRelationshipReresolution,
} from "../src/core/relationship-dependencies";

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


test("targeted candidates conservatively cover ambiguous basenames", () => {
  const index = new ReversePathDependencyIndex();
  index.set("A/Source.md", ["A/Controller.md"], ["Controller"]);
  index.set("B/Source.md", ["B/Controller.md"], ["Controller"]);

  assert.deepEqual(
    index.candidatesForPathChanges(["A/Controller.md"]),
    ["A/Source.md", "B/Source.md"],
  );
});

test("folder-qualified authored links remain candidates for their exact path and basename changes", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", ["A/Controller.md"], ["A/Controller"]);

  assert.deepEqual(index.candidatesForPathChanges(["A/Controller.md"]), ["Source.md"]);
  assert.deepEqual(index.candidatesForPathChanges(["Controller.md"]), ["Source.md"]);
});

test("aliases and fragments cannot hide an authored dependency candidate", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Alias.md", [], ["Folder/Target|Friendly name"]);
  index.set("Heading.md", [], ["Folder/Target#Heading"]);
  index.set("Block.md", [], ["Folder/Target#^block-id"]);

  assert.deepEqual(
    index.candidatesForPathChanges(["Folder/Target.md"]),
    ["Alias.md", "Block.md", "Heading.md"],
  );
});

test("candidate matching normalizes case, separators, leading slash, and md extension", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", [], ["\\Folder\\Controller.MD"]);

  assert.deepEqual(index.candidatesForPathChanges(["folder/controller.md"]), ["Source.md"]);
  assert.deepEqual(index.candidatesForPathChanges(["/FOLDER/CONTROLLER.MD"]), ["Source.md"]);
});


test("dependency consistency confirms complete source and reverse evidence", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", ["Folder/Target.md"], ["Folder/Target"]);

  const result = index.consistency([
    {
      sourcePath: "Source.md",
      targetPaths: ["Folder/Target.md"],
      authoredLinkpaths: ["Folder/Target"],
    },
  ]);

  assert.equal(result.complete, true);
  assert.deepEqual(result.issues, []);
});

test("dependency consistency fails closed when an expected source is missing", () => {
  const index = new ReversePathDependencyIndex();

  const result = index.consistency([
    {
      sourcePath: "Source.md",
      targetPaths: ["Target.md"],
      authoredLinkpaths: ["Target"],
    },
  ]);

  assert.equal(result.complete, false);
  assert.equal(result.issues.some((issue) => issue.includes("Source.md")), true);
});

test("dependency consistency detects internally inconsistent reverse evidence", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", ["Target.md"], ["Target"]);

  const internals = index as unknown as {
    byTarget: Map<string, Set<string>>;
  };
  internals.byTarget.delete("Target.md");

  const result = index.consistency([
    {
      sourcePath: "Source.md",
      targetPaths: ["Target.md"],
      authoredLinkpaths: ["Target"],
    },
  ]);

  assert.equal(result.complete, false);
  assert.equal(result.issues.some((issue) => issue.includes("missing reverse target entry")), true);
});


test("reverse dependency size is bounded by current evidence rather than edit history", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", ["A/Target.md", "B/Target.md"], ["A/Target", "Shared"]);

  assert.deepEqual(index.size(), {
    sources: 1,
    resolvedTargetKeys: 2,
    authoredKeys: 3,
    resolvedAssociations: 2,
    authoredAssociations: 3,
    storedMemberships: 10,
  });

  index.set("Source.md", ["C/Target.md"], ["C/Target"]);

  assert.deepEqual(index.size(), {
    sources: 1,
    resolvedTargetKeys: 1,
    authoredKeys: 2,
    resolvedAssociations: 1,
    authoredAssociations: 2,
    storedMemberships: 6,
  });
});

test("one authored link contributes at most two normalized dependency keys", () => {
  const index = new ReversePathDependencyIndex();
  index.set("Source.md", [], ["Folder/Subfolder/Target#Heading|Alias"]);

  const size = index.size();
  assert.equal(size.authoredAssociations, 2);
  assert.equal(size.authoredKeys, 2);
  assert.equal(size.storedMemberships, 4);
});
