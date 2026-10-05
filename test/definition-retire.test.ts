import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionRetirementService, retireDefinitionText, type DefinitionRetirementStore } from "../src/core/definition-retire";
import { TransactionManager } from "../src/core/transaction";
import type { DefinitionDeletionImpact } from "../src/core/definition-lifecycle";

class MemoryRetirementStore implements DefinitionRetirementStore {
  files = new Map<string,string>();
  async exists(path:string){ return this.files.has(path); }
  async read(path:string){ const v=this.files.get(path); if(v===undefined) throw new Error(path+" missing"); return v; }
  async write(path:string,text:string){ if(!this.files.has(path)) throw new Error(path+" missing"); this.files.set(path,text); }
}

const path="30_Objects/Contactor.md";
const uid="20261005060500000skellyspencer";
const active="---\ntype: Object\nuid: "+uid+"\nstatus: active\ntags:\n  - power\n---\n\n# Contactor\n";
const missing="---\ntype: Object\nuid: "+uid+"\ntags:\n  - power\n---\n\n# Contactor\n";
const impact:DefinitionDeletionImpact={
  definitionPath:path,
  noteUses:[{fromPath:"System.md",field:"hasPart"}],
  occurrenceUses:[{ownerPath:"Assembly.md",localId:"part-x",kind:"part",identifier:"K1"}],
};

test("retireDefinitionText sets retired while preserving body content",()=>{
  const result=retireDefinitionText(active);
  assert.equal(result.currentStatus,"active");
  assert.match(result.text,/status: retired/);
  assert.match(result.text,/# Contactor/);
  assert.match(result.text,/tags:/);
});

test("retirement can add missing governed status",()=>{
  const result=retireDefinitionText(missing);
  assert.equal(result.currentStatus,undefined);
  assert.match(result.text,/status: retired/);
});

test("definition retirement stages impact without changing dependent references",async()=>{
  const store=new MemoryRetirementStore(); store.files.set(path,active);
  const tx=new TransactionManager();
  const service=new DefinitionRetirementService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  assert.equal(staged.transaction.status,"reviewed");
  assert.equal(staged.plan.noteUseCount,1);
  assert.equal(staged.plan.occurrenceUseCount,1);
  assert.equal(staged.plan.preservesReferences,true);
  assert.equal(await store.read(path),active);
  service.cancel(staged.transaction.id);
  assert.equal(tx.history().length,0);
});

test("definition retirement Apply is stale-content guarded and reversible",async()=>{
  const store=new MemoryRetirementStore(); store.files.set(path,active);
  const tx=new TransactionManager();
  const service=new DefinitionRetirementService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  await service.apply(staged.transaction.id);
  assert.match(await store.read(path),/status: retired/);
  assert.equal(tx.history().length,1);

  await tx.undo();
  assert.equal(await store.read(path),active);
  await tx.redo();
  assert.match(await store.read(path),/status: retired/);
});

test("definition retirement refuses a note changed after Review",async()=>{
  const store=new MemoryRetirementStore(); store.files.set(path,active);
  const tx=new TransactionManager();
  const service=new DefinitionRetirementService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  store.files.set(path,active+"external\n");
  await assert.rejects(service.apply(staged.transaction.id),/changed after Review/);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});

test("definition retirement refuses an already retired definition",async()=>{
  const store=new MemoryRetirementStore();
  store.files.set(path,retireDefinitionText(active).text);
  const tx=new TransactionManager();
  const service=new DefinitionRetirementService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  assert.equal(staged.plan.changed,false);
  await assert.rejects(service.apply(staged.transaction.id),/already retired/);
  service.cancel(staged.transaction.id);
});


test("retirement preserves unrelated frontmatter formatting and comments byte-for-byte",()=>{
  const formatted=`---
# lifecycle comment
type: Object
uid: ${uid}
status: "active" # keep inline comment
custom: 'keep single quotes'
tags:
  - power

---

# Contactor
`;
  const result=retireDefinitionText(formatted);
  assert.equal(result.currentStatus,"active");
  assert.ok(result.text.includes("# lifecycle comment\ntype: Object\nuid: "+uid+"\nstatus: retired # keep inline comment\ncustom: 'keep single quotes'\ntags:\n  - power\n"));
  assert.ok(result.text.endsWith("\n# Contactor\n"));
});

test("retirement adds missing status without rewriting existing frontmatter",()=>{
  const formatted=`---
# identity comment
type: Object
uid: ${uid}
custom:
  nested: value
tags: [power, control]
---

# Contactor
`;
  const result=retireDefinitionText(formatted);
  assert.equal(result.currentStatus,undefined);
  assert.ok(result.text.includes("# identity comment\ntype: Object\nuid: "+uid+"\ncustom:\n  nested: value\ntags: [power, control]\nstatus: retired\n---"));
  assert.ok(result.text.endsWith("\n# Contactor\n"));
});


test("definition retirement refuses changed impact evidence after Review",async()=>{
  const store=new MemoryRetirementStore(); store.files.set(path,active);
  const tx=new TransactionManager();
  let currentImpact=impact;
  const service=new DefinitionRetirementService(store,async()=>currentImpact,tx);

  const staged=await service.stageAndReview(path,uid);
  currentImpact={
    definitionPath:path,
    noteUses:[...impact.noteUses,{fromPath:"Another System.md",field:"hasPart"}],
    occurrenceUses:impact.occurrenceUses,
  };
  await assert.rejects(service.apply(staged.transaction.id),/usage changed after Review/);
  assert.equal(await store.read(path),active);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});


test("definition retirement redo refuses changed impact evidence after undo",async()=>{
  const store=new MemoryRetirementStore(); store.files.set(path,active);
  const tx=new TransactionManager();
  let currentImpact=impact;
  const service=new DefinitionRetirementService(store,async()=>currentImpact,tx);

  const staged=await service.stageAndReview(path,uid);
  await service.apply(staged.transaction.id);
  await tx.undo();
  currentImpact={
    definitionPath:path,
    noteUses:[...impact.noteUses,{fromPath:"Another System.md",field:"hasPart"}],
    occurrenceUses:impact.occurrenceUses,
  };
  await assert.rejects(tx.redo(),/dependent usage changed after Review/);
  assert.equal(await store.read(path),active);
});


test("definition retirement refuses staging when caller UID does not match source definition",async()=>{
  const store=new MemoryRetirementStore(); store.files.set(path,active);
  const tx=new TransactionManager();
  const service=new DefinitionRetirementService(store,async()=>impact,tx);

  await assert.rejects(
    service.stageAndReview(path,"20261005060500001skellyspencer"),
    /expected uid .* found/,
  );
  assert.equal(await store.read(path),active);
  assert.equal(tx.history().length,0);
});
