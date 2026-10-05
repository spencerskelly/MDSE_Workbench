import assert from "node:assert/strict";
import test from "node:test";
import { assessDefinitionDeletion } from "../src/core/definition-lifecycle";

test("definition deletion is allowed when no active references remain", () => {
  const result = assessDefinitionDeletion({
    definitionPath: "30_Objects/Contactor.md",
    noteUses: [],
    occurrenceUses: [],
  });

  assert.equal(result.allowed, true);
  assert.equal(result.noteUseCount, 0);
  assert.equal(result.occurrenceUseCount, 0);
  assert.deepEqual(result.blockers, []);
});

test("definition deletion is blocked by note-level model references", () => {
  const result = assessDefinitionDeletion({
    definitionPath: "30_Objects/Contactor.md",
    noteUses: [
      { fromPath: "10_Systems/Charger.md", field: "hasPart" },
      { fromPath: "20_Designs/Power Stage.md", field: "satisfies" },
    ],
    occurrenceUses: [],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.noteUseCount, 2);
  assert.match(result.blockers[0], /^MODEL:/);
  assert.ok(result.blockers.some((row) => row.includes("Charger.md") && row.includes("hasPart")));
});

test("definition deletion is blocked by Local Model occurrence references", () => {
  const result = assessDefinitionDeletion({
    definitionPath: "40_Ports/CAN Port.md",
    noteUses: [],
    occurrenceUses: [
      {
        ownerPath: "30_Objects/Controller.md",
        localId: "ep-20261005055000000skellyspencer",
        kind: "endpoint",
        identifier: "J1",
      },
    ],
  });

  assert.equal(result.allowed, false);
  assert.equal(result.occurrenceUseCount, 1);
  assert.equal(
    result.blockers[0],
    'LOCAL: 30_Objects/Controller.md contains endpoint "J1" (^ep-20261005055000000skellyspencer) using this definition.',
  );
});

test("definition deletion reports note and occurrence blockers without mutating input order", () => {
  const noteUses = [
    { fromPath: "B.md", field: "uses" },
    { fromPath: "A.md", field: "hasPart" },
  ];
  const occurrenceUses = [
    { ownerPath: "Z.md", localId: "flow-z", kind: "flow" as const, identifier: "Z" },
    { ownerPath: "A.md", localId: "part-a", kind: "part" as const, identifier: "A" },
  ];
  const result = assessDefinitionDeletion({
    definitionPath: "Definition.md",
    noteUses,
    occurrenceUses,
  });

  assert.equal(result.allowed, false);
  assert.deepEqual(noteUses.map((x) => x.fromPath), ["B.md", "A.md"]);
  assert.deepEqual(occurrenceUses.map((x) => x.ownerPath), ["Z.md", "A.md"]);
  assert.deepEqual(result.blockers, [
    "MODEL: A.md references this definition through hasPart.",
    "MODEL: B.md references this definition through uses.",
    'LOCAL: A.md contains part "A" (^part-a) using this definition.',
    'LOCAL: Z.md contains flow "Z" (^flow-z) using this definition.',
  ]);
});
