import assert from "node:assert/strict";
import test from "node:test";
import { assertDefinitionSourceUid, planDefinitionOccurrenceMigration } from "../src/core/definition-migrate";

test("occurrence migration plans only the definition field replacement",()=>{
  const plan=planDefinitionOccurrenceMigration({
    ownerPath:"30_Objects/Assembly.md",
    localId:"part-x",
    currentDefinitionPath:"30_Objects/Old Contactor.md",
    replacedPath:"30_Objects/Old Contactor.md",
    replacementPath:"30_Objects/New Contactor.md",
  });
  assert.deepEqual(plan,{
    ownerPath:"30_Objects/Assembly.md",
    localId:"part-x",
    replacedPath:"30_Objects/Old Contactor.md",
    replacementPath:"30_Objects/New Contactor.md",
    definitionLink:"[[30_Objects/New Contactor]]",
  });
});

test("occurrence migration refuses a concurrent definition reassignment",()=>{
  assert.throws(()=>planDefinitionOccurrenceMigration({
    ownerPath:"30_Objects/Assembly.md",
    localId:"part-x",
    currentDefinitionPath:"30_Objects/Other Contactor.md",
    replacedPath:"30_Objects/Old Contactor.md",
    replacementPath:"30_Objects/New Contactor.md",
  }),/definition changed from the superseded definition/);
});

test("occurrence migration refuses a missing current definition",()=>{
  assert.throws(()=>planDefinitionOccurrenceMigration({
    ownerPath:"30_Objects/Assembly.md",
    localId:"part-x",
    currentDefinitionPath:null,
    replacedPath:"30_Objects/Old Contactor.md",
    replacementPath:"30_Objects/New Contactor.md",
  }),/no longer has a resolvable reusable definition/);
});


test("occurrence migration source identity guard pins replacement UID",()=>{
  const replacementPath="30_Objects/New Contactor.md";
  const expectedUid="20261005062000000skellyspencer";
  const text="---\ntype: Object\nuid: "+expectedUid+"\n---\n\n# New Contactor\n";

  assert.doesNotThrow(()=>assertDefinitionSourceUid(text,replacementPath,expectedUid));
  assert.throws(
    ()=>assertDefinitionSourceUid(text,replacementPath,"20261005062000009skellyspencer"),
    /identity changed; expected uid .* found/,
  );
});
