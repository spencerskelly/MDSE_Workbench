import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionSupersessionService, type DefinitionSupersessionStore } from "../src/core/definition-supersede-service";
import { TransactionManager } from "../src/core/transaction";
import type { DefinitionDeletionImpact } from "../src/core/definition-lifecycle";

class MemorySupersessionStore implements DefinitionSupersessionStore {
  files = new Map<string,string>();
  async exists(path:string){ return this.files.has(path); }
  async read(path:string){ const v=this.files.get(path); if(v===undefined) throw new Error(path+" missing"); return v; }
  async write(path:string,text:string){ if(!this.files.has(path)) throw new Error(path+" missing"); this.files.set(path,text); }
}

const oldPath="30_Objects/Old Contactor.md";
const newPath="30_Objects/New Contactor.md";
const oldUid="20261005061000000skellyspencer";
const newUid="20261005061000001skellyspencer";
const oldText=`---\ntype: Object\nuid: ${oldUid}\nstatus: retired\n---\n\n# Old Contactor\n`;
const newText=`---\ntype: Object\nuid: ${newUid}\nstatus: active\n---\n\n# New Contactor\n`;

const clearImpact=():DefinitionDeletionImpact=>({definitionPath:oldPath,noteUses:[],occurrenceUses:[]});

test("supersession stages and reviews paired relationship without writing dependents",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const impact:DefinitionDeletionImpact={
    definitionPath:oldPath,
    noteUses:[{fromPath:"System.md",field:"hasPart"}],
    occurrenceUses:[{ownerPath:"Assembly.md",localId:"part-x",kind:"part",identifier:"K1"}],
  };
  const service=new DefinitionSupersessionService(store,async()=>impact,tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  assert.equal(staged.transaction.status,"reviewed");
  assert.equal(staged.plan.migrationCandidates.length,2);
  assert.equal(staged.plan.rewritesReferences,false);
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),newText);
  service.cancel(staged.transaction.id);
  assert.equal(tx.history().length,0);
});

test("supersession Apply writes both sides and participates in undo redo",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  await service.apply(staged.transaction.id);
  assert.match(await store.read(newPath),/supersedes:/);
  assert.match(await store.read(newPath),/Old Contactor/);
  assert.match(await store.read(oldPath),/supersededBy:/);
  assert.match(await store.read(oldPath),/New Contactor/);
  assert.equal(tx.history().length,1);

  await tx.undo();
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),newText);
  await tx.redo();
  assert.match(await store.read(newPath),/supersedes:/);
  assert.match(await store.read(oldPath),/supersededBy:/);
});

test("supersession refuses changed migration inventory after Review",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  let impact=clearImpact();
  const service=new DefinitionSupersessionService(store,async()=>impact,tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  impact={definitionPath:oldPath,noteUses:[{fromPath:"System.md",field:"hasPart"}],occurrenceUses:[]};
  await assert.rejects(service.apply(staged.transaction.id),/usage changed after Review/);
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),newText);
  service.cancel(staged.transaction.id);
});

test("supersession refuses definition content changes after Review",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  store.files.set(newPath,newText+"external\n");
  await assert.rejects(service.apply(staged.transaction.id),/changed after Review/);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});
