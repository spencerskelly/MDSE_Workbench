/**
 * Local Model reader (WB-106, WB-111). Pure TypeScript, no Obsidian imports.
 *
 * The model stays Markdown in the vault: this reads the governed `## Local Model` region of a note
 * (schema 0.1 through 0.5), gives every record a stable `ModelRef`, and reports findings. It never writes.
 * Paths and headings are navigation and display; identity is the note `uid` plus the local block ID.
 */
import type { ModelIndex } from "./model";

export type LocalKind = "part" | "endpoint" | "connection" | "flow";

export const READABLE_VERSIONS = ["0.1", "0.2", "0.3", "0.4", "0.5"] as const;
export const WRITABLE_VERSION = "0.5";

const PREFIX: Record<LocalKind, string> = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
const SECTION_LEGACY: Record<string, LocalKind> = { "part occurrences": "part", "local interfaces": "endpoint", connections: "connection" };
const SECTION_04: Record<string, LocalKind> = { parts: "part", interfaces: "endpoint", connections: "connection" };
const sectionFor = (version: string, title: string): LocalKind | null =>
  (((version === "0.4" || version === "0.5") ? SECTION_04 : SECTION_LEGACY)[title.toLowerCase()] ?? null);
const FLOW_ROLES = ["transmit", "receive", "exchange", "unspecified"];
const USAGES = ["standard", "variant", "option"];
/** A 30-character global identity token: 17 digits then 13 letters or hyphens (schema 0.2). */
export const TOKEN_30 = /^\d{17}[a-z-]{13}$/;
const START = /^<!--\s*MDSE:LOCAL-MODEL START(?:\s+schema=(\S+?))?\s*-->\s*$/;
const END = /^<!--\s*MDSE:LOCAL-MODEL END\s*-->\s*$/;

/** What a reference points at. Semantic identity is this, never a path or a heading (WB-106). */
export type ModelRef =
  | { kind: "note"; uid: string }
  | { kind: "local"; ownerUid: string; localKind: LocalKind; localId: string };

export const noteRef = (uid: string): ModelRef => ({ kind: "note", uid });
export const localRef = (ownerUid: string, localKind: LocalKind, localId: string): ModelRef => ({ kind: "local", ownerUid, localKind, localId });
export const refKey = (r: ModelRef): string => (r.kind === "note" ? `note:${r.uid}` : `local:${r.ownerUid}#^${r.localId}`);

/** One `[[Target#^block|alias]]` link as written. `target` is empty for a link inside the same note. */
export interface LinkRef {
  text: string;
  target: string;
  /** The block ID without `^`, or "" when the link has no block fragment. */
  blockId: string;
  alias?: string;
}

export interface LocalRecord {
  kind: LocalKind;
  /** The native block ID; equals the local ID. Empty when the record has none. */
  localId: string;
  identifier: string;
  /** 1-based line of the record heading in the file. */
  line: number;
  fields: Map<string, string>;
  definition: LinkRef | null;
  /** Normalized: omitted means standard, and a 0.1 record is always standard. */
  usage: string;
  usageExplicit: boolean;
  part: LinkRef | null;
  parent: LinkRef | null;
  exposes: LinkRef[];
  equals: LinkRef[];
  /** Connection ends as block links; for a flow, `roleA`/`roleB` hold the transmit/receive roles. */
  endpointA: LinkRef | null;
  endpointB: LinkRef | null;
  roleA: string | null;
  roleB: string | null;
  multiplicity: string | null;
  endpointKind: string | null;
  /** A flow's owning connection (its local ID), or null. */
  connectionId: string | null;
  sourceSchemaVersion: string;
}

export interface LocalFinding {
  code: string;
  severity: "error" | "warning";
  message: string;
  /** Vault path of the owning note, filled in by the caller or the vault-level checks. */
  path?: string;
  localId?: string;
  line?: number;
}

export interface LocalRegion {
  /** Fingerprint of only the Local Model semantic slice, independent from unrelated note text. */
  sourceFingerprint: string;
  /** The schema= value of the START marker, or null when absent. */
  schemaVersion: string | null;
  startLine: number | null;
  endLine: number | null;
  records: LocalRecord[];
  findings: LocalFinding[];
  /** False when markers are wrong or the version is unknown: the text is still Markdown, but no structured use or editing. */
  structured: boolean;
}

