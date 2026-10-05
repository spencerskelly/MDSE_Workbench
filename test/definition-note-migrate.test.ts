import assert from "node:assert/strict";
import test from "node:test";
import { planDefinitionNoteMigration } from "../src/core/definition-note-migrate";
import type { RelationshipDef } from "../src/core/schema";

const paired = {
  field: "hasPart",
  inverse: "partOf",
  kind: "paired",
} as RelationshipDef;

const symmetric = {
  field: "interfaces",
  kind: "symmetric",
} as RelationshipDef;

test("note migration plans source target replacement plus paired inverse movement",()=>{
  const plan=planDefinitionNoteMigration({
    ownerPath:"10_Systems/Charger.md",
    field:"hasPart",
    replacedPath:"30_Objects/Old Contactor.md",
    replacementPath:"30_Objects/New Contactor.md",
    relationship:paired,
    currentTargets:["30_Objects/Old Contactor.md","30_Objects/Other.md"],
  });
  assert.deepEqual(plan.sourceMutation,{
    removeTarget:"30_Objects/Old Contactor.md",
    addTarget:"30_Objects/New Contactor.md",
  });
  assert.deepEqual(plan.inverseMutations,[
    {path:"30_Objects/Old Contactor.md",field:"partOf",removeTarget:"10_Systems/Charger.md"},
    {path:"30_Objects/New Contactor.md",field:"partOf",addTarget:"10_Systems/Charger.md"},
  ]);
  assert.equal(plan.inverseField,"partOf");
  assert.equal(plan.symmetric,false);
  assert.equal(plan.authoredAsInverse,false);
});

test("note migration supports a paired relationship authored through its inverse field",()=>{
  const plan=planDefinitionNoteMigration({
    ownerPath:"30_Objects/Contactor.md",
    field:"partOf",
    replacedPath:"10_Systems/Old Charger.md",
    replacementPath:"10_Systems/New Charger.md",
    relationship:paired,
    currentTargets:["10_Systems/Old Charger.md"],
  });
  assert.equal(plan.authoredAsInverse,true);
  assert.equal(plan.inverseField,"hasPart");
  assert.deepEqual(plan.sourceMutation,{
    removeTarget:"10_Systems/Old Charger.md",
    addTarget:"10_Systems/New Charger.md",
  });
  assert.deepEqual(plan.inverseMutations,[
    {path:"10_Systems/Old Charger.md",field:"hasPart",removeTarget:"30_Objects/Contactor.md"},
    {path:"10_Systems/New Charger.md",field:"hasPart",addTarget:"30_Objects/Contactor.md"},
  ]);
});

test("note migration plans symmetric inverse movement on the same field",()=>{
  const plan=planDefinitionNoteMigration({
    ownerPath:"40_Ports/J1.md",
    field:"interfaces",
    replacedPath:"40_Ports/Old Bus.md",
    replacementPath:"40_Ports/New Bus.md",
    relationship:symmetric,
    currentTargets:["40_Ports/Old Bus.md"],
  });
  assert.equal(plan.inverseField,"interfaces");
  assert.equal(plan.symmetric,true);
  assert.deepEqual(plan.inverseMutations,[
    {path:"40_Ports/Old Bus.md",field:"interfaces",removeTarget:"40_Ports/J1.md"},
    {path:"40_Ports/New Bus.md",field:"interfaces",addTarget:"40_Ports/J1.md"},
  ]);
});

test("note migration refuses a changed or already migrated relationship",()=>{
  assert.throws(()=>planDefinitionNoteMigration({
    ownerPath:"10_Systems/Charger.md",field:"hasPart",
    replacedPath:"30_Objects/Old Contactor.md",replacementPath:"30_Objects/New Contactor.md",
    relationship:paired,currentTargets:["30_Objects/Other.md"],
  }),/no longer targets/);

  assert.throws(()=>planDefinitionNoteMigration({
    ownerPath:"10_Systems/Charger.md",field:"hasPart",
    replacedPath:"30_Objects/Old Contactor.md",replacementPath:"30_Objects/New Contactor.md",
    relationship:paired,currentTargets:["30_Objects/Old Contactor.md","30_Objects/New Contactor.md"],
  }),/already targets replacement/);
});

test("note migration with one-way relationship has no inverse mutations",()=>{
  const oneWay: RelationshipDef = {
    field: "participants",
    kind: "oneWay",
    from: "any",
    to: "any",
    sameClass: false,
    excludePairs: [],
    provisional: false,
    temporary: false,
    order: 0,
  };
  const plan=planDefinitionNoteMigration({
    ownerPath:"20_UseCases/Charge.md",field:"participants",
    replacedPath:"30_Objects/Old Charger.md",replacementPath:"30_Objects/New Charger.md",
    relationship:oneWay,currentTargets:["30_Objects/Old Charger.md"],
  });
  assert.equal(plan.inverseField,null);
  assert.deepEqual(plan.inverseMutations,[]);
});
