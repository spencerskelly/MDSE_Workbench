import assert from "node:assert/strict";
import test from "node:test";
import { planDefinitionSupersession } from "../src/core/definition-supersede";

const impact = {
  definitionPath: "30_Objects/Old Contactor.md",
  noteUses: [
    { fromPath: "20_Designs/B.md", field: "hasPart" },
    { fromPath: "10_Systems/A.md", field: "references" },
  ],
  occurrenceUses: [
    { ownerPath: "30_Objects/Assembly.md", localId: "part-b", kind: "part" as const, identifier: "K2" },
    { ownerPath: "30_Objects/Assembly.md", localId: "part-a", kind: "part" as const, identifier: "K1" },
  ],
};

test("supersession requires distinct same-class definitions", () => {
  const ok = planDefinitionSupersession({
    replacedPath: "30_Objects/Old Contactor.md",
    replacedType: "Object",
    replacementPath: "30_Objects/New Contactor.md",
    replacementType: "Object",
    impact,
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.relationshipField, "supersedes");
  assert.equal(ok.rewritesReferences, false);

  const wrongClass = planDefinitionSupersession({
    replacedPath: "30_Objects/Old Contactor.md",
    replacedType: "Object",
    replacementPath: "40_Ports/J1.md",
    replacementType: "Port",
    impact,
  });
  assert.equal(wrongClass.valid, false);
  assert.match(wrongClass.blockers[0], /same model class/);

  const self = planDefinitionSupersession({
    replacedPath: "30_Objects/Old Contactor.md",
    replacedType: "Object",
    replacementPath: "30_Objects/Old Contactor.md",
    replacementType: "Object",
    impact,
  });
  assert.equal(self.valid, false);
  assert.ok(self.blockers.some((x) => /cannot supersede itself/.test(x)));
});

test("supersession inventories every current use for guided migration without rewriting", () => {
  const plan = planDefinitionSupersession({
    replacedPath: "30_Objects/Old Contactor.md",
    replacedType: "Object",
    replacementPath: "30_Objects/New Contactor.md",
    replacementType: "Object",
    impact,
  });

  assert.deepEqual(plan.migrationCandidates, [
    { scope: "note", ownerPath: "10_Systems/A.md", field: "references" },
    { scope: "note", ownerPath: "20_Designs/B.md", field: "hasPart" },
    { scope: "occurrence", ownerPath: "30_Objects/Assembly.md", field: "definition", localId: "part-a", kind: "part", identifier: "K1" },
    { scope: "occurrence", ownerPath: "30_Objects/Assembly.md", field: "definition", localId: "part-b", kind: "part", identifier: "K2" },
  ]);
  assert.equal(plan.rewritesReferences, false);
});

test("supersession warns when the proposed replacement is retired", () => {
  const plan = planDefinitionSupersession({
    replacedPath: "30_Objects/Old Contactor.md",
    replacedType: "Object",
    replacementPath: "30_Objects/New Contactor.md",
    replacementType: "Object",
    replacementStatus: "retired",
    impact: { definitionPath: "30_Objects/Old Contactor.md", noteUses: [], occurrenceUses: [] },
  });
  assert.equal(plan.valid, true);
  assert.ok(plan.warnings.some((x) => /already retired/.test(x)));
});


test("supersession migration excludes lifecycle provenance links but retains engineering dependencies", () => {
  const plan = planDefinitionSupersession({
    replacedPath: "30_Objects/Old Contactor.md",
    replacedType: "Object",
    replacementPath: "30_Objects/New Contactor.md",
    replacementType: "Object",
    impact: {
      definitionPath: "30_Objects/Old Contactor.md",
      noteUses: [
        { fromPath: "30_Objects/New Contactor.md", field: "supersedes" },
        { fromPath: "30_Objects/Historical.md", field: "supersededBy" },
        { fromPath: "10_Systems/System.md", field: "hasPart" },
      ],
      occurrenceUses: [],
    },
  });
  assert.deepEqual(plan.migrationCandidates, [
    { scope: "note", ownerPath: "10_Systems/System.md", field: "hasPart" },
  ]);
});