export function parseLinks(value: string): LinkRef[] {
  const out: LinkRef[] = [];
  for (const m of value.matchAll(/\[\[([^\]]*)\]\]/g)) {
    const inner = m[1];
    const bar = inner.indexOf("|");
    const left = bar < 0 ? inner : inner.slice(0, bar);
    const alias = bar < 0 ? undefined : inner.slice(bar + 1).trim();
    const hash = left.indexOf("#");
    const target = (hash < 0 ? left : left.slice(0, hash)).trim();
    const frag = hash < 0 ? "" : left.slice(hash + 1).trim();
    out.push({ text: m[0], target, blockId: frag.startsWith("^") ? frag.slice(1) : "", alias });
  }
  return out;
}

const kindOfId = (id: string): LocalKind | null => {
  for (const k of Object.keys(PREFIX) as LocalKind[]) if (id.startsWith(PREFIX[k])) return k;
  return null;
};

function blank(kind: LocalKind, identifier: string, line: number, version: string): LocalRecord {
  return {
    kind, localId: "", identifier, line, fields: new Map(), definition: null, usage: "standard", usageExplicit: false,
    part: null, parent: null, exposes: [], equals: [], endpointA: null, endpointB: null, roleA: null, roleB: null,
    multiplicity: null, endpointKind: null, connectionId: null, sourceSchemaVersion: version,
  };
}

function finish(r: LocalRecord): void {
  const f = r.fields;
  const links = (k: string) => parseLinks(f.get(k) ?? "");
  r.definition = links("definition")[0] ?? null;
  if (r.kind === "part" || r.kind === "endpoint") {
    if (r.sourceSchemaVersion === "0.1") {
      r.usage = "standard";
      r.usageExplicit = false;
    } else if (f.has("usage")) {
      r.usage = (f.get("usage") ?? "").trim();
      r.usageExplicit = true;
    }
  } else if (f.has("usage")) {
    r.usage = (f.get("usage") ?? "").trim();
    r.usageExplicit = true;
  }
  r.part = links("part")[0] ?? null;
  r.parent = links("parent")[0] ?? null;
  r.exposes = links("exposes");
  r.equals = links("equals");
  if (r.kind === "flow") {
    r.roleA = (f.get("endpointA") ?? "").trim() || null;
    r.roleB = (f.get("endpointB") ?? "").trim() || null;
  } else {
    r.endpointA = links("endpointA")[0] ?? null;
    r.endpointB = links("endpointB")[0] ?? null;
  }
  r.multiplicity = (f.get("multiplicity") ?? "").trim() || null;
  r.endpointKind = (f.get("kind") ?? "").trim() || null;
}

const ALLOWED_FIELDS_LEGACY: Record<LocalKind, string[]> = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "exposes", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier"],
  flow: ["definition", "identifier", "endpointA", "endpointB"],
};
const ALLOWED_FIELDS_04: Record<LocalKind, string[]> = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier", "exposes"],
  flow: ["definition", "identifier", "endpointA", "endpointB"],
};
const allowedFields = (version: string, kind: LocalKind): readonly string[] =>
  ((version === "0.4" || version === "0.5") ? ALLOWED_FIELDS_04 : ALLOWED_FIELDS_LEGACY)[kind];

