/**
 * Structured Local Model 0.2 mutation planner (WB-114/WB-116).
 *
 * Pure TypeScript. It never writes vault files. It plans a minimal record-level text replacement,
 * reparses the result with the governed reader, and returns proposed text plus validation findings.
 */
import {
  WRITABLE_VERSION,
  parseLocalModel,
  type LocalFinding,
  type LocalKind,
  type LocalRecord,
  type LocalRegion,
} from "./localmodel";

const FIELD_ORDER: Record<LocalKind, readonly string[]> = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "exposes", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier"],
  flow: ["definition", "identifier", "endpointA", "endpointB"],
};

export interface LocalRecordPatch {
  /** Visible heading only. The native block ID remains the record identity. */
  heading?: string;
  /** null removes an optional field. Standard usage is canonically omitted. */
  fields?: Readonly<Record<string, string | null>>;
}

export interface PlannedLocalEdit {
  before: string;
  after: string;
  changed: boolean;
  localId: string;
  kind: LocalKind;
  findings: LocalFinding[];
}

export interface EditableLocalRegion {
  region: LocalRegion;
  lines: string[];
  eol: "\n" | "\r\n";
}

export function editableLocalRegion(text: string): EditableLocalRegion {
  const region = parseLocalModel(text);
  if (!region) throw new Error("This note has no governed Local Model region.");
  if (!region.structured) throw new Error("The Local Model region has structural/schema errors and cannot be edited.");
  if (region.schemaVersion !== WRITABLE_VERSION) {
    throw new Error("Local Model schema " + (region.schemaVersion ?? "unknown") + " is read-only. Structured writes require schema " + WRITABLE_VERSION + ".");
  }
  return {
    region,
    lines: text.split(/\r?\n/),
    eol: text.includes("\r\n") ? "\r\n" : "\n",
  };
}

export interface LocalPlanOptions {\n  /** Staged structural transactions may temporarily hold an invalid target record. Atomic edits leave this false. */\n  allowInvalidTarget?: boolean;\n}\n\nexport function planLocalRecordPatch(text: string, localId: string, patch: LocalRecordPatch, options: LocalPlanOptions = {}): PlannedLocalEdit {
  const editable = editableLocalRegion(text);
  const record = editable.region.records.find((r) => r.localId === localId);
  if (!record) throw new Error("Local Model record ^" + localId + " does not exist in this note.");

  const nextHeading = patch.heading === undefined ? record.identifier : patch.heading.trim();
  if (!nextHeading) throw new Error("A Local Model record heading cannot be empty.");

  const fields = new Map(record.fields);
  for (const [key, raw] of Object.entries(patch.fields ?? {})) {
    if (!FIELD_ORDER[record.kind].includes(key)) throw new Error(key + " is not a governed field on a " + record.kind + " record.");
    if ((record.kind === "connection" || record.kind === "flow") && key === "usage") {
      throw new Error("usage is not valid on a " + record.kind + " record.");
    }
    const value = raw === null ? null : raw.trim();
    if (value === null || value === "" || (key === "usage" && value === "standard")) fields.delete(key);
    else fields.set(key, value);
  }

  const range = recordLineRange(editable, record);
  const rendered = renderRecord(record.kind, nextHeading, record.localId, fields);
  const nextLines = [...editable.lines.slice(0, range.start), ...rendered, ...editable.lines.slice(range.end)];
  const after = nextLines.join(editable.eol);

  const parsed = parseLocalModel(after);
  if (!parsed?.structured) throw new Error("Planned edit would make the Local Model region structurally unreadable.");
  const reparsed = parsed.records.find((r) => r.localId === localId);
  if (!reparsed) throw new Error("Planned edit lost Local Model record ^" + localId + ".");
  if (reparsed.kind !== record.kind) throw new Error("Planned edit changed ^" + localId + " from " + record.kind + " to " + reparsed.kind + ".");

  return {
    before: text,
    after,
    changed: after !== text,
    localId,
    kind: record.kind,
    findings: parsed.findings.slice(),
  };
}

