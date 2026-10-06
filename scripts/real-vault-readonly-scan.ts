import { readdir, readFile, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve as resolvePath, sep } from "node:path";
import { parse as parseYaml } from "yaml";
import { parseSchema } from "../src/core/schema";
import { ModelIndex, type AuthoredRelationshipLink, type NoteRecord } from "../src/core/model";
import { resolveAuthoredRelationshipLinks } from "../src/core/relationship-resolution";
import { LocalModelIndex, parseLocalModel, validateLocalModels, type LocalFinding } from "../src/core/localmodel";

type Obj = Record<string, unknown>;
type BlockRef = { owner: string; targetText: string; localId: string; raw: string };

const rootArg = process.argv[2];
const reportPath = process.argv[3];
if (!rootArg) {
  console.error("Usage: npm run accept:real-vault:scan -- <vault-path> [report-json]");
  process.exit(2);
}

const root = resolvePath(rootArg);
if (reportPath) {
  const report = resolvePath(reportPath);
  const rel = relative(root, report);
  if (rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))) {
    throw new Error("Read-only scan refuses to write its report inside the candidate vault.");
  }
}

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
  await walk(dir);
  return out.sort();
}

function frontmatter(text: string): Obj {
  const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  const parsed = parseYaml(m[1]);
  return isObj(parsed) ? parsed : {};
}

const scalarStrings = (v: unknown): string[] =>
  typeof v === "string" ? [v] : Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

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
  return Object.fromEntries(Object.entries(out).sort((a, b) => a[0].localeCompare(b[0])));
}

