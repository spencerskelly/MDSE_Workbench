/**
 * Structured Local Model 0.4 mutation planner (WB-114/WB-116).
 *
 * Pure TypeScript. It never writes vault files. It plans a minimal record-level text replacement,
 * reparses the result with the governed reader, and returns proposed text plus validation findings.
 */
import {
  WRITABLE_VERSION,
  parseLocalModel,
  parseLinks,
  type LocalFinding,
  type LocalKind,
  type LocalRecord,
  type LocalRegion,
} from "./localmodel";

const FIELD_ORDER: Record<LocalKind, readonly string[]> = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier", "exposes"],
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

export interface LocalPlanOptions {
  /** Staged structural transactions may temporarily hold an invalid target record. Atomic edits leave this false. */
  allowInvalidTarget?: boolean;
}

export function planLocalRecordPatch(text: string, localId: string, patch: LocalRecordPatch, options: LocalPlanOptions = {}): PlannedLocalEdit {
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
  const edits = [{ start: range.start, end: range.end, lines: rendered }];
  const reciprocalIds: string[] = [];

  // A canonical 0.5 BindingConnector edit changes both Interface records in a single
  // planned note snapshot. Review / Apply / Undo / Redo keep that snapshot atomic.
  if (record.kind === "endpoint" && Object.prototype.hasOwnProperty.call(patch.fields ?? {}, "equals")) {
    const written = fields.get("equals") ?? "";
    const wanted = parseLinks(written);
    if (written.replace(/\[\[[^\]]*\]\]/g, "").trim()) {
      throw new Error("equals must contain only governed Interface block links.");
    }
    const next = new Set<string>();
    for (const link of wanted) {
      if (link.target) throw new Error("equals must stay inside the same Local Model owner.");
      if (!link.blockId) throw new Error("equals requires a native Interface block ID.");
      if (link.blockId === localId) throw new Error("An Interface cannot equal itself.");
      if (next.has(link.blockId)) throw new Error("Duplicate equals target ^" + link.blockId + ".");
      next.add(link.blockId);
    }
    const previous = new Set(record.equals.filter((link) => !link.target && link.blockId).map((link) => link.blockId));
    for (const peerId of new Set([...previous, ...next])) {
      const peer = editable.region.records.find((item) => item.localId === peerId);
      if (!peer) continue; // source validator reports invalid proposed missing targets
      if (peer.kind !== "endpoint") continue; // source validator reports wrong target kind
      const has = peer.equals.some((link) => !link.target && link.blockId === localId);
      const wants = next.has(peerId);
      if (has === wants) continue;
      const links = peer.equals.filter((link) => link.target || link.blockId !== localId).map((link) => link.text);
      if (wants) links.push("[[#^" + localId + "]]");
      const peerFields = new Map(peer.fields);
      if (links.length) peerFields.set("equals", links.join(" "));
      else peerFields.delete("equals");
      const peerRange = recordLineRange(editable, peer);
      edits.push({ start: peerRange.start, end: peerRange.end, lines: renderRecord(peer.kind, peer.identifier, peer.localId, peerFields) });
      reciprocalIds.push(peerId);
    }
  }
  const nextLines = [...editable.lines];
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    nextLines.splice(edit.start, edit.end - edit.start, ...edit.lines);
  }
  const after = nextLines.join(editable.eol);

  const parsed = parseLocalModel(after);
  if (!parsed?.structured) throw new Error("Planned edit would make the Local Model region structurally unreadable.");
  const reparsed = parsed.records.find((r) => r.localId === localId);
  if (!reparsed) throw new Error("Planned edit lost Local Model record ^" + localId + ".");
  if (reparsed.kind !== record.kind) throw new Error("Planned edit changed ^" + localId + " from " + record.kind + " to " + reparsed.kind + ".");
  if (!options.allowInvalidTarget) {
    for (const editedId of [localId, ...reciprocalIds]) assertTargetValid(parsed, editedId);
  }

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



export function nextLocalId(kind: LocalKind, ownerUid: string, now = new Date()): string {
  if (!/^\d{17}[a-z-]{13}$/.test(ownerUid)) {
    throw new Error("Cannot create a Local Model identity because the owner note UID is not a governed 30-character identity.");
  }
  const suffix = ownerUid.slice(-13);
  const pad = (value: number, width: number) => String(value).padStart(width, "0");
  const stamp =
    pad(now.getUTCFullYear(), 4) +
    pad(now.getUTCMonth() + 1, 2) +
    pad(now.getUTCDate(), 2) +
    pad(now.getUTCHours(), 2) +
    pad(now.getUTCMinutes(), 2) +
    pad(now.getUTCSeconds(), 2) +
    pad(now.getUTCMilliseconds(), 3);
  const prefix: Record<LocalKind, string> = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
  return prefix[kind] + stamp + suffix;
}


export function nextAvailableLocalId(
  kind: LocalKind,
  ownerUid: string,
  existingLocalIds: ReadonlySet<string> | readonly string[],
  now = new Date(),
): string {
  const occupied = existingLocalIds instanceof Set ? existingLocalIds : new Set(existingLocalIds);
  let candidateTime = new Date(now.getTime());
  for (let attempts = 0; attempts < 10000; attempts++) {
    const candidate = nextLocalId(kind, ownerUid, candidateTime);
    if (!occupied.has(candidate)) return candidate;
    candidateTime = new Date(candidateTime.getTime() + 1);
  }
  throw new Error("Cannot allocate a unique Local Model identity after 10000 millisecond retries.");
}