function recordLineRange(editable: EditableLocalRegion, record: LocalRecord): { start: number; end: number } {
  const start = record.line - 1;
  if (start < 0 || start >= editable.lines.length) throw new Error("Cannot locate ^" + record.localId + " in the source text.");

  const endMarker = editable.region.endLine ? editable.region.endLine - 1 : editable.lines.length;
  let end = endMarker;
  for (let i = start + 1; i < endMarker; i++) {
    if (/^#{3,5}\s+/.test(editable.lines[i])) {
      end = i;
      break;
    }
  }
  while (end > start + 1 && editable.lines[end - 1].trim() === "") end--;
  return { start, end };
}

function renderRecord(kind: LocalKind, heading: string, localId: string, fields: ReadonlyMap<string, string>): string[] {
  const level = kind === "flow" ? "#####" : "####";
  const out = [level + " " + heading];

  const known = new Set(FIELD_ORDER[kind]);
  for (const key of FIELD_ORDER[kind]) {
    const value = fields.get(key);
    if (value !== undefined && value !== "") out.push("- " + key + ": " + value);
  }
  for (const [key, value] of fields) {
    if (!known.has(key) && value !== "") out.push("- " + key + ": " + value);
  }
  out.push("^" + localId);
  return out;
}


export interface NewLocalRecord {
  kind: LocalKind;
  localId: string;
  heading: string;
  fields: Readonly<Record<string, string>>;
  /** Required only when kind is flow. */
  connectionId?: string;
}

const SECTION_TITLE: Record<Exclude<LocalKind, "flow">, string> = {
  part: "Part Occurrences",
  endpoint: "Local Interfaces",
  connection: "Connections",
};

const SECTION_ORDER: Array<Exclude<LocalKind, "flow">> = ["part", "endpoint", "connection"];

export function planLocalRecordCreate(text: string, input: NewLocalRecord): PlannedLocalEdit {
  validateNewRecord(input);

  const existing = parseLocalModel(text);
  if (!existing) {
    if (/^##\s+Local Model\s*$/m.test(text)) {
      throw new Error("This note already has an ungoverned Local Model heading. Resolve it before structured creation.");
    }
    if (input.kind === "flow") throw new Error("A flow requires an existing connection.");
    const eol: "\n" | "\r\n" = text.includes("\r\n") ? "\r\n" : "\n";
    const block = renderRecord(input.kind, input.heading.trim(), input.localId, normalizedFields(input.kind, input.fields));
    const regionLines = [
      "## Local Model",
      "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
      "",
      "### " + SECTION_TITLE[input.kind],
      "",
      ...block,
      "",
      "<!-- MDSE:LOCAL-MODEL END -->",
    ];
    const separator = text === "" || text.endsWith("\n") || text.endsWith("\r") ? "" : eol;
    const prefix = text === "" ? "" : text + separator + eol;
    return checkedCreate(text, prefix + regionLines.join(eol), input);
  }

  const editable = editableLocalRegion(text);
  if (editable.region.records.some((r) => r.localId === input.localId)) {
    throw new Error("Local Model record ^" + input.localId + " already exists in this note.");
  }

  const block = renderRecord(input.kind, input.heading.trim(), input.localId, normalizedFields(input.kind, input.fields));
  const lines = editable.lines.slice();

  if (input.kind === "flow") {
    const connectionId = input.connectionId ?? "";
    const connection = editable.region.records.find((r) => r.kind === "connection" && r.localId === connectionId);
    if (!connection) throw new Error("Flow parent connection ^" + connectionId + " does not exist in this note.");
    const insert = endOfConnection(lines, editable.region, connection);
    const payload = [...block, ""];
    lines.splice(insert, 0, ...payload);
  } else {
    const insert = sectionInsertPoint(lines, editable.region, input.kind);
    if (insert.existing) {
      lines.splice(insert.line, 0, ...block, "");
    } else {
      lines.splice(insert.line, 0, "### " + SECTION_TITLE[input.kind], "", ...block, "");
    }
  }

  return checkedCreate(text, lines.join(editable.eol), input);
}