/** Stable FNV-1a fingerprint of the text that can affect Local Model parsing/validation. */
export function localModelSourceFingerprint(text: string): string | null {
  const lines = text.split(/\r?\n/);
  const markerLines: number[] = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (START.test(trimmed) || END.test(trimmed)) markerLines.push(i);
  });
  if (!markerLines.length) return null;
  const slice = lines.slice(markerLines[0], markerLines[markerLines.length - 1] + 1).join("\n");
  let h = 2166136261;
  for (let i = 0; i < slice.length; i++) {
    h ^= slice.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Parses the governed region of one note. Returns null when the note has no marker at all.
 * At most one region per note (WB-106); extra or broken markers are findings and switch structured use off.
 */
export function parseLocalModel(text: string): LocalRegion | null {
  const lines = text.split(/\r?\n/);
  const starts: Array<{ i: number; version: string | null }> = [];
  const ends: number[] = [];
  lines.forEach((l, i) => {
    const s = START.exec(l.trim());
    if (s) starts.push({ i, version: s[1] ?? null });
    else if (END.test(l.trim())) ends.push(i);
  });
  if (!starts.length && !ends.length) return null;

  const region: LocalRegion = {
    sourceFingerprint: localModelSourceFingerprint(text) as string,
    schemaVersion: starts[0]?.version ?? null, startLine: starts[0] ? starts[0].i + 1 : null,
    endLine: ends[0] !== undefined ? ends[0] + 1 : null, records: [], findings: [], structured: true,
  };
  const bad = (code: string, message: string, line?: number) => {
    region.findings.push({ code, severity: "error", message, line });
    region.structured = false;
  };

  if (starts.length > 1) bad("marker.duplicate", `Local Model START appears ${starts.length} times; one governed region per note.`, starts[1].i + 1);
  if (!starts.length) bad("marker.missing-start", "Local Model END without a START marker.", ends[0] + 1);
  else if (!ends.length) bad("marker.missing-end", "Local Model START without an END marker.", starts[0].i + 1);
  else if (ends[0] < starts[0].i) bad("marker.order", "Local Model END comes before START.", ends[0] + 1);
  if (starts.length >= 2 && ends.length && starts[1].i < ends[0]) bad("marker.nested", "A Local Model START appears inside an open region.", starts[1].i + 1);
  if (ends.length > starts.length && starts.length) bad("marker.mismatch", `Local Model has ${starts.length} START and ${ends.length} END markers.`, ends[ends.length - 1] + 1);

  if (starts.length) {
    const v = starts[0].version;
    if (!v) bad("schema.missing-version", "Local Model START has no schema= version.", starts[0].i + 1);
    else if (!(READABLE_VERSIONS as readonly string[]).includes(v)) bad("schema.unsupported", `Local Model schema ${v} is not supported; the text stays readable and structured Local Model use is off.`, starts[0].i + 1);
  }
  if (!region.structured) return region;

  const version = starts[0].version as string;
  const from = starts[0].i + 1;
  const to = ends[0];
  let section: LocalKind | null = null;
  let current: LocalRecord | null = null;
  let lastConnection: LocalRecord | null = null;
  const done = (r: LocalRecord | null) => {
    if (r) {
      finish(r);
      region.records.push(r);
    }
  };

  for (let i = from; i < to; i++) {
    const raw = lines[i];
    const h = /^(#{2,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) {
      const level = h[1].length;
      const title = h[2].trim();
      if (level === 2) continue;
      done(current);
      current = null;
      if (level === 3) {
        section = sectionFor(version, title);
        if (!section) region.findings.push({ code: "record.unknown-section", severity: "warning", message: `Unknown Local Model section "${title}".`, line: i + 1 });
        continue;
      }
      if (level === 4) {
        if (!section) {
          region.findings.push({ code: "record.unknown-section", severity: "warning", message: `Record "${title}" is outside a known section.`, line: i + 1 });
          continue;
        }
        current = blank(section, title, i + 1, version);
        if (section === "connection") lastConnection = current;
        continue;
      }
      if (level === 5) {
        current = blank("flow", title, i + 1, version);
        if (lastConnection) current.connectionId = lastConnection.localId || null;
        else region.findings.push({ code: "record.orphan-flow", severity: "error", message: `Flow "${title}" is not under a connection.`, line: i + 1 });
        continue;
      }
      continue;
    }
    if (!current) continue;
    const id = /^\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/.exec(raw.trim());
    if (id) {
      current.localId = id[1];
      if (current.kind === "connection") lastConnection = current;
      continue;
    }
    const fieldLine = /^\s*[-*]\s+([A-Za-z][A-Za-z0-9]*)\s*:\s*(.*)$/.exec(raw);
    if (fieldLine) {
      let value = fieldLine[2];
      const trailing = /\s\^([A-Za-z0-9][A-Za-z0-9-]*)\s*$/.exec(value);
      if (trailing) {
        current.localId = trailing[1];
        value = value.slice(0, trailing.index).trim();
        if (current.kind === "connection") lastConnection = current;
      }
      current.fields.set(fieldLine[1], value);
    }
  }
  done(current);
  // A flow found before its connection's ID line was read picks the ID up now.
  for (const r of region.records) if (r.kind === "flow" && !r.connectionId) r.connectionId = null;
  region.findings.push(...validateRegion(region));
  return region;
}

const refTargetsKind: Array<[keyof Pick<LocalRecord, "part" | "parent">, LocalKind, LocalKind]> = [
  ["part", "endpoint", "part"],
  ["parent", "endpoint", "endpoint"],
];

/** Checks that need only the note's own text (WB-106 findings, single-note part). */
export function validateRegion(region: LocalRegion): LocalFinding[] {
  const out: LocalFinding[] = [];
  const add = (code: string, message: string, r?: LocalRecord, severity: "error" | "warning" = "error") =>
    out.push({ code, severity, message, localId: r?.localId || undefined, line: r?.line });
  const version = region.schemaVersion ?? "0.2";
  const byId = new Map<string, LocalRecord[]>();
  for (const r of region.records) {
    if (r.localId) {
      const l = byId.get(r.localId) ?? [];
      l.push(r);
      byId.set(r.localId, l);
    }
  }

  for (const r of region.records) {
    const label = `${r.kind} "${r.identifier}"`;
    if (!r.localId) {
      add("record.no-block-id", `${label} has no block ID.`, r);
    } else {
      const k = kindOfId(r.localId);
      if (!k) add("record.block-id-malformed", `${label}: block ID ${r.localId} does not start with a record prefix (part-, ep-, conn-, flow-).`, r);
      else if (k !== r.kind) add("record.block-id-malformed", `${label}: block ID ${r.localId} is for a ${k}.`, r);
      else if (version !== "0.1" && !TOKEN_30.test(r.localId.slice(PREFIX[k].length))) add("record.block-id-malformed", `${label}: block ID ${r.localId} does not end in a 30-character identity token.`, r);
    }
    for (const key of r.fields.keys()) {
      if (key === "usage" && version === "0.1") add("record.unknown-field", `${label}: usage is not part of schema 0.1.`, r, "warning");
      else if (!allowedFields(version, r.kind).includes(key) && key !== "usage") add("record.unknown-field", `${label}: unknown field ${key}.`, r, "warning");
    }
    if (r.fields.has("usage")) {
      if (r.kind === "connection" || r.kind === "flow") add("record.usage-invalid", `${label}: usage is not valid on a ${r.kind}.`, r);
      else if (version !== "0.1" && !USAGES.includes(r.usage)) add("record.usage-invalid", `${label}: usage "${r.usage}" is not standard, variant or option.`, r);
    }
    if (
      !r.definition &&
      (
        r.kind === "part" ||
        r.kind === "flow" ||
        (r.kind === "endpoint" && (version === "0.1" || version === "0.2" || r.usageExplicit))
      )
    ) {
      add("record.missing-definition", `${label} has no definition link.`, r);
    }
    if (r.kind === "endpoint" && (version === "0.4" || version === "0.5") && r.exposes.length) {
      add("exposure.owner-invalid", `${label}: exposes belongs to a Connection in schema 0.4.`, r);
    }
    if (r.definition && r.definition.blockId) add("definition.incompatible", `${label}: the definition must link to a note, not a block.`, r);
  }
  for (const [id, list] of byId) if (list.length > 1) add("record.duplicate-id", `Block ID ${id} is used by ${list.length} records.`, list[1]);

  const sameNote = (l: LinkRef | null) => (l && !l.target && l.blockId ? byId.get(l.blockId)?.[0] : undefined);
  const needLocal = (r: LocalRecord, l: LinkRef | null, field: string, kind: LocalKind) => {
    if (!l) return;
    if (l.target) return; // another note: checked with the vault
    if (!l.blockId) {
      add("ref.local-missing", `${r.kind} "${r.identifier}": ${field} is not a block link.`, r);
      return;
    }
    const t = sameNote(l);
    if (!t) add("ref.local-missing", `${r.kind} "${r.identifier}": ${field} points at ^${l.blockId}, which is not in this note.`, r);
    else if (t.kind !== kind) add("ref.local-kind", `${r.kind} "${r.identifier}": ${field} points at a ${t.kind}, expected a ${kind}.`, r);
  };
  for (const r of region.records) {
    if (r.kind === "endpoint") {
      const label = `endpoint "${r.identifier}"`;
      for (const [field, , want] of refTargetsKind) needLocal(r, r[field], field, want);
      if (r.part && r.parent) add("ref.part-and-parent", `endpoint "${r.identifier}" has both part and parent; they are mutually exclusive.`, r);
      for (const l of r.exposes) needLocal(r, l, "exposes", "endpoint");
      for (const l of r.equals) needLocal(r, l, "equals", "endpoint");
      // In 0.5 only, explicit source BindingConnector equals is a symmetric,
      // same-owner edge. Earlier versions retain their original review semantics.
      if (version === "0.5") {
        const rawEquals = r.fields.get("equals");
        if (rawEquals !== undefined && (
          !r.equals.length ||
          // The importer writes multiple explicit links as "[[...]], [[...]]";
          // the editor also accepts space-separated links. Nothing else is valid.
          !/^\[\[[^\]]+\]\](?:\s*(?:,\s*|\s+)\[\[[^\]]+\]\])*$/u.test(rawEquals.trim()) ||
          r.equals.some((link) => !link.blockId)
        )) {
          add("equals.malformed", `${label}: equals must contain only Interface block links with valid ^IDs.`, r);
        }
        const seenEquals = new Set<string>();
        for (const l of r.equals) {
          if (!l.target && l.blockId && l.blockId === r.localId) {
            add("equals.self", `${label}: an Interface cannot equal itself.`, r);
          }
          if (l.blockId) {
            const key = l.target + "#" + l.blockId;
            if (seenEquals.has(key)) {
              add("equals.duplicate", `${label}: duplicate equals link to ^${l.blockId}.`, r);
            }
            seenEquals.add(key);
          }
          if (l.target) {
            add("equals.cross-context", `${label}: equals must target an Interface in the same Local Model owner.`, r);
            continue;
          }
          if (!l.blockId) continue; // missing/malformed links are checked by needLocal
          const target = sameNote(l);
          if (!target || target.kind !== "endpoint" || !r.localId) continue;
          if (!target.equals.some((back) => !back.target && back.blockId === r.localId)) {
            add("equals.asymmetric", `${label}: equals with Interface "${target.identifier}" must be reciprocal.`, r);
          }
        }
      }
    }
    if (r.kind === "connection") {
      if (!r.endpointA || !r.endpointB) add("ref.endpoint-count", `connection "${r.identifier}" needs exactly two endpoints (endpointA and endpointB).`, r);
      needLocal(r, r.endpointA, "endpointA", "endpoint");
      needLocal(r, r.endpointB, "endpointB", "endpoint");
      if (version === "0.4" || version === "0.5") {
        for (const l of r.exposes) {
          if (l.target) {
            add("exposure.cross-context", `connection "${r.identifier}": exposes must target a boundary Interface in this Local Model context.`, r);
            continue;
          }
          needLocal(r, l, "exposes", "endpoint");
          const target = sameNote(l);
          if (target?.kind === "endpoint" && (target.part || target.parent)) {
            add("exposure.not-boundary", `connection "${r.identifier}": exposes target "${target.identifier}" is not a boundary Interface.`, r);
          }
        }
      }
    }
    if (r.kind === "flow") {
      for (const [f, v] of [["endpointA", r.roleA], ["endpointB", r.roleB]] as const) {
        if (!v || !FLOW_ROLES.includes(v)) add("ref.flow-role-invalid", `flow "${r.identifier}": ${f} role "${v ?? ""}" is not one of ${FLOW_ROLES.join(", ")}.`, r, "error");
      }
      if (!r.connectionId && region.records.some((x) => x.kind === "connection" && !x.localId)) add("record.orphan-flow", `flow "${r.identifier}" sits under a connection that has no block ID.`, r);
    }
  }
  // Parent chains: a cycle makes the nesting meaningless.
  for (const r of region.records) {
    if (r.kind !== "endpoint" || !r.parent) continue;
    const seen = new Set<string>([r.localId]);
    let cur = sameNote(r.parent);
    while (cur && cur.kind === "endpoint") {
      if (seen.has(cur.localId)) {
        add("ref.parent-cycle", `endpoint "${r.identifier}" is its own ancestor through parent links.`, r);
        break;
      }
      seen.add(cur.localId);
      cur = sameNote(cur.parent);
    }
  }
  return out;
}

