import assert from "node:assert/strict";
import test from "node:test";
import {
  allocateLocalId,
  allocateUid,
  localTimestamp,
  normalizeAuthorCode,
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
