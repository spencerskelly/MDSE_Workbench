import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseSchema } from "../src/core/schema";
import { ModelIndex, type AuthoredRelationshipLink, type NoteRecord } from "../src/core/model";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import { LocalModelIndex, parseLocalModel, type LocalRegion } from "../src/core/localmodel";
import {
  INTERFACES_PROFILE,
  STRUCTURE_PROFILE,
  WHERE_USED_PROFILE,
  traverse,
  withLocalInterfaces,
  withLocalStructure,
  withLocalWhereUsed,
} from "../src/core/views";
import { buildInternalView } from "../src/core/internal-view";

type Obj = Record<string, unknown>;
type Candidate = { path: string; region: LocalRegion };

const rootArg = process.argv[2];
const reportPath = process.argv[3];
if (!rootArg) {
  console.error("Usage: npm run accept:real-vault:views -- <vault-path> [report-json]");
  process.exit(2);
}

const root = resolvePath(rootArg);
if (reportPath) {
  const report = resolvePath(reportPath);
  const rel = relative(root, report);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error("Gate 3 refuses to write its report inside the candidate vault.");
  }
}

const posix = (p: string) => p.split(sep).join("/");
const stem = (p: string) => basename(p).replace(/\.md$/i, "");
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const scalarStrings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

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
  await walk(dir);
  return out.sort();
}

function frontmatter(text: string): Obj {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  const parsed = parseYaml(m[1]);
  return isObj(parsed) ? parsed : {};
}

function authoredLinks(fm: Obj, fields: Set<string>): AuthoredRelationshipLink[] {
  const out: AuthoredRelationshipLink[] = [];
  for (const field of fields) {
    for (const raw of scalarStrings(fm[field])) {
      const matches = [...raw.matchAll(/\[\[([^\]]+)\]\]/g)];
      if (!matches.length) {
        const linkpath = raw.split("|")[0].split("#")[0].trim();
        if (linkpath) out.push({ field, link: raw, linkpath });
      } else {
        for (const m of matches) {
          const left = m[1].split("|")[0];
          const linkpath = left.split("#")[0].trim();
          if (linkpath) out.push({ field, link: m[0], linkpath });
        }
      }
    }
  }
  return out;
}

function candidateOrder(a: Candidate, b: Candidate): number {
  return a.region.records.length - b.region.records.length || a.path.localeCompare(b.path);
}