/** Parsed regions of the vault, with lookups by local ID. */
export class LocalModelIndex {
  readonly regions = new Map<string, LocalRegion>();
  private readonly ids = new Map<string, Array<{ path: string; record: LocalRecord }>>();

  set(path: string, region: LocalRegion | null): void {
    this.remove(path);
    if (!region) return;
    this.regions.set(path, region);
    // Quarantined regions remain available for findings/diagnostics, but never contribute
    // occurrence identity or topology to the shared usable Local Model index.
    if (!region.structured) return;
    for (const r of region.records) {
      if (!r.localId) continue;
      const l = this.ids.get(r.localId) ?? [];
      l.push({ path, record: r });
      this.ids.set(r.localId, l);
    }
  }

  remove(path: string): void {
    const old = this.regions.get(path);
    if (!old) return;
    this.regions.delete(path);
    for (const r of old.records) {
      const l = this.ids.get(r.localId);
      if (!l) continue;
      const kept = l.filter((x) => x.path !== path || x.record !== r);
      if (kept.length) this.ids.set(r.localId, kept);
      else this.ids.delete(r.localId);
    }
  }

  find(localId: string): ReadonlyArray<{ path: string; record: LocalRecord }> {
    return this.ids.get(localId) ?? [];
  }

  isQuarantined(path: string): boolean {
    const region = this.regions.get(path);
    return !!region && !region.structured;
  }

