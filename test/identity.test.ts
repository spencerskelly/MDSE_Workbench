import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateLocalId,
  allocateUid,
  assertIndexedNoteUidMatchesSource,
  localTimestamp,
  normalizeAuthorCode,
  sourceUidFromMarkdown,
  tokenFromLocalId,
} from "../src/core/identity";

test("author code is last name then first name, normalized to 13 characters",()=>{
  assert.equal(normalizeAuthorCode("Spencer","Skelly"),"skellyspencer");
  assert.equal(normalizeAuthorCode("Ada","Li"),"liada--------");
  assert.equal(normalizeAuthorCode("Jörg","Müller"),"mullerjorg---");
});

test("timestamp uses local Date fields with milliseconds",()=>{
  const d=new Date(2026,9,3,13,35,12,742);
  assert.equal(localTimestamp(d),"20261003133512742");
});

test("allocation advances one millisecond until the global token is unused",()=>{
  const d=new Date(2026,9,3,13,35,12,742);
  const used=new Set([
    "20261003133512742skellyspencer",
    "20261003133512743skellyspencer",
  ]);
  const a=allocateUid(d,"skellyspencer",used);
  assert.equal(a.uid,"20261003133512744skellyspencer");
  assert.equal(a.collisionSteps,2);
});

test("local identity uses the same global token with representation prefix",()=>{
  const d=new Date(2026,9,3,13,35,12,742);
  const a=allocateLocalId("endpoint",d,"skellyspencer",new Set());
  assert.equal(a.localId,"ep-20261003133512742skellyspencer");
  assert.equal(tokenFromLocalId(a.localId),a.uid);
});


test("source uid guard fails closed on stale or missing source identity",()=> {
  const uid="20261003133512742skellyspencer";
  const source=["---","type: Object","uid: "+uid,"---","","# A"].join("\n");
  assert.equal(sourceUidFromMarkdown(source),uid);
  assert.doesNotThrow(()=>assertIndexedNoteUidMatchesSource("A.md",source,uid,"edit relationship in"));
  assert.throws(
    ()=>assertIndexedNoteUidMatchesSource("A.md",source,"20261003133512743skellyspencer","edit relationship in"),
    /indexed uid .* does not match source uid/,
  );
  assert.throws(
    ()=>assertIndexedNoteUidMatchesSource("A.md","# no frontmatter",uid,"edit relationship in"),
    /source uid none/,
  );
});
