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
const resolve=(target:string,fromPath:string)=>{
  void fromPath;
  if(target==="Old Contactor" || target==="30_Objects/Old Contactor") return oldPath;
  if(target==="New Contactor" || target==="30_Objects/New Contactor") return newPath;
  if(target==="Another Contactor" || target==="30_Objects/Another Contactor") return "30_Objects/Another Contactor.md";
  return target.endsWith(".md")?target:target+".md";
};
const linkText=(targetPath:string,fromPath:string)=>{
  void fromPath;
  return targetPath.replace(/^.*\//,"").replace(/\.md$/,"");
};

test("supersession stages and reviews paired relationship without writing dependents",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const impact:DefinitionDeletionImpact={
    definitionPath:oldPath,
    noteUses:[{fromPath:"System.md",field:"hasPart"}],
    occurrenceUses:[{ownerPath:"Assembly.md",localId:"part-x",kind:"part",identifier:"K1"}],
  };
  const service=new DefinitionSupersessionService(store,async()=>impact,resolve,linkText,tx);
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
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,tx);
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
  const service=new DefinitionSupersessionService(store,async()=>impact,resolve,linkText,tx);
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
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  store.files.set(newPath,newText+"external\n");
  await assert.rejects(service.apply(staged.transaction.id),/changed after Review/);
  assert.equal(tx.history().length,0);
  service.cancel(staged.transaction.id);
});


test("supersession preserves unrelated frontmatter formatting and comments byte-for-byte",async()=>{
  const formattedOld=`---
# lifecycle comment
type: Object
uid: ${oldUid}
status: retired # keep inline comment
custom: 'keep single quotes'

---

# Old Contactor
`;
  const formattedNew=`---
type: Object
# identity comment
uid: ${newUid}
status: "active"
custom:
  nested: value

---

# New Contactor
`;
  const store=new MemorySupersessionStore(); store.files.set(oldPath,formattedOld); store.files.set(newPath,formattedNew);
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,new TransactionManager());
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  await service.apply(staged.transaction.id);
  const oldAfter=await store.read(oldPath);
  const newAfter=await store.read(newPath);
  assert.ok(oldAfter.includes("# lifecycle comment\ntype: Object\nuid: "+oldUid+"\nstatus: retired # keep inline comment\ncustom: 'keep single quotes'\n"));
  assert.ok(newAfter.includes("type: Object\n# identity comment\nuid: "+newUid+"\nstatus: \"active\"\ncustom:\n  nested: value\n"));
  assert.ok(oldAfter.endsWith("\n# Old Contactor\n"));
  assert.ok(newAfter.endsWith("\n# New Contactor\n"));
});

test("supersession changes only an existing relationship value",async()=>{
  const replacementWithExisting=`---
type: Object
uid: ${newUid}
status: active
supersedes:
  - "[[30_Objects/Another Contactor]]" # existing relationship comment
custom: 'unchanged'
---

# New Contactor
`;
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,replacementWithExisting);
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,new TransactionManager());
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  await service.apply(staged.transaction.id);
  const after=await store.read(newPath);
  assert.ok(after.includes("type: Object\nuid: "+newUid+"\nstatus: active\n"));
  assert.ok(after.includes("custom: 'unchanged'"));
  assert.ok(after.includes("[[30_Objects/Another Contactor]]"));
  assert.ok(after.includes("[[Old Contactor]]"));
  assert.ok(after.endsWith("\n# New Contactor\n"));
});


test("supersession does not duplicate an alternate link text that resolves to the same definition",async()=>{
  const replacementAlreadyLinked=`---
type: Object
uid: ${newUid}
status: active
supersedes:
  - "[[Old Contactor]]"
---

# New Contactor
`;
  const replacedAlreadyLinked=`---
type: Object
uid: ${oldUid}
status: retired
supersededBy:
  - "[[New Contactor]]"
---

# Old Contactor
`;
  const store=new MemorySupersessionStore();
  store.files.set(oldPath,replacedAlreadyLinked);
  store.files.set(newPath,replacementAlreadyLinked);
  const tx=new TransactionManager();
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  await service.apply(staged.transaction.id);
  assert.equal(await store.read(newPath),replacementAlreadyLinked);
  assert.equal(await store.read(oldPath),replacedAlreadyLinked);
});