  quarantinedPaths(): string[] {
    return [...this.regions.entries()]
      .filter(([, region]) => !region.structured)
      .map(([path]) => path)
      .sort();
  }

  recordsOf(path: string, kind?: LocalKind): LocalRecord[] {
    const r = this.regions.get(path);
    if (!r || !r.structured) return [];
    return kind ? r.records.filter((x) => x.kind === kind) : r.records.slice();
  }

  /**
   * Where Used for occurrences (WB-106): every local record whose definition resolves to `definitionPath`.
   * `resolve` turns link text into a vault path the way Obsidian would from the owning note.
   */
  occurrencesOf(definitionPath: string, resolve: (target: string, fromPath: string) => string | undefined): Array<{ path: string; record: LocalRecord }> {
    const out: Array<{ path: string; record: LocalRecord }> = [];
    for (const [path, region] of this.regions) {
      if (!region.structured) continue;
      for (const record of region.records) {
        if (record.definition && record.definition.target && resolve(record.definition.target, path) === definitionPath) out.push({ path, record });
      }
    }
    return out;
  }

  /** ModelRef of a record in a note whose uid is `ownerUid`. */
  refOf(ownerUid: string, record: LocalRecord): ModelRef | null {
    return record.localId ? localRef(ownerUid, record.kind, record.localId) : null;
  }
}

