import { variantOfMetadataFinding } from "../src/core/variantof-format";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import { variantOfFormatError } from "../src/core/variantof-format";
import { toFindings, countByCategory } from "../src/core/review";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ModelIndex } from "../src/core/model";
import { validateVariantOf } from "../src/core/variantof";
import { parseSchema } from "../src/core/schema";
const schema = parseSchema(
 { schemaVersion:"1.37", oneWay:[{ field:"variantOf", from:["Object"], to:["Object"] }] },
 { schemaVersion:"1.18", commonProperties:["type","id","uid","status","tags"], classes:[{name:"Object",prefix:"OBJ",subtype:[]},{name:"Requirement",prefix:"REQ",subtype:[]}] }
);
function graph(rows:Array<[string,string, string[]?]>) {
 const index=new ModelIndex(schema);
 for(const [path,type,targets] of rows) index.upsert({path,name:path,type,fields:new Map(targets?[["variantOf",targets]]:[]),unresolved:0});
 return {index, codes:validateVariantOf(index).map(x=>x.code)};
}
test("variantOf: single Object target, siblings, no stored inverse and no subtype edge",()=>{
 const {index,codes}=graph([["A","Object",["Family"]],["B","Object",["Family"]],["Family","Object"]]);
 assert.deepEqual(codes,[]);
 assert.equal(index.out("A")[0].field,"variantOf");
 assert.deepEqual(index.out("Family"),[]);
 assert.equal(index.findings().missingInverse.length,0);
});
test("variantOf: missing target, non-Object owner and target",()=>{
 const a=graph([["A","Object",["Absent"]]]);
 assert.ok(a.codes.includes("variant.target-missing"));
 const b=graph([["A","Requirement",["B"]],["B","Requirement"]]);
 assert.ok(b.codes.includes("variant.endpoint-invalid"));
});
test("variantOf: self link, multiple targets and cycles",()=>{
 assert.ok(graph([["A","Object",["A"]]]).codes.includes("variant.self"));
 assert.ok(graph([["A","Object",["B","C"]],["B","Object"],["C","Object"]]).codes.includes("variant.multiple"));
 const c=graph([["A","Object",["B"]],["B","Object",["C"]],["C","Object",["A"]]]);
 assert.equal(c.codes.filter(x=>x==="variant.cycle").length,3);
});

test("variantOf issues appear as stable Review findings",()=>{
 const {index}=graph([["A","Object",["Missing"]]]);
 const {index: valid}=graph([["A","Object",["Family"]],["Family","Object"]]);
 const issues=validateVariantOf(index);
 const review=toFindings(index.findings(), [], issues);
 assert.ok(review.some(x=>x.category==="variantOf" && x.field==="variantOf" && x.reason==="variant.target-missing"));
 assert.equal(countByCategory(review).variantOf,1);
 assert.equal(toFindings(valid.findings(),[],validateVariantOf(valid)).filter(x=>x.category==="variantOf").length,0);
});

test("variantOf retains duplicate resolved links and unresolved YAML evidence", () => {
  const index = new ModelIndex(schema);
  index.upsert({path:"Family", name:"Family", type:"Object", fields:new Map(), unresolved:0});
  index.upsert({path:"A",name:"A",type:"Object",fields:new Map([["variantOf",["Family"]]]),
    unresolved:1, broken:[{field:"variantOf",link:"[[Not Found]]"}],
    repeat:new Map([["variantOf|Family",2]])});
  const codes=validateVariantOf(index).map(x=>x.code);
  assert.ok(codes.includes("variant.duplicate"));
  assert.ok(codes.includes("variant.unresolved"));
  assert.ok(codes.includes("variant.multiple"));
  const review=toFindings(index.findings(),[],validateVariantOf(index));
  assert.ok(review.some(x=>x.category==="variantOf" && x.reason==="variant.duplicate"));
  assert.ok(review.some(x=>x.category==="variantOf" && x.reason==="variant.unresolved"));
  assert.ok(review.some(x=>x.category==="broken" && x.field==="variantOf"));
});

test("raw YAML format issues survive into Review findings", () => {
  assert.equal(variantOfFormatError("[[Family]]"),null);
  assert.equal(variantOfFormatError("[[Family|Alias]]"),null);
  for (const value of ["Family", "[[A]], [[B]]", ["[[A]]"], 3, true, "[[Family#^block]]"]) {
    assert.ok(variantOfFormatError(value), String(value));
  }
  const {index}=graph([["A","Object"]]);
  const note=index.notes.get("A")!;
  note.variantOfFormatError=variantOfFormatError("Family")!;
  const issues=validateVariantOf(index);
  assert.ok(issues.some(x=>x.code==="variant.format"));
  assert.ok(toFindings(index.findings(),[],issues).some(x=>x.category==="variantOf" && x.reason==="variant.format"));
});

test("reresolution retains raw format diagnosis while updating link evidence", () => {
 const {index}=graph([["A","Object"],["Family","Object"]]);
 const original=index.notes.get("A")!;
 original.variantOfFormatError="variantOf must contain exactly one note-level [[Target]] link.";
 const authored=[{field:"variantOf",link:"[[Family]]",linkpath:"Family"}];
 const resolved=resolveAuthoredRelationshipLinks(authored,"A",schema,(target)=>target==="Family"?"Family":undefined);
 index.upsert({...original,fields:resolved.fields,unresolved:resolved.unresolved,broken:resolved.broken,repeat:resolved.repeat});
 assert.equal(index.notes.get("A")?.variantOfFormatError,original.variantOfFormatError);
 assert.ok(validateVariantOf(index).some(x=>x.code==="variant.format"));
});

test("Obsidian metadata-cache-shaped frontmatter retains malformed variantOf independently of links",()=>{
 const noLinks={frontmatter:{type:"Object",variantOf:"Family"},frontmatterLinks:[] as unknown[]};
 assert.ok(variantOfMetadataFinding(noLinks.frontmatter));
 assert.equal(variantOfMetadataFinding({type:"Object",variantOf:"[[Family]]"}),undefined);
 assert.ok(variantOfMetadataFinding({type:"Object",variantOf:["[[Family]]","[[Other]]"]}));
 assert.ok(variantOfMetadataFinding({type:"Object",variantOf:5}));
 assert.equal(variantOfMetadataFinding({type:"Object"}),undefined);
 assert.equal(variantOfMetadataFinding(null),undefined);
});
