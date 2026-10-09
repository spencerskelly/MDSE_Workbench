/**
 * Candidate-only Local Model 0.5 real-QEAX acceptance.
 * Never writes to the source vault. Does not replace the accepted 0.4 gates.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, relative, isAbsolute, join, sep } from "node:path";
import { parseLocalModel } from "../src/core/localmodel";
import { planLocalRecordPatch } from "../src/core/localmodel-edit";

const rootArg = process.argv[2];
const reportArg = process.argv[3];
if (!rootArg || !reportArg) {
  console.error("Usage: npm run accept:real-vault:05 -- <vault-dir> <report-json-outside-vault>");
  process.exit(2);
}
const root = resolve(rootArg), report = resolve(reportArg);
const reportRelative = relative(root, report);
if (!reportRelative || (!reportRelative.startsWith(".." + sep) && reportRelative !== ".." && !isAbsolute(reportRelative))) {
  throw new Error("A real-vault acceptance report may not be written into its source vault.");
}
const failures: string[] = [];
const check = (ok: boolean, why: string) => { if (!ok) failures.push(why); };
const read = async (name: string): Promise<string> => readFile(join(root, name), "utf8");
const manifestNumber = (manifest: string, name: string): number => {
  const line = manifest.split(/\r?\n/).find(s => s.startsWith("- " + name + ":"));
  const value = line ? Number(line.slice(("- " + name + ":").length).trim().replace(/,/g, "")) : NaN;
  check(Number.isSafeInteger(value) && value >= 0, "Missing/invalid Run Manifest count: " + name);
  return value;
};
async function markdownFiles(dir: string): Promise<string[]> {
  const found: string[] = [];
  async function descend(path: string): Promise<void> {
    for (const item of await readdir(path, { withFileTypes: true })) {
      if (item.name === ".git" || item.name === ".obsidian" || item.name === "node_modules") continue;
      const full = join(path, item.name);
      if (item.isDirectory()) await descend(full);
      else if (item.isFile() && item.name.toLowerCase().endsWith(".md")) found.push(full);
    }
  }
  await descend(dir);
  return found.sort();
}
const run = async () => {
  const started = Date.now();
  const manifest = await read("99_System/11_Import/Run Manifest.md");
  const state = JSON.parse(await read("99_System/11_Import/Import State.json")) as Record<string, any>;
  const localSchema = await read("99_System/03_Schemas/local-model.yaml");
  check(/^schemaVersion:\s*["']?0\.5["']?\s*$/m.test(localSchema), "Runtime local-model.yaml is not schema 0.5");
  check(/^[ \t]*writableVersion:\s*["']?0\.5["']?[ \t]*$/m.test(localSchema), "Runtime schema is not writable 0.5");
  check(state.status === "IMPORT_COMPLETE", "Import State must be IMPORT_COMPLETE");
  check(state.runStatus?.write === "WRITE_PASS", "Import State write gate must be WRITE_PASS");
  check(state.runStatus?.acceptance === "ACCEPTANCE_PENDING", "Semantic acceptance must remain pending before promotion");
  const files = await markdownFiles(root);
  const counts: Record<"part" | "endpoint" | "connection" | "flow", number> = {part:0, endpoint:0, connection:0, flow:0};
  const expected = {
    part: manifestNumber(manifest, "Local parts"),
    endpoint: manifestNumber(manifest, "Local endpoints"),
    connection: manifestNumber(manifest, "Local connections"),
    flow: manifestNumber(manifest, "Local flows"),
    definitionless: manifestNumber(manifest, "Definitionless contextual endpoints (W-377)"),
  };
  let defless = 0, exposures = 0, localRegions = 0, parsedErrors = 0, noOpSamples = 0, noOpDrifts = 0;
  const directed = new Set<string>();
  const undirected = new Set<string>();
  const localIdOwners = new Map<string,string>();
  const samples = new Set<string>();
  const findingExamples: string[] = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    if (!text.includes("MDSE:LOCAL-MODEL")) continue;
    const region = parseLocalModel(text);
    if (!region) { failures.push("Unparseable marker in " + relative(root,file)); continue; }
    localRegions++;
    check(region.structured && region.schemaVersion === "0.5",
      "Non-structured/non-0.5 region in " + relative(root,file) + " (" + region.schemaVersion + ")");
    for(const finding of region.findings) {
      if(finding.severity !== "error") continue;
      parsedErrors++;
      if (findingExamples.length < 16) findingExamples.push(relative(root,file) + ":" + (finding.line??0) + " " + finding.code);
    }
    if (!region.structured || region.schemaVersion !== "0.5") continue;
    for (const record of region.records) {
      counts[record.kind]++;
      if (record.kind === "endpoint" && !record.definition) defless++;
      if (record.kind === "connection") exposures += record.exposes.length;
      if (record.localId) {
        const oldOwner = localIdOwners.get(record.localId);
        check(!oldOwner || oldOwner === file, "Duplicate local ID in different notes: " + record.localId);
        localIdOwners.set(record.localId,file);
      }
      if (record.kind === "endpoint") {
        for (const target of record.equals) {
          if (target.target || !target.blockId || !record.localId) continue;
          directed.add(file + "/" + record.localId + "->" + target.blockId);
          undirected.add(file + "/" + [record.localId,target.blockId].sort().join("::"));
          const peer = region.records.find(r => r.localId === target.blockId && r.kind === "endpoint");
          check(Boolean(peer) && peer!.equals.some(l => !l.target && l.blockId === record.localId),
            "Nonreciprocal or invalid equals: " + relative(root,file) + "#^" + record.localId);
        }
      }
      if (!samples.has(record.kind) && record.localId && region.findings.every(f=>f.severity !== "error")) {
        samples.add(record.kind);
        try {
          const noOp = planLocalRecordPatch(text,record.localId,{}, {allowInvalidTarget:true});
          noOpSamples++;
          if (noOp.changed || noOp.after !== text) noOpDrifts++;
        } catch (err) {
          failures.push("No-op planner failed for " + record.kind + " in " + relative(root,file) + ": " + String(err));
        }
      }
    }
  }
  for(const kind of ["part","endpoint","connection","flow"] as const) {
    check(counts[kind] === expected[kind],
      "Run Manifest / " + kind + " mismatch: " + counts[kind] + " vs " + expected[kind]);
  }
  check(defless===expected.definitionless,"Definitionless Interface count mismatch: " + defless + " vs " + expected.definitionless);
  check(localRegions > 0, "No Local Model 0.5 regions");
  check(parsedErrors === 0,"Local Model parser errors: " + parsedErrors + " e.g. " + findingExamples.join(" | "));
  check(exposures === 23,"Expected 23 Connection.exposes, saw " + exposures);
  check(directed.size === 418,"Expected 418 directed Interface.equals links, saw " + directed.size);
  check(undirected.size === 209,"Expected 209 reciprocal Interface.equals pairs, saw " + undirected.size);
  check(noOpSamples >= 3, "Insufficient no-op planner samples across record kinds: " + noOpSamples);
  check(noOpDrifts === 0, "Non-zero source formatting drift on no-op structured edits: " + noOpDrifts);
  const result = {
    status: failures.length?"FAIL":"PASS", acceptance:"candidate-only", localModelVersion:"0.5",
    sourceVaultUnmodified:true, elapsedMs:Date.now()-started, markdownFiles:files.length,
    localRegions, counts, expected, definitionlessInterfaces:defless,
    exposures, directedEquals:directed.size, canonicalEqualsPairs:undirected.size,
    parsedErrors, noOpSamples, noOpDrifts, failures:failures.slice(0,100)
  };
  const json=JSON.stringify(result,null,2) + "\n";
  await writeFile(report,json,"utf8");
  console.log("WORKBENCH_05_REAL_QEAX_RESULT_BEGIN\n"+json.trimEnd()+"\nWORKBENCH_05_REAL_QEAX_RESULT_END");
  if (failures.length) process.exitCode=1;
};
run().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : String(error)); process.exitCode=1; });