export interface Candidates {
  /** Concrete definitions only, deduplicated by uid (path when there is none). Never persisted. */
  candidates: string[];
  cycle: boolean;
}

/**
 * Specialization candidates (W-314, WB-106): start at the stated definition, include it when concrete, and walk
 * incoming authored `subtypeOf` links (specific → general) through abstract and concrete notes alike.
 * Only concrete notes are candidates. Cycles are detected and never followed twice.
 */
export function specializationCandidates(index: ModelIndex, root: string): Candidates {
  const seen = new Set<string>([root]);
  const order: string[] = [root];
  const onStack = new Set<string>([root]);
  let cycle = false;
  const stack: Array<{ node: string; edges: ReadonlyArray<{ from: string; field: string }>; i: number }> = [
    { node: root, edges: index.in(root).filter((e) => e.field === "subtypeOf"), i: 0 },
  ];
  while (stack.length) {
    const top = stack[stack.length - 1];
    if (top.i >= top.edges.length) {
      onStack.delete(top.node);
      stack.pop();
      continue;
    }
    const child = top.edges[top.i++].from;
    if (onStack.has(child)) {
      cycle = true;
      continue;
    }
    if (seen.has(child)) continue;
    seen.add(child);
    order.push(child);
    onStack.add(child);
    stack.push({ node: child, edges: index.in(child).filter((e) => e.field === "subtypeOf"), i: 0 });
  }
  const byKey = new Map<string, string>();
  for (const p of order) {
    const n = index.notes.get(p);
    if (!n || n.abstract === true) continue;
    const key = n.uid || p;
    if (!byKey.has(key)) byKey.set(key, p);
  }
  return { candidates: [...byKey.values()], cycle };
}

