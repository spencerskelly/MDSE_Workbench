import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionDeletionService, type DefinitionDeleteStore } from "../src/core/definition-delete";
import { TransactionManager } from "../src/core/transaction";
import type { DefinitionDeletionImpact } from "../src/core/definition-lifecycle";

class MemoryDeleteStore implements DefinitionDeleteStore {
  files = new Map<string,string>();
  async exists(path:string){ return this.files.has(path); }
  async read(path:string){ const v=this.files.get(path); if(v===undefined) throw new Error(path+" missing"); return v; }
  async remove(path:string){ if(!this.files.delete(path)) throw new Error(path+" missing"); }
  async create(path:string,text:string){ if(this.files.has(path)) throw new Error(path+" exists"); this.files.set(path,text); }
}

const path="30_Objects/Contactor.md";
const uid="20261005060000000skellyspencer";
const text="---\ntype: Object\nuid: "+uid+"\n---\n\n# Contactor\n";

const clearImpact=():DefinitionDeletionImpact=>({definitionPath:path,noteUses:[],occurrenceUses:[]});

test("definition deletion stages and reviews without touching storage", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  const service=new DefinitionDeletionService(store,async()=>clearImpact(),tx);

  const staged=await service.stageAndReview(path,uid);
  assert.equal(staged.transaction.status,"reviewed");
  assert.equal(staged.impact.allowed,true);
  assert.equal(await store.exists(path),true);
  service.cancel(staged.transaction.id);
  assert.equal(tx.history().length,0);
});

test("definition deletion Apply rechecks active references", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  let blocked=false;
  const service=new DefinitionDeletionService(store,async()=>blocked?{
    definitionPath:path,
    noteUses:[{fromPath:"System.md",field:"hasPart"}],
    occurrenceUses:[],
  }:clearImpact(),tx);

  const staged=await service.stageAndReview(path,uid);
  blocked=true;
  await assert.rejects(service.apply(staged.transaction.id),/active reference/);
  assert.equal(await store.exists(path),true);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});

test("definition deletion Apply refuses definition changes after Review", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  const service=new DefinitionDeletionService(store,async()=>clearImpact(),tx);

  const staged=await service.stageAndReview(path,uid);
  store.files.set(path,text+"external\n");
  await assert.rejects(service.apply(staged.transaction.id),/changed after Review/);
  assert.equal(await store.exists(path),true);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});

test("definition deletion participates in undo and guarded redo", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  let impact=clearImpact();
  const service=new DefinitionDeletionService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  await service.apply(staged.transaction.id);
  assert.equal(await store.exists(path),false);
  assert.equal(tx.history().length,1);

  await tx.undo();
  assert.equal(await store.exists(path),true);

  impact={
    definitionPath:path,
    noteUses:[],
    occurrenceUses:[{ownerPath:"Assembly.md",localId:"part-x",kind:"part",identifier:"K1"}],
  };
  await assert.rejects(tx.redo(),/active references/);
  assert.equal(await store.exists(path),true);
});


test("definition deletion remains blocked by supersession provenance", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  const impact:DefinitionDeletionImpact={
    definitionPath:path,
    noteUses:[{fromPath:"30_Objects/New Contactor.md",field:"supersedes"}],
    occurrenceUses:[],
  };
  const service=new DefinitionDeletionService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  assert.equal(staged.impact.allowed,false);
  assert.equal(staged.impact.noteUseCount,1);
  assert.match(staged.impact.blockers[0] ?? "",/supersedes/);
  await assert.rejects(service.apply(staged.transaction.id),/active reference/);
  assert.equal(await store.exists(path),true);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});


test("definition deletion redo is blocked when supersession provenance appears after undo", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  let impact=clearImpact();
  const service=new DefinitionDeletionService(store,async()=>impact,tx);

  const staged=await service.stageAndReview(path,uid);
  await service.apply(staged.transaction.id);
  await tx.undo();

  impact={
    definitionPath:path,
    noteUses:[{fromPath:"30_Objects/New Contactor.md",field:"supersedes"}],
    occurrenceUses:[],
  };
  await assert.rejects(tx.redo(),/active references/);
  assert.equal(await store.exists(path),true);
});


test("definition deletion undo refuses UID collision introduced after delete", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  let uidCollision=false;
  const service=new DefinitionDeletionService(store,async()=>clearImpact(),tx,()=>uidCollision);

  const staged=await service.stageAndReview(path,uid);
  await service.apply(staged.transaction.id);
  assert.equal(await store.exists(path),false);

  uidCollision=true;
  await assert.rejects(tx.undo(),/uid .* is now in use/);
  assert.equal(await store.exists(path),false);
  assert.equal(tx.history().length,1);
});


test("definition deletion refuses staging when caller UID does not match source definition", async()=>{
  const store=new MemoryDeleteStore(); store.files.set(path,text);
  const tx=new TransactionManager();
  const service=new DefinitionDeletionService(store,async()=>clearImpact(),tx);

  await assert.rejects(
    service.stageAndReview(path,"20261005060000001skellyspencer"),
    /expected uid .* found/,
  );
  assert.equal(await store.exists(path),true);
  assert.equal(tx.history().length,0);
});