export interface LocalDeleteImpact {
  sourceLocalId: string;
  sourceKind: LocalKind;
  sourceIdentifier: string;
  field: string;
}

export interface PlannedLocalDelete extends PlannedLocalEdit {
  impacts: LocalDeleteImpact[];
  identifier: string;
}

export function planLocalRecordDelete(text: string, localId: string): PlannedLocalDelete {
  const editable = editableLocalRegion(text);
  const record = editable.region.records.find((candidate) => candidate.localId === localId);
  if (!record) throw new Error("Local Model record ^" + localId + " does not exist in this note.");
  if (record.kind !== "part" && record.kind !== "endpoint" && record.kind !== "connection" && record.kind !== "flow") {
    throw new Error("This deletion slice supports part, endpoint, connection and flow occurrences only.");
  }

  const impacts: LocalDeleteImpact[] = [];
  for (const source of editable.region.records) {
    if (source.localId === localId) continue;
    if (record.kind === "connection" && source.kind === "flow" && source.connectionId === localId) {
      impacts.push({
        sourceLocalId: source.localId,
        sourceKind: source.kind,
        sourceIdentifier: source.identifier,
        field: "connection",
      });
    }
    for (const [field, value] of source.fields) {
      for (const link of parseLinks(value)) {
        if (!link.target && link.blockId === localId) {
          impacts.push({
            sourceLocalId: source.localId,
            sourceKind: source.kind,
            sourceIdentifier: source.identifier,
            field,
          });
        }
      }
    }
  }

  const range = recordLineRange(editable, record);
  let end = range.end;
  while (end < editable.lines.length && editable.lines[end].trim() === "") end++;
  const nextLines = [...editable.lines.slice(0, range.start), ...editable.lines.slice(end)];
  const after = nextLines.join(editable.eol);
  const parsed = parseLocalModel(after);
  if (!parsed?.structured) throw new Error("Planned deletion would make the Local Model region structurally unreadable.");

  return {
    before: text,
    after,
    changed: after !== text,
    localId,
    kind: record.kind,
    findings: parsed.findings.slice(),
    impacts,
    identifier: record.identifier,
  };
}

export function planLocalFlowMove(text: string, flowId: string, connectionId: string): PlannedLocalEdit {
  const editable = editableLocalRegion(text);
  const flow = editable.region.records.find((record) => record.localId === flowId);
  if (!flow || flow.kind !== "flow") throw new Error("Local Model flow ^" + flowId + " does not exist in this note.");
  const target = editable.region.records.find((record) => record.localId === connectionId);
  if (!target || target.kind !== "connection") throw new Error("Target connection ^" + connectionId + " does not exist in this note.");
  if (flow.connectionId === connectionId) throw new Error("This flow already belongs to the selected connection.");

  const range = recordLineRange(editable, flow);
  let removeEnd = range.end;
  while (removeEnd < editable.lines.length && editable.lines[removeEnd].trim() === "") removeEnd++;
  const withoutFlow = [...editable.lines.slice(0, range.start), ...editable.lines.slice(removeEnd)].join(editable.eol);

  const interim = editableLocalRegion(withoutFlow);
  const reparsedTarget = interim.region.records.find((record) => record.localId === connectionId);
  if (!reparsedTarget || reparsedTarget.kind !== "connection") throw new Error("Target connection disappeared while planning the flow move.");

  const rendered = renderRecord("flow", flow.identifier, flow.localId, new Map(flow.fields));
  const nextLines = interim.lines.slice();
  const insertAt = endOfConnection(nextLines, interim.region, reparsedTarget);
  nextLines.splice(insertAt, 0, ...rendered, "");
  const after = nextLines.join(interim.eol);

  const parsed = parseLocalModel(after);
  if (!parsed?.structured) throw new Error("Planned flow move would make the Local Model region structurally unreadable.");
  const moved = parsed.records.find((record) => record.localId === flowId);
  if (!moved || moved.kind !== "flow") throw new Error("Planned flow move lost Local Model flow ^" + flowId + ".");
  if (moved.connectionId !== connectionId) throw new Error("Planned flow move did not bind ^" + flowId + " to ^" + connectionId + ".");

  return {
    before: text,
    after,
    changed: after !== text,
    localId: flowId,
    kind: "flow",
    findings: parsed.findings.slice(),
  };
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
  part: "Parts",
  endpoint: "Interfaces",
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
      "<!-- MDSE:LOCAL-MODEL START schema=" + WRITABLE_VERSION + " -->",
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
  if ((input.kind === "part" || input.kind === "flow") && !input.fields.definition?.trim()) {
    throw new Error("A " + input.kind + " record requires a definition.");
  }
  if (input.kind === "endpoint" && input.fields.usage?.trim() && !input.fields.definition?.trim()) {
    throw new Error("An Interface occurrence requires a definition when usage is set.");
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