const COMPATIBLE: Record<LocalKind, string | null> = { part: "Object", endpoint: null, flow: "Item Flow", connection: null };
function compatibleDefinition(record: LocalRecord, def: { type?: string; subtype?: string }): string | null {
  if (record.kind !== "endpoint") {
    const expected = COMPATIBLE[record.kind];
    return expected && def.type !== expected ? expected : null;
  }
  if (record.sourceSchemaVersion === "0.4" || record.sourceSchemaVersion === "0.5") {
    return def.type === "Object" && def.subtype === "interface" ? null : "Object / interface";
  }
  return def.type === "Port" ? null : "Port";
}

export interface VaultCheckInput {
  index: ModelIndex;
  local: LocalModelIndex;
  /** Link text → vault path, as Obsidian resolves it from the owning note; undefined when nothing matches. */
  resolve: (target: string, fromPath: string) => string | undefined;
}

/**
 * Checks that need the whole vault (WB-106): note-level findings from each region, identity-token collisions across
 * note UIDs and local records, cross-note block links, definitions, abstract/usage and variation, and
 * relationship fields that point at a block.
 */
export function validateLocalModels(input: VaultCheckInput): LocalFinding[] {
  const { index, local, resolve } = input;
  const out: LocalFinding[] = [];
  const add = (path: string, code: string, message: string, r?: LocalRecord, severity: "error" | "warning" = "error") =>
    out.push({ code, severity, message, path, localId: r?.localId || undefined, line: r?.line });

  for (const [path, region] of local.regions) for (const f of region.findings) out.push({ ...f, path });

  // Global identity tokens: every note uid and every 30-character local token share one namespace.
  const owners = new Map<string, string[]>();
  const claim = (token: string, who: string) => {
    const l = owners.get(token) ?? [];
    l.push(who);
    owners.set(token, l);
  };
  for (const n of index.notes.values()) if (n.uid && TOKEN_30.test(n.uid)) claim(n.uid, `note ${n.path}`);
  for (const [path, region] of local.regions) {
    if (region.schemaVersion === "0.1") continue;
    for (const r of region.records) {
      const k = kindOfId(r.localId);
      if (!k) continue;
      const token = r.localId.slice(PREFIX[k].length);
      if (TOKEN_30.test(token)) claim(token, `${r.kind} ^${r.localId} in ${path}`);
    }
  }
  for (const [token, who] of owners) {
    if (who.length < 2) continue;
    for (const w of who) {
      const m = /in (.+)$/.exec(w);
      const path = m ? m[1] : w.replace(/^note /, "");
      add(path, "identity.collision", `Identity token ${token} is used more than once: ${who.join("; ")}.`);
    }
  }

  const rootsChecked = new Set<string>();
  for (const [path, region] of local.regions) {
    if (!region.structured) continue;
    for (const r of region.records) {
      const label = `${r.kind} "${r.identifier}"`;
      // Cross-note block links.
      const links: Array<[string, LinkRef | null, LocalKind]> = [
        ["part", r.part, "part"], ["parent", r.parent, "endpoint"], ["endpointA", r.endpointA, "endpoint"], ["endpointB", r.endpointB, "endpoint"],
        ...r.exposes.map((l) => ["exposes", l, "endpoint"] as [string, LinkRef, LocalKind]),
        ...r.equals.map((l) => ["equals", l, "endpoint"] as [string, LinkRef, LocalKind]),
      ];
      for (const [field, l, want] of links) {
        if (!l || !l.target) continue;
        const tp = resolve(l.target, path);
        const rec = tp ? local.recordsOf(tp).find((x) => x.localId === l.blockId) : undefined;
        if (!tp) add(path, "ref.cross-note-missing", `${label}: ${field} points at note "${l.target}", which does not exist.`, r);
        else if (!rec) add(path, "ref.cross-note-missing", `${label}: ${field} points at ^${l.blockId} in ${tp}, which has no such record.`, r);
        else if (rec.kind !== want) add(path, "ref.local-kind", `${label}: ${field} points at a ${rec.kind}, expected a ${want}.`, r);
      }
      // Definitions.
      if (!r.definition || r.definition.blockId) continue;
      const dp = r.definition.target ? resolve(r.definition.target, path) : path;
      const def = dp ? index.notes.get(dp) : undefined;
      if (!dp || !def) {
        add(path, "definition.unresolved", `${label}: definition "${r.definition.target}" does not resolve to a note.`, r);
        continue;
      }
      const want = compatibleDefinition(r, def);
      if (want) add(path, "definition.incompatible", `${label}: definition ${def.name} is ${def.type ? `a ${def.type}${def.subtype ? " / " + def.subtype : ""}` : "not a model note"}, expected ${want}.`, r);
      if ((r.kind === "part" || r.kind === "endpoint") && USAGES.includes(r.usage)) {
        if (r.usage === "standard" && def.abstract === true) add(path, "definition.abstract-standard", `${label}: a standard occurrence points at abstract definition ${def.name}.`, r);
        if (r.usage === "variant" || r.usage === "option") {
          const c = specializationCandidates(index, dp);
          if (c.cycle && !rootsChecked.has(dp)) {
            rootsChecked.add(dp);
            add(dp, "specialization.cycle", `The subtypeOf links under ${def.name} form a cycle.`, r);
          }
          if (!c.candidates.length) add(path, "variation.no-candidate", `${label}: ${r.usage} on ${def.name} has no concrete candidate in its specialization family.`, r);
        }
      }
    }
  }

  // Relationship fields that point at a block.
  for (const n of index.notes.values()) {
    for (const ref of n.localRefs ?? []) {
      const rec = local.recordsOf(ref.path).find((x) => x.localId === ref.localId);
      if (!rec) add(n.path, "frontmatter.local-target-missing", `${ref.field} points at ^${ref.localId} in ${ref.path}, which has no such record.`);
    }
    if (n.abstractInvalid) add(n.path, "abstract.invalid", "abstract must be true or false.");
  }
  return out;
}

