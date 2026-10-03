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

export function planLocalRecordPatch(text: string, localId: string, patch: LocalRecordPatch): PlannedLocalEdit {
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