async function main(): Promise<void> {
  const started = Date.now();
  const abs = await markdownFiles(root);
  const files = abs.map((p) => posix(relative(root, p)));
  const texts = new Map<string, string>();
  const fms = new Map<string, Obj>();

  for (let i = 0; i < files.length; i++) {
    const text = await readFile(abs[i], "utf8");
    texts.set(files[i], text);
    fms.set(files[i], frontmatter(text));
  }

  const schema = parseSchema(
    parseYaml(await readFile(join(root, "99_System/03_Schemas/relationships.yaml"), "utf8")),
    parseYaml(await readFile(join(root, "99_System/03_Schemas/element-types.yaml"), "utf8")),
  );
  if (schema.warnings.length) throw new Error("Vault schema warnings: " + schema.warnings.join(" | "));

  const pathByLower = new Map<string, string>();
  const byStem = new Map<string, string[]>();
  for (const file of files) {
    pathByLower.set(file.toLowerCase(), file);
    pathByLower.set(file.replace(/\.md$/i, "").toLowerCase(), file);
    const key = stem(file).toLowerCase();
    const group = byStem.get(key) ?? [];
    group.push(file);
    byStem.set(key, group);
  }

  const resolveTarget = (target: string, fromPath: string): string | undefined => {
    const raw = target.trim();
    if (!raw) return fromPath;
    const clean = raw.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\.md$/i, "");
    const exact = pathByLower.get(clean.toLowerCase()) ?? pathByLower.get((clean + ".md").toLowerCase());
    if (exact) return exact;
    const matches = byStem.get(clean.split("/").at(-1)!.toLowerCase()) ?? [];
    return matches.length === 1 ? matches[0] : undefined;
  };

  const relationFields = new Set([...schema.byField.keys(), ...schema.byInverse.keys()]);
  const index = new ModelIndex(schema);
  for (const file of files) {
    const fm = fms.get(file)!;
    const authored = authoredLinks(fm, relationFields);
    const resolved = resolveAuthoredRelationshipLinks(authored, file, schema, resolveTarget);
    const abstractValue = fm.abstract;
    const rec: NoteRecord = {
      path: file,
      name: stem(file),
      ...(typeof fm.type === "string" ? { type: fm.type } : {}),
      ...(typeof fm.subtype === "string" ? { subtype: fm.subtype } : {}),
      ...(typeof fm.id === "string" ? { id: fm.id } : {}),
      ...(typeof fm.uid === "string" ? { uid: fm.uid } : {}),
      authoredLinks: authored,
      fields: resolved.fields,
      unresolved: resolved.unresolved,
      broken: resolved.broken,
      ...(resolved.repeat ? { repeat: resolved.repeat } : {}),
      ...(resolved.localRefs ? { localRefs: resolved.localRefs } : {}),
      ...(typeof abstractValue === "boolean" ? { abstract: abstractValue } : {}),
      ...(abstractValue !== undefined && typeof abstractValue !== "boolean" ? { abstractInvalid: true } : {}),
    };
    index.upsert(rec);
  }

  const local = new LocalModelIndex();
  const candidates: Candidate[] = [];
  for (const file of files) {
    const text = texts.get(file)!;
    if (!text.includes("MDSE:LOCAL-MODEL")) continue;
    const region = parseLocalModel(text);
    local.set(file, region);
    if (!region || region.schemaVersion !== "0.4" || !region.structured) continue;
    if (index.notes.get(file)?.type === "Object") candidates.push({ path: file, region });
  }
  candidates.sort(candidateOrder);

  const structureCandidate = candidates.find((c) => c.region.records.some((r) => r.kind === "part"));
  const topologyCandidate = candidates.find((c) =>
    c.region.records.some((r) => r.kind === "connection" && r.exposes.length > 0),
  );
  const flowCandidate = candidates.find((c) => c.region.records.some((r) => r.kind === "flow"));
  const definitionlessCandidate = candidates.find((c) =>
    c.region.records.some((r) => r.kind === "endpoint" && !r.definition),
  );

  let whereUsed: { definition: string; owner: string; localId: string } | undefined;
  for (const c of candidates) {
    for (const r of c.region.records) {
      if (!r.definition?.target) continue;
      const definition = resolveTarget(r.definition.target, c.path);
      if (definition) {
        whereUsed = { definition, owner: c.path, localId: r.localId };
        break;
      }
    }
    if (whereUsed) break;
  }

  const failures: string[] = [];
  const samples: Record<string, unknown> = {};

  if (!structureCandidate) {
    failures.push("No real Object with Local Model Parts was available.");
  } else {
    const base = traverse(index, [structureCandidate.path], STRUCTURE_PROFILE);
    const view = withLocalStructure(index, local, base, STRUCTURE_PROFILE);
    const parts = [...view.localNodes.values()].filter((x) => x.record.kind === "part");
    samples.structure = {
      owner: structureCandidate.path,
      sourceRecords: structureCandidate.region.records.length,
      graphNotes: view.depthOf.size,
      graphEdges: view.tree.length,
      localNodes: view.localNodes.size,
      localEdges: view.localEdges.length,
      visibleParts: parts.length,
    };
    if (parts.length < 1) failures.push("Structure view did not render the selected real Part occurrence.");
  }

  if (!topologyCandidate) {
    failures.push("No real Object with Connection.exposes was available.");
  } else {
    const base = traverse(index, [topologyCandidate.path], INTERFACES_PROFILE);
    const view = withLocalInterfaces(index, local, resolveTarget, base, INTERFACES_PROFILE);
    const internal = buildInternalView(index, local, topologyCandidate.path, resolveTarget);
    const endpoints = [...view.localNodes.values()].filter((x) => x.record.kind === "endpoint").length;
    const connections = [...view.localNodes.values()].filter((x) => x.record.kind === "connection").length;
    const exposeEdges = internal.canvas.edges.filter((e) => e.id.startsWith("expose:")).length;
    samples.interfacesInternal = {
      owner: topologyCandidate.path,
      sourceRecords: topologyCandidate.region.records.length,
      graphNotes: view.depthOf.size,
      graphEdges: view.tree.length,
      localNodes: view.localNodes.size,
      localEdges: view.localEdges.length,
      endpoints,
      connections,
      internalCanvasNodes: internal.canvas.nodes.length,
      internalCanvasEdges: internal.canvas.edges.length,
      exposeEdges,
    };
    if (endpoints < 1 || connections < 1) failures.push("Interfaces view lost topology records.");
    if (exposeEdges < 1) failures.push("Internal view did not render Connection.exposes.");
  }

  if (!flowCandidate) {
    failures.push("No real Object with a conveyed Local Model flow was available.");
  } else {
    const base = traverse(index, [flowCandidate.path], INTERFACES_PROFILE);
    const view = withLocalInterfaces(index, local, resolveTarget, base, INTERFACES_PROFILE);
    const flows = [...view.localNodes.values()].filter((x) => x.record.kind === "flow").length;
    samples.conveyedFlow = {
      owner: flowCandidate.path,
      sourceRecords: flowCandidate.region.records.length,
      visibleFlows: flows,
      localNodes: view.localNodes.size,
      localEdges: view.localEdges.length,
    };
    if (flows < 1) failures.push("Interfaces view did not render a real conveyed flow.");
  }

  if (!definitionlessCandidate) {
    failures.push("No real Object with a definitionless contextual Interface was available.");
  } else {
    const base = traverse(index, [definitionlessCandidate.path], INTERFACES_PROFILE);
    const view = withLocalInterfaces(index, local, resolveTarget, base, INTERFACES_PROFILE);
    const definitionless = [...view.localNodes.values()].filter(
      (x) => x.record.kind === "endpoint" && !x.record.definition,
    ).length;
    samples.definitionlessInterface = {
      owner: definitionlessCandidate.path,
      sourceRecords: definitionlessCandidate.region.records.length,
      visibleDefinitionlessInterfaces: definitionless,
      localNodes: view.localNodes.size,
      localEdges: view.localEdges.length,
    };
    if (definitionless < 1) failures.push("Interfaces view dropped a definitionless contextual Interface.");
  }

  if (!whereUsed) {
    failures.push("No real definition-backed occurrence was available for Where Used.");
  } else {
    const base = traverse(index, [whereUsed.definition], WHERE_USED_PROFILE);
    const view = withLocalWhereUsed(index, local, resolveTarget, base, WHERE_USED_PROFILE);
    const visible = [...view.localNodes.values()].some(
      (x) => x.ownerPath === whereUsed!.owner && x.record.localId === whereUsed!.localId,
    );
    samples.whereUsed = {
      definition: whereUsed.definition,
      owner: whereUsed.owner,
      localId: whereUsed.localId,
      graphNotes: view.depthOf.size,
      graphEdges: view.tree.length,
      localNodes: view.localNodes.size,
      localEdges: view.localEdges.length,
      selectedOccurrenceVisible: visible,
    };
    if (!visible) failures.push("Where Used did not preserve the selected real occurrence.");
  }

  const memory = process.memoryUsage();
  const result = {
    status: failures.length ? "FAIL" : "PASS",
    mode: "representative-view-check",
    workbenchVersion: "0.1.18",
    elapsedMs: Date.now() - started,
    memoryRssMiB: Math.round(memory.rss / 1024 / 1024),
    markdownFiles: files.length,
    localModelObjectCandidates: candidates.length,
    samples,
    failures,
  };
  const json = JSON.stringify(result, null, 2) + "\n";
  if (reportPath) await writeFile(reportPath, json, "utf8");
  console.log("WB128_REAL_VAULT_VIEW_RESULT_BEGIN");
  console.log(json.trimEnd());
  console.log("WB128_REAL_VAULT_VIEW_RESULT_END");
  if (result.status !== "PASS") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
