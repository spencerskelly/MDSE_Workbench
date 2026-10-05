import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionNoteMigrationService, type DefinitionNoteMigrationStore } from "../src/core/definition-note-migrate-service";
import { TransactionManager } from "../src/core/transaction";
import type { RelationshipDef } from "../src/core/schema";

class MemoryStore implements DefinitionNoteMigrationStore {
  files=new Map<string,string>();
  async read(path:string){ const v=this.files.get(path); if(v===undefined) throw new Error(path+" missing"); return v; }
  async write(path:string,text:string){ if(!this.files.has(path)) throw new Error(path+" missing"); this.files.set(path,text); }
}

const owner="10_Systems/Charger.md";
const oldPath="30_Objects/Old Contactor.md";
const newPath="30_Objects/New Contactor.md";
const ownerText="---\ntype: Object\nuid: 20261005061500000skellyspencer\nhasPart:\n  - \"[[30_Objects/Old Contactor]]\"\n---\n\n# Charger\n";
const oldText="---\ntype: Object\nuid: 20261005061500001skellyspencer\npartOf:\n  - \"[[10_Systems/Charger]]\"\n---\n\n# Old\n";
const newText="---\ntype: Object\nuid: 20261005061500002skellyspencer\n---\n\n# New\n";
const rel={field:"hasPart",inverse:"partOf",kind:"paired"} as RelationshipDef;
const resolve=(target:string)=> target.endsWith(".md")?target:target+".md";
const linkText=(target:string)=>target.replace(/\.md$/,"");

test("note migration stages source and inverse moves without writing",async()=>{
  const store=new MemoryStore(); store.files.set(owner,ownerText); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(
    store,(target)=>resolve(target),linkText,tx,
  );
  const staged=await service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  assert.equal(staged.transaction.status,"reviewed");
  assert.deepEqual(staged.affectedPaths.sort(),[newPath,oldPath,owner].sort());
  assert.equal(await store.read(owner),ownerText);
  service.cancel(staged.transaction.id);
  assert.equal(tx.history().length,0);
});

test("note migration Apply moves paired relationship and supports undo redo",async()=>{
  const store=new MemoryStore(); store.files.set(owner,ownerText); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);
  const staged=await service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  await service.apply(staged.transaction.id);
  assert.match(await store.read(owner),/New Contactor/);
  assert.doesNotMatch(await store.read(owner),/Old Contactor/);
  assert.doesNotMatch(await store.read(oldPath),/Charger/);
  assert.match(await store.read(newPath),/partOf:/);
  assert.match(await store.read(newPath),/Charger/);
  assert.equal(tx.history().length,1);
  await tx.undo();
  assert.equal(await store.read(owner),ownerText);
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),newText);
  await tx.redo();
  assert.match(await store.read(owner),/New Contactor/);
});

test("note migration Apply refuses any affected file changed after Review",async()=>{
  const store=new MemoryStore(); store.files.set(owner,ownerText); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);
  const staged=await service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  store.files.set(oldPath,oldText+"external\n");
  await assert.rejects(service.apply(staged.transaction.id),/changed after Review/);
  assert.equal(await store.read(owner),ownerText);
  assert.equal(await store.read(newPath),newText);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});

test("note migration refuses staging when fresh targets no longer include superseded definition",async()=>{
  const store=new MemoryStore();
  store.files.set(owner,ownerText.replace("Old Contactor","Other"));
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);
  await assert.rejects(service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel}),/no longer targets/);
});
