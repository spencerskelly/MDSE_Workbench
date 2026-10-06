import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseSchema } from "../src/core/schema";
import { ModelIndex, type AuthoredRelationshipLink, type NoteRecord } from "../src/core/model";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import { LocalModelIndex, parseLocalModel, validateLocalModels, type LocalFinding } from "../src/core/localmodel";
import { planLocalRecordPatch } from "../src/core/localmodel-edit";
import {
  INTERFACES_PROFILE, REQUIREMENTS_PROFILE, STRUCTURE_PROFILE, WHERE_USED_PROFILE,
  traverse, withLocalInterfaces, withLocalRequirements, withLocalStructure, withLocalWhereUsed,
} from "../src/core/views";
import { buildInternalView } from "../src/core/internal-view";

type Obj = Record<string, unknown>;
const root = process.argv[2], reportPath = process.argv[3];
if (!root) { console.error("Usage: npm run accept:real-vault -- <vault-path> [report-json]"); process.exit(2); }
const started = Date.now();
const posix = (p: string) => p.split(sep).join("/");
const stem = (p: string) => basename(p).replace(/\.md$/i, "");
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

async function markdownFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(cur: string): Promise<void> {
    for (const ent of await readdir(cur, { withFileTypes: true })) {
      if (ent.name === ".git" || ent.name === "node_modules") continue;
      const full = join(cur, ent.name);
      if (ent.isDirectory()) await walk(full);
      else if (ent.isFile() && ent.name.toLowerCase().endsWith(".md")) out.push(full);
    }
  }
  await walk(dir); return out.sort();
}
function frontmatter(text: string): Obj {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  const parsed = parseYaml(m[1]); return isObj(parsed) ? parsed : {};
}
const scalarStrings = (v: unknown): string[] => typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
function authoredLinks(fm: Obj, fields: Set<string>): AuthoredRelationshipLink[] {
  const out: AuthoredRelationshipLink[] = [];
  for (const field of fields) for (const raw of scalarStrings(fm[field])) {
    const matches = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)];
    if (!matches.length) {
      const linkpath = raw.split("|")[0].split("#")[0].trim();
      if (linkpath) out.push({ field, link: raw, linkpath });
    } else for (const m of matches) {
      const left = m[1].split("|")[0], linkpath = left.split("#")[0].trim();
      out.push({ field, link: m[0], linkpath });
    }
  }
  return out;
}
function manifestNumber(text: string, label: string): number {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("- " + label + ":")) continue;
    const m = /([0-9][0-9,]*)/.exec(line.slice(label.length + 3));
    if (m) return Number(m[1].replaceAll(",", ""));
  }
  throw new Error("Run Manifest is missing numeric field: " + label);
}
function countCodes(findings: readonly LocalFinding[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const f of findings) out[f.code] = (out[f.code] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort((a,b)=>a[0].localeCompare(b[0])));
}

const abs = await markdownFiles(root), files = abs.map((p)=>posix(relative(root,p)));
const texts = new Map<string,string>(), fms = new Map<string,Obj>();
for (let i=0;i<files.length;i++) { const t=await readFile(abs[i],"utf8"); texts.set(files[i],t); fms.set(files[i],frontmatter(t)); }

const schema=parseSchema(
  parseYaml(await readFile(join(root,"99_System/03_Schemas/relationships.yaml"),"utf8")),
  parseYaml(await readFile(join(root,"99_System/03_Schemas/element-types.yaml"),"utf8"))
);
if(schema.warnings.length) throw new Error("Vault schema warnings: "+schema.warnings.join(" | "));