test("supersession refuses unresolved existing relationship targets instead of appending beside ambiguity",async()=>{
  const replacementWithBrokenExisting=`---
type: Object
uid: ${newUid}
status: active
supersedes:
  - "[[Missing Definition]]"
---

# New Contactor
`;
  const store=new MemorySupersessionStore();
  store.files.set(oldPath,oldText);
  store.files.set(newPath,replacementWithBrokenExisting);
  const unresolved=(target:string,fromPath:string)=>{
    void fromPath;
    if(target==="Missing Definition") return null;
    return resolve(target,fromPath);
  };
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),unresolved,linkText,new TransactionManager());
  await assert.rejects(
    service.stageAndReview({
      replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
      replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
    }),
    /existing relationship target "Missing Definition" cannot be resolved/,
  );
  assert.equal(await store.read(newPath),replacementWithBrokenExisting);
  assert.equal(await store.read(oldPath),oldText);
});


test("supersession redo refuses changed migration inventory after undo",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  let impact=clearImpact();
  const service=new DefinitionSupersessionService(store,async()=>impact,resolve,linkText,tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  await service.apply(staged.transaction.id);
  await tx.undo();
  impact={definitionPath:oldPath,noteUses:[{fromPath:"System.md",field:"hasPart"}],occurrenceUses:[]};
  await assert.rejects(tx.redo(),/dependent usage changed after Review/);
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),newText);
});


test("semantic history requires newer migration-like edits to undo before supersession",async()=>{
  const store=new MemorySupersessionStore(); store.files.set(oldPath,oldText); store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,tx);
  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",replacementStatus:"active",
  });
  await service.apply(staged.transaction.id);

  let newerApplied=true;
  tx.recordApplied(
    "migration-after-supersession",
    "migrate dependent after supersession",
    "structural",
    [{kind:"definition.note-migrate",summary:"migrate dependent",refs:[]}],
    {
      undo:async()=>{ newerApplied=false; },
      redo:async()=>{ newerApplied=true; },
    },
  );

  await tx.undo();
  assert.equal(newerApplied,false);
  assert.match(await store.read(newPath),/supersedes:/);
  assert.match(await store.read(oldPath),/supersededBy:/);

  await tx.undo();
  assert.equal(await store.read(oldPath),oldText);
  assert.equal(await store.read(newPath),newText);
});


test("supersession refuses staging when either source UID does not match the canonical note", async()=>{
  const store=new MemorySupersessionStore();
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText);
  const tx=new TransactionManager();
  const service=new DefinitionSupersessionService(store,async()=>clearImpact(),resolve,linkText,tx);

  await assert.rejects(
    service.stageAndReview({
      replacedPath:oldPath,replacedUid:"20261005061000009skellyspencer",replacedType:"Object",
      replacementPath:newPath,replacementUid:newUid,replacementType:"Object",
      replacementStatus:"active",
    }),
    /expected .* uid .* found/,
  );

  await assert.rejects(
    service.stageAndReview({
      replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
      replacementPath:newPath,replacementUid:"20261005061000009skellyspencer",replacementType:"Object",
      replacementStatus:"active",
    }),
    /expected .* uid .* found/,
  );
  assert.equal(tx.history().length,0);
});


test("supersession class compatibility is decided from fresh source types, not stale caller types", async()=>{
  const store=new MemorySupersessionStore();
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText.replace("type: Object","type: Function"));
  const service=new DefinitionSupersessionService(
    store,async()=>clearImpact(),resolve,linkText,new TransactionManager(),
  );

  await assert.rejects(
    service.stageAndReview({
      replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
      replacementPath:newPath,replacementUid:newUid,replacementType:"Object",
      replacementStatus:"active",
    }),
    /Supersession requires the same model class; Function cannot supersede Object/,
  );
});

test("supersession replacement status warning is decided from fresh source status, not stale caller status", async()=>{
  const store=new MemorySupersessionStore();
  store.files.set(oldPath,oldText);
  store.files.set(newPath,newText.replace("status: active","status: retired"));
  const service=new DefinitionSupersessionService(
    store,async()=>clearImpact(),resolve,linkText,new TransactionManager(),
  );

  const staged=await service.stageAndReview({
    replacedPath:oldPath,replacedUid:oldUid,replacedType:"Object",
    replacementPath:newPath,replacementUid:newUid,replacementType:"Object",
    replacementStatus:"active",
  });
  assert.ok(staged.plan.warnings.includes("The selected replacement definition is already retired."));
  service.cancel(staged.transaction.id);
});