function checkedCreate(before: string, after: string, input: NewLocalRecord): PlannedLocalEdit {
  const parsed = parseLocalModel(after);
  if (!parsed?.structured) throw new Error("Planned creation would make the Local Model region structurally unreadable.");
  const record = parsed.records.find((r) => r.localId === input.localId);
  if (!record || record.kind !== input.kind) throw new Error("Planned creation did not produce the requested " + input.kind + " record.");
  return { before, after, changed: after !== before, localId: input.localId, kind: input.kind, findings: parsed.findings.slice() };
}

function validateNewRecord(input: NewLocalRecord): void {
  if (!input.heading.trim()) throw new Error("A Local Model record heading cannot be empty.");
  const prefix: Record<LocalKind, string> = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
  const want = prefix[input.kind];
  if (!input.localId.startsWith(want) || !/^\d{17}[a-z-]{13}$/.test(input.localId.slice(want.length))) {
    throw new Error("Local Model ID " + input.localId + " is not a valid " + input.kind + " identity.");
  }
  for (const key of Object.keys(input.fields)) {
    if (!FIELD_ORDER[input.kind].includes(key)) throw new Error(key + " is not a governed field on a " + input.kind + " record.");
  }
  if ((input.kind === "part" || input.kind === "endpoint" || input.kind === "flow") && !input.fields.definition?.trim()) {
    throw new Error("A " + input.kind + " record requires a definition.");
  }
  if (input.kind === "connection" && (!input.fields.endpointA?.trim() || !input.fields.endpointB?.trim())) {
    throw new Error("A connection requires endpointA and endpointB.");
  }
  if (input.kind === "flow" && (!input.fields.endpointA?.trim() || !input.fields.endpointB?.trim())) {
    throw new Error("A flow requires endpointA and endpointB roles.");
  }
}

function normalizedFields(kind: LocalKind, source: Readonly<Record<string, string>>): Map<string, string> {
  const out = new Map<string, string>();
  for (const key of FIELD_ORDER[kind]) {
    const value = source[key]?.trim();
    if (!value || (key === "usage" && value === "standard")) continue;
    out.set(key, value);
  }
  return out;
}

function sectionInsertPoint(
  lines: readonly string[],
  region: LocalRegion,
  kind: Exclude<LocalKind, "flow">,
): { line: number; existing: boolean } {
  const title = SECTION_TITLE[kind].toLowerCase();
  const end = region.endLine ? region.endLine - 1 : lines.length;
  let section = -1;
  for (let i = (region.startLine ?? 1); i < end; i++) {
    const m = /^###\s+(.*?)\s*$/.exec(lines[i]);
    if (m && m[1].trim().toLowerCase() === title) {
      section = i;
      break;
    }
  }
  if (section >= 0) {
    let insert = end;
    for (let i = section + 1; i < end; i++) {
      if (/^###\s+/.test(lines[i])) {
        insert = i;
        break;
      }
    }
    while (insert > section + 1 && lines[insert - 1].trim() === "") insert--;
    return { line: insert, existing: true };
  }

  const order = SECTION_ORDER.indexOf(kind);
  for (let later = order + 1; later < SECTION_ORDER.length; later++) {
    const laterTitle = SECTION_TITLE[SECTION_ORDER[later]].toLowerCase();
    for (let i = (region.startLine ?? 1); i < end; i++) {
      const m = /^###\s+(.*?)\s*$/.exec(lines[i]);
      if (m && m[1].trim().toLowerCase() === laterTitle) return { line: i, existing: false };
    }
  }
  return { line: end, existing: false };
}

function endOfConnection(lines: readonly string[], region: LocalRegion, connection: LocalRecord): number {
  const start = connection.line - 1;
  const end = region.endLine ? region.endLine - 1 : lines.length;
  let insert = end;
  for (let i = start + 1; i < end; i++) {
    if (/^####\s+/.test(lines[i]) || /^###\s+/.test(lines[i])) {
      insert = i;
      break;
    }
  }
  while (insert > start + 1 && lines[insert - 1].trim() === "") insert--;
  return insert;
}


function assertTargetValid(region: LocalRegion, localId: string): void {
  const errors=region.findings.filter((finding)=>finding.severity==="error" && finding.localId===localId);
  if (!errors.length) return;
  throw new Error("Local Model record ^"+localId+" is invalid: "+errors.map((x)=>x.message).join(" "));
}
