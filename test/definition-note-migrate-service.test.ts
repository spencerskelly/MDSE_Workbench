import assert from "node:assert/strict";
import test from "node:test";
import { DefinitionNoteMigrationService, type DefinitionNoteMigrationStore } from "../src/core/definition-note-migrate-service";
import { TransactionManager } from "../src/core/transaction";
import type { RelationshipDef } from "../src/core/schema";

class MemoryStore implements DefinitionNoteMigrationStore {
  files=new Map<string,string>();
  async exists(path:string){ return this.files.has(path); }
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
  const oldAfter=await store.read(oldPath);
  assert.doesNotMatch(oldAfter,/Charger/);
  assert.doesNotMatch(oldAfter,/partOf:/);
  assert.doesNotMatch(oldAfter,/partOf:\s*\[\]/);
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


test("note migration preserves unrelated YAML formatting across all paired files",async()=>{
  const formattedOwner=`---
# owner comment
type: Object
uid: 20261005061500000skellyspencer
status: "active"
hasPart:
  - "[[30_Objects/Old Contactor]]"
custom: 'owner unchanged'
---

# Charger
`;
  const formattedOld=`---
type: Object
# old inverse comment
uid: 20261005061500001skellyspencer
partOf:
  - "[[10_Systems/Charger]]"
custom: [one, two]
---

# Old
`;
  const formattedNew=`---
type: Object
uid: 20261005061500002skellyspencer
custom:
  nested: "keep"
---

# New
`;
  const store=new MemoryStore();
  store.files.set(owner,formattedOwner); store.files.set(oldPath,formattedOld); store.files.set(newPath,formattedNew);
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,new TransactionManager());
  const staged=await service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  await service.apply(staged.transaction.id);

  const ownerAfter=await store.read(owner);
  const oldAfter=await store.read(oldPath);
  const newAfter=await store.read(newPath);
  assert.ok(ownerAfter.includes("# owner comment\ntype: Object\nuid: 20261005061500000skellyspencer\nstatus: \"active\"\n"));
  assert.ok(ownerAfter.includes("custom: 'owner unchanged'"));
  assert.ok(ownerAfter.endsWith("\n# Charger\n"));
  assert.ok(oldAfter.includes("type: Object\n# old inverse comment\nuid: 20261005061500001skellyspencer\n"));
  assert.ok(oldAfter.includes("custom: [one, two]"));
  assert.ok(oldAfter.endsWith("\n# Old\n"));
  assert.ok(newAfter.includes("custom:\n  nested: \"keep\""));
  assert.ok(newAfter.endsWith("\n# New\n"));
  assert.match(ownerAfter,/New Contactor/);
  assert.doesNotMatch(ownerAfter,/Old Contactor/);
  assert.doesNotMatch(oldAfter,/Charger/);
  assert.match(newAfter,/Charger/);
});


test("note migration moves a paired relationship authored through the inverse field",async()=>{
  const inverseOwner="30_Objects/Contactor.md";
  const oldSystem="10_Systems/Old Charger.md";
  const newSystem="10_Systems/New Charger.md";
  const inverseOwnerText=`---
type: Object
uid: 20261005061500010skellyspencer
partOf:
  - "[[10_Systems/Old Charger]]"
---

# Contactor
`;
  const oldSystemText=`---
type: Object
uid: 20261005061500011skellyspencer
hasPart:
  - "[[30_Objects/Contactor]]"
---

# Old Charger
`;
  const newSystemText=`---
type: Object
uid: 20261005061500012skellyspencer
---

# New Charger
`;
  const localResolve=(target:string)=>{
    if(target==="10_Systems/Old Charger") return oldSystem;
    if(target==="10_Systems/New Charger") return newSystem;
    if(target==="30_Objects/Contactor") return inverseOwner;
    return target.endsWith(".md")?target:target+".md";
  };
  const store=new MemoryStore();
  store.files.set(inverseOwner,inverseOwnerText);
  store.files.set(oldSystem,oldSystemText);
  store.files.set(newSystem,newSystemText);
  const service=new DefinitionNoteMigrationService(
    store,(target)=>localResolve(target),(target)=>target.replace(/\.md$/,""),new TransactionManager(),
  );
  const staged=await service.stageAndReview({
    ownerPath:inverseOwner,
    field:"partOf",
    replacedPath:oldSystem,
    replacementPath:newSystem,
    relationship:rel,
  });
  assert.equal(staged.plan.authoredAsInverse,true);
  await service.apply(staged.transaction.id);
  assert.match(await store.read(inverseOwner),/New Charger/);
  assert.doesNotMatch(await store.read(inverseOwner),/Old Charger/);
  assert.doesNotMatch(await store.read(oldSystem),/Contactor/);
  assert.match(await store.read(newSystem),/hasPart:/);
  assert.match(await store.read(newSystem),/Contactor/);
});


