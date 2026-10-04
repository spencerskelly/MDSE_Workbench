import { test } from "node:test";
import assert from "node:assert/strict";
import { ReversePathDependencyIndex } from "../src/core/relationship-dependencies";

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
