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