async function main(): Promise<void> {
const abs = await markdownFiles(root);
const files = abs.map((p) => posix(relative(root, p)));

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
const local = new LocalModelIndex();

const counts = { part: 0, endpoint: 0, connection: 0, flow: 0 };
const localSchemas: Record<string, number> = {};
const localIdOwner = new Map<string, string>();
const duplicateExamples: string[] = [];
const blockRefs: BlockRef[] = [];
const blockExamples: string[] = [];

let definitionlessInterfaces = 0;
let connectionExposes = 0;
let parserErrors = 0;
let duplicateLocalIds = 0;
let legacyPortNotes = 0;
let legacyPortFields = 0;
let unresolvedRelationshipLinks = 0;
let brokenRelationshipLinks = 0;
let authoredRelationshipLinks = 0;
let localRegionNotes = 0;

const blockRx = /\[\[([^\]]*?)#\^((?:part|ep|conn|flow)-[^\]|]+)(?:\|[^\]]*)?\]\]/g;

for (let i = 0; i < files.length; i++) {
  const file = files[i];
  const text = await readFile(abs[i], "utf8");
  const fm = frontmatter(text);

  const authored = authoredLinks(fm, relationFields);
  const resolved = resolveAuthoredRelationshipLinks(authored, file, schema, resolveTarget);
  authoredRelationshipLinks += authored.length;
  unresolvedRelationshipLinks += resolved.unresolved;
  brokenRelationshipLinks += resolved.broken.length;

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

  if (fm.type === "Port") legacyPortNotes++;
  for (const k of ["hasPort", "interfaces", "transmits", "receives", "hasFlow"]) {
    if (fm[k] !== undefined) legacyPortFields++;
  }

  if (text.includes("MDSE:LOCAL-MODEL")) {
    localRegionNotes++;
    const region = parseLocalModel(text);
    local.set(file, region);
    if (region) {
      localSchemas[region.schemaVersion] = (localSchemas[region.schemaVersion] ?? 0) + 1;
      parserErrors += region.findings.filter((f) => f.severity === "error").length;
      for (const localRecord of region.records) {
        counts[localRecord.kind]++;
        if (localRecord.kind === "endpoint" && !localRecord.definition) definitionlessInterfaces++;
        if (localRecord.kind === "connection") connectionExposes += localRecord.exposes.length;

        const prior = localIdOwner.get(localRecord.localId);
        if (prior && prior !== file) {
          duplicateLocalIds++;
          if (duplicateExamples.length < 10) duplicateExamples.push(localRecord.localId + ": " + prior + " | " + file);
        } else if (!prior) {
          localIdOwner.set(localRecord.localId, file);
        }
      }
    }
  }

  for (const m of text.matchAll(blockRx)) {
    blockRefs.push({ owner: file, targetText: m[1], localId: m[2], raw: m[0] });
  }
}

let localBlockReferenceFailures = 0;
for (const ref of blockRefs) {
  const target = resolveTarget(ref.targetText, ref.owner);
  if (!target || !local.recordsOf(target).some((record) => record.localId === ref.localId)) {
    localBlockReferenceFailures++;
    if (blockExamples.length < 10) blockExamples.push(ref.owner + " -> " + ref.raw);
  }
}

const whole = validateLocalModels({ index, local, resolve: resolveTarget });
const blockers = new Set([
  "schema.unsupported",
  "marker.duplicate",
  "marker.missing-start",
  "marker.missing-end",
  "marker.order",
  "marker.nested",
  "marker.mismatch",
  "record.unknown-section",
  "record.no-block-id",
  "record.block-id-malformed",
  "record.duplicate-id",
  "ref.local-missing",
  "ref.local-kind",
  "frontmatter.local-target-missing",
  "exposure.owner-invalid",
  "exposure.cross-context",
  "exposure.not-boundary",
  "identity.collision",
]);
const blockingCompatibilityFindings = whole.filter((f) => blockers.has(f.code)).length;

const manifest = await readFile(join(root, "99_System/11_Import/Run Manifest.md"), "utf8");
const expected = {
  notes: manifestNumber(manifest, "Notes written"),
  part: manifestNumber(manifest, "Local parts"),
  endpoint: manifestNumber(manifest, "Local endpoints"),
  definitionless: manifestNumber(manifest, "Definitionless contextual endpoints (W-377)"),
  connection: manifestNumber(manifest, "Local connections"),
  flow: manifestNumber(manifest, "Local flows"),
};

const failures: string[] = [];
const expectEqual = (label: string, actual: number, expectedValue: number): void => {
  if (actual !== expectedValue) failures.push(label + ": expected " + expectedValue + ", got " + actual);
};

expectEqual("Local Parts", counts.part, expected.part);
expectEqual("Local Interfaces", counts.endpoint, expected.endpoint);
expectEqual("Definitionless Interfaces", definitionlessInterfaces, expected.definitionless);
expectEqual("Local Connections", counts.connection, expected.connection);
expectEqual("Local flows", counts.flow, expected.flow);

for (const [version, count] of Object.entries(localSchemas)) {
  if (version !== "0.4" && count > 0) failures.push("non-0.4 Local Model regions: " + version + "=" + count);
}
if (parserErrors) failures.push("Local Model parser errors: " + parserErrors);
if (blockingCompatibilityFindings) failures.push("blocking compatibility findings: " + blockingCompatibilityFindings);
if (localBlockReferenceFailures) failures.push("broken #^local-id references: " + localBlockReferenceFailures);
if (duplicateLocalIds) failures.push("duplicate local IDs across owners: " + duplicateLocalIds);
if (legacyPortNotes) failures.push("first-class Port notes reintroduced: " + legacyPortNotes);
if (legacyPortFields) failures.push("legacy Port relationship fields reintroduced: " + legacyPortFields);

const memory = process.memoryUsage();
const result = {
  status: failures.length ? "FAIL" : "PASS",
  mode: "read-only-scan",
  workbenchVersion: "0.1.18",
  vault: root,
  elapsedMs: Date.now() - started,
  memoryRssMiB: Math.round(memory.rss / 1024 / 1024),
  markdownFiles: files.length,
  modelNotes: [...index.notes.values()].filter((n) => index.isElement(n)).length,
  authoredRelationshipLinks,
  unresolvedRelationshipLinks,
  brokenRelationshipLinks,
  localRegionNotes,
  localSchemas: Object.fromEntries(Object.entries(localSchemas).sort((a, b) => a[0].localeCompare(b[0]))),
  records: counts,
  definitionlessInterfaces,
  connectionExposes,
  localBlockReferences: blockRefs.length,
  localBlockReferenceFailures,
  duplicateLocalIds,
  parserErrors,
  wholeVaultFindings: countCodes(whole),
  blockingCompatibilityFindings,
  legacyPortNotes,
  legacyPortFields,
  expected,
  failures: [
    ...failures,
    ...blockExamples.map((x) => "block-ref example: " + x),
    ...duplicateExamples.map((x) => "duplicate-id example: " + x),
  ],
};

const json = JSON.stringify(result, null, 2) + "\n";
if (reportPath) await writeFile(reportPath, json, "utf8");
console.log("WB128_REAL_VAULT_READONLY_RESULT_BEGIN");
console.log(json.trimEnd());
console.log("WB128_REAL_VAULT_READONLY_RESULT_END");
if (result.status !== "PASS") process.exitCode = 1;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : String(error));
  process.exitCode = 1;
});