/** The ModelRef a relationship link resolves to: the note, or a record inside it when the link names a block. */
export function refForLink(index: ModelIndex, local: LocalModelIndex, targetPath: string, blockId: string): ModelRef | null {
  const note = index.notes.get(targetPath);
  if (!note?.uid) return null;
  if (!blockId) return noteRef(note.uid);
  const rec = local.recordsOf(targetPath).find((x) => x.localId === blockId);
  return rec ? localRef(note.uid, rec.kind, rec.localId) : null;
}

export interface ReportOptions {
  /** Examples listed per finding code. */
  perCode?: number;
  generated?: string;
}

/** A Markdown report of findings, grouped by code, for the generated Workbench Views folder. */
export function renderFindingsReport(findings: LocalFinding[], stats: { notesWithRegion: number; records: number; byKind: Record<string, number> }, opts: ReportOptions = {}): string {
  const per = opts.perCode ?? 25;
  const by = new Map<string, LocalFinding[]>();
  for (const f of findings) {
    const l = by.get(f.code) ?? [];
    l.push(f);
    by.set(f.code, l);
  }
  const errors = findings.filter((f) => f.severity === "error").length;
  const lines = [
    "# Local Model findings",
    "",
    `Generated by MDSE Workbench${opts.generated ? ` on ${opts.generated}` : ""}. This file is generated and git-ignored; do not edit it.`,
    "",
    `- Notes with a Local Model region: ${stats.notesWithRegion}`,
    `- Records: ${stats.records} (${Object.entries(stats.byKind).map(([k, v]) => `${k} ${v}`).join(", ") || "none"})`,
    `- Findings: ${findings.length} (${errors} errors, ${findings.length - errors} warnings)`,
    "",
  ];
  if (!findings.length) lines.push("No findings.", "");
  else {
    lines.push("| Code | Severity | Count |", "|---|---|---|");
    for (const [code, list] of [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) lines.push(`| \`${code}\` | ${list[0].severity} | ${list.length} |`);
    lines.push("");
    for (const [code, list] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`## ${code}`, "");
      for (const f of list.slice(0, per)) {
        const where = f.path ? `[[${f.path.replace(/\.md$/i, "")}${f.localId ? `#^${f.localId}` : ""}|${f.path.split("/").pop()?.replace(/\.md$/i, "")}]]` : "";
        lines.push(`- ${where} ${f.message}${f.line ? ` (line ${f.line})` : ""}`);
      }
      if (list.length > per) lines.push(`- … ${list.length - per} more`);
      lines.push("");
    }
  }
  return lines.join("\n");
}