const pathByLower=new Map<string,string>(), byStem=new Map<string,string[]>();
for(const file of files){
  pathByLower.set(file.toLowerCase(),file); pathByLower.set(file.replace(/\.md$/i,"").toLowerCase(),file);
  const k=stem(file).toLowerCase(), a=byStem.get(k)??[]; a.push(file); byStem.set(k,a);
}
const resolve=(target:string,fromPath:string):string|undefined=>{
  const raw=target.trim(); if(!raw)return fromPath;
  const clean=raw.replace(/\\/g,"/").replace(/^\.\//,"").replace(/\.md$/i,"");
  const exact=pathByLower.get(clean.toLowerCase())??pathByLower.get((clean+".md").toLowerCase());
  if(exact)return exact;
  const a=byStem.get(clean.split("/").at(-1)!.toLowerCase())??[]; return a.length===1?a[0]:undefined;
};

const relationFields=new Set([...schema.byField.keys(),...schema.byInverse.keys()]);
const index=new ModelIndex(schema);
for(const file of files){
  const fm=fms.get(file)!, authored=authoredLinks(fm,relationFields);
  const resolved=resolveAuthoredRelationshipLinks(authored,file,schema,resolve);
  const ar=fm.abstract;
  const rec:NoteRecord={path:file,name:stem(file),
    ...(typeof fm.type==="string"?{type:fm.type}:{}), ...(typeof fm.subtype==="string"?{subtype:fm.subtype}:{}),
    ...(typeof fm.id==="string"?{id:fm.id}:{}), ...(typeof fm.uid==="string"?{uid:fm.uid}:{}),
    authoredLinks:authored,fields:resolved.fields,unresolved:resolved.unresolved,broken:resolved.broken,
    ...(resolved.repeat?{repeat:resolved.repeat}:{}), ...(resolved.localRefs?{localRefs:resolved.localRefs}:{}),
    ...(typeof ar==="boolean"?{abstract:ar}:{}), ...(ar!==undefined&&typeof ar!=="boolean"?{abstractInvalid:true}:{})};
  index.upsert(rec);
}

const local=new LocalModelIndex(), counts={part:0,endpoint:0,connection:0,flow:0};
const idOwners=new Map<string,string[]>(); let defless=0, exposes=0, parserErrors=0, noOpChecks=0, noOpDrift=0;
const driftExamples:string[]=[];
for(const file of files){
  const text=texts.get(file)!; if(!text.includes("MDSE:LOCAL-MODEL"))continue;
  const region=parseLocalModel(text); local.set(file,region); if(!region)continue;
  parserErrors+=region.findings.filter((f)=>f.severity==="error").length;
  if(region.schemaVersion!=="0.4"){parserErrors++;continue;}
  for(const rec of region.records){
    counts[rec.kind]++; if(rec.kind==="endpoint"&&!rec.definition)defless++; if(rec.kind==="connection")exposes+=rec.exposes.length;
    const a=idOwners.get(rec.localId)??[]; a.push(file); idOwners.set(rec.localId,a);
  }
  if(region.structured){
    const seen=new Set<string>();
    for(const rec of region.records){
      if(seen.has(rec.kind))continue; seen.add(rec.kind);
      const p=planLocalRecordPatch(text,rec.localId,{}, {allowInvalidTarget:true}); noOpChecks++;
      if(p.changed||p.after!==text){noOpDrift++; if(driftExamples.length<10)driftExamples.push(file+"#^"+rec.localId);}
    }
  }
}
const duplicateLocalIds=[...idOwners.values()].filter((a)=>a.length>1).length;
const whole=validateLocalModels({index,local,resolve});
const blockers=new Set(["schema.unsupported","marker.duplicate","marker.missing-start","marker.missing-end","marker.order","marker.nested","marker.mismatch",
"record.unknown-section","record.no-block-id","record.block-id-malformed","record.duplicate-id","ref.local-missing","ref.local-kind",
"frontmatter.local-target-missing","exposure.owner-invalid","exposure.cross-context","exposure.not-boundary","identity.collision"]);
const blockingCompatibilityFindings=whole.filter((f)=>blockers.has(f.code)).length;

let blockRefs=0, blockRefFailures=0; const blockExamples:string[]=[];
const rx=/\[\[([^\]]*?)#\^((?:part|ep|conn|flow)-[^\]|]+)(?:\|[^\]]*)?\]\]/g;
for(const file of files) for(const m of texts.get(file)!.matchAll(rx)){
  blockRefs++; const target=resolve(m[1],file);
  if(!target||!local.recordsOf(target).some((r)=>r.localId===m[2])){blockRefFailures++; if(blockExamples.length<10)blockExamples.push(file+" -> "+m[0]);}
}
let legacyPortNotes=0,legacyPortFields=0;
for(const file of files){const fm=fms.get(file)!; if(fm.type==="Port")legacyPortNotes++; for(const k of ["hasPort","interfaces","transmits","receives","hasFlow"])if(fm[k]!==undefined)legacyPortFields++;}

const manifest=await readFile(join(root,"99_System/11_Import/Run Manifest.md"),"utf8");
const expected={notes:manifestNumber(manifest,"Notes written"),part:manifestNumber(manifest,"Local parts"),
endpoint:manifestNumber(manifest,"Local endpoints"),defless:manifestNumber(manifest,"Definitionless contextual endpoints (W-377)"),
connection:manifestNumber(manifest,"Local connections"),flow:manifestNumber(manifest,"Local flows")};

const samples:Record<string,unknown>={};
const partOwner=[...local.regions].find(([p,r])=>index.notes.get(p)?.type==="Object"&&r.structured&&r.records.some((x)=>x.kind==="part"));
if(partOwner){const [owner]=partOwner,b=traverse(index,[owner],STRUCTURE_PROFILE),v=withLocalStructure(index,local,b,STRUCTURE_PROFILE);samples.structure={owner,parts:[...v.localNodes.values()].filter((x)=>x.record.kind==="part").length};}
const topologyOwner=[...local.regions].find(([p,r])=>index.notes.get(p)?.type==="Object"&&r.structured&&r.records.some((x)=>x.kind==="connection"&&x.exposes.length));
if(topologyOwner){const [owner]=topologyOwner,b=traverse(index,[owner],INTERFACES_PROFILE),v=withLocalInterfaces(index,local,resolve,b,INTERFACES_PROFILE),iv=buildInternalView(index,local,owner,resolve);samples.interfaces={owner,localNodes:v.localNodes.size,localEdges:v.localEdges.length,exposesEdges:iv.canvas.edges.filter((e)=>e.id.startsWith("expose:")).length};}
const flowOwner=[...local.regions].find(([p,r])=>index.notes.get(p)?.type==="Object"&&r.structured&&r.records.some((x)=>x.kind==="flow"));
if(flowOwner){const [owner]=flowOwner,b=traverse(index,[owner],INTERFACES_PROFILE),v=withLocalInterfaces(index,local,resolve,b,INTERFACES_PROFILE);samples.flow={owner,flows:[...v.localNodes.values()].filter((x)=>x.record.kind==="flow").length};}
let wu:{definition:string;owner:string;localId:string}|null=null;
for(const [owner,r] of local.regions){if(!r.structured)continue;for(const x of r.records){if(!x.definition?.target)continue;const d=resolve(x.definition.target,owner);if(d){wu={definition:d,owner,localId:x.localId};break;}}if(wu)break;}
if(wu){const b=traverse(index,[wu.definition],WHERE_USED_PROFILE),v=withLocalWhereUsed(index,local,resolve,b,WHERE_USED_PROFILE);samples.whereUsed={...wu,visible:[...v.localNodes.values()].some((x)=>x.ownerPath===wu!.owner&&x.record.localId===wu!.localId)};}
const reqRefs=[...index.notes.values()].flatMap((n)=>(n.localRefs??[]).filter((r)=>r.field==="appliesTo").map((r)=>({requirement:n.path,...r})));
if(reqRefs.length){const s=reqRefs[0],b=traverse(index,[s.requirement],REQUIREMENTS_PROFILE),v=withLocalRequirements(index,local,b,REQUIREMENTS_PROFILE);samples.requirements={count:reqRefs.length,visible:[...v.localNodes.values()].some((x)=>x.ownerPath===s.path&&x.record.localId===s.localId)};}
else samples.requirements={count:0,status:"not exercised by EA8647; covered by unit regression"};

const failures:string[]=[]; const eq=(label:string,a:number,b:number)=>{if(a!==b)failures.push(label+": expected "+b+", got "+a);};
eq("Local Parts",counts.part,expected.part);eq("Local Interfaces",counts.endpoint,expected.endpoint);eq("Definitionless Interfaces",defless,expected.defless);eq("Local Connections",counts.connection,expected.connection);eq("Local flows",counts.flow,expected.flow);
if(duplicateLocalIds)failures.push("duplicate local IDs: "+duplicateLocalIds);
if(parserErrors)failures.push("Local Model parser errors: "+parserErrors);
if(blockingCompatibilityFindings)failures.push("blocking compatibility findings: "+blockingCompatibilityFindings);
if(blockRefFailures)failures.push("broken #^local-id references: "+blockRefFailures);
if(noOpDrift)failures.push("no-op formatting drift: "+noOpDrift);
if(legacyPortNotes)failures.push("first-class Port notes reintroduced: "+legacyPortNotes);
if(legacyPortFields)failures.push("legacy Port relationship fields reintroduced: "+legacyPortFields);
if(!partOwner||Number((samples.structure as Obj|undefined)?.parts??0)<1)failures.push("no real Structure occurrence sample rendered");
if(!topologyOwner||Number((samples.interfaces as Obj|undefined)?.exposesEdges??0)<1)failures.push("no real Connection.exposes sample rendered");
if(!flowOwner||Number((samples.flow as Obj|undefined)?.flows??0)<1)failures.push("no real conveyed flow sample rendered");
if(wu&&(samples.whereUsed as Obj).visible!==true)failures.push("Where Used did not preserve a real occurrence");

const result={status:failures.length?"FAIL":"PASS",vault:root,elapsedMs:Date.now()-started,markdownFiles:files.length,
modelNotes:[...index.notes.values()].filter((n)=>index.isElement(n)).length,records:counts,definitionlessInterfaces:defless,
connectionExposes:exposes,localBlockReferences:blockRefs,localBlockReferenceFailures:blockRefFailures,duplicateLocalIds,
parserErrors,wholeVaultFindings:countCodes(whole),blockingCompatibilityFindings,noOpRegionsChecked:noOpChecks,noOpDrift,
legacyPortNotes,legacyPortFields,expected,samples,failures:[...failures,...blockExamples.map((x)=>"block-ref example: "+x),...driftExamples.map((x)=>"no-op drift example: "+x)]};
const json=JSON.stringify(result,null,2)+"\n"; if(reportPath)await writeFile(reportPath,json,"utf8");
console.log("WB128_REAL_VAULT_RESULT_BEGIN");console.log(json.trimEnd());console.log("WB128_REAL_VAULT_RESULT_END");
if(result.status!=="PASS")process.exit(1);