test("note migration refuses missing old inverse instead of repairing it silently",async()=>{
  const brokenOld=oldText.replace(/partOf:\n  - "\[\[10_Systems\/Charger\]\]"\n/,"");
  const store=new MemoryStore();
  store.files.set(owner,ownerText); store.files.set(oldPath,brokenOld); store.files.set(newPath,newText);
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,new TransactionManager());
  await assert.rejects(
    service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel}),
    /does not point back.*will not repair it silently/,
  );
  assert.equal(await store.read(owner),ownerText);
  assert.equal(await store.read(oldPath),brokenOld);
  assert.equal(await store.read(newPath),newText);
});

test("note migration refuses an already-present replacement inverse instead of duplicating it",async()=>{
  const alreadyLinkedNew="---\ntype: Object\nuid: 20261005061500002skellyspencer\npartOf:\n  - \"[[10_Systems/Charger]]\"\n---\n\n# New\n";
  const store=new MemoryStore();
  store.files.set(owner,ownerText); store.files.set(oldPath,oldText); store.files.set(newPath,alreadyLinkedNew);
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,new TransactionManager());
  await assert.rejects(
    service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel}),
    /already points to.*will not create a duplicate/,
  );
  assert.equal(await store.read(owner),ownerText);
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),alreadyLinkedNew);
});


test("note migration removes an emptied inverse property without disturbing adjacent YAML",async()=>{
  const oldWithAdjacent=`---
type: Object
uid: 20261005061500001skellyspencer
# relationship comment belongs to the property below
partOf:
  - "[[10_Systems/Charger]]"
custom: 'keep me'
---

# Old
`;
  const store=new MemoryStore();
  store.files.set(owner,ownerText);
  store.files.set(oldPath,oldWithAdjacent);
  store.files.set(newPath,newText);
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,new TransactionManager());
  const staged=await service.stageAndReview({
    ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel,
  });
  await service.apply(staged.transaction.id);
  const after=await store.read(oldPath);
  assert.doesNotMatch(after,/^partOf:/m);
  assert.doesNotMatch(after,/partOf:\s*\[\]/);
  assert.ok(after.includes("# relationship comment belongs to the property below"));
  assert.ok(after.includes("custom: 'keep me'"));
  assert.ok(after.endsWith("\n# Old\n"));
});


test("note migration undo rolls back earlier files if a later paired-file write fails",async()=>{
  class FailingUndoStore extends MemoryStore {
    failPath:string|null=null;
    failText:string|null=null;
    async write(path:string,text:string){
      if(path===this.failPath && text===this.failText) throw new Error("injected undo write failure");
      return super.write(path,text);
    }
  }
  const store=new FailingUndoStore();
  store.files.set(owner,ownerText); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);
  const staged=await service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  await service.apply(staged.transaction.id);

  const ownerAfter=await store.read(owner);
  const oldAfter=await store.read(oldPath);
  const newAfter=await store.read(newPath);
  store.failPath=oldPath;
  store.failText=oldText;

  await assert.rejects(tx.undo(),/injected undo write failure/);
  assert.equal(await store.read(owner),ownerAfter);
  assert.equal(await store.read(oldPath),oldAfter);
  assert.equal(await store.read(newPath),newAfter);
  assert.equal(tx.history().length,1);
});


test("note migration redo rolls back earlier files if a later paired-file write fails",async()=>{
  class FailingRedoStore extends MemoryStore {
    failPath:string|null=null;
    failText:string|null=null;
    async write(path:string,text:string){
      if(path===this.failPath && text===this.failText) throw new Error("injected redo write failure");
      return super.write(path,text);
    }
  }
  const store=new FailingRedoStore();
  store.files.set(owner,ownerText); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);
  const staged=await service.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  await service.apply(staged.transaction.id);
  await tx.undo();

  store.failPath=oldPath;
  store.failText=oldText.replace("Old Contactor","Old Contactor"); // set below to actual migrated text
  const migratedOwner=staged.plan.sourceMutation ? ownerText.replace("Old Contactor","New Contactor") : ownerText;
  const beforeOwner=await store.read(owner);
  const beforeOld=await store.read(oldPath);
  const beforeNew=await store.read(newPath);

  // Capture actual migrated old file text by performing a guarded redo once on a separate store.
  const probe=new MemoryStore(); probe.files.set(owner,ownerText); probe.files.set(oldPath,oldText); probe.files.set(newPath,newText);
  const probeTx=new TransactionManager();
  const probeService=new DefinitionNoteMigrationService(probe,(target)=>resolve(target),linkText,probeTx);
  const probeStaged=await probeService.stageAndReview({ownerPath:owner,field:"hasPart",replacedPath:oldPath,replacementPath:newPath,relationship:rel});
  await probeService.apply(probeStaged.transaction.id);
  store.failText=await probe.read(oldPath);

  await assert.rejects(tx.redo(),/injected redo write failure/);
  assert.equal(await store.read(owner),beforeOwner);
  assert.equal(await store.read(oldPath),beforeOld);
  assert.equal(await store.read(newPath),beforeNew);
  assert.equal(tx.history().length,0);
  void migratedOwner;
});


test("one-way note migration refuses Apply and Redo when replacement definition disappears",async()=>{
  const oneWay={
    field:"participants",kind:"oneWay",from:"any",to:"any",sameClass:false,
    excludePairs:[],provisional:false,temporary:false,order:0,
  } as RelationshipDef;
  const oneWayOwner="20_UseCases/Charge.md";
  const oneWayOwnerText="---\ntype: Use Case\nuid: 20261005061500003skellyspencer\nparticipants:\n  - \"[[30_Objects/Old Contactor]]\"\n---\n\n# Charge\n";

  const store=new MemoryStore();
  store.files.set(oneWayOwner,oneWayOwnerText);
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);

  const staged=await service.stageAndReview({
    ownerPath:oneWayOwner,field:"participants",replacedPath:oldPath,replacementPath:newPath,relationship:oneWay,
  });
  store.files.delete(newPath);
  await assert.rejects(service.apply(staged.transaction.id),/no longer exists/);
  assert.equal(await store.read(oneWayOwner),oneWayOwnerText);
  service.cancel(staged.transaction.id);

  store.files.set(newPath,newText);
  const staged2=await service.stageAndReview({
    ownerPath:oneWayOwner,field:"participants",replacedPath:oldPath,replacementPath:newPath,relationship:oneWay,
  });
  await service.apply(staged2.transaction.id);
  await tx.undo();
  store.files.delete(newPath);
  await assert.rejects(tx.redo(),/no longer exists/);
  assert.equal(await store.read(oneWayOwner),oneWayOwnerText);
});


test("note migration refuses staging when indexed source UIDs no longer match canonical notes",async()=>{
  const store=new MemoryStore();
  store.files.set(owner,ownerText);
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);

  const base={
    ownerPath:owner,
    ownerUid:"20261005061500000skellyspencer",
    field:"hasPart",
    replacedPath:oldPath,
    replacedUid:"20261005061500001skellyspencer",
    replacementPath:newPath,
    replacementUid:"20261005061500002skellyspencer",
    relationship:rel,
  };

  await assert.rejects(
    service.stageAndReview({...base,ownerUid:"20261005061500009skellyspencer"}),
    /expected .* uid .* found/,
  );
  await assert.rejects(
    service.stageAndReview({...base,replacedUid:"20261005061500009skellyspencer"}),
    /expected .* uid .* found/,
  );
  await assert.rejects(
    service.stageAndReview({...base,replacementUid:"20261005061500009skellyspencer"}),
    /expected .* uid .* found/,
  );
  assert.equal(tx.history().length,0);
});


test("one-way note migration refuses Apply and Redo when replacement path keeps a different UID",async()=>{
  const oneWay={
    field:"participants",kind:"oneWay",from:"any",to:"any",sameClass:false,
    excludePairs:[],provisional:false,temporary:false,order:0,
  } as RelationshipDef;
  const oneWayOwner="20_UseCases/Charge Identity.md";
  const oneWayOwnerText="---\ntype: Use Case\nuid: 20261005061500013skellyspencer\nparticipants:\n  - \"[[30_Objects/Old Contactor]]\"\n---\n\n# Charge Identity\n";
  const replacementUid="20261005061500002skellyspencer";
  const replacementChangedUid="20261005061500099skellyspencer";
  const swappedNewText=newText.replace(replacementUid,replacementChangedUid);

  const store=new MemoryStore();
  store.files.set(oneWayOwner,oneWayOwnerText);
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionNoteMigrationService(store,(target)=>resolve(target),linkText,tx);

  const staged=await service.stageAndReview({
    ownerPath:oneWayOwner,
    ownerUid:"20261005061500013skellyspencer",
    field:"participants",
    replacedPath:oldPath,
    replacedUid:"20261005061500001skellyspencer",
    replacementPath:newPath,
    replacementUid,
    relationship:oneWay,
  });
  store.files.set(newPath,swappedNewText);
  await assert.rejects(service.apply(staged.transaction.id),/identity changed; expected uid .* found/);
  assert.equal(await store.read(oneWayOwner),oneWayOwnerText);
  service.cancel(staged.transaction.id);

  store.files.set(newPath,newText);
  const staged2=await service.stageAndReview({
    ownerPath:oneWayOwner,
    ownerUid:"20261005061500013skellyspencer",
    field:"participants",
    replacedPath:oldPath,
    replacedUid:"20261005061500001skellyspencer",
    replacementPath:newPath,
    replacementUid,
    relationship:oneWay,
  });
  await service.apply(staged2.transaction.id);
  await tx.undo();
  store.files.set(newPath,swappedNewText);
  await assert.rejects(tx.redo(),/identity changed; expected uid .* found/);
  assert.equal(await store.read(oneWayOwner),oneWayOwnerText);
});
