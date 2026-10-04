"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => MdseWorkbench
});
module.exports = __toCommonJS(main_exports);
var import_obsidian8 = require("obsidian");

// src/core/runtime-health.ts
function summarizeRuntimeHealth(input) {
  if (!input.ready) {
    if (input.coreError) {
      return {
        level: "attention",
        label: "Workbench \xB7 core unavailable",
        detail: "Workbench core model startup failed, but Obsidian remains usable.",
        rows: [
          ["Model service", "unavailable", true],
          ["Core error", input.coreError, true],
          ["Recovery", "Correct the reported issue, then run Rebuild index"]
        ]
      };
    }
    const level = input.building ? "syncing" : "starting";
    return {
      level,
      label: input.building ? "Workbench \xB7 indexing" : "Workbench \xB7 starting",
      detail: "Model service is not ready yet.",
      rows: [
        ["Model service", input.building ? "indexing" : "starting"],
        ["Local Model", input.localQueued ? `${input.localQueued} queued` : input.localPending ? `${input.localPending} pending` : "not yet available"]
      ]
    };
  }
  const rows = [];
  const assuranceError = input.assurance?.current ? input.assurance.error ?? null : null;
  const hardAttention = input.localReadErrors > 0 || !!input.occurrenceError || !!input.cacheWriteError || input.schemaWarnings > 0 || !!assuranceError;
  rows.push(["Model service", input.livePending ? `${input.livePending} live update(s) pending` : "ready"]);
  const activeLocal = Math.max(0, input.localPending - input.localQueued);
  rows.push([
    "Local Model",
    input.occurrenceError ? `background processing issue: ${input.occurrenceError}` : input.localReadErrors ? `${input.localReadErrors} read error(s)` : activeLocal ? `${activeLocal} note(s) hydrating` : input.localQueued ? `${input.localQueued} note(s) queued for later` : "settled",
    !!input.occurrenceError || input.localReadErrors > 0
  ]);
  rows.push(["Schema", input.schemaWarnings ? `${input.schemaWarnings} warning(s)` : "compatible", input.schemaWarnings > 0]);
  rows.push([
    "Semantic cache",
    input.cacheWriteError ? `write issue: ${input.cacheWriteError}` : input.cacheCurrent ? "current" : "pending/coalesced",
    !!input.cacheWriteError
  ]);
  if (!input.assurance) {
    rows.push(["Global assurance", "not run for current model revision"]);
  } else if (!input.assurance.current) {
    rows.push(["Global assurance", "stale; recomputes on demand"]);
  } else if (input.assurance.error) {
    rows.push(["Global assurance", `unavailable: ${input.assurance.error}`, true]);
  } else {
    rows.push([
      "Global assurance",
      input.assurance.findings ? `${input.assurance.findings} finding(s)` : "current \xB7 no findings",
      input.assurance.findings > 0
    ]);
  }
  if (hardAttention) {
    const issues = input.localReadErrors + input.schemaWarnings + (input.occurrenceError ? 1 : 0) + (input.cacheWriteError ? 1 : 0) + (assuranceError ? 1 : 0);
    return {
      level: "attention",
      label: `Workbench \xB7 ${issues} issue${issues === 1 ? "" : "s"}`,
      detail: "The model remains readable; inspect runtime health for the affected subsystem.",
      rows
    };
  }
  const pending = input.livePending + input.localPending;
  if (pending > 0) {
    const activeOccurrence = Math.max(0, input.localPending - input.localQueued);
    return {
      level: "syncing",
      label: input.livePending ? `Workbench \u2713 \xB7 applying ${input.livePending}` : activeOccurrence ? "Workbench \u2713 \xB7 occurrence data loading" : "Workbench \u2713 \xB7 occurrence data queued",
      detail: input.livePending ? "Core model remains usable while coalesced live edits finish." : activeOccurrence ? "Core model is ready; occurrence-aware capabilities are loading in the background." : "Core model is ready; occurrence-aware capabilities are intentionally deferred until the vault is quiet or one is requested.",
      rows
    };
  }
  if (input.assurance?.current && input.assurance.findings > 0) {
    return {
      level: "ready",
      label: `Workbench \u2713 \xB7 ${input.assurance.findings} review`,
      detail: "Runtime is healthy; engineering findings are available in Review.",
      rows
    };
  }
  return {
    level: "ready",
    label: "Workbench \u2713",
    detail: input.assurance?.current ? "Runtime and current assurance are healthy." : "Runtime is healthy; global assurance runs on demand.",
    rows
  };
}

// src/core/background.ts
function canRunBackgroundWork(state) {
  return !state.unloaded && state.ready && !state.building && !state.rebuildPending && state.liveUpdatePending === 0 && state.quietForMs >= state.minimumQuietMs;
}

// src/core/localmodel.ts
var READABLE_VERSIONS = ["0.1", "0.2"];
var PREFIX = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
var SECTION = { "part occurrences": "part", "local interfaces": "endpoint", connections: "connection" };
var FLOW_ROLES = ["transmit", "receive", "exchange", "unspecified"];
var USAGES = ["standard", "variant", "option"];
var TOKEN_30 = /^\d{17}[a-z-]{13}$/;
var START = /^<!--\s*MDSE:LOCAL-MODEL START(?:\s+schema=(\S+?))?\s*-->\s*$/;
var END = /^<!--\s*MDSE:LOCAL-MODEL END\s*-->\s*$/;
var noteRef = (uid) => ({ kind: "note", uid });
var localRef = (ownerUid, localKind, localId) => ({ kind: "local", ownerUid, localKind, localId });
var refKey = (r) => r.kind === "note" ? `note:${r.uid}` : `local:${r.ownerUid}#^${r.localId}`;
function parseLinks(value) {
  const out = [];
  for (const m of value.matchAll(/\[\[([^\]]*)\]\]/g)) {
    const inner = m[1];
    const bar = inner.indexOf("|");
    const left = bar < 0 ? inner : inner.slice(0, bar);
    const alias = bar < 0 ? void 0 : inner.slice(bar + 1).trim();
    const hash = left.indexOf("#");
    const target = (hash < 0 ? left : left.slice(0, hash)).trim();
    const frag = hash < 0 ? "" : left.slice(hash + 1).trim();
    out.push({ text: m[0], target, blockId: frag.startsWith("^") ? frag.slice(1) : "", alias });
  }
  return out;
}
var kindOfId = (id) => {
  for (const k of Object.keys(PREFIX)) if (id.startsWith(PREFIX[k])) return k;
  return null;
};
function blank(kind, identifier, line, version) {
  return {
    kind,
    localId: "",
    identifier,
    line,
    fields: /* @__PURE__ */ new Map(),
    definition: null,
    usage: "standard",
    usageExplicit: false,
    part: null,
    parent: null,
    exposes: [],
    equals: [],
    endpointA: null,
    endpointB: null,
    roleA: null,
    roleB: null,
    multiplicity: null,
    endpointKind: null,
    connectionId: null,
    sourceSchemaVersion: version
  };
}
function finish(r) {
  const f = r.fields;
  const links = (k) => parseLinks(f.get(k) ?? "");
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
var ALLOWED_FIELDS = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "exposes", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier"],
  flow: ["definition", "identifier", "endpointA", "endpointB"]
};
function parseLocalModel(text) {
  const lines = text.split(/\r?\n/);
  const starts = [];
  const ends = [];
  lines.forEach((l, i) => {
    const s = START.exec(l.trim());
    if (s) starts.push({ i, version: s[1] ?? null });
    else if (END.test(l.trim())) ends.push(i);
  });
  if (!starts.length && !ends.length) return null;
  const region = {
    schemaVersion: starts[0]?.version ?? null,
    startLine: starts[0] ? starts[0].i + 1 : null,
    endLine: ends[0] !== void 0 ? ends[0] + 1 : null,
    records: [],
    findings: [],
    structured: true
  };
  const bad = (code, message, line) => {
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
    else if (!READABLE_VERSIONS.includes(v)) bad("schema.unsupported", `Local Model schema ${v} is not supported; the text stays readable and structured Local Model use is off.`, starts[0].i + 1);
  }
  if (!region.structured) return region;
  const version = starts[0].version;
  const from = starts[0].i + 1;
  const to = ends[0];
  let section = null;
  let current = null;
  let lastConnection = null;
  const done = (r) => {
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
        section = SECTION[title.toLowerCase()] ?? null;
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
  for (const r of region.records) if (r.kind === "flow" && !r.connectionId) r.connectionId = null;
  region.findings.push(...validateRegion(region));
  return region;
}
var refTargetsKind = [
  ["part", "endpoint", "part"],
  ["parent", "endpoint", "endpoint"]
];
function validateRegion(region) {
  const out = [];
  const add = (code, message, r, severity = "error") => out.push({ code, severity, message, localId: r?.localId || void 0, line: r?.line });
  const version = region.schemaVersion ?? "0.2";
  const byId = /* @__PURE__ */ new Map();
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
      else if (version === "0.2" && !TOKEN_30.test(r.localId.slice(PREFIX[k].length))) add("record.block-id-malformed", `${label}: block ID ${r.localId} does not end in a 30-character identity token.`, r);
    }
    for (const key2 of r.fields.keys()) {
      if (key2 === "usage" && version === "0.1") add("record.unknown-field", `${label}: usage is not part of schema 0.1.`, r, "warning");
      else if (!ALLOWED_FIELDS[r.kind].includes(key2) && key2 !== "usage") add("record.unknown-field", `${label}: unknown field ${key2}.`, r, "warning");
    }
    if (r.fields.has("usage")) {
      if (r.kind === "connection" || r.kind === "flow") add("record.usage-invalid", `${label}: usage is not valid on a ${r.kind}.`, r);
      else if (version === "0.2" && !USAGES.includes(r.usage)) add("record.usage-invalid", `${label}: usage "${r.usage}" is not standard, variant or option.`, r);
    }
    if ((r.kind === "part" || r.kind === "endpoint" || r.kind === "flow") && !r.definition) add("record.missing-definition", `${label} has no definition link.`, r);
    if (r.definition && r.definition.blockId) add("definition.incompatible", `${label}: the definition must link to a note, not a block.`, r);
  }
  for (const [id, list] of byId) if (list.length > 1) add("record.duplicate-id", `Block ID ${id} is used by ${list.length} records.`, list[1]);
  const sameNote = (l) => l && !l.target && l.blockId ? byId.get(l.blockId)?.[0] : void 0;
  const needLocal = (r, l, field, kind) => {
    if (!l) return;
    if (l.target) return;
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
      for (const [field, , want] of refTargetsKind) needLocal(r, r[field], field, want);
      if (r.part && r.parent) add("ref.part-and-parent", `endpoint "${r.identifier}" has both part and parent; they are mutually exclusive.`, r);
      for (const l of r.exposes) needLocal(r, l, "exposes", "endpoint");
      for (const l of r.equals) needLocal(r, l, "equals", "endpoint");
    }
    if (r.kind === "connection") {
      if (!r.endpointA || !r.endpointB) add("ref.endpoint-count", `connection "${r.identifier}" needs exactly two endpoints (endpointA and endpointB).`, r);
      needLocal(r, r.endpointA, "endpointA", "endpoint");
      needLocal(r, r.endpointB, "endpointB", "endpoint");
    }
    if (r.kind === "flow") {
      for (const [f, v] of [["endpointA", r.roleA], ["endpointB", r.roleB]]) {
        if (!v || !FLOW_ROLES.includes(v)) add("ref.flow-role-invalid", `flow "${r.identifier}": ${f} role "${v ?? ""}" is not one of ${FLOW_ROLES.join(", ")}.`, r, "error");
      }
      if (!r.connectionId && region.records.some((x) => x.kind === "connection" && !x.localId)) add("record.orphan-flow", `flow "${r.identifier}" sits under a connection that has no block ID.`, r);
    }
  }
  for (const r of region.records) {
    if (r.kind !== "endpoint" || !r.parent) continue;
    const seen = /* @__PURE__ */ new Set([r.localId]);
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
var LocalModelIndex = class {
  constructor() {
    this.regions = /* @__PURE__ */ new Map();
    this.ids = /* @__PURE__ */ new Map();
  }
  set(path, region) {
    this.remove(path);
    if (!region) return;
    this.regions.set(path, region);
    for (const r of region.records) {
      if (!r.localId) continue;
      const l = this.ids.get(r.localId) ?? [];
      l.push({ path, record: r });
      this.ids.set(r.localId, l);
    }
  }
  remove(path) {
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
  find(localId) {
    return this.ids.get(localId) ?? [];
  }
  recordsOf(path, kind) {
    const r = this.regions.get(path);
    if (!r || !r.structured) return [];
    return kind ? r.records.filter((x) => x.kind === kind) : r.records.slice();
  }
  /**
   * Where Used for occurrences (WB-106): every local record whose definition resolves to `definitionPath`.
   * `resolve` turns link text into a vault path the way Obsidian would from the owning note.
   */
  occurrencesOf(definitionPath, resolve) {
    const out = [];
    for (const [path, region] of this.regions) {
      if (!region.structured) continue;
      for (const record of region.records) {
        if (record.definition && record.definition.target && resolve(record.definition.target, path) === definitionPath) out.push({ path, record });
      }
    }
    return out;
  }
  /** ModelRef of a record in a note whose uid is `ownerUid`. */
  refOf(ownerUid, record) {
    return record.localId ? localRef(ownerUid, record.kind, record.localId) : null;
  }
};
function specializationCandidates(index, root) {
  const seen = /* @__PURE__ */ new Set([root]);
  const order = [root];
  const onStack = /* @__PURE__ */ new Set([root]);
  let cycle = false;
  const stack = [
    { node: root, edges: index.in(root).filter((e) => e.field === "subtypeOf"), i: 0 }
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
  const byKey = /* @__PURE__ */ new Map();
  for (const p of order) {
    const n = index.notes.get(p);
    if (!n || n.abstract === true) continue;
    const key2 = n.uid || p;
    if (!byKey.has(key2)) byKey.set(key2, p);
  }
  return { candidates: [...byKey.values()], cycle };
}
var COMPATIBLE = { part: "Object", endpoint: "Port", flow: "Item Flow", connection: null };
function validateLocalModels(input) {
  const { index, local, resolve } = input;
  const out = [];
  const add = (path, code, message, r, severity = "error") => out.push({ code, severity, message, path, localId: r?.localId || void 0, line: r?.line });
  for (const [path, region] of local.regions) for (const f of region.findings) out.push({ ...f, path });
  const owners = /* @__PURE__ */ new Map();
  const claim = (token, who) => {
    const l = owners.get(token) ?? [];
    l.push(who);
    owners.set(token, l);
  };
  for (const n of index.notes.values()) if (n.uid && TOKEN_30.test(n.uid)) claim(n.uid, `note ${n.path}`);
  for (const [path, region] of local.regions) {
    if (region.schemaVersion !== "0.2") continue;
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
  const rootsChecked = /* @__PURE__ */ new Set();
  for (const [path, region] of local.regions) {
    if (!region.structured) continue;
    for (const r of region.records) {
      const label = `${r.kind} "${r.identifier}"`;
      const links = [
        ["part", r.part, "part"],
        ["parent", r.parent, "endpoint"],
        ["endpointA", r.endpointA, "endpoint"],
        ["endpointB", r.endpointB, "endpoint"],
        ...r.exposes.map((l) => ["exposes", l, "endpoint"]),
        ...r.equals.map((l) => ["equals", l, "endpoint"])
      ];
      for (const [field, l, want2] of links) {
        if (!l || !l.target) continue;
        const tp = resolve(l.target, path);
        const rec = tp ? local.recordsOf(tp).find((x) => x.localId === l.blockId) : void 0;
        if (!tp) add(path, "ref.cross-note-missing", `${label}: ${field} points at note "${l.target}", which does not exist.`, r);
        else if (!rec) add(path, "ref.cross-note-missing", `${label}: ${field} points at ^${l.blockId} in ${tp}, which has no such record.`, r);
        else if (rec.kind !== want2) add(path, "ref.local-kind", `${label}: ${field} points at a ${rec.kind}, expected a ${want2}.`, r);
      }
      if (!r.definition || r.definition.blockId) continue;
      const dp = r.definition.target ? resolve(r.definition.target, path) : path;
      const def = dp ? index.notes.get(dp) : void 0;
      if (!dp || !def) {
        add(path, "definition.unresolved", `${label}: definition "${r.definition.target}" does not resolve to a note.`, r);
        continue;
      }
      const want = COMPATIBLE[r.kind];
      if (want && def.type !== want) add(path, "definition.incompatible", `${label}: definition ${def.name} is ${def.type ? `a ${def.type}` : "not a model note"}, expected a ${want}.`, r);
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
  for (const n of index.notes.values()) {
    for (const ref of n.localRefs ?? []) {
      const rec = local.recordsOf(ref.path).find((x) => x.localId === ref.localId);
      if (!rec) add(n.path, "frontmatter.local-target-missing", `${ref.field} points at ^${ref.localId} in ${ref.path}, which has no such record.`);
    }
    if (n.abstractInvalid) add(n.path, "abstract.invalid", "abstract must be true or false.");
  }
  return out;
}
function renderFindingsReport(findings, stats, opts = {}) {
  const per = opts.perCode ?? 25;
  const by = /* @__PURE__ */ new Map();
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
    ""
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
      if (list.length > per) lines.push(`- \u2026 ${list.length - per} more`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// src/core/rules.ts
var inEndpoint = (e, cls) => e === "any" || e.includes(cls);
function allows(def, fromClass, toClass) {
  if (!inEndpoint(def.from, fromClass)) {
    return { ok: false, reason: `${def.field} is not written on a ${fromClass}.` };
  }
  if (!inEndpoint(def.to, toClass)) {
    return { ok: false, reason: `${def.field} does not point at a ${toClass}.` };
  }
  if (def.sameClass && fromClass !== toClass) {
    return { ok: false, reason: `${def.field} connects two notes of the same class only.` };
  }
  if (def.excludePairs.some(([f, t]) => f === fromClass && t === toClass)) {
    return { ok: false, reason: `${fromClass} to ${toClass} uses another relationship, not ${def.field}.` };
  }
  return { ok: true };
}
function optionsBetween(schema, firstClass, secondClass) {
  const out = [];
  for (const def of schema.relationships) {
    if (def.temporary) continue;
    const forward = allows(def, firstClass, secondClass).ok;
    const backward = allows(def, secondClass, firstClass).ok;
    if (forward) out.push({ def, ownerIsFirst: true });
    if (backward && !(def.kind === "symmetric" && forward)) out.push({ def, ownerIsFirst: false });
  }
  return out.sort((a, b) => Number(a.def.provisional) - Number(b.def.provisional) || a.def.order - b.def.order);
}

// src/core/model.ts
var ModelIndex = class {
  constructor(schema) {
    this.schema = schema;
    this.notes = /* @__PURE__ */ new Map();
    this.outEdges = /* @__PURE__ */ new Map();
    this.inEdges = /* @__PURE__ */ new Map();
  }
  get size() {
    return this.notes.size;
  }
  /** Model notes: notes whose `type` is a class in element-types.yaml. */
  isElement(rec) {
    return !!rec && !!rec.type && this.schema.classNames.has(rec.type);
  }
  upsert(rec) {
    this.remove(rec.path);
    this.notes.set(rec.path, rec);
    const out = [];
    for (const [field, targets] of rec.fields) {
      if (!this.schema.byField.has(field)) continue;
      for (const to of targets) {
        const e = { from: rec.path, to, field };
        out.push(e);
        let list = this.inEdges.get(to);
        if (!list) this.inEdges.set(to, list = []);
        list.push(e);
      }
    }
    if (out.length) this.outEdges.set(rec.path, out);
  }
  remove(path) {
    if (!this.notes.delete(path)) return;
    for (const e of this.outEdges.get(path) ?? []) {
      const list = this.inEdges.get(e.to);
      if (!list) continue;
      const kept = list.filter((x) => x !== e);
      if (kept.length) this.inEdges.set(e.to, kept);
      else this.inEdges.delete(e.to);
    }
    this.outEdges.delete(path);
  }
  out(path) {
    return this.outEdges.get(path) ?? [];
  }
  in(path) {
    return this.inEdges.get(path) ?? [];
  }
  edgeCount() {
    let n = 0;
    for (const list of this.outEdges.values()) n += list.length;
    return n;
  }
  hasLink(path, field, target) {
    return this.notes.get(path)?.fields.get(field)?.includes(target) ?? false;
  }
  findings() {
    const f = { missingInverse: [], orphanInverse: [], offRule: [], provisional: [], unresolvedLinks: 0, broken: [] };
    for (const rec of this.notes.values()) {
      f.unresolvedLinks += rec.unresolved;
      for (const b of rec.broken ?? []) f.broken.push({ from: rec.path, ...b });
      for (const e of this.out(rec.path)) {
        const def = this.schema.byField.get(e.field);
        const target = this.notes.get(e.to);
        if (def.provisional) f.provisional.push(e);
        if (this.isElement(rec) && this.isElement(target)) {
          const r = allows(def, rec.type, target.type);
          if (!r.ok) f.offRule.push({ ...e, reason: r.reason ?? "" });
        }
        if (!target) continue;
        const back = def.kind === "symmetric" ? def.field : def.inverse;
        if (back && !this.hasLink(e.to, back, e.from)) f.missingInverse.push(e);
      }
      for (const [field, targets] of rec.fields) {
        const def = this.schema.byInverse.get(field);
        if (!def) continue;
        for (const owner of targets) {
          if (this.notes.has(owner) && !this.hasLink(owner, def.field, rec.path)) {
            f.orphanInverse.push({ from: rec.path, to: owner, field });
          }
        }
      }
    }
    return f;
  }
};

// src/core/schema.ts
var MIN_RELATIONSHIPS_VERSION = "1.25";
var isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
function endpoint(v, where, warnings) {
  if (v === void 0) return "any";
  if (v === "any") return "any";
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
  warnings.push(`${where}: endpoint is neither "any" nor a list of classes; treated as any.`);
  return "any";
}
function pairs(v, where, warnings) {
  if (v === void 0) return [];
  if (Array.isArray(v) && v.every((p) => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === "string"))) {
    return v;
  }
  warnings.push(`${where}: excludePairs is not a list of [from, to] pairs; ignored.`);
  return [];
}
function compareVersions(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
function parseSchema(relationshipsYaml, elementTypesYaml) {
  const warnings = [];
  if (!isObj(relationshipsYaml)) throw new Error("relationships.yaml did not parse to a mapping.");
  if (!isObj(elementTypesYaml)) throw new Error("element-types.yaml did not parse to a mapping.");
  const rels = [];
  let order = 0;
  const add = (raw, kind, section2) => {
    if (!isObj(raw)) {
      warnings.push(`${section2}: an entry is not a mapping; skipped.`);
      return;
    }
    const field = kind === "paired" || kind === "temporary" ? raw.forward : raw.field;
    if (typeof field !== "string") {
      warnings.push(`${section2}: an entry has no field name; skipped.`);
      return;
    }
    const where = `${section2}.${field}`;
    const between = kind === "symmetric" ? endpoint(raw.between, where, warnings) : void 0;
    rels.push({
      field,
      inverse: typeof raw.inverse === "string" ? raw.inverse : void 0,
      kind,
      from: between ?? endpoint(raw.from, where, warnings),
      to: between ?? endpoint(raw.to, where, warnings),
      sameClass: raw.sameClass === true,
      excludePairs: pairs(raw.excludePairs, where, warnings),
      provisional: raw.provisional === true,
      temporary: kind === "temporary" || raw.temporary === true,
      order: order++
    });
  };
  const section = (name, kind) => {
    const list = relationshipsYaml[name];
    if (list === void 0) return;
    if (!Array.isArray(list)) {
      warnings.push(`relationships.yaml: "${name}" is not a list; skipped.`);
      return;
    }
    for (const raw of list) {
      add(kind === "oneWay" && typeof raw === "string" ? { field: raw } : raw, kind, name);
    }
  };
  section("paired", "paired");
  section("temporaryPairs", "temporary");
  section("symmetric", "symmetric");
  section("oneWay", "oneWay");
  const byField = /* @__PURE__ */ new Map();
  const byInverse = /* @__PURE__ */ new Map();
  for (const r of rels) {
    if (byField.has(r.field)) warnings.push(`relationships.yaml: field "${r.field}" is listed twice.`);
    byField.set(r.field, r);
    if (r.inverse) byInverse.set(r.inverse, r);
  }
  const rawClasses = elementTypesYaml.classes;
  const classes = Array.isArray(rawClasses) ? rawClasses.filter(isObj).flatMap(
    (c) => typeof c.name === "string" ? [{
      name: c.name,
      prefix: typeof c.prefix === "string" ? c.prefix : void 0,
      subtypes: Array.isArray(c.subtype) ? c.subtype.filter((s) => typeof s === "string") : []
    }] : []
  ) : [];
  if (classes.length === 0) warnings.push("element-types.yaml: no classes found.");
  const classNames = new Set(classes.map((c) => c.name));
  for (const r of rels) {
    for (const side of [r.from, r.to]) {
      if (side === "any") continue;
      for (const c of side) {
        if (!classNames.has(c)) warnings.push(`relationships.yaml: "${r.field}" names unknown class "${c}".`);
      }
    }
  }
  const strList = (v) => Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  const relationshipsVersion = String(relationshipsYaml.schemaVersion ?? "0");
  if (compareVersions(relationshipsVersion, MIN_RELATIONSHIPS_VERSION) < 0) {
    warnings.push(
      `relationships.yaml is version ${relationshipsVersion}; this Workbench needs ${MIN_RELATIONSHIPS_VERSION} or later. Editing is disabled.`
    );
  }
  return {
    relationshipsVersion,
    elementTypesVersion: String(elementTypesYaml.schemaVersion ?? "0"),
    classes,
    classNames,
    commonProperties: strList(elementTypesYaml.commonProperties),
    optionalProperties: Array.isArray(elementTypesYaml.optionalProperties) ? elementTypesYaml.optionalProperties.flatMap((v) => {
      if (typeof v === "string") return [v];
      if (isObj(v) && typeof v.name === "string") return [v.name];
      return [];
    }) : [],
    translatedOnlyProperties: strList(elementTypesYaml.translatedOnlyProperties),
    relationships: rels,
    byField,
    byInverse,
    warnings
  };
}
function editingBlocked(schema) {
  return compareVersions(schema.relationshipsVersion, MIN_RELATIONSHIPS_VERSION) < 0;
}
function schemaSignature(schema) {
  const endpoint2 = (v) => v === "any" ? "any" : v.join(",");
  const rows = [
    `relationshipsVersion=${schema.relationshipsVersion}`,
    `elementTypesVersion=${schema.elementTypesVersion}`,
    `common=${schema.commonProperties.join(",")}`,
    `optional=${schema.optionalProperties.join(",")}`,
    `translatedOnly=${schema.translatedOnlyProperties.join(",")}`,
    ...schema.classes.map((c) => `class|${c.name}|${c.prefix ?? ""}|${c.subtypes.join(",")}`),
    ...schema.relationships.map(
      (r) => [
        "rel",
        r.order,
        r.field,
        r.inverse ?? "",
        r.kind,
        endpoint2(r.from),
        endpoint2(r.to),
        r.sameClass ? "1" : "0",
        r.excludePairs.map((p) => p.join(">")).join(","),
        r.provisional ? "1" : "0",
        r.temporary ? "1" : "0"
      ].join("|")
    )
  ].join("\n");
  let h = 2166136261;
  for (const ch of rows) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// src/core/cache.ts
var CACHE_FORMAT_VERSION = 1;
var CACHE_SEMANTIC_VERSION = 3;
function expectedCompatibility(schema, scope) {
  return {
    formatVersion: CACHE_FORMAT_VERSION,
    semanticVersion: CACHE_SEMANTIC_VERSION,
    vaultUid: scope.vaultUid,
    relationshipsVersion: schema.relationshipsVersion,
    elementTypesVersion: schema.elementTypesVersion,
    schemaSignature: schemaSignature(schema),
    localModelReadableVersions: [...READABLE_VERSIONS]
  };
}
function cacheCompatibilityProblem(cache, expected) {
  if (!isObject(cache)) return "cache is not an object";
  const header = cache.header;
  if (!isObject(header)) return "cache header is missing";
  if (header.formatVersion !== expected.formatVersion) return `cache format ${String(header.formatVersion)} != ${expected.formatVersion}`;
  if (header.semanticVersion !== expected.semanticVersion) return `semantic cache contract ${String(header.semanticVersion)} != ${expected.semanticVersion}`;
  if (header.vaultUid !== expected.vaultUid) return `vault identity ${String(header.vaultUid)} != ${expected.vaultUid}`;
  if (header.relationshipsVersion !== expected.relationshipsVersion) return `relationships schema ${String(header.relationshipsVersion)} != ${expected.relationshipsVersion}`;
  if (header.elementTypesVersion !== expected.elementTypesVersion) return `element-types schema ${String(header.elementTypesVersion)} != ${expected.elementTypesVersion}`;
  if (header.schemaSignature !== expected.schemaSignature) return `schema semantics ${String(header.schemaSignature)} != ${expected.schemaSignature}`;
  if (!sameStrings(header.localModelReadableVersions, expected.localModelReadableVersions)) return "Local Model reader contract changed";
  return null;
}
function serializeSemanticState(index, local, fingerprints, schema, scope, producerVersion, createdAt = Date.now()) {
  const notes = [...index.notes.values()].sort((a, b) => a.path.localeCompare(b.path)).map(serializeNote);
  const localRegions = [...local.regions.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, region]) => [path, serializeRegion(region)]);
  return {
    header: { ...expectedCompatibility(schema, scope), createdAt, producerVersion },
    fingerprints: Object.fromEntries([...fingerprints.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    notes,
    localRegions
  };
}
function restoreSemanticState(cache, schema, scope) {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.notes) || !Array.isArray(cache.localRegions) || !isObject(cache.fingerprints)) {
    throw new Error("Malformed semantic cache payload.");
  }
  const index = new ModelIndex(schema);
  for (const raw of cache.notes) index.upsert(deserializeNote(raw));
  const local = new LocalModelIndex();
  for (const entry of cache.localRegions) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string") throw new Error("Malformed Local Model cache entry.");
    local.set(entry[0], deserializeRegion(entry[1]));
  }
  const fingerprints = /* @__PURE__ */ new Map();
  for (const [path, raw] of Object.entries(cache.fingerprints)) {
    if (!isFingerprint(raw)) throw new Error(`Malformed fingerprint for ${path}.`);
    fingerprints.set(path, { ...raw });
  }
  return { index, local, fingerprints };
}
function serializeNote(n) {
  return {
    path: n.path,
    name: n.name,
    ...n.type !== void 0 ? { type: n.type } : {},
    ...n.id !== void 0 ? { id: n.id } : {},
    ...n.uid !== void 0 ? { uid: n.uid } : {},
    authoredLinks: (n.authoredLinks ?? []).map((x) => ({ ...x })),
    fields: [...n.fields.entries()].map(([k, v]) => [k, [...v]]),
    unresolved: n.unresolved,
    ...n.broken ? { broken: n.broken.map((x) => ({ ...x })) } : {},
    ...n.repeat ? { repeat: [...n.repeat.entries()] } : {},
    ...n.abstract !== void 0 ? { abstract: n.abstract } : {},
    ...n.abstractInvalid !== void 0 ? { abstractInvalid: n.abstractInvalid } : {},
    ...n.localRefs ? { localRefs: n.localRefs.map((x) => ({ ...x })) } : {}
  };
}
function deserializeNote(raw) {
  if (!isObject(raw) || typeof raw.path !== "string" || typeof raw.name !== "string" || typeof raw.unresolved !== "number" || !Array.isArray(raw.fields) || !arrayOfAuthoredLinks(raw.authoredLinks)) {
    throw new Error("Malformed note cache entry.");
  }
  const fields = /* @__PURE__ */ new Map();
  for (const entry of raw.fields) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !Array.isArray(entry[1]) || !entry[1].every((x) => typeof x === "string")) {
      throw new Error(`Malformed cached fields for ${raw.path}.`);
    }
    fields.set(entry[0], [...entry[1]]);
  }
  const repeat = raw.repeat === void 0 ? void 0 : pairsNumber(raw.repeat, "repeat");
  const type = optionalString(raw, "type");
  const id = optionalString(raw, "id");
  const uid = optionalString(raw, "uid");
  let broken;
  if (raw.broken !== void 0) {
    if (!arrayOfBroken(raw.broken)) throw new Error(`Malformed cached broken links for ${raw.path}.`);
    broken = raw.broken.map((x) => ({ ...x }));
  }
  let localRefs;
  if (raw.localRefs !== void 0) {
    if (!arrayOfLocalRefs(raw.localRefs)) throw new Error(`Malformed cached local references for ${raw.path}.`);
    localRefs = raw.localRefs.map((x) => ({ ...x }));
  }
  const abstract = optionalBoolean(raw, "abstract", raw.path);
  const abstractInvalid = optionalBoolean(raw, "abstractInvalid", raw.path);
  return {
    path: raw.path,
    name: raw.name,
    ...type !== void 0 ? { type } : {},
    ...id !== void 0 ? { id } : {},
    ...uid !== void 0 ? { uid } : {},
    authoredLinks: raw.authoredLinks.map((x) => ({ ...x })),
    fields,
    unresolved: raw.unresolved,
    ...broken ? { broken } : {},
    ...repeat ? { repeat } : {},
    ...abstract !== void 0 ? { abstract } : {},
    ...abstractInvalid !== void 0 ? { abstractInvalid } : {},
    ...localRefs ? { localRefs } : {}
  };
}
function serializeRegion(r) {
  return {
    schemaVersion: r.schemaVersion,
    startLine: r.startLine,
    endLine: r.endLine,
    structured: r.structured,
    findings: r.findings.map(serializeFinding),
    records: r.records.map(serializeLocalRecord)
  };
}
function serializeLocalRecord(r) {
  return {
    ...r,
    fields: [...r.fields.entries()],
    definition: serializeLink(r.definition),
    part: serializeLink(r.part),
    parent: serializeLink(r.parent),
    exposes: r.exposes.map((x) => serializeLink(x)),
    equals: r.equals.map((x) => serializeLink(x)),
    endpointA: serializeLink(r.endpointA),
    endpointB: serializeLink(r.endpointB)
  };
}
function serializeLink(link) {
  if (!link) return null;
  return {
    text: link.text,
    target: link.target,
    blockId: link.blockId,
    ...link.alias !== void 0 ? { alias: link.alias } : {}
  };
}
function serializeFinding(f) {
  return {
    code: f.code,
    severity: f.severity,
    message: f.message,
    ...f.path !== void 0 ? { path: f.path } : {},
    ...f.localId !== void 0 ? { localId: f.localId } : {},
    ...f.line !== void 0 ? { line: f.line } : {}
  };
}
function deserializeRegion(raw) {
  if (!isObject(raw) || !Array.isArray(raw.records) || !Array.isArray(raw.findings) || typeof raw.structured !== "boolean") {
    throw new Error("Malformed Local Model region cache entry.");
  }
  const records = raw.records.map((record) => deserializeLocalRecord(record));
  const findings = raw.findings.map((finding) => {
    if (!isFinding(finding)) throw new Error("Malformed Local Model finding cache entry.");
    return { ...finding };
  });
  if (!(raw.schemaVersion === null || typeof raw.schemaVersion === "string")) throw new Error("Malformed Local Model schema version in cache.");
  if (!(raw.startLine === null || typeof raw.startLine === "number")) throw new Error("Malformed Local Model start line in cache.");
  if (!(raw.endLine === null || typeof raw.endLine === "number")) throw new Error("Malformed Local Model end line in cache.");
  return {
    schemaVersion: raw.schemaVersion,
    startLine: raw.startLine,
    endLine: raw.endLine,
    records,
    findings,
    structured: raw.structured
  };
}
function deserializeLocalRecord(raw) {
  if (!isObject(raw) || !isLocalKind(raw.kind) || typeof raw.localId !== "string" || typeof raw.identifier !== "string" || typeof raw.line !== "number" || !Array.isArray(raw.fields)) {
    throw new Error("Malformed Local Model record cache entry.");
  }
  const fields = /* @__PURE__ */ new Map();
  for (const entry of raw.fields) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || typeof entry[1] !== "string") throw new Error("Malformed Local Model field cache entry.");
    fields.set(entry[0], entry[1]);
  }
  if (typeof raw.usage !== "string" || typeof raw.usageExplicit !== "boolean" || typeof raw.sourceSchemaVersion !== "string") {
    throw new Error("Malformed Local Model scalar cache entry.");
  }
  return {
    kind: raw.kind,
    localId: raw.localId,
    identifier: raw.identifier,
    line: raw.line,
    fields,
    definition: strictLinkOrNull(raw.definition, "definition"),
    usage: raw.usage,
    usageExplicit: raw.usageExplicit,
    part: strictLinkOrNull(raw.part, "part"),
    parent: strictLinkOrNull(raw.parent, "parent"),
    exposes: strictLinks(raw.exposes, "exposes"),
    equals: strictLinks(raw.equals, "equals"),
    endpointA: strictLinkOrNull(raw.endpointA, "endpointA"),
    endpointB: strictLinkOrNull(raw.endpointB, "endpointB"),
    roleA: strictNullableString(raw.roleA, "roleA"),
    roleB: strictNullableString(raw.roleB, "roleB"),
    multiplicity: strictNullableString(raw.multiplicity, "multiplicity"),
    endpointKind: strictNullableString(raw.endpointKind, "endpointKind"),
    connectionId: strictNullableString(raw.connectionId, "connectionId"),
    sourceSchemaVersion: raw.sourceSchemaVersion
  };
}
var isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
var sameStrings = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
function optionalString(o, k) {
  const v = o[k];
  if (v === void 0) return void 0;
  if (typeof v !== "string") throw new Error(`Malformed cached ${k}.`);
  return v;
}
function optionalBoolean(o, k, path) {
  const v = o[k];
  if (v === void 0) return void 0;
  if (typeof v !== "boolean") throw new Error(`Malformed cached ${k} value for ${path}.`);
  return v;
}
function strictNullableString(v, field) {
  if (v === null) return null;
  if (typeof v === "string") return v;
  throw new Error(`Malformed Local Model ${field} cache entry.`);
}
var isLocalKind = (v) => v === "part" || v === "endpoint" || v === "connection" || v === "flow";
var isFingerprint = (v) => isObject(v) && typeof v.ctime === "number" && typeof v.mtime === "number" && typeof v.size === "number" && (v.hash === void 0 || typeof v.hash === "string");
var isLink = (v) => isObject(v) && typeof v.text === "string" && typeof v.target === "string" && typeof v.blockId === "string" && (v.alias === void 0 || typeof v.alias === "string");
function strictLinkOrNull(v, field) {
  if (v === null) return null;
  if (!isLink(v)) throw new Error(`Malformed Local Model ${field} link cache entry.`);
  return { ...v };
}
function strictLinks(v, field) {
  if (!Array.isArray(v) || !v.every(isLink)) throw new Error(`Malformed Local Model ${field} links cache entry.`);
  return v.map((x) => ({ ...x }));
}
var isFinding = (v) => isObject(v) && typeof v.code === "string" && (v.severity === "error" || v.severity === "warning") && typeof v.message === "string";
var arrayOfBroken = (v) => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.link === "string");
var arrayOfLocalRefs = (v) => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.path === "string" && typeof x.localId === "string");
var arrayOfAuthoredLinks = (v) => Array.isArray(v) && v.every((x) => isObject(x) && typeof x.field === "string" && typeof x.link === "string" && typeof x.linkpath === "string");
function pairsNumber(v, label) {
  if (!Array.isArray(v)) throw new Error(`Malformed cached ${label}.`);
  const out = /* @__PURE__ */ new Map();
  for (const x of v) {
    if (!Array.isArray(x) || x.length !== 2 || typeof x[0] !== "string" || typeof x[1] !== "number") throw new Error(`Malformed cached ${label}.`);
    out.set(x[0], x[1]);
  }
  return out;
}
var CACHE_MANIFEST_VERSION = 3;
function shardSemanticCache(cache, generation, noteBuckets = 32, localBuckets = 16, fingerprintBuckets = 32) {
  if (!generation.trim()) throw new Error("Cache generation must not be empty.");
  for (const [label, n] of [["note", noteBuckets], ["Local Model", localBuckets], ["fingerprint", fingerprintBuckets]]) {
    if (!Number.isInteger(n) || n < 1 || n > 256) throw new Error(`${label} cache bucket count must be an integer from 1 to 256.`);
  }
  const noteShards = Array.from({ length: noteBuckets }, (_, index) => ({ generation, index, notes: [] }));
  for (const rec of cache.notes) noteShards[cacheBucketForPath(rec.path, noteBuckets)].notes.push(rec);
  for (const shard of noteShards) shard.notes.sort((a, b) => a.path.localeCompare(b.path));
  const localShards = Array.from({ length: localBuckets }, (_, index) => ({ generation, index, localRegions: [] }));
  for (const entry of cache.localRegions) localShards[cacheBucketForPath(entry[0], localBuckets)].localRegions.push(entry);
  for (const shard of localShards) shard.localRegions.sort((a, b) => a[0].localeCompare(b[0]));
  const fingerprintShards = Array.from({ length: fingerprintBuckets }, (_, index) => ({ generation, index, fingerprints: [] }));
  for (const entry of Object.entries(cache.fingerprints)) fingerprintShards[cacheBucketForPath(entry[0], fingerprintBuckets)].fingerprints.push(entry);
  for (const shard of fingerprintShards) shard.fingerprints.sort((a, b) => a[0].localeCompare(b[0]));
  return {
    manifest: {
      manifestVersion: CACHE_MANIFEST_VERSION,
      sequence: 0,
      generation,
      header: cache.header,
      fingerprints: { count: fingerprintShards.length, total: Object.keys(cache.fingerprints).length },
      notes: { count: noteShards.length, total: cache.notes.length },
      localRegions: { count: localShards.length, total: cache.localRegions.length }
    },
    fingerprintShards,
    noteShards,
    localShards
  };
}
function joinSemanticCache(manifest, fingerprintShards, noteShards, localShards) {
  if (!isDiskManifest(manifest)) throw new Error("Malformed semantic cache manifest.");
  if (manifest.manifestVersion !== CACHE_MANIFEST_VERSION) throw new Error(`Unsupported cache manifest version ${manifest.manifestVersion}.`);
  const fingerprints = joinFingerprintShards(manifest, fingerprintShards);
  const notes = joinNoteShards(manifest, noteShards);
  const localRegions = joinLocalShards(manifest, localShards);
  return {
    header: manifest.header,
    fingerprints,
    notes,
    localRegions
  };
}
function joinFingerprintShards(manifest, shards) {
  if (shards.length !== manifest.fingerprints.count) throw new Error("Semantic cache fingerprint shard count mismatch.");
  const ordered = new Array(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || raw.generation !== manifest.generation || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || !Array.isArray(raw.fingerprints)) {
      throw new Error("Malformed semantic cache fingerprint shard.");
    }
    if (ordered[raw.index]) throw new Error("Duplicate semantic cache fingerprint shard index.");
    ordered[raw.index] = raw;
  }
  const out = {};
  let total = 0;
  for (const shard of ordered) {
    for (const entry of shard.fingerprints) {
      if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || !isFingerprint(entry[1])) throw new Error("Malformed semantic cache fingerprint entry.");
      if (out[entry[0]]) throw new Error(`Duplicate semantic cache fingerprint path ${entry[0]}.`);
      out[entry[0]] = { ...entry[1] };
      total++;
    }
  }
  if (total !== manifest.fingerprints.total) throw new Error("Semantic cache fingerprint total mismatch.");
  return out;
}
function joinNoteShards(manifest, shards) {
  if (shards.length !== manifest.notes.count) throw new Error("Semantic cache note shard count mismatch.");
  const ordered = new Array(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || raw.generation !== manifest.generation || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || !Array.isArray(raw.notes)) {
      throw new Error("Malformed semantic cache note shard.");
    }
    if (ordered[raw.index]) throw new Error("Duplicate semantic cache note shard index.");
    ordered[raw.index] = raw;
  }
  const notes = ordered.flatMap((s) => s.notes).sort((a, b) => a.path.localeCompare(b.path));
  if (notes.length !== manifest.notes.total) throw new Error("Semantic cache note total mismatch.");
  return notes;
}
function joinLocalShards(manifest, shards) {
  if (shards.length !== manifest.localRegions.count) throw new Error("Semantic cache Local Model shard count mismatch.");
  const ordered = new Array(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || raw.generation !== manifest.generation || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || !Array.isArray(raw.localRegions)) {
      throw new Error("Malformed semantic cache Local Model shard.");
    }
    if (ordered[raw.index]) throw new Error("Duplicate semantic cache Local Model shard index.");
    ordered[raw.index] = raw;
  }
  const regions = ordered.flatMap((s) => s.localRegions).sort((a, b) => a[0].localeCompare(b[0]));
  if (regions.length !== manifest.localRegions.total) throw new Error("Semantic cache Local Model total mismatch.");
  return regions;
}
function cacheBucketForPath(path, count) {
  if (!Number.isInteger(count) || count < 1) throw new Error("Cache bucket count must be a positive integer.");
  let h = 2166136261;
  for (let i = 0; i < path.length; i++) {
    h ^= path.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % count;
}
function cacheDirtyBucketsForPaths(paths, noteBuckets = 32, localBuckets = 16, fingerprintBuckets = 32) {
  const fp = /* @__PURE__ */ new Set();
  const notes = /* @__PURE__ */ new Set();
  const local = /* @__PURE__ */ new Set();
  for (const path of paths) {
    fp.add(cacheBucketForPath(path, fingerprintBuckets));
    notes.add(cacheBucketForPath(path, noteBuckets));
    local.add(cacheBucketForPath(path, localBuckets));
  }
  const sorted = (s) => [...s].sort((a, b) => a - b);
  return { fingerprints: sorted(fp), notes: sorted(notes), localRegions: sorted(local) };
}
function isDiskManifest(v) {
  if (!isObject(v) || typeof v.manifestVersion !== "number" || !Number.isInteger(v.sequence) || v.sequence < 0 || typeof v.generation !== "string" || !isObject(v.header)) return false;
  return isShardSet(v.fingerprints) && isShardSet(v.notes) && isShardSet(v.localRegions);
}
function isShardSet(v) {
  return isObject(v) && Number.isInteger(v.count) && Number.isInteger(v.total) && v.count >= 0 && v.total >= 0;
}
function planReconciliation(cached, current) {
  const unchanged = [];
  const changed = [];
  const added = [];
  const deleted = [];
  for (const path of [...current.keys()].sort()) {
    const now = current.get(path);
    const before = cached.get(path);
    if (!before) {
      added.push(path);
      continue;
    }
    const basicSame = before.ctime === now.ctime && before.mtime === now.mtime && before.size === now.size;
    const hashSame = before.hash !== void 0 && now.hash !== void 0 ? before.hash === now.hash : true;
    (basicSame && hashSame ? unchanged : changed).push(path);
  }
  for (const path of [...cached.keys()].sort()) if (!current.has(path)) deleted.push(path);
  return { unchanged, changed, added, deleted };
}
function reconciliationMode(plan, incrementalLimit = 300) {
  if (!Number.isInteger(incrementalLimit) || incrementalLimit < 1) throw new Error("incrementalLimit must be a positive integer.");
  const changed = plan.changed.length + plan.added.length + plan.deleted.length;
  if (!changed) return "none";
  return changed <= incrementalLimit ? "incremental" : "full";
}

// src/core/cache-storage.ts
var SLOT_NAMES = ["a", "b"];
var MANIFEST_NAMES = ["manifest-a.json", "manifest-b.json"];
function cacheManifestPaths(root) {
  const clean = cleanRoot(root);
  return [`${clean}/${MANIFEST_NAMES[0]}`, `${clean}/${MANIFEST_NAMES[1]}`];
}
function cacheSlotPaths(root) {
  const clean = cleanRoot(root);
  return [`${clean}/slots/${SLOT_NAMES[0]}`, `${clean}/slots/${SLOT_NAMES[1]}`];
}
async function writeSemanticCacheGeneration(storage, root, cache, generation, options = {}) {
  assertGeneration(generation);
  const clean = cleanRoot(root);
  const sharded = shardSemanticCache(cache, generation, options.noteBuckets, options.localBuckets, options.fingerprintBuckets);
  await storage.mkdir(clean);
  await storage.mkdir(`${clean}/slots`);
  const manifests = await readManifestSlots(storage, clean);
  sharded.manifest.sequence = Math.max(
    manifests[0].manifest?.sequence ?? 0,
    manifests[1].manifest?.sequence ?? 0
  ) + 1;
  const slot = chooseWriteSlot(manifests);
  const slotRoot = cacheSlotPaths(clean)[slot];
  await storage.mkdir(slotRoot);
  for (const shard of sharded.fingerprintShards) {
    await storage.write(`${slotRoot}/fingerprints-${pad(shard.index)}.json`, JSON.stringify(shard));
  }
  for (const shard of sharded.noteShards) {
    await storage.write(`${slotRoot}/notes-${pad(shard.index)}.json`, JSON.stringify(shard));
  }
  for (const shard of sharded.localShards) {
    await storage.write(`${slotRoot}/local-${pad(shard.index)}.json`, JSON.stringify(shard));
  }
  await storage.write(cacheManifestPaths(clean)[slot], JSON.stringify(sharded.manifest));
  return sharded.manifest;
}
async function readSemanticCacheGeneration(storage, root) {
  const clean = cleanRoot(root);
  const manifests = await readManifestSlots(storage, clean);
  const candidates = manifests.flatMap((x, slot) => x.manifest ? [{ slot, manifest: x.manifest }] : []).sort(
    (a, b) => b.manifest.sequence - a.manifest.sequence || b.manifest.header.createdAt - a.manifest.header.createdAt || b.manifest.generation.localeCompare(a.manifest.generation)
  );
  if (!candidates.length) throw new Error("No semantic cache manifest is available.");
  const errors = [];
  for (const { slot, manifest } of candidates) {
    try {
      return await readSlot(storage, clean, slot, manifest);
    } catch (e) {
      errors.push(`${MANIFEST_NAMES[slot]}: ${e.message}`);
    }
  }
  throw new Error(`No complete semantic cache generation is readable. ${errors.join(" | ")}`);
}
async function readSlot(storage, clean, slot, manifest) {
  assertGeneration(manifest.generation);
  const slotRoot = cacheSlotPaths(clean)[slot];
  const [fingerprintShards, noteShards, localShards] = await Promise.all([
    readJsonSeries(storage, Array.from({ length: manifest.fingerprints.count }, (_, i) => `${slotRoot}/fingerprints-${pad(i)}.json`)),
    readJsonSeries(storage, Array.from({ length: manifest.notes.count }, (_, i) => `${slotRoot}/notes-${pad(i)}.json`)),
    readJsonSeries(storage, Array.from({ length: manifest.localRegions.count }, (_, i) => `${slotRoot}/local-${pad(i)}.json`))
  ]);
  return joinSemanticCache(manifest, fingerprintShards, noteShards, localShards);
}
async function readJsonSeries(storage, paths, concurrency = 4) {
  if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error("Cache read concurrency must be a positive integer.");
  const out = new Array(paths.length);
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= paths.length) return;
      out[i] = JSON.parse(await storage.read(paths[i]));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, paths.length) }, () => worker()));
  return out;
}
async function readManifestSlots(storage, clean) {
  const paths = cacheManifestPaths(clean);
  const out = [];
  for (const path of paths) {
    try {
      const parsed = JSON.parse(await storage.read(path));
      out.push(isManifestShape(parsed) ? { manifest: parsed } : { manifest: null });
    } catch {
      out.push({ manifest: null });
    }
  }
  return out;
}
function chooseWriteSlot(slots) {
  if (!slots[0].manifest) return 0;
  if (!slots[1].manifest) return 1;
  const a = slots[0].manifest;
  const b = slots[1].manifest;
  if (a.sequence !== b.sequence) return a.sequence < b.sequence ? 0 : 1;
  if (a.header.createdAt !== b.header.createdAt) return a.header.createdAt < b.header.createdAt ? 0 : 1;
  return a.generation.localeCompare(b.generation) <= 0 ? 0 : 1;
}
function cleanRoot(root) {
  const clean = root.replace(/\\/g, "/").replace(/\/+$/, "").replace(/^\/+/, "");
  if (!clean || clean.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Invalid semantic cache root.");
  return clean;
}
function assertGeneration(generation) {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(generation)) throw new Error("Invalid semantic cache generation.");
}
function pad(index) {
  return String(index).padStart(5, "0");
}
function isObject2(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function isManifestShape(v) {
  if (!isObject2(v) || typeof v.manifestVersion !== "number" || !Number.isInteger(v.sequence) || v.sequence < 0 || typeof v.generation !== "string" || !isObject2(v.header)) return false;
  if (!isObject2(v.fingerprints) || !isObject2(v.notes) || !isObject2(v.localRegions)) return false;
  const shardSet = (x) => Number.isInteger(x.count) && x.count >= 0 && Number.isInteger(x.total) && x.total >= 0;
  return shardSet(v.fingerprints) && shardSet(v.notes) && shardSet(v.localRegions) && typeof v.header.createdAt === "number";
}

// src/core/internal-view.ts
var PART_W = 260;
var PART_H = 110;
var END_W = 150;
var END_H = 52;
var PAD_X = 260;
var PAD_Y = 180;
var COL_GAP = 320;
var ROW_GAP = 220;
var COLS = 3;
function internalSignature(local, ownerPath) {
  const rows = local.recordsOf(ownerPath).map((r) => {
    const fields = [...r.fields.entries()].map(([k, v]) => k + "=" + v).join("|");
    return [r.kind, r.localId, r.identifier, fields, r.connectionId ?? ""].join(";");
  }).sort().join("\n");
  let h = 2166136261;
  for (const ch of ownerPath + "\n" + rows) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function buildInternalView(index, local, ownerPath, resolve) {
  const owner = index.notes.get(ownerPath);
  if (!owner) throw new Error(ownerPath + " is not indexed.");
  const records = local.recordsOf(ownerPath);
  if (!records.length) throw new Error(owner.name + " has no governed Local Model records.");
  const parts = records.filter((r) => r.kind === "part").sort(byName);
  const endpoints = records.filter((r) => r.kind === "endpoint").sort(byName);
  const connections = records.filter((r) => r.kind === "connection").sort(byName);
  const flows = records.filter((r) => r.kind === "flow").sort(byName);
  const boundary = endpoints.filter((r) => !r.part && !r.parent);
  const internal = endpoints.filter((r) => !!r.part || !!r.parent);
  const rows = Math.max(1, Math.ceil(parts.length / COLS));
  const contentW = Math.max(900, Math.min(COLS, Math.max(1, parts.length)) * (PART_W + COL_GAP) + PAD_X * 2 - COL_GAP);
  const contentH = Math.max(620, rows * (PART_H + ROW_GAP) + PAD_Y * 2 - ROW_GAP);
  const nodes = [];
  const edges = [];
  const pos = /* @__PURE__ */ new Map();
  const groupId = "internal:boundary";
  nodes.push({
    id: groupId,
    type: "group",
    label: owner.name,
    x: 0,
    y: 0,
    width: contentW,
    height: contentH
  });
  const ownerLink = ownerPath.replace(/\.md$/i, "");
  parts.forEach((r, i) => {
    const col = i % COLS, row = Math.floor(i / COLS);
    const x = PAD_X + col * (PART_W + COL_GAP);
    const y = PAD_Y + row * (PART_H + ROW_GAP);
    const id = nodeId(r);
    const def = r.definition?.text ?? "";
    const text = [
      "**[[" + ownerLink + "#^" + r.localId + "|" + escapeMd(r.identifier) + "]]**",
      def ? "Definition: " + def : "",
      r.multiplicity ? "Multiplicity: " + r.multiplicity : "",
      r.usage !== "standard" ? "Usage: " + r.usage : ""
    ].filter(Boolean).join("\n");
    nodes.push({ id, type: "text", text, x, y, width: PART_W, height: PART_H });
    pos.set(r.localId, { x, y, width: PART_W, height: PART_H });
  });
  const exposureSide = /* @__PURE__ */ new Map();
  boundary.forEach((r, i) => {
    const side = i % 2 === 0 ? "left" : "right";
    for (const link of r.exposes) {
      const t = linkedLocal(local, resolve, ownerPath, link);
      if (t?.record.kind === "endpoint") exposureSide.set(t.record.localId, side);
    }
  });
  const partEndpointCount = /* @__PURE__ */ new Map();
  for (const r of internal) {
    const parent = linkedLocal(local, resolve, ownerPath, r.part ?? r.parent);
    const parentPos = parent ? pos.get(parent.record.localId) : void 0;
    let side = exposureSide.get(r.localId);
    if (!side) {
      const key2 = parent?.record.localId ?? "orphan";
      const n = partEndpointCount.get(key2) ?? 0;
      partEndpointCount.set(key2, n + 1);
      side = n % 2 === 0 ? "left" : "right";
    }
    const id = nodeId(r);
    let x = PAD_X + (side === "left" ? 0 : contentW - PAD_X - END_W), y = PAD_Y;
    if (parentPos) {
      x = side === "left" ? parentPos.x - END_W - 40 : parentPos.x + parentPos.width + 40;
      const n = partEndpointCount.get(parent?.record.localId ?? "") ?? 1;
      y = parentPos.y + Math.min(parentPos.height - END_H, Math.max(0, (n - 1) * 58));
    }
    nodes.push({ id, type: "text", text: endpointText(ownerLink, r), x, y, width: END_W, height: END_H });
    pos.set(r.localId, { x, y, width: END_W, height: END_H });
  }
  const left = boundary.filter((_, i) => i % 2 === 0);
  const right = boundary.filter((_, i) => i % 2 === 1);
  placeBoundary(left, "left", contentW, contentH, nodes, pos, ownerLink);
  placeBoundary(right, "right", contentW, contentH, nodes, pos, ownerLink);
  for (const r of boundary) {
    const from = nodeId(r);
    for (const link of r.exposes) {
      const t = linkedLocal(local, resolve, ownerPath, link);
      if (!t || t.record.kind !== "endpoint") continue;
      const to = nodeId(t.record);
      if (!pos.has(r.localId) || !pos.has(t.record.localId)) continue;
      edges.push(edge(
        "expose:" + r.localId + ":" + t.record.localId,
        from,
        to,
        sideToward(pos.get(r.localId), pos.get(t.record.localId)),
        sideToward(pos.get(t.record.localId), pos.get(r.localId)),
        "exposes",
        "none"
      ));
    }
  }
  const flowsByConnection = /* @__PURE__ */ new Map();
  for (const f of flows) {
    if (!f.connectionId) continue;
    const list = flowsByConnection.get(f.connectionId) ?? [];
    list.push(f);
    flowsByConnection.set(f.connectionId, list);
  }
  for (const r of connections) {
    const a = linkedLocal(local, resolve, ownerPath, r.endpointA);
    const b = linkedLocal(local, resolve, ownerPath, r.endpointB);
    if (!a || !b || a.record.kind !== "endpoint" || b.record.kind !== "endpoint") continue;
    const pa = pos.get(a.record.localId), pb = pos.get(b.record.localId);
    if (!pa || !pb) continue;
    const flowNames = (flowsByConnection.get(r.localId) ?? []).map((f) => f.identifier || f.definition?.alias || f.definition?.target || "flow");
    const label = [r.identifier, ...flowNames].filter(Boolean).join(" \xB7 ");
    edges.push(edge(
      "connection:" + r.localId,
      nodeId(a.record),
      nodeId(b.record),
      sideToward(pa, pb),
      sideToward(pb, pa),
      label || "connection",
      "none"
    ));
  }
  return {
    ownerPath,
    canvas: { nodes, edges },
    signature: internalSignature(local, ownerPath),
    records: records.length,
    parts: parts.length,
    endpoints: endpoints.length,
    connections: connections.length
  };
}
function placeBoundary(records, side, contentW, contentH, nodes, pos, ownerLink) {
  const gap = contentH / (records.length + 1);
  records.forEach((r, i) => {
    const x = side === "left" ? -END_W / 2 : contentW - END_W / 2;
    const y = Math.round(gap * (i + 1) - END_H / 2);
    nodes.push({ id: nodeId(r), type: "text", text: endpointText(ownerLink, r), x, y, width: END_W, height: END_H });
    pos.set(r.localId, { x, y, width: END_W, height: END_H });
  });
}
function endpointText(ownerLink, r) {
  return "**[[" + ownerLink + "#^" + r.localId + "|" + escapeMd(r.identifier) + "]]**";
}
function nodeId(r) {
  return "local:" + r.localId;
}
function edge(id, fromNode, toNode, fromSide, toSide, label, toEnd = "arrow") {
  return { id, fromNode, toNode, fromSide, toSide, label, toEnd };
}
function sideToward(a, b) {
  const ax = a.x + a.width / 2, ay = a.y + a.height / 2, bx = b.x + b.width / 2, by = b.y + b.height / 2;
  const dx = bx - ax, dy = by - ay;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "bottom" : "top";
}
function linkedLocal(local, resolve, fromPath, link) {
  if (!link?.blockId) return null;
  const path = link.target ? resolve(link.target, fromPath) : fromPath;
  if (!path) return null;
  const record = local.recordsOf(path).find((r) => r.localId === link.blockId);
  return record ? { path, record } : null;
}
function byName(a, b) {
  return a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId);
}
function escapeMd(value) {
  return value.replace(/[\[\]|]/g, " ");
}

// src/core/views.ts
var UNDEFINED = "undefined:";
var undefinedId = (link) => `${UNDEFINED}${link}`;
var isUndefinedId = (id) => id.startsWith(UNDEFINED);
var undefinedName = (id) => id.slice(UNDEFINED.length);
var STRUCTURE_PROFILE = {
  name: "Structure",
  description: "Definition/navigation hierarchy plus contextual part occurrences. Interface topology belongs in Internal or Interfaces.",
  steps: [
    { field: "hasPart", direction: "out" },
    { field: "hasChild", direction: "out" },
    { field: "hasState", direction: "out" },
    { field: "includes", direction: "out" }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true
};
var INTERNAL_PROFILE = {
  name: "Internal",
  description: "Inside this assembly: contextual part occurrences, boundary interfaces, exposure and local connections.",
  startTypes: ["Object"],
  steps: [],
  depth: 0,
  nodeCap: 200,
  needsLocalOccurrences: true
};
var FUNCTIONAL_PROFILE = {
  name: "Functional",
  description: "Functions of an Object, or a Function with its performer, parent, sub-functions and order.",
  startTypes: ["Object", "Function"],
  steps: [
    { field: "performs", direction: "out", from: ["Object"], to: ["Function"], atStartOnly: true, undefinedOk: true },
    { field: "performs", direction: "in", from: ["Function"], to: ["Object"] },
    { field: "hasChild", direction: "in", from: ["Function"], to: ["Function"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Function"], to: ["Function"] },
    { field: "precedes", direction: "in", from: ["Function"], to: ["Function"], undefinedOk: false },
    { field: "precedes", direction: "out", from: ["Function"], to: ["Function"], undefinedOk: true }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var REQ_HOLDERS = ["Object", "Function", "Design", "State", "Use Case", "Verification"];
var REQUIREMENTS_PROFILE = {
  name: "Requirements",
  description: "A requirement with its parents, children, derivation, satisfiers and verifiers; or an element with its requirements.",
  startTypes: ["Requirement", ...REQ_HOLDERS],
  steps: [
    { field: "hasChild", direction: "in", from: ["Requirement"], to: ["Requirement", "Object", "Function", "Design"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Requirement"], to: ["Requirement"] },
    { field: "hasChild", direction: "out", from: ["Object", "Function", "Design"], to: ["Requirement"], atStartOnly: true },
    { field: "derivedFrom", direction: "out", from: ["Requirement"], to: ["Requirement"], undefinedOk: true },
    { field: "derivedFrom", direction: "in", from: ["Requirement"], to: ["Requirement"] },
    { field: "refines", direction: "out", from: ["Requirement"], to: ["Requirement"], undefinedOk: true },
    { field: "refines", direction: "in", from: ["Requirement"], to: ["Requirement"] },
    { field: "references", direction: "out", from: ["Requirement"], to: ["Requirement", "Document"] },
    { field: "satisfies", direction: "in", from: ["Requirement"], to: ["Function", "Design"] },
    { field: "satisfies", direction: "out", from: ["Function", "Design"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "verifies", direction: "in", from: ["Requirement"], to: ["Verification"] },
    { field: "verifies", direction: "out", from: ["Verification"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "appliesTo", direction: "out", from: ["Requirement"] },
    { field: "appliesTo", direction: "in", from: REQ_HOLDERS, to: ["Requirement"], atStartOnly: true },
    { field: "drives", direction: "in", from: ["Requirement"], to: ["Use Case"] },
    { field: "drives", direction: "out", from: ["Use Case"], to: ["Requirement"], atStartOnly: true, undefinedOk: true }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true
};
var WHERE_USED_PROFILE = {
  name: "Where Used",
  description: "What contains or uses this: parent assemblies, owners, performers, designs, use cases, dependants.",
  steps: [
    { field: "hasPart", direction: "in" },
    { field: "includes", direction: "in" },
    { field: "hasChild", direction: "in" },
    { field: "hasState", direction: "in" },
    { field: "hasPort", direction: "in" },
    { field: "performs", direction: "in", from: ["Function"], to: ["Object"] },
    { field: "hasDesign", direction: "in", from: ["Design"] },
    { field: "realizedBy", direction: "in", from: ["Function", "Design"], to: ["Use Case"] },
    { field: "participants", direction: "in", from: ["Object", "Actor", "Function", "Port", "Document"], to: ["Use Case"] },
    { field: "dependsOn", direction: "in" }
  ],
  depth: 3,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true
};
var INTERFACES_PROFILE = {
  name: "Interfaces",
  description: "Ports, what each connects to and who owns the other end, exposed ports, item flows.",
  startTypes: ["Object", "Port", "Item Flow"],
  steps: [
    { field: "hasPort", direction: "out", from: ["Object"], to: ["Port"], undefinedOk: true },
    { field: "hasPort", direction: "in", from: ["Port"], to: ["Object"] },
    { field: "interfaces", direction: "out", from: ["Port"], to: ["Port"], noArrow: true, undefinedOk: true },
    { field: "exposes", direction: "out", from: ["Port"], to: ["Port"], undefinedOk: true },
    { field: "exposes", direction: "in", from: ["Port"], to: ["Port"] },
    { field: "transmits", direction: "out", from: ["Port"], to: ["Item Flow"], undefinedOk: true },
    { field: "receives", direction: "out", from: ["Port"], to: ["Item Flow"], undefinedOk: true },
    { field: "exchanges", direction: "out", from: ["Port"], to: ["Item Flow"], undefinedOk: true },
    { field: "hasFlow", direction: "out", from: ["Port"], to: ["Item Flow"], undefinedOk: true },
    { field: "transmits", direction: "in", from: ["Item Flow"], to: ["Port"] },
    { field: "receives", direction: "in", from: ["Item Flow"], to: ["Port"] },
    { field: "exchanges", direction: "in", from: ["Item Flow"], to: ["Port"] },
    { field: "hasFlow", direction: "in", from: ["Item Flow"], to: ["Port"] }
  ],
  depth: 3,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true
};
var VERIFICATION_PROFILE = {
  name: "Verification",
  description: "What verifies a requirement, what else a verification covers, and what satisfies those requirements.",
  startTypes: ["Requirement", "Verification", "Function", "Design", "State"],
  steps: [
    { field: "verifies", direction: "in", from: ["Requirement"], to: ["Verification"] },
    { field: "verifies", direction: "out", from: ["Verification"], to: ["Requirement"], undefinedOk: true },
    { field: "appliesTo", direction: "in", from: ["State"], to: ["Requirement"], atStartOnly: true },
    { field: "satisfies", direction: "out", from: ["Function", "Design"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "satisfies", direction: "in", from: ["Requirement"], to: ["Function", "Design"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var DESIGN_PROFILE = {
  name: "Design",
  description: "The designs of an Object or Document, sub-designs, and the requirements each satisfies.",
  startTypes: ["Object", "Document", "Design"],
  steps: [
    { field: "hasDesign", direction: "out", from: ["Object", "Document"], to: ["Design"], undefinedOk: true },
    { field: "hasDesign", direction: "in", from: ["Design"], to: ["Object", "Document"], atStartOnly: true },
    { field: "hasChild", direction: "in", from: ["Design"], to: ["Design"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Design"], to: ["Design"] },
    { field: "satisfies", direction: "out", from: ["Design"], to: ["Requirement"], undefinedOk: true }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var SCENARIO_PROFILE = {
  name: "Scenario",
  description: "A use case: participants, the functions and designs that realize it, included and optional use cases, the order of its steps.",
  startTypes: ["Use Case"],
  steps: [
    { field: "participants", direction: "out", from: ["Use Case"], to: ["Object", "Actor", "Function", "Port", "Document"], undefinedOk: true },
    { field: "realizedBy", direction: "out", from: ["Use Case"], to: ["Function", "Design"], undefinedOk: true },
    { field: "hasChild", direction: "out", from: ["Use Case"], to: ["Use Case"] },
    { field: "hasChild", direction: "in", from: ["Use Case"], to: ["Use Case"], atStartOnly: true },
    { field: "optionOf", direction: "out", from: ["Use Case"], to: ["Use Case"], undefinedOk: true },
    { field: "optionOf", direction: "in", from: ["Use Case"], to: ["Use Case"] },
    { field: "drives", direction: "out", from: ["Use Case"], to: ["Requirement"] },
    { field: "precedes", direction: "in", from: ["Function"], to: ["Function"] },
    { field: "precedes", direction: "out", from: ["Function"], to: ["Function"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var BEHAVIOR_PROFILE = {
  name: "Behavior",
  description: "State machines and states: who has them, initial and final states, order, nesting, what triggers them.",
  startTypes: ["State Machine", "State", "Object"],
  steps: [
    { field: "hasState", direction: "out", from: ["Object", "State Machine"], to: ["State", "State Machine"], undefinedOk: true },
    { field: "hasState", direction: "in", from: ["State", "State Machine"], to: ["Object", "State Machine"], atStartOnly: true },
    { field: "initialState", direction: "out", from: ["State Machine"], to: ["State"], undefinedOk: true },
    { field: "finalState", direction: "out", from: ["State Machine"], to: ["State"], undefinedOk: true },
    { field: "hasChild", direction: "out", from: ["State"], to: ["State"] },
    { field: "hasChild", direction: "in", from: ["State"], to: ["State"], atStartOnly: true },
    { field: "precedes", direction: "in", from: ["State"], to: ["State"] },
    { field: "precedes", direction: "out", from: ["State"], to: ["State"], undefinedOk: true },
    { field: "triggeredBy", direction: "out", from: ["State"], to: ["Function", "Design", "State", "Item Flow"] },
    { field: "triggeredBy", direction: "in", from: ["State"], to: ["Function", "Design", "State"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var FAILURE_PROFILE = {
  name: "Failure and risk",
  description: "What an issue or failure mode affects, what affects an element, causes, and the requirements around them.",
  steps: [
    { field: "affects", direction: "out", from: ["Issue", "Failure Mode", "Use Case"] },
    { field: "affects", direction: "in", to: ["Issue", "Failure Mode", "Use Case"] },
    { field: "drives", direction: "out", from: ["Issue", "Failure Mode"] },
    { field: "drives", direction: "in", from: ["Issue", "Failure Mode"] },
    { field: "satisfies", direction: "out", from: ["Function", "Design"], to: ["Requirement"], undefinedOk: true },
    { field: "performs", direction: "in", from: ["Function"], to: ["Object"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var EVIDENCE_PROFILE = {
  name: "Evidence",
  description: "The artifacts, documents and info notes that describe this, and what else each one describes.",
  steps: [
    { field: "describes", direction: "in", to: ["Info", "Artifact", "Document"] },
    { field: "describes", direction: "out", from: ["Info", "Artifact", "Document"] },
    { field: "hasChild", direction: "out", to: ["Artifact", "Info", "Document"] },
    { field: "hasChild", direction: "in", from: ["Artifact", "Info", "Document"], atStartOnly: true },
    { field: "references", direction: "out", from: ["Requirement"], to: ["Document"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var PROFILES = {
  [INTERNAL_PROFILE.name]: INTERNAL_PROFILE,
  [STRUCTURE_PROFILE.name]: STRUCTURE_PROFILE,
  [FUNCTIONAL_PROFILE.name]: FUNCTIONAL_PROFILE,
  [REQUIREMENTS_PROFILE.name]: REQUIREMENTS_PROFILE,
  [WHERE_USED_PROFILE.name]: WHERE_USED_PROFILE,
  [INTERFACES_PROFILE.name]: INTERFACES_PROFILE,
  [VERIFICATION_PROFILE.name]: VERIFICATION_PROFILE,
  [DESIGN_PROFILE.name]: DESIGN_PROFILE,
  [SCENARIO_PROFILE.name]: SCENARIO_PROFILE,
  [BEHAVIOR_PROFILE.name]: BEHAVIOR_PROFILE,
  [FAILURE_PROFILE.name]: FAILURE_PROFILE,
  [EVIDENCE_PROFILE.name]: EVIDENCE_PROFILE
};
function stepAllows(step, cur, nbr) {
  if (step.from && !(cur && step.from.includes(cur))) return false;
  if (step.to && !(nbr && step.to.includes(nbr))) return false;
  return true;
}
function traverse(index, starts, profile) {
  const nameOf = (p) => isUndefinedId(p) ? undefinedName(p) : index.notes.get(p)?.name ?? p;
  const perParent = profile.perParent ?? Infinity;
  const depthOf = /* @__PURE__ */ new Map();
  const omitted = /* @__PURE__ */ new Map();
  const tree = [];
  let capReached = false;
  let frontier = [...new Set(starts)].filter((s) => index.notes.has(s));
  for (const s of frontier) depthOf.set(s, 0);
  const typeOf = (p) => index.notes.get(p)?.type;
  const neighbours = (p, dist) => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const step of profile.steps) {
      if (step.atStartOnly && dist > 0) continue;
      if (step.from && !step.from.includes(typeOf(p) ?? "")) continue;
      const edges2 = step.direction === "out" ? index.out(p) : index.in(p);
      const next = edges2.filter((e) => e.field === step.field).map((e) => step.direction === "out" ? e.to : e.from).filter((n) => index.notes.has(n) && !seen.has(n) && stepAllows(step, typeOf(p), typeOf(n))).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      for (const n of next) {
        seen.add(n);
        out.push({ node: n, field: step.field, direction: step.direction });
      }
      if (step.direction === "out" && (!step.to || step.undefinedOk)) {
        const missing = /* @__PURE__ */ new Map();
        for (const b of index.notes.get(p)?.broken ?? []) {
          if (b.field === step.field) missing.set(b.link, (missing.get(b.link) ?? 0) + 1);
        }
        for (const [link, count] of [...missing].sort((a, b) => a[0].localeCompare(b[0]))) {
          const id = undefinedId(link);
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ node: id, field: step.field, direction: "out", count });
        }
      }
    }
    return out;
  };
  const bump = (p, n = 1) => omitted.set(p, (omitted.get(p) ?? 0) + n);
  for (let d = 0; d < profile.depth && frontier.length; d++) {
    const queues = frontier.map((p) => ({ p, q: neighbours(p, d).filter((n) => !depthOf.has(n.node)), shown: 0 }));
    const picked = /* @__PURE__ */ new Map();
    let progress = true;
    while (progress) {
      progress = false;
      for (const s of queues) {
        if (s.shown >= perParent || depthOf.size >= profile.nodeCap) continue;
        while (s.q.length && depthOf.has(s.q[0].node)) s.q.shift();
        const n = s.q.shift();
        if (!n) continue;
        depthOf.set(n.node, d + 1);
        s.shown++;
        progress = true;
        let list = picked.get(s.p);
        if (!list) picked.set(s.p, list = []);
        list.push(n);
      }
    }
    const next = [];
    for (const s of queues) {
      const rest = s.q.filter((n) => !depthOf.has(n.node)).length;
      if (rest) {
        bump(s.p, rest);
        if (depthOf.size >= profile.nodeCap) capReached = true;
      }
      for (const n of picked.get(s.p) ?? []) {
        const owner = n.direction === "out" ? s.p : n.node;
        const target = n.direction === "out" ? n.node : s.p;
        tree.push({ parent: s.p, child: n.node, field: n.field, direction: n.direction, count: n.count ?? index.notes.get(owner)?.repeat?.get(`${n.field}|${target}`) ?? 1 });
        next.push(n.node);
      }
    }
    frontier = next;
  }
  for (const p of frontier) {
    const beyond = neighbours(p, profile.depth).filter((n) => !depthOf.has(n.node)).length;
    if (beyond) bump(p, beyond);
  }
  const treeKey = new Set(tree.flatMap((l) => [`${l.parent}|${l.field}|${l.child}`, `${l.child}|${l.field}|${l.parent}`]));
  const edges = [];
  const cross = [];
  for (const p of depthOf.keys()) {
    for (const e of index.out(p)) {
      if (!depthOf.has(e.to)) continue;
      const fits = profile.steps.some(
        (s) => s.field === e.field && (s.direction === "out" ? stepAllows(s, typeOf(e.from), typeOf(e.to)) : stepAllows(s, typeOf(e.to), typeOf(e.from)))
      );
      if (!fits) continue;
      edges.push(e);
      if (!treeKey.has(`${e.from}|${e.field}|${e.to}`)) cross.push(e);
    }
  }
  return {
    profile: profile.name,
    starts: [...depthOf.keys()].filter((p) => depthOf.get(p) === 0),
    depthOf,
    tree,
    edges,
    cross,
    omitted,
    capReached,
    undefinedCount: [...depthOf.keys()].filter(isUndefinedId).length,
    localNodes: /* @__PURE__ */ new Map(),
    localEdges: []
  };
}
function withLocalStructure(index, local, base3, profile = STRUCTURE_PROFILE) {
  if (profile.name !== STRUCTURE_PROFILE.name) return base3;
  const depthOf = new Map(base3.depthOf);
  const tree = base3.tree.slice();
  const omitted = new Map(base3.omitted);
  const localNodes = new Map(base3.localNodes);
  let capReached = base3.capReached;
  const perParent = profile.perParent ?? Infinity;
  const owners = [...depthOf.entries()].filter(([path, depth]) => depth < profile.depth && index.notes.has(path)).sort((a, b) => a[1] - b[1] || (index.notes.get(a[0])?.name ?? a[0]).localeCompare(index.notes.get(b[0])?.name ?? b[0]));
  for (const [ownerPath, ownerDepth] of owners) {
    const owner = index.notes.get(ownerPath);
    if (!owner?.uid) continue;
    const records = local.recordsOf(ownerPath, "part").filter((r) => !!r.localId).sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    if (!records.length) continue;
    const existingChildren = tree.filter((l) => l.parent === ownerPath).length;
    const roomForParent = Math.max(0, perParent - existingChildren);
    const roomForView = Math.max(0, profile.nodeCap - depthOf.size);
    const show = records.slice(0, Math.min(roomForParent, roomForView));
    for (const record of show) {
      const ref = local.refOf(owner.uid, record);
      if (!ref) continue;
      const id = refKey(ref);
      if (depthOf.has(id)) continue;
      localNodes.set(id, { ref, ownerPath, record });
      depthOf.set(id, ownerDepth + 1);
      tree.push({ parent: ownerPath, child: id, field: "part occurrence", direction: "out", count: 1 });
    }
    const hidden = records.length - show.length;
    if (hidden > 0) {
      omitted.set(ownerPath, (omitted.get(ownerPath) ?? 0) + hidden);
      if (roomForView < records.length) capReached = true;
    }
  }
  return { ...base3, depthOf, tree, omitted, capReached, localNodes };
}
function mutableLocal(base3) {
  return {
    depthOf: new Map(base3.depthOf),
    tree: base3.tree.slice(),
    omitted: new Map(base3.omitted),
    localNodes: new Map(base3.localNodes),
    localEdges: base3.localEdges.slice(),
    capReached: base3.capReached
  };
}
function localKeyFor(index, local, ownerPath, record) {
  const uid = index.notes.get(ownerPath)?.uid;
  const ref = uid ? local.refOf(uid, record) : null;
  return ref ? refKey(ref) : null;
}
function addLocalNode(index, local, m, ownerPath, record, depth, profile) {
  const key2 = localKeyFor(index, local, ownerPath, record);
  if (!key2) return null;
  if (m.depthOf.has(key2)) return key2;
  if (m.depthOf.size >= profile.nodeCap) {
    m.capReached = true;
    return null;
  }
  const uid = index.notes.get(ownerPath)?.uid;
  const ref = uid ? local.refOf(uid, record) : null;
  if (!ref) return null;
  m.localNodes.set(key2, { ref, ownerPath, record });
  m.depthOf.set(key2, depth);
  return key2;
}
function linkedLocal2(index, local, resolve, fromPath, link) {
  if (!link?.blockId) return null;
  const path = link.target ? resolve(link.target, fromPath) : fromPath;
  if (!path) return null;
  const record = local.recordsOf(path).find((r) => r.localId === link.blockId);
  if (!record) return null;
  const key2 = localKeyFor(index, local, path, record);
  return key2 ? { path, record, key: key2 } : null;
}
function withLocalInterfaces(index, local, resolve, base3, profile = INTERFACES_PROFILE) {
  if (profile.name !== INTERFACES_PROFILE.name) return base3;
  const m = mutableLocal(base3);
  const starts = base3.starts.filter((p) => index.notes.has(p));
  for (const ownerPath of starts.filter((p) => index.notes.get(p)?.type === "Object")) {
    const ownerDepth = m.depthOf.get(ownerPath) ?? 0;
    const records = local.recordsOf(ownerPath);
    const endpoints = records.filter((r) => r.kind === "endpoint" && r.localId).sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    const connections = records.filter((r) => r.kind === "connection" && r.localId).sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    const flows = records.filter((r) => r.kind === "flow" && r.localId).sort((a, b) => a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId));
    for (const r of endpoints) {
      const k = addLocalNode(index, local, m, ownerPath, r, ownerDepth + 1, profile);
      if (k) m.tree.push({ parent: ownerPath, child: k, field: "interface occurrence", direction: "out", count: 1 });
    }
    for (const r of connections) {
      const k = addLocalNode(index, local, m, ownerPath, r, ownerDepth + 1, profile);
      if (k) m.tree.push({ parent: ownerPath, child: k, field: "connection", direction: "out", count: 1 });
    }
    for (const r of flows) {
      const k = addLocalNode(index, local, m, ownerPath, r, ownerDepth + 2, profile);
      if (!k) continue;
      const parent = r.connectionId ? records.find((x) => x.kind === "connection" && x.localId === r.connectionId) : void 0;
      const pk = parent ? localKeyFor(index, local, ownerPath, parent) : null;
      m.tree.push({ parent: pk && m.depthOf.has(pk) ? pk : ownerPath, child: k, field: "flow occurrence", direction: "out", count: 1 });
    }
    for (const r of endpoints) {
      const a = localKeyFor(index, local, ownerPath, r);
      if (!a || !m.depthOf.has(a)) continue;
      const groups = [
        ["exposes", r.exposes],
        ["equals", r.equals],
        ["parent", r.parent ? [r.parent] : []]
      ];
      for (const [field, links] of groups) {
        for (const link of links) {
          const t = linkedLocal2(index, local, resolve, ownerPath, link);
          if (!t) continue;
          const alreadyPlaced = m.depthOf.has(t.key);
          addLocalNode(index, local, m, t.path, t.record, ownerDepth + 1, profile);
          if (!m.depthOf.has(t.key)) continue;
          if (alreadyPlaced) m.localEdges.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
          else m.tree.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
        }
      }
    }
    for (const r of connections) {
      const a = localKeyFor(index, local, ownerPath, r);
      if (!a || !m.depthOf.has(a)) continue;
      const ends = [["endpointA", r.endpointA], ["endpointB", r.endpointB]];
      for (const [field, link] of ends) {
        const t = linkedLocal2(index, local, resolve, ownerPath, link);
        if (!t) continue;
        const alreadyPlaced = m.depthOf.has(t.key);
        addLocalNode(index, local, m, t.path, t.record, ownerDepth + 1, profile);
        if (!m.depthOf.has(t.key)) continue;
        if (alreadyPlaced) m.localEdges.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
        else m.tree.push({ parent: a, child: t.key, field, direction: "out", count: 1 });
      }
    }
  }
  for (const definitionPath of starts.filter((p) => ["Port", "Item Flow"].includes(index.notes.get(p)?.type ?? ""))) {
    const d = m.depthOf.get(definitionPath) ?? 0;
    const expected = index.notes.get(definitionPath)?.type === "Port" ? "endpoint" : "flow";
    const occurrences = local.occurrencesOf(definitionPath, resolve).filter(({ record }) => record.kind === expected).sort((a, b) => a.path.localeCompare(b.path) || a.record.identifier.localeCompare(b.record.identifier));
    for (const { path, record } of occurrences) {
      const k = addLocalNode(index, local, m, path, record, d + 1, profile);
      if (k) m.tree.push({ parent: definitionPath, child: k, field: "occurrence", direction: "out", count: 1 });
    }
  }
  return { ...base3, ...m };
}
function withLocalWhereUsed(index, local, resolve, base3, profile = WHERE_USED_PROFILE) {
  if (profile.name !== WHERE_USED_PROFILE.name) return base3;
  const m = mutableLocal(base3);
  for (const definitionPath of base3.starts.filter((p) => index.notes.has(p))) {
    const d = m.depthOf.get(definitionPath) ?? 0;
    const occurrences = local.occurrencesOf(definitionPath, resolve).sort((a, b) => a.path.localeCompare(b.path) || a.record.kind.localeCompare(b.record.kind) || a.record.identifier.localeCompare(b.record.identifier));
    for (const { path, record } of occurrences) {
      const k = addLocalNode(index, local, m, path, record, d + 1, profile);
      if (k) m.tree.push({ parent: definitionPath, child: k, field: "occurrence", direction: "out", count: 1 });
    }
  }
  return { ...base3, ...m };
}
function withLocalRequirements(index, local, base3, profile = REQUIREMENTS_PROFILE) {
  if (profile.name !== REQUIREMENTS_PROFILE.name) return base3;
  const m = mutableLocal(base3);
  for (const requirementPath of base3.starts.filter((p) => index.notes.get(p)?.type === "Requirement")) {
    const d = m.depthOf.get(requirementPath) ?? 0;
    const refs = (index.notes.get(requirementPath)?.localRefs ?? []).filter((r) => r.field === "appliesTo").sort((a, b) => a.path.localeCompare(b.path) || a.localId.localeCompare(b.localId));
    for (const ref of refs) {
      const record = local.recordsOf(ref.path).find((r) => r.localId === ref.localId);
      if (!record) continue;
      const k = addLocalNode(index, local, m, ref.path, record, d + 1, profile);
      if (k) m.tree.push({ parent: requirementPath, child: k, field: "appliesTo", direction: "out", count: 1 });
    }
  }
  return { ...base3, ...m };
}
function withLocalInternal(index, local, resolve, base3, profile = INTERNAL_PROFILE) {
  if (profile.name !== INTERNAL_PROFILE.name) return base3;
  const ownerPath = base3.starts[0];
  if (!ownerPath || index.notes.get(ownerPath)?.type !== "Object") return base3;
  const records = local.recordsOf(ownerPath);
  if (!records.length) return base3;
  const m = mutableLocal(base3);
  for (const record of records) addLocalNode(index, local, m, ownerPath, record, 1, profile);
  const internal = buildInternalView(index, local, ownerPath, resolve);
  return { ...base3, ...m, specialCanvas: internal.canvas };
}
function profileNeedsLocalOccurrences(profile) {
  return profile.needsLocalOccurrences === true;
}
function withLocalOccurrences(index, local, resolve, base3, profile) {
  switch (profile.name) {
    case "Internal":
      return withLocalInternal(index, local, resolve, base3, profile);
    case "Structure":
      return withLocalStructure(index, local, base3, profile);
    case "Interfaces":
      return withLocalInterfaces(index, local, resolve, base3, profile);
    case "Where Used":
      return withLocalWhereUsed(index, local, resolve, base3, profile);
    case "Requirements":
      return withLocalRequirements(index, local, base3, profile);
    default:
      return base3;
  }
}
function signature(view) {
  const nodes = [...view.depthOf.keys()].sort().join("\n");
  const edges = view.edges.map((e) => `${e.from}|${e.field}|${e.to}`).sort().join("\n");
  const dupes = view.tree.filter((l) => l.count > 1).map((l) => `${l.parent}|${l.field}|${l.child}x${l.count}`).sort().join("\n");
  const more = [...view.omitted].map(([p, n]) => `${p}:${n}`).sort().join("\n");
  const local = [...view.localNodes.entries()].map(([id, n]) => {
    const r = n.record;
    return `${id}|${r.identifier}|${r.definition?.text ?? ""}|${r.multiplicity ?? ""}|${r.usage}`;
  }).sort().join("\n");
  const localEdges = view.localEdges.map((e) => `${e.parent}|${e.field}|${e.child}|${e.direction}`).sort().join("\n");
  let h = 2166136261;
  for (const ch of `${view.profile}
${nodes}
${edges}
${more}
${dupes}
${local}
${localEdges}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
function edgeLabel(field, count) {
  const text = count > 1 ? `${field} (duplicate \xD7${count})` : field;
  return text || void 0;
}
var UNDEFINED_COLOR = "1";
var NODE_W = 300;
var NODE_H = 80;
var COL_GAP2 = 160;
var ROW_H = 100;
var MORE_W = 140;
var MAX_CROSS = 40;
var PALETTE = ["4", "5", "6", "2", "3", "#9aa0a6", "#b5835a", "#7f9cf5", "#c9b037", "#5fb3b3", "#a37ed6", "#e0a458"];
function toCanvas(index, view, profile = STRUCTURE_PROFILE) {
  if (profile.name === INTERNAL_PROFILE.name && view.specialCanvas) return view.specialCanvas;
  const nameOf = (p) => view.localNodes.get(p)?.record.identifier ?? (isUndefinedId(p) ? undefinedName(p) : index.notes.get(p)?.name ?? p);
  const colorOf = /* @__PURE__ */ new Map();
  for (const s of profile.steps) if (!colorOf.has(s.field)) colorOf.set(s.field, PALETTE[colorOf.size % PALETTE.length]);
  const localFields = [...view.tree, ...view.localEdges].map((l) => l.field);
  for (const field of localFields) if (!colorOf.has(field)) colorOf.set(field, PALETTE[colorOf.size % PALETTE.length]);
  const plainFields = new Set(profile.steps.filter((s) => s.noArrow).map((s) => s.field));
  const kids = /* @__PURE__ */ new Map();
  for (const l of view.tree) {
    let k = kids.get(l.parent);
    if (!k) kids.set(l.parent, k = []);
    k.push(l);
  }
  const nodes = [];
  const edges = [];
  const idOf = /* @__PURE__ */ new Map();
  let cursor = 0;
  const place = (p, depth) => {
    const x = depth * (NODE_W + COL_GAP2);
    const children = kids.get(p) ?? [];
    const more = view.omitted.get(p) ?? 0;
    const centres = [];
    const mine = [];
    for (const l of children) {
      const c = place(l.child, depth + 1);
      centres.push(c);
      const reverse = l.direction === "in";
      const edge2 = {
        id: `e${edges.length}`,
        fromNode: reverse ? idOf.get(l.child) : "",
        // the other end is filled once the parent has an id
        toNode: reverse ? "" : idOf.get(l.child),
        fromSide: reverse ? "left" : "right",
        toSide: reverse ? "right" : "left",
        label: edgeLabel(l.field, l.count),
        color: colorOf.get(l.field),
        ...plainFields.has(l.field) ? { toEnd: "none" } : {}
      };
      edges.push(edge2);
      mine.push({ edge: edge2, reverse });
    }
    let moreId;
    if (more) {
      moreId = `m${nodes.length}`;
      const y2 = cursor;
      cursor += ROW_H;
      nodes.push({ id: moreId, type: "text", text: `**+${more} more**`, x: x + NODE_W + COL_GAP2, y: y2, width: MORE_W, height: NODE_H });
      centres.push(y2 + NODE_H / 2);
    }
    let centre;
    if (centres.length) centre = (centres[0] + centres[centres.length - 1]) / 2;
    else {
      centre = cursor + NODE_H / 2;
      cursor += ROW_H;
    }
    const id = `n${nodes.length}`;
    idOf.set(p, id);
    const y = Math.round(centre - NODE_H / 2);
    const localNode = view.localNodes.get(p);
    if (localNode) {
      const r = localNode.record;
      const owner = localNode.ownerPath.replace(/\.md$/i, "");
      const selfLink = `[[${owner}#^${r.localId}|${r.identifier}]]`;
      const kind = r.kind === "part" ? "part occurrence" : r.kind === "endpoint" ? "interface occurrence" : r.kind === "flow" ? "flow occurrence" : "connection";
      const context = r.kind === "endpoint" ? r.part?.text ? `Part: ${r.part.text}` : r.parent?.text ? `Parent: ${r.parent.text}` : "Assembly boundary" : "";
      const detail = [
        `**${selfLink}**`,
        `*${kind}*`,
        `Owner: [[${owner}]]`,
        r.definition ? `Definition: ${r.definition.text}` : "",
        context,
        r.multiplicity ? `Multiplicity: ${r.multiplicity}` : "",
        r.usage !== "standard" ? `Usage: ${r.usage}` : ""
      ].filter(Boolean).join("\n");
      nodes.push({ id, type: "text", text: detail, x, y, width: NODE_W, height: NODE_H });
    } else if (isUndefinedId(p)) nodes.push({ id, type: "text", text: `**${undefinedName(p)}**
*undefined*`, x, y, width: NODE_W, height: NODE_H, color: UNDEFINED_COLOR });
    else nodes.push({ id, type: "file", file: p, x, y, width: NODE_W, height: NODE_H, color: depth === 0 ? "4" : void 0 });
    for (const m of mine) {
      if (m.reverse) m.edge.toNode = id;
      else m.edge.fromNode = id;
    }
    if (moreId) edges.push({ id: `e${edges.length}`, fromNode: id, toNode: moreId, fromSide: "right", toSide: "left" });
    return centre;
  };
  const roots = [...view.starts].sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
  for (const r of roots) {
    place(r, 0);
    cursor += ROW_H;
  }
  for (const l of view.localEdges) {
    const a = idOf.get(l.parent);
    const b = idOf.get(l.child);
    if (!a || !b) continue;
    const reverse = l.direction === "in";
    edges.push({
      id: `e${edges.length}`,
      fromNode: reverse ? b : a,
      toNode: reverse ? a : b,
      fromSide: reverse ? "left" : "right",
      toSide: reverse ? "right" : "left",
      label: edgeLabel(l.field, l.count),
      color: colorOf.get(l.field) ?? "#9aa0a6",
      ...plainFields.has(l.field) || l.field === "equals" ? { toEnd: "none" } : {}
    });
  }
  if (view.cross.length <= MAX_CROSS) {
    for (const e of view.cross) {
      const from = idOf.get(e.from);
      const to = idOf.get(e.to);
      if (from && to) edges.push({ id: `e${edges.length}`, fromNode: from, toNode: to, fromSide: "right", toSide: "left" });
    }
  } else {
    nodes.push({
      id: "note-cross",
      type: "text",
      text: `${view.cross.length} other links between these notes are not drawn.`,
      x: 0,
      y: -ROW_H - NODE_H,
      width: NODE_W * 1.5,
      height: NODE_H
    });
  }
  return { nodes, edges };
}

// src/obsidian/indexer.ts
var import_obsidian = require("obsidian");

// src/core/relationship-resolution.ts
function resolveAuthoredRelationshipLinks(authored, fromPath, schema, resolve) {
  const fields = /* @__PURE__ */ new Map();
  let unresolved = 0;
  const broken = [];
  const repeat = /* @__PURE__ */ new Map();
  const localRefs = [];
  for (const item of authored) {
    const field = item.field;
    if (!schema.byField.has(field) && !schema.byInverse.has(field)) continue;
    const path = resolve(item.linkpath, fromPath);
    if (!path) {
      unresolved++;
      broken.push({ field, link: item.link });
      continue;
    }
    const localId = blockId(item.link);
    if (localId) {
      localRefs.push({ field, path, localId });
      continue;
    }
    let list = fields.get(field);
    if (!list) fields.set(field, list = []);
    if (!list.includes(path)) list.push(path);
    else repeat.set(`${field}|${path}`, (repeat.get(`${field}|${path}`) ?? 1) + 1);
  }
  return {
    fields,
    unresolved,
    broken,
    ...repeat.size ? { repeat } : {},
    ...localRefs.length ? { localRefs } : {}
  };
}
function blockId(link) {
  const hash = link.indexOf("#^");
  if (hash < 0) return null;
  const tail = link.slice(hash + 2);
  const id = tail.split("|")[0].split("]]")[0].trim();
  return id || null;
}

// src/core/cooperative.ts
var UI_WORK_SLICE_BUDGET_MS = 12;
var CooperativeBudget = class {
  constructor(budgetMs = UI_WORK_SLICE_BUDGET_MS, now = () => performance.now()) {
    this.budgetMs = budgetMs;
    this.now = now;
    if (!(budgetMs > 0) || !Number.isFinite(budgetMs)) throw new Error("Cooperative budget must be a positive finite number.");
    this.startedAt = this.now();
  }
  shouldYield() {
    return this.now() - this.startedAt >= this.budgetMs;
  }
  reset() {
    this.startedAt = this.now();
  }
  async checkpoint(yieldNow) {
    if (!this.shouldYield()) return false;
    await yieldNow();
    this.reset();
    return true;
  }
};

// src/obsidian/indexer.ts
var CHUNK = 500;
var LOCAL_BLOCK_PREFIX = /^(part|ep|conn|flow)-/;
var BURST_REBUILD = 300;
var QUIET_MS = 3e3;
var LIVE_DEBOUNCE_MS = 250;
var WORK_SLICE_MS = UI_WORK_SLICE_BUDGET_MS;
var yieldToUi = () => new Promise((resolve) => window.setTimeout(resolve, 0));
var Indexer = class {
  constructor(app, schema) {
    this.app = app;
    this.schema = schema;
    /** Parsed governed Local Model regions used by occurrence-aware views (WB-106). */
    this.local = new LocalModelIndex();
    this.stats = null;
    /** Cheap file evidence persisted with the disposable semantic cache. */
    this.fingerprints = /* @__PURE__ */ new Map();
    this.running = null;
    this.dirty = /* @__PURE__ */ new Set();
    /** Startup metadata-cache churn is ignored until Workbench deliberately begins model reconciliation. */
    this.liveChanges = false;
    this.burst = 0;
    this.burstStarted = 0;
    this.timer = null;
    /** Prevents a slower cachedRead from overwriting a newer Local Model edit. */
    this.localRevision = /* @__PURE__ */ new Map();
    /** Body reads started by incremental Local Model updates; consumers can wait for semantic consistency. */
    this.pendingLocalReads = /* @__PURE__ */ new Set();
    /** Monotonic in-session semantic revision used to coalesce disposable cache writes. */
    this.semanticRevision = 0;
    /** Paths whose derived cache buckets no longer match the last committed cache generation. */
    this.cacheDirtyPaths = /* @__PURE__ */ new Set();
    /** Cold-build Local Model hydration is deliberately decoupled from core note-graph readiness. */
    this.hydrationEpoch = 0;
    this.hydrationTask = null;
    this.deferredHydrationPaths = [];
    this.deferredHydrationEpoch = 0;
    /** Background occurrence hydration pauses while foreground activity resumes; explicit consumers promote it. */
    this.hydrationDemanded = false;
    this.backgroundIdle = () => true;
    this.hydrationRemaining = 0;
    this.hydrationStartedAt = null;
    this.lastHydrationMsValue = null;
    this.lastHydrationCandidatesValue = 0;
    /** Read failures are scoped findings; they never make ordinary Markdown unusable. */
    this.localReadErrors = /* @__PURE__ */ new Map();
    /** Rapid live edits are coalesced so one keystroke burst does not trigger repeated Local Model body reads. */
    this.livePending = /* @__PURE__ */ new Set();
    this.liveApplyTimer = null;
    this.liveApplyTask = null;
    /** Path-set changes can alter Obsidian wikilink resolution in otherwise unchanged notes. */
    this.relationshipResolveTimer = null;
    this.relationshipResolveTask = null;
    this.relationshipResolvePending = false;
    this.index = new ModelIndex(schema);
  }
  get building() {
    return this.running !== null;
  }
  get rebuildPending() {
    return this.timer !== null;
  }
  get revision() {
    return this.semanticRevision;
  }
  get localHydrationPending() {
    return this.hydrationRemaining + this.deferredHydrationPaths.length;
  }
  get localHydrationQueued() {
    return this.deferredHydrationPaths.length;
  }
  get localHydrationActive() {
    return this.hydrationRemaining;
  }
  get liveUpdatePending() {
    return this.livePending.size + (this.liveApplyTask ? 1 : 0);
  }
  get lastLocalHydrationMs() {
    return this.lastHydrationMsValue;
  }
  get lastLocalHydrationCandidates() {
    return this.lastHydrationCandidatesValue;
  }
  get localReadErrorCount() {
    return this.localReadErrors.size;
  }
  localReadFindings() {
    return [...this.localReadErrors.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, message]) => ({
      code: "local.read-failed",
      severity: "error",
      message: `Could not read this note's Local Model body: ${message}`,
      path
    }));
  }
  bumpRevision(path) {
    this.semanticRevision++;
    if (path) this.cacheDirtyPaths.add(path);
  }
  get cacheDirtyPathCount() {
    return this.cacheDirtyPaths.size;
  }
  cacheDirtyPathsSnapshot() {
    return [...this.cacheDirtyPaths].sort();
  }
  /** Clear dirty evidence only if no newer semantic revision appeared during persistence. */
  markCacheCommitted(revision) {
    if (this.semanticRevision === revision) this.cacheDirtyPaths.clear();
  }
  enableLiveChanges() {
    this.liveChanges = true;
  }
  setBackgroundIdleCheck(check) {
    this.backgroundIdle = check;
  }
  /**
   * Start deferred occurrence parsing. Background starts may pause again if foreground activity
   * resumes; an explicit occurrence-aware consumer promotes the same task to demanded work.
   */
  beginDeferredLocalHydration(background = false) {
    if (this.hydrationTask) {
      if (!background) this.hydrationDemanded = true;
      return;
    }
    if (!this.deferredHydrationPaths.length) return;
    const paths = this.deferredHydrationPaths;
    const epoch = this.deferredHydrationEpoch;
    this.deferredHydrationPaths = [];
    this.hydrationDemanded = !background;
    const files = paths.map((path) => this.app.vault.getAbstractFileByPath(path)).filter((f) => f instanceof import_obsidian.TFile && f.extension === "md");
    this.startLocalHydration(files, epoch);
  }
  /**
   * Wait for asynchronous semantic work.
   * - demanded=true: an explicit occurrence-aware consumer promotes hydration and finishes it.
   * - demanded=false: background/cache callers may start background hydration but never steal
   *   priority from resumed foreground activity.
   */
  async whenLocalSettled(demanded = true) {
    this.beginDeferredLocalHydration(!demanded);
    while (this.hydrationTask || this.pendingLocalReads.size || this.livePending.size || this.liveApplyTimer !== null || this.liveApplyTask || this.relationshipResolvePending || this.relationshipResolveTimer !== null || this.relationshipResolveTask) {
      const work = [...this.pendingLocalReads];
      if (this.liveApplyTask) work.push(this.liveApplyTask);
      if (this.hydrationTask) work.push(this.hydrationTask);
      if (this.relationshipResolveTask) work.push(this.relationshipResolveTask);
      if (work.length) await Promise.all(work);
      else await new Promise((r) => window.setTimeout(r, 50));
    }
  }
  /** Current Markdown path/mtime/size evidence without parsing note bodies. */
  currentFingerprints() {
    const out = /* @__PURE__ */ new Map();
    for (const file of this.app.vault.getMarkdownFiles()) {
      out.set(file.path, { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size });
    }
    return out;
  }
  setSchema(schema) {
    this.schema = schema;
  }
  /**
   * Install already-validated disposable cache state. This does not read or write model files.
   * Runtime callers must perform cache compatibility checks before calling it.
   */
  installRestored(state, createdAt) {
    if (this.running) throw new Error("Cannot install restored state while indexing is active.");
    this.hydrationEpoch++;
    this.hydrationTask = null;
    this.hydrationDemanded = false;
    this.deferredHydrationPaths = [];
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationRemaining = 0;
    this.hydrationStartedAt = null;
    this.lastHydrationMsValue = 0;
    this.lastHydrationCandidatesValue = 0;
    this.localReadErrors.clear();
    this.index = state.index;
    this.local = state.local;
    this.fingerprints.clear();
    for (const [path, fp] of state.fingerprints) this.fingerprints.set(path, { ...fp });
    this.dirty.clear();
    this.cacheDirtyPaths.clear();
    this.burst = 0;
    this.bumpRevision();
    this.stats = this.makeStats("restored", 0, createdAt);
    return this.stats;
  }
  /**
   * Reparse content-changed files when the Markdown path set is known to be unchanged.
   * Added/deleted/renamed paths are deliberately outside this API because they can change
   * resolution of links authored in otherwise unchanged notes (W-344).
   */
  reconcileStablePaths(paths) {
    return this.reconcilePlan({ unchanged: [], changed: [...paths], added: [], deleted: [] });
  }
  /**
   * Reconcile a warm-cache plan. Content changes/additions are parsed; deletions are removed.
   * When the path set changes, every cached authored relationship link is re-resolved against
   * Obsidian's current metadata cache without rereading unchanged Markdown bodies.
   */
  reconcilePlan(plan) {
    if (!this.running) this.running = this.doReconcilePlan(plan).finally(() => this.running = null);
    return this.running;
  }
  record(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return null;
    const authoredLinks = [];
    for (const fl of cache.frontmatterLinks ?? []) {
      const field = fl.key.split(".")[0];
      if (!this.schema.byField.has(field) && !this.schema.byInverse.has(field)) continue;
      authoredLinks.push({ field, link: fl.link, linkpath: (0, import_obsidian.getLinkpath)(fl.link) });
    }
    const resolved = resolveAuthoredRelationshipLinks(
      authoredLinks,
      file.path,
      this.schema,
      (linkpath, fromPath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)?.path
    );
    const str = (v) => v === void 0 || v === null || v === "" ? void 0 : String(v);
    const abstract = fm.abstract === true ? true : fm.abstract === false ? false : void 0;
    const abstractInvalid = fm.abstract !== void 0 && fm.abstract !== null && fm.abstract !== "" && abstract === void 0;
    return {
      path: file.path,
      name: file.basename,
      type: str(fm.type),
      id: str(fm.id),
      uid: str(fm.uid),
      authoredLinks,
      fields: resolved.fields,
      unresolved: resolved.unresolved,
      broken: resolved.broken,
      repeat: resolved.repeat,
      abstract,
      abstractInvalid: abstractInvalid || void 0,
      localRefs: resolved.localRefs
    };
  }
  /** Metadata-only prefilter: body reads are limited to notes that can actually contain a Local Model region. */
  mayHaveLocalModel(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    if (!cache) return false;
    if (cache.headings?.some((h) => h.level === 2 && h.heading.trim().toLowerCase() === "local model")) return true;
    return Object.keys(cache.blocks ?? {}).some((id) => LOCAL_BLOCK_PREFIX.test(id));
  }
  makeStats(mode, ms, builtAt) {
    let elements = 0;
    for (const r of this.index.notes.values()) if (this.index.isElement(r)) elements++;
    return {
      mode,
      files: this.fingerprints.size,
      notes: this.index.size,
      elements,
      links: this.index.edgeCount(),
      ms,
      builtAt
    };
  }
  /** UI-safe stats pass for startup/reconciliation paths that may contain tens of thousands of notes. */
  async makeStatsCooperative(mode, ms, builtAt) {
    let elements = 0;
    let links = 0;
    const budget = new CooperativeBudget(WORK_SLICE_MS);
    for (const r of this.index.notes.values()) {
      if (this.index.isElement(r)) elements++;
      links += this.index.out(r.path).length;
      await budget.checkpoint(yieldToUi);
    }
    return {
      mode,
      files: this.fingerprints.size,
      notes: this.index.size,
      elements,
      links,
      ms,
      builtAt
    };
  }
  async doReconcilePlan(plan) {
    const t0 = performance.now();
    const changedOrAdded = [.../* @__PURE__ */ new Set([...plan.changed, ...plan.added])].sort();
    const deleted = [...new Set(plan.deleted)].sort();
    for (const path of deleted) {
      this.index.remove(path);
      this.local.remove(path);
      this.localReadErrors.delete(path);
      this.fingerprints.delete(path);
      this.localRevision.set(path, (this.localRevision.get(path) ?? 0) + 1);
      this.bumpRevision(path);
    }
    const reconcileBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (let i = 0; i < changedOrAdded.length; i++) {
      const path = changedOrAdded[i];
      const f = this.app.vault.getAbstractFileByPath(path);
      if (!(f instanceof import_obsidian.TFile) || f.extension !== "md") {
        throw new Error(`Warm reconciliation expected Markdown file ${path}, but it is unavailable.`);
      }
      await this.applyAwaited(path, f);
      await reconcileBudget.checkpoint(yieldToUi);
    }
    if (plan.added.length || plan.deleted.length) await this.reResolveAllRelationships();
    const backlog = [...this.dirty];
    this.dirty.clear();
    if (backlog.length > CHUNK) this.scheduleRebuild();
    else {
      let needsFull = false;
      for (let i = 0; i < backlog.length; i++) {
        const path = backlog[i];
        const f = this.app.vault.getAbstractFileByPath(path);
        if (!(f instanceof import_obsidian.TFile) || f.extension !== "md") {
          needsFull = true;
          break;
        }
        await this.applyAwaited(path, f);
        await reconcileBudget.checkpoint(yieldToUi);
      }
      if (needsFull) this.scheduleRebuild();
    }
    this.stats = await this.makeStatsCooperative("reconciled", Math.round(performance.now() - t0), Date.now());
    return this.stats;
  }
  /**
   * Re-resolve relationship links from cached authored evidence after the note path set changes.
   * This is CPU/metadata work only: unchanged Markdown files and Local Model bodies are not read.
   */
  async reResolveAllRelationships() {
    const notes = [...this.index.notes.values()];
    let changed = 0;
    const resolveBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (let i = 0; i < notes.length; i++) {
      const rec = notes[i];
      if (!rec.authoredLinks) throw new Error(`Cached note ${rec.path} has no authored-link evidence; full rebuild required.`);
      const resolved = resolveAuthoredRelationshipLinks(
        rec.authoredLinks,
        rec.path,
        this.schema,
        (linkpath, fromPath) => this.app.metadataCache.getFirstLinkpathDest(linkpath, fromPath)?.path
      );
      if (!sameResolvedEvidence(rec, resolved)) {
        this.index.upsert({
          ...rec,
          fields: resolved.fields,
          unresolved: resolved.unresolved,
          broken: resolved.broken,
          repeat: resolved.repeat,
          localRefs: resolved.localRefs
        });
        this.cacheDirtyPaths.add(rec.path);
        changed++;
      }
      await resolveBudget.checkpoint(yieldToUi);
    }
    if (changed) this.bumpRevision();
    return changed;
  }
  /**
   * Debounce live add/delete/rename events, then re-resolve authored links from metadata only.
   * This keeps an open vault semantically correct without rereading unchanged Markdown bodies.
   */
  scheduleRelationshipReresolution() {
    if (!this.liveChanges) return;
    this.relationshipResolvePending = true;
    if (this.relationshipResolveTimer !== null) window.clearTimeout(this.relationshipResolveTimer);
    this.relationshipResolveTimer = window.setTimeout(() => {
      this.relationshipResolveTimer = null;
      this.beginRelationshipReresolution();
    }, 1500);
  }
  /** Called by the plugin when Obsidian reports that wikilink resolution has settled. */
  linkResolutionSettled() {
    if (!this.relationshipResolvePending) return;
    if (this.relationshipResolveTimer !== null) {
      window.clearTimeout(this.relationshipResolveTimer);
      this.relationshipResolveTimer = null;
    }
    this.beginRelationshipReresolution();
  }
  beginRelationshipReresolution() {
    if (!this.relationshipResolvePending) return;
    if (this.rebuildPending || this.running || !this.stats) {
      this.scheduleRelationshipReresolution();
      return;
    }
    if (this.relationshipResolveTask) return;
    this.relationshipResolvePending = false;
    let task;
    task = this.reResolveAllRelationships().then(() => void 0).finally(() => {
      if (this.relationshipResolveTask === task) this.relationshipResolveTask = null;
      if (this.relationshipResolvePending) this.scheduleRelationshipReresolution();
    });
    this.relationshipResolveTask = task;
  }
  /** Awaited variant used by controlled startup reconciliation. */
  async applyAwaited(path, file) {
    this.fingerprints.set(path, { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size });
    const rec = this.record(file);
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);
    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    this.local.remove(path);
    if (this.mayHaveLocalModel(file)) {
      try {
        const text = await this.app.vault.cachedRead(file);
        if (this.localRevision.get(path) === revision) {
          this.local.set(path, parseLocalModel(text));
          this.localReadErrors.delete(path);
        }
      } catch (e) {
        if (this.localRevision.get(path) === revision) this.localReadErrors.set(path, e.message);
      }
    } else this.localReadErrors.delete(path);
    this.bumpRevision(path);
  }
  /**
   * Parse only notes prefiltered by Obsidian metadata as Local Model candidates. This runs after
   * the core note graph is already usable. Occurrence-aware consumers call whenLocalSettled().
   */
  startLocalHydration(files, epoch) {
    this.hydrationRemaining = files.length;
    this.lastHydrationCandidatesValue = files.length;
    this.hydrationStartedAt = performance.now();
    if (!files.length) {
      this.hydrationTask = null;
      this.lastHydrationMsValue = 0;
      this.hydrationStartedAt = null;
      return;
    }
    let task;
    task = (async () => {
      let changed = false;
      const hydrationBudget = new CooperativeBudget(WORK_SLICE_MS);
      for (let i = 0; i < files.length; i++) {
        if (epoch !== this.hydrationEpoch) return;
        while (!this.hydrationDemanded && (!this.backgroundIdle() || this.liveUpdatePending > 0)) {
          await new Promise((r) => window.setTimeout(r, 250));
          if (epoch !== this.hydrationEpoch) return;
        }
        const file = files[i];
        const path = file.path;
        const revision = (this.localRevision.get(path) ?? 0) + 1;
        this.localRevision.set(path, revision);
        try {
          const text = await this.app.vault.cachedRead(file);
          if (epoch === this.hydrationEpoch && this.localRevision.get(path) === revision) {
            this.local.set(path, parseLocalModel(text));
            this.localReadErrors.delete(path);
            this.cacheDirtyPaths.add(path);
            changed = true;
          }
        } catch (e) {
          if (epoch === this.hydrationEpoch && this.localRevision.get(path) === revision) {
            this.localReadErrors.set(path, e.message);
            this.cacheDirtyPaths.add(path);
            changed = true;
          }
        } finally {
          if (epoch === this.hydrationEpoch) this.hydrationRemaining = Math.max(0, files.length - i - 1);
        }
        await hydrationBudget.checkpoint(yieldToUi);
      }
      if (changed && epoch === this.hydrationEpoch) this.bumpRevision();
    })().finally(() => {
      if (this.hydrationTask === task) {
        this.hydrationTask = null;
        this.hydrationDemanded = false;
        this.hydrationRemaining = 0;
        if (this.hydrationStartedAt !== null) {
          this.lastHydrationMsValue = Math.round(performance.now() - this.hydrationStartedAt);
          this.hydrationStartedAt = null;
        }
      }
    });
    this.hydrationTask = task;
  }
  /** Builds the index; a second call while building returns the same promise. */
  build() {
    if (!this.running) this.running = this.doBuild().finally(() => this.running = null);
    return this.running;
  }
  async doBuild() {
    const t0 = performance.now();
    this.dirty.clear();
    this.livePending.clear();
    if (this.liveApplyTimer !== null) {
      window.clearTimeout(this.liveApplyTimer);
      this.liveApplyTimer = null;
    }
    this.localReadErrors.clear();
    const epoch = ++this.hydrationEpoch;
    const index = new ModelIndex(this.schema);
    const local = new LocalModelIndex();
    const files = this.app.vault.getMarkdownFiles();
    const localCandidates = [];
    const fingerprints = /* @__PURE__ */ new Map();
    const buildBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      fingerprints.set(file.path, { ctime: file.stat.ctime, mtime: file.stat.mtime, size: file.stat.size });
      const rec = this.record(file);
      if (rec) index.upsert(rec);
      if (this.mayHaveLocalModel(file)) localCandidates.push(file);
      await buildBudget.checkpoint(yieldToUi);
    }
    this.index = index;
    this.local = local;
    this.fingerprints.clear();
    this.cacheDirtyPaths.clear();
    const finalizeBudget = new CooperativeBudget(WORK_SLICE_MS);
    for (const [path, fp] of fingerprints) {
      this.fingerprints.set(path, fp);
      this.cacheDirtyPaths.add(path);
      await finalizeBudget.checkpoint(yieldToUi);
    }
    this.bumpRevision();
    this.deferredHydrationPaths = localCandidates.map((file) => file.path);
    this.deferredHydrationEpoch = epoch;
    this.hydrationRemaining = 0;
    this.lastHydrationCandidatesValue = localCandidates.length;
    this.lastHydrationMsValue = null;
    const backlog = this.dirty.size;
    if (backlog <= CHUNK) {
      for (const path of this.dirty) {
        this.apply(path);
        await finalizeBudget.checkpoint(yieldToUi);
      }
    }
    this.dirty.clear();
    if (backlog > CHUNK) this.scheduleRebuild();
    this.burst = 0;
    this.stats = await this.makeStatsCooperative("full", Math.round(performance.now() - t0), Date.now());
    return this.stats;
  }
  apply(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (f instanceof import_obsidian.TFile && f.extension === "md") this.fingerprints.set(path, { ctime: f.stat.ctime, mtime: f.stat.mtime, size: f.stat.size });
    else this.fingerprints.delete(path);
    const rec = f instanceof import_obsidian.TFile ? this.record(f) : null;
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);
    this.applyLocal(path, f instanceof import_obsidian.TFile ? f : null);
    this.bumpRevision(path);
  }
  /** Update one governed Local Model region without rebuilding the whole vault. */
  applyLocal(path, file) {
    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    this.local.remove(path);
    if (!file || !this.mayHaveLocalModel(file)) {
      this.localReadErrors.delete(path);
      return;
    }
    let task;
    task = this.app.vault.cachedRead(file).then((text) => {
      if (this.localRevision.get(path) !== revision) return;
      this.local.set(path, parseLocalModel(text));
      this.localReadErrors.delete(path);
      this.bumpRevision(path);
    }).catch((e) => {
      if (this.localRevision.get(path) !== revision) return;
      this.localReadErrors.set(path, e.message);
      this.bumpRevision(path);
    }).finally(() => this.pendingLocalReads.delete(task));
    this.pendingLocalReads.add(task);
  }
  /** One file changed or was created. Rapid events are coalesced by path. */
  changed(path) {
    if (!this.liveChanges) return;
    if (!this.stats || this.running) {
      this.dirty.add(path);
      return;
    }
    this.livePending.add(path);
    const now = Date.now();
    if (now - this.burstStarted > 1e4) {
      this.burstStarted = now;
      this.burst = 0;
    }
    this.burst++;
    if (this.burst >= BURST_REBUILD || this.livePending.size >= BURST_REBUILD) {
      this.livePending.clear();
      if (this.liveApplyTimer !== null) {
        window.clearTimeout(this.liveApplyTimer);
        this.liveApplyTimer = null;
      }
      this.scheduleRebuild();
      return;
    }
    this.scheduleLiveApply();
  }
  removed(path) {
    this.changed(path);
  }
  scheduleLiveApply() {
    if (!this.liveChanges || this.rebuildPending) return;
    if (this.liveApplyTimer !== null) window.clearTimeout(this.liveApplyTimer);
    this.liveApplyTimer = window.setTimeout(() => {
      this.liveApplyTimer = null;
      this.beginLiveApply();
    }, LIVE_DEBOUNCE_MS);
  }
  beginLiveApply() {
    if (!this.liveChanges || this.rebuildPending || this.running || this.liveApplyTask || !this.livePending.size) {
      if (this.livePending.size && !this.rebuildPending && !this.liveApplyTask) this.scheduleLiveApply();
      return;
    }
    const paths = [...this.livePending].sort();
    this.livePending.clear();
    let task;
    task = (async () => {
      let pathSetChanged = false;
      const liveBudget = new CooperativeBudget(WORK_SLICE_MS);
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const existed = this.fingerprints.has(path);
        this.apply(path);
        const existsNow = this.fingerprints.has(path);
        if (existed !== existsNow) pathSetChanged = true;
        await liveBudget.checkpoint(yieldToUi);
      }
      if (pathSetChanged) this.scheduleRelationshipReresolution();
    })().finally(() => {
      if (this.liveApplyTask === task) this.liveApplyTask = null;
      if (this.livePending.size) this.scheduleLiveApply();
    });
    this.liveApplyTask = task;
  }
  scheduleRebuild() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.build();
    }, QUIET_MS);
  }
  dispose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    if (this.liveApplyTimer !== null) window.clearTimeout(this.liveApplyTimer);
    this.liveApplyTimer = null;
    this.livePending.clear();
    this.liveApplyTask = null;
    if (this.relationshipResolveTimer !== null) window.clearTimeout(this.relationshipResolveTimer);
    this.relationshipResolveTimer = null;
    this.relationshipResolveTask = null;
    this.relationshipResolvePending = false;
    this.hydrationEpoch++;
    this.hydrationTask = null;
    this.deferredHydrationPaths = [];
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationRemaining = 0;
  }
};
function sameResolvedEvidence(rec, next) {
  if (rec.unresolved !== next.unresolved) return false;
  if (!sameMapOfStrings(rec.fields, next.fields)) return false;
  if (!sameBroken(rec.broken ?? [], next.broken)) return false;
  if (!sameNumberMap(rec.repeat, next.repeat)) return false;
  if (!sameLocalRefs(rec.localRefs ?? [], next.localRefs ?? [])) return false;
  return true;
}
function sameMapOfStrings(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, av] of a) {
    const bv = b.get(k);
    if (!bv || av.length !== bv.length || av.some((v, i) => v !== bv[i])) return false;
  }
  return true;
}
function sameBroken(a, b) {
  return a.length === b.length && a.every((v, i) => v.field === b[i].field && v.link === b[i].link);
}
function sameNumberMap(a, b) {
  if (!a?.size && !b?.size) return true;
  if (!a || !b || a.size !== b.size) return false;
  for (const [k, v] of a) if (b.get(k) !== v) return false;
  return true;
}
function sameLocalRefs(a, b) {
  return a.length === b.length && a.every((v, i) => v.field === b[i].field && v.path === b[i].path && v.localId === b[i].localId);
}

// src/obsidian/probe.ts
var import_obsidian2 = require("obsidian");
function activeCanvas(app) {
  const view = app.workspace.getMostRecentLeaf()?.view;
  return view?.getViewType?.() === "canvas" ? view.canvas ?? null : null;
}
function selectedFiles(canvas) {
  const sel2 = canvas?.selection;
  if (!(sel2 instanceof Set)) return [];
  return [...sel2].map((n) => n?.file).filter((f) => f instanceof import_obsidian2.TFile);
}
function probeReport(app) {
  const c = activeCanvas(app);
  if (!c) return [["Canvas", "Open a canvas and run this again.", true]];
  const has = (v) => v === void 0 ? "missing" : typeof v === "function" ? "function" : "present";
  const rows = [
    ["Obsidian version", app.appVersion ?? window.electron?.version ?? "unknown"],
    ["canvas.selection", sel(c)],
    ["canvas.nodes", has(c.nodes)],
    ["canvas.edges", has(c.edges)],
    ["canvas.addEdge", has(c.addEdge)],
    ["canvas.removeEdge", has(c.removeEdge)],
    ["canvas.requestSave", has(c.requestSave)],
    ["canvas.getData", has(c.getData)],
    ["Selected notes now", String(selectedFiles(c).length)],
    ["Card elements (note details popup)", cardElements(c)]
  ];
  return rows;
}
function cardElements(c) {
  const nodes = c.nodes;
  const list = nodes instanceof Map ? [...nodes.values()] : [];
  if (!list.length) return "no cards to inspect";
  const withEl = list.filter((n) => n?.nodeEl instanceof HTMLElement).length;
  return `${withEl} of ${list.length} cards have an element`;
}
function sel(c) {
  return c.selection instanceof Set ? `Set with ${c.selection.size} item(s)` : "missing";
}
function registerSelectionMenu(app, register, onRelate) {
  const ref = app.workspace.on("canvas:selection-menu", (menu, canvas) => {
    const files = selectedFiles(canvas);
    if (files.length !== 2) return;
    menu.addItem(
      (item) => item.setTitle("Relate selected notes (Workbench)").setIcon("link").onClick(() => onRelate(files[0], files[1]))
    );
  });
  register(ref);
}

// src/obsidian/ui.ts
var import_obsidian3 = require("obsidian");
var ElementPicker = class extends import_obsidian3.FuzzySuggestModal {
  constructor(app, items, placeholder, onPick) {
    super(app);
    this.items = items;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }
  getItems() {
    return this.items;
  }
  getItemText(r) {
    return `${r.name} ${r.type ?? ""} ${r.id ?? ""}`;
  }
  renderSuggestion(m, el) {
    el.createSpan({ text: m.item.name });
    el.createSpan({ cls: "mdse-option-meta", text: [m.item.type, m.item.id].filter(Boolean).join(", ") });
  }
  onChooseItem(r) {
    this.onPick(r);
  }
};
var RelationshipPicker = class extends import_obsidian3.SuggestModal {
  constructor(app, options, first, second, onPick) {
    super(app);
    this.options = options;
    this.first = first;
    this.second = second;
    this.onPick = onPick;
    this.setPlaceholder(`How is ${first.name} related to ${second.name}?`);
    this.emptyStateText = "No relationship is allowed between these two classes.";
  }
  sentence(o) {
    const [owner, target] = o.ownerIsFirst ? [this.first, this.second] : [this.second, this.first];
    return [owner.name, o.def.field, target.name];
  }
  getSuggestions(query) {
    const q = query.toLowerCase();
    return this.options.filter((o) => this.sentence(o).join(" ").toLowerCase().includes(q));
  }
  renderSuggestion(o, el) {
    const [a, f, b] = this.sentence(o);
    el.createSpan({ text: `${a} ` });
    el.createEl("strong", { text: f });
    el.createSpan({ text: ` ${b}` });
    if (o.def.provisional) el.createSpan({ cls: "mdse-option-meta", text: "provisional: comes back in Review" });
  }
  onChooseSuggestion(o) {
    this.onPick(o);
  }
};
var ViewPicker = class extends import_obsidian3.SuggestModal {
  constructor(app, profiles, noteName, onPick) {
    super(app);
    this.profiles = profiles;
    this.onPick = onPick;
    this.setPlaceholder(`View of ${noteName}\u2026`);
    this.emptyStateText = "No view starts from this kind of note.";
  }
  getSuggestions(query) {
    const q = query.toLowerCase();
    return this.profiles.filter((p) => `${p.name} ${p.description ?? ""}`.toLowerCase().includes(q));
  }
  renderSuggestion(p, el) {
    el.createEl("strong", { text: p.name });
    el.createDiv({ cls: "mdse-option-meta", text: p.description ?? "" });
  }
  onChooseSuggestion(p) {
    this.onPick(p);
  }
};
var ReportModal = class extends import_obsidian3.Modal {
  constructor(app, heading, rows, notes = []) {
    super(app);
    this.heading = heading;
    this.rows = rows;
    this.notes = notes;
  }
  onOpen() {
    this.titleEl.setText(this.heading);
    const wrap = this.contentEl.createDiv({ cls: "mdse-diagnostics" });
    const table = wrap.createEl("table");
    for (const [k, v, warn] of this.rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v, cls: warn ? "mdse-warn" : void 0 });
    }
    for (const n of this.notes) wrap.createEl("p", { text: n });
  }
  onClose() {
    this.contentEl.empty();
  }
};
var ConfirmModal = class extends import_obsidian3.Modal {
  constructor(app, text, action, onYes) {
    super(app);
    this.text = text;
    this.action = action;
    this.onYes = onYes;
  }
  onOpen() {
    this.contentEl.createEl("p", { text: this.text });
    const row = this.contentEl.createDiv({ cls: "modal-button-container" });
    row.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const yes = row.createEl("button", { text: this.action, cls: "mod-cta" });
    yes.onclick = () => {
      this.close();
      this.onYes();
    };
  }
  onClose() {
    this.contentEl.empty();
  }
};

// src/obsidian/detail.ts
var import_obsidian4 = require("obsidian");

// src/core/detail.ts
function bodyOf(text, frontmatterEnd) {
  if (typeof frontmatterEnd === "number" && frontmatterEnd > 0 && frontmatterEnd <= text.length) return text.slice(frontmatterEnd).replace(/^\s*\n/, "");
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  return (m ? text.slice(m[0].length) : text).replace(/^\s*\n/, "");
}
function parseTranslate(style) {
  const m = /translate(?:3d)?\(\s*(-?[\d.]+)px\s*,\s*(-?[\d.]+)px/.exec(style ?? "");
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}
function nodeAt(nodes, x, y) {
  return nodes.find((n) => Math.abs(n.x - x) < 1 && Math.abs(n.y - y) < 1);
}
function undefinedName2(text) {
  if (!text || !/\*undefined\*\s*$/.test(text)) return null;
  const m = /^\*\*([\s\S]*?)\*\*/.exec(text);
  return m ? m[1] : null;
}
function linkParts(item) {
  const s = typeof item === "object" ? JSON.stringify(item) : String(item);
  const parts = [];
  const re = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|([^\]]*))?\]\]/g;
  let last = 0;
  let m;
  while (m = re.exec(s)) {
    if (m.index > last) parts.push({ text: s.slice(last, m.index) });
    parts.push({ text: (m[2] ?? m[1]).trim(), link: m[1].trim() });
    last = m.index + m[0].length;
  }
  if (last < s.length) parts.push({ text: s.slice(last) });
  return parts;
}
function rowsFrom(fm, include, collapse, keepEmpty = false) {
  if (!fm) return [];
  const rows = [];
  for (const [key2, value] of Object.entries(fm)) {
    if (key2 === "position" || !include(key2)) continue;
    let items = (Array.isArray(value) ? value : [value]).filter((v) => v !== null && v !== void 0 && v !== "");
    const counts = /* @__PURE__ */ new Map();
    if (collapse) {
      for (const v of items) counts.set(String(v), (counts.get(String(v)) ?? 0) + 1);
      items = [...new Set(items.map(String))];
    }
    const parts = [];
    items.forEach((item, i) => {
      if (i > 0) parts.push({ text: ", " });
      parts.push(...linkParts(item));
      const n = counts.get(String(item)) ?? 1;
      if (n > 1) parts.push({ text: ` (duplicate \xD7${n})` });
    });
    if (parts.length || keepEmpty) rows.push({ key: key2, parts, count: items.length });
  }
  return rows;
}
function propertyRows(fm, skip = /* @__PURE__ */ new Set(), keepEmpty = false) {
  return rowsFrom(fm, (k) => !skip.has(k), false, keepEmpty);
}
function relationshipRows(fm, fields) {
  return rowsFrom(fm, (k) => fields.has(k), true);
}

// src/core/edit.ts
var PROTECTED_PROPERTIES = /* @__PURE__ */ new Set(["type", "id", "uid"]);
var scalar = (v) => v === null || ["string", "number", "boolean"].includes(typeof v);
function propertyEditor(key2, value, ctx) {
  if (PROTECTED_PROPERTIES.has(key2)) return { kind: "readonly", why: "type, id and uid are never edited by hand" };
  if (ctx.relationFields.has(key2)) return { kind: "readonly", why: "relationships are edited under Relationships" };
  if (ctx.translatedOnly.has(key2)) return { kind: "readonly", why: "written by the translator" };
  if (key2 === "subtype") {
    if (!ctx.subtypes || ctx.subtypes.length === 0) return { kind: "readonly", why: "this class has no subtypes" };
    const current = typeof value === "string" && value !== "" && !ctx.subtypes.includes(value) ? [value] : [];
    return { kind: "select", options: ["", ...ctx.subtypes, ...current] };
  }
  if (key2 === "status") return { kind: "status", suggestions: ["Draft", "Active", "Retired"] };
  if (Array.isArray(value)) return value.every(scalar) ? { kind: "list" } : { kind: "readonly", why: "not a simple list" };
  if (scalar(value) || value === void 0) return { kind: "text" };
  return { kind: "readonly", why: "not a simple value" };
}
function parseListInput(input) {
  return [...new Set(input.split(",").map((s) => s.trim()).filter(Boolean))];
}
function coerceValue(original, input) {
  const t = input.trim();
  if (typeof original === "number" && t !== "" && !Number.isNaN(Number(t))) return Number(t);
  if (typeof original === "boolean" && (t === "true" || t === "false")) return t === "true";
  return t;
}
function replaceBody(text, newBody) {
  const fm = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(text);
  const head = fm ? fm[0] : "";
  const rest = text.slice(head.length);
  const lead = /^\s*\n/.exec(rest)?.[0] ?? "";
  return head + lead + newBody.replace(/^\s*\n/, "");
}
function bodyUnchanged(currentText, loadedBody) {
  return bodyOf(currentText) === loadedBody;
}

// src/obsidian/detail.ts
var NoteDetailPanel = class extends import_obsidian4.Component {
  constructor(app, host) {
    super();
    this.app = app;
    this.host = host;
    this.el = null;
    this.renderer = null;
    this.history = [];
    this.current = null;
    this.currentLocal = null;
    this.generation = 0;
    /** Edit mode is explicit and temporary (WB-039, WB-040): off for every note the popup opens. */
    this.editing = false;
    this.bodyArea = null;
    this.bodyLoaded = "";
    this.refreshTimer = null;
    this.escape = (e) => {
      if (e.key === "Escape" && this.el) this.requestClose();
    };
  }
  onload() {
    this.registerEvent(
      this.app.metadataCache.on("changed", (file) => {
        if (!this.el || !this.current || this.currentLocal || file.path !== this.current.path || this.isDirty()) return;
        if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
        this.refreshTimer = window.setTimeout(() => {
          this.refreshTimer = null;
          if (this.current && !this.isDirty()) void this.show(this.current, false);
        }, 150);
      })
    );
  }
  onunload() {
    this.close();
  }
  isDirty() {
    return !!this.bodyArea && this.bodyArea.value !== this.bodyLoaded;
  }
  /** Closes unless there is unsaved text (used when the active tab changes). */
  closeIfClean() {
    if (!this.isDirty()) this.close();
  }
  requestClose() {
    if (this.isDirty()) new ConfirmModal(this.app, "Discard the unsaved text changes?", "Discard", () => this.close()).open();
    else this.close();
  }
  async show(file, remember = true) {
    const switching = !this.current || this.current.path !== file.path;
    if (switching && this.isDirty()) {
      new ConfirmModal(this.app, `Discard the unsaved text changes to ${this.current?.basename ?? "this note"}?`, "Discard", () => {
        this.bodyArea = null;
        void this.show(file, remember);
      }).open();
      return;
    }
    if (switching) {
      this.editing = false;
      if (remember && this.current) this.history.push(this.current.path);
    }
    this.current = file;
    this.currentLocal = null;
    const root = this.ensure();
    const gen = ++this.generation;
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter ?? null;
    const text = await this.app.vault.cachedRead(file);
    if (gen !== this.generation) return;
    this.renderer?.unload();
    this.renderer = new import_obsidian4.Component();
    this.renderer.load();
    this.bodyArea = null;
    root.empty();
    root.toggleClass("mdse-detail-editing", this.editing);
    const blocked = this.host.editBlocked();
    const head = root.createDiv({ cls: "mdse-detail-head" });
    const back = head.createEl("button", { text: "\u2039", cls: "mdse-detail-btn", attr: { "aria-label": "Back" } });
    back.disabled = this.history.length === 0;
    back.onclick = () => {
      const prev = this.history.pop();
      const f = prev ? this.app.vault.getAbstractFileByPath(prev) : null;
      if (f instanceof import_obsidian4.TFile) void this.show(f, false);
    };
    head.createDiv({ cls: "mdse-detail-title", text: file.basename }).setAttr("title", file.path);
    const edit = head.createEl("button", { text: this.editing ? "Done" : "Edit", cls: this.editing ? "mdse-detail-btn mod-cta" : "mdse-detail-btn" });
    if (blocked && !this.editing) {
      edit.disabled = true;
      edit.setAttr("title", blocked);
    }
    edit.onclick = () => {
      if (this.editing && this.isDirty()) {
        new ConfirmModal(this.app, "Discard the unsaved text changes?", "Discard", () => {
          this.editing = false;
          void this.show(file, false);
        }).open();
        return;
      }
      this.editing = !this.editing;
      void this.show(file, false);
    };
    if (this.editing) {
      const undo = head.createEl("button", { text: "Undo", cls: "mdse-detail-btn", attr: { title: "Undo the last Workbench edit" } });
      undo.disabled = !this.host.writer()?.canUndo;
      undo.onclick = () => void this.host.undo();
    }
    const view = head.createEl("button", { text: "View\u2026", cls: "mdse-detail-btn", attr: { title: "Open a view of this note: Structure, Functional, Where Used and more" } });
    view.onclick = () => this.host.pickView(file.path);
    const open = head.createEl("button", { text: "Open note", cls: "mdse-detail-btn" });
    open.onclick = () => void this.app.workspace.getLeaf(true).openFile(file);
    head.createEl("button", { text: "\xD7", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.requestClose();
    const chips = root.createDiv({ cls: "mdse-detail-chips" });
    for (const k of ["type", "subtype", "id", "status"]) {
      const v = fm?.[k];
      if (v !== void 0 && v !== null && String(v) !== "") chips.createSpan({ cls: "mdse-detail-chip", text: k === "type" || k === "subtype" ? String(v) : `${k} ${String(v)}` });
    }
    if (this.editing) chips.createSpan({ cls: "mdse-detail-chip mdse-detail-chip-edit", text: "editing" });
    const schema = this.host.schema();
    const fields = new Set(schema ? [...schema.byField.keys(), ...schema.byInverse.keys()] : []);
    this.propertiesSection(root, file, fm, fields, schema);
    this.relationshipsSection(root, file, relationshipRows(fm, fields), fields);
    const md = bodyOf(text, cache?.frontmatterPosition?.end.offset);
    if (this.editing) this.textEditor(root, file, md);
    else {
      const body = root.createDiv({ cls: "mdse-detail-body markdown-rendered" });
      if (md.trim()) {
        await import_obsidian4.MarkdownRenderer.render(this.app, md, body, file.path, this.renderer);
        if (gen !== this.generation) return;
        body.querySelectorAll("a.internal-link").forEach((a) => {
          a.addEventListener("click", (e) => {
            e.preventDefault();
            e.stopPropagation();
            const target = this.app.metadataCache.getFirstLinkpathDest((a.getAttribute("data-href") ?? "").split("#")[0], file.path);
            if (target) void this.show(target);
          });
        });
      } else body.createEl("p", { cls: "mdse-detail-empty", text: "This note has no text." });
    }
    root.scrollTop = 0;
  }
  /** WB-105/WB-106: read-only details for one contextual Local Model occurrence. */
  showLocal(file, record) {
    if (this.isDirty()) {
      new ConfirmModal(this.app, `Discard the unsaved text changes to ${this.current?.basename ?? "this note"}?`, "Discard", () => {
        this.bodyArea = null;
        this.showLocal(file, record);
      }).open();
      return;
    }
    this.generation++;
    this.current = file;
    this.currentLocal = record;
    this.editing = false;
    this.bodyArea = null;
    this.renderer?.unload();
    this.renderer = null;
    const root = this.ensure();
    root.empty();
    root.removeClass("mdse-detail-editing");
    const head = root.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: record.identifier }).setAttr("title", `${file.path}#^${record.localId}`);
    const owner = head.createEl("button", { text: "Open owner", cls: "mdse-detail-btn" });
    owner.onclick = () => void this.app.workspace.getLeaf(true).openFile(file);
    const occurrence = head.createEl("button", { text: "Open occurrence", cls: "mdse-detail-btn" });
    occurrence.onclick = () => void this.app.workspace.openLinkText(`${file.path.replace(/\.md$/i, "")}#^${record.localId}`, file.path, true);
    head.createEl("button", { text: "\xD7", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.close();
    const chips = root.createDiv({ cls: "mdse-detail-chips" });
    chips.createSpan({ cls: "mdse-detail-chip", text: record.kind });
    if (record.usage !== "standard") chips.createSpan({ cls: "mdse-detail-chip", text: record.usage });
    if (record.endpointKind) chips.createSpan({ cls: "mdse-detail-chip", text: record.endpointKind });
    const table = root.createEl("table", { cls: "mdse-finding" });
    const row = (key2, value, action) => {
      if (!value) return;
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      const td = tr.createEl("td");
      if (action) {
        const a = td.createEl("a", { text: value, href: "#" });
        a.onclick = (e) => {
          e.preventDefault();
          action();
        };
      } else td.setText(value);
    };
    const linkText = (r) => r?.text ?? "";
    const open = (r) => r?.target ? () => void this.app.workspace.openLinkText(r.target, file.path, true) : void 0;
    row("Owner", file.basename, () => void this.app.workspace.getLeaf(true).openFile(file));
    row("Local ID", record.localId);
    row("Definition", linkText(record.definition), open(record.definition));
    row("Usage", record.usage !== "standard" ? record.usage : "");
    row("Multiplicity", record.multiplicity ?? "");
    row("Part", linkText(record.part));
    row("Parent endpoint", linkText(record.parent));
    if (record.exposes.length) row("Exposes", record.exposes.map((r) => r.text).join(", "));
    if (record.equals.length) row("Equals (temporary)", record.equals.map((r) => r.text).join(", "));
    row("Endpoint A", linkText(record.endpointA));
    row("Endpoint B", linkText(record.endpointB));
    row("Connection", record.connectionId ?? "");
    if (record.kind === "flow") {
      row("Endpoint A role", record.roleA ?? "");
      row("Endpoint B role", record.roleB ?? "");
    }
    root.createEl("p", { cls: "mdse-muted", text: "Local Model occurrences are contextual model records stored in the owner note. This popup is read-only." });
    root.scrollTop = 0;
  }
  /** A card for a note that does not exist yet (WB-092). */
  showUndefined(name) {
    this.generation++;
    this.current = null;
    this.currentLocal = null;
    this.history = [];
    this.editing = false;
    this.bodyArea = null;
    this.renderer?.unload();
    this.renderer = null;
    const root = this.ensure();
    root.empty();
    root.removeClass("mdse-detail-editing");
    const head = root.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: name });
    head.createEl("button", { text: "\xD7", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.close();
    root.createDiv({ cls: "mdse-detail-chips" }).createSpan({ cls: "mdse-detail-chip mdse-detail-undefined", text: "undefined" });
    root.createEl("p", { cls: "mdse-detail-empty", text: "No note with this name exists yet. It is linked from the note it hangs off in this view, and still has to be defined." });
  }
  close() {
    this.generation++;
    if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
    this.refreshTimer = null;
    this.renderer?.unload();
    this.renderer = null;
    this.el?.remove();
    this.el = null;
    this.current = null;
    this.currentLocal = null;
    this.history = [];
    this.editing = false;
    this.bodyArea = null;
    document.removeEventListener("keydown", this.escape, true);
  }
  ensure() {
    if (!this.el) {
      this.el = document.body.createDiv({ cls: "mdse-detail" });
      document.addEventListener("keydown", this.escape, true);
    }
    return this.el;
  }
  // ---- Properties ----
  propertiesSection(root, file, fm, fields, schema) {
    const rows = propertyRows(fm, fields, this.editing);
    if (!rows.length) return;
    const details = root.createEl("details", { cls: "mdse-detail-props" });
    details.open = this.editing;
    details.createEl("summary", { text: `Properties (${rows.reduce((n, r) => n + r.count, 0)})` });
    const table = details.createEl("table");
    const type = typeof fm?.type === "string" ? fm.type : "";
    const ctx = {
      relationFields: fields,
      translatedOnly: new Set(schema?.translatedOnlyProperties ?? []),
      subtypes: schema ? schema.classes.find((c) => c.name === type)?.subtypes ?? null : null
    };
    for (const r of rows) {
      const tr = table.createEl("tr");
      tr.createEl("th", { text: r.count > 1 ? `${r.key} (${r.count})` : r.key });
      const td = tr.createEl("td");
      const value = fm?.[r.key];
      const editor = this.editing ? propertyEditor(r.key, value, ctx) : null;
      if (!editor || editor.kind === "readonly") {
        this.parts(td, r, file.path);
        if (editor) td.setAttr("title", editor.kind === "readonly" ? editor.why : "");
        continue;
      }
      const save = async (v) => {
        try {
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          await writer.setProperty(file.path, r.key, v);
          new import_obsidian4.Notice(`Saved ${r.key} on ${file.basename}.`, 3e3);
        } catch (e) {
          new import_obsidian4.Notice(`Not saved: ${e.message}`, 12e3);
          void this.show(file, false);
        }
      };
      if (editor.kind === "select") {
        const sel2 = td.createEl("select", { cls: "dropdown mdse-detail-input" });
        for (const o of editor.options) sel2.createEl("option", { value: o, text: o === "" ? "(none)" : o });
        sel2.value = typeof value === "string" ? value : "";
        sel2.onchange = () => void save(sel2.value);
      } else {
        const text = editor.kind === "list" ? value.map(String).join(", ") : value === null || value === void 0 ? "" : String(value);
        const input = td.createEl("input", { type: "text", cls: "mdse-detail-input", value: text });
        if (editor.kind === "status") {
          const id = `mdse-status-${Math.random().toString(36).slice(2, 8)}`;
          input.setAttr("list", id);
          const dl = td.createEl("datalist", { attr: { id } });
          for (const s of editor.suggestions) dl.createEl("option", { value: s });
        }
        if (editor.kind === "list") input.setAttr("placeholder", "comma separated");
        input.onchange = () => void save(editor.kind === "list" ? parseListInput(input.value) : coerceValue(value, input.value));
        input.onkeydown = (e) => {
          if (e.key === "Enter") input.blur();
          e.stopPropagation();
        };
      }
    }
  }
  // ---- Relationships ----
  relationshipsSection(root, file, rows, fields) {
    if (!rows.length && !this.editing) return;
    const details = root.createEl("details", { cls: "mdse-detail-props" });
    details.open = this.editing;
    details.createEl("summary", { text: `Relationships (${rows.reduce((n, r) => n + r.count, 0)})` });
    if (rows.length) {
      const table = details.createEl("table");
      for (const r of rows) {
        const tr = table.createEl("tr");
        tr.createEl("th", { text: r.count > 1 ? `${r.key} (${r.count})` : r.key });
        const td = tr.createEl("td");
        if (!this.editing) {
          this.parts(td, r, file.path);
          continue;
        }
        for (let i = 0; i < r.parts.length; i++) {
          const p = r.parts[i];
          if (!p.link) {
            td.appendText(p.text);
            continue;
          }
          this.link(td, p.text, p.link, file.path);
          const qty = r.parts[i + 1]?.text.startsWith(" \xD7") ? r.parts[++i] : null;
          if (qty) td.appendText(qty.text);
          const times = qty ? Number(qty.text.slice(2)) : 1;
          const x = td.createEl("button", { text: "\u2715", cls: "mdse-detail-x", attr: { "aria-label": `Remove ${p.text}`, title: "Remove this relationship" } });
          x.onclick = () => this.confirmRemove(file, r.key, p.link, p.text, times, fields);
        }
      }
    }
    if (this.editing) {
      const add = details.createEl("button", { text: "Add relationship\u2026", cls: "mdse-detail-btn mdse-detail-add" });
      add.onclick = () => new ElementPicker(this.app, this.host.elements(file.path), `Relate ${file.basename} to\u2026`, (second) => this.host.relate(file.path, second.path)).open();
    }
  }
  confirmRemove(file, field, linkText, shown, times, _fields) {
    const schema = this.host.schema();
    const target = this.app.metadataCache.getFirstLinkpathDest(linkText, file.path);
    const forward = schema?.byField.get(field);
    const inverseOf = schema?.byInverse.get(field);
    const def = forward ?? inverseOf;
    const back = def ? def.kind === "symmetric" ? def.field : def.inverse : void 0;
    const once = times > 1 ? ` It is listed ${times} times; all are removed.` : "";
    const text = !target ? `Remove ${field} \u2192 ${shown} from ${file.basename}? ${shown} does not exist yet, so there is no inverse.${once}` : `Remove ${field} \u2192 ${shown} from ${file.basename}${back ? `, and its inverse ${forward ? back : def.field} on ${shown}` : ""}?${once}`;
    new ConfirmModal(this.app, text, "Remove", () => {
      void (async () => {
        try {
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          if (!target) await writer.removeMissing(file.path, field, linkText);
          else if (forward) await writer.remove(forward, file.path, target.path);
          else if (inverseOf) await writer.remove(inverseOf, target.path, file.path);
          else throw new Error(`${field} is not a relationship in this vault's schema.`);
          new import_obsidian4.Notice(`Removed ${field} \u2192 ${shown}.`, 4e3);
        } catch (e) {
          new import_obsidian4.Notice(`Not removed: ${e.message}`, 12e3);
        }
      })();
    }).open();
  }
  // ---- Text ----
  textEditor(root, file, md) {
    this.bodyLoaded = md;
    if (md.includes("<!-- MDSE:LOCAL-MODEL START schema=")) {
      root.createDiv({ cls: "mdse-detail-state", text: "Text editing is disabled for this note because it contains a governed Local Model. Region-aware editing is part of WB-106." });
      return;
    }
    const area = root.createEl("textarea", { cls: "mdse-detail-text", attr: { spellcheck: "true", "aria-label": "Note text" } });
    area.value = md;
    area.rows = Math.min(30, Math.max(10, md.split("\n").length + 2));
    this.bodyArea = area;
    const bar = root.createDiv({ cls: "mdse-detail-bar" });
    const save = bar.createEl("button", { text: "Save text", cls: "mdse-detail-btn mod-cta" });
    const cancel = bar.createEl("button", { text: "Revert", cls: "mdse-detail-btn" });
    const state = bar.createSpan({ cls: "mdse-detail-state" });
    const sync = () => {
      const dirty = this.isDirty();
      save.disabled = !dirty;
      cancel.disabled = !dirty;
      state.setText(dirty ? "unsaved" : "");
    };
    sync();
    area.oninput = sync;
    area.onkeydown = (e) => {
      e.stopPropagation();
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !save.disabled) save.click();
      if (e.key === "Escape") area.blur();
    };
    cancel.onclick = () => {
      area.value = this.bodyLoaded;
      sync();
    };
    save.onclick = () => {
      void (async () => {
        try {
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          await writer.setBody(file.path, this.bodyLoaded, area.value);
          this.bodyLoaded = area.value;
          sync();
          new import_obsidian4.Notice(`Saved the text of ${file.basename}.`, 3e3);
          if (this.current) void this.show(this.current, false);
        } catch (e) {
          new import_obsidian4.Notice(`Not saved: ${e.message}`, 12e3);
        }
      })();
    };
  }
  // ---- Shared ----
  parts(td, r, from) {
    for (const p of r.parts) {
      if (p.link) this.link(td, p.text, p.link, from);
      else td.appendText(p.text);
    }
  }
  link(parent, text, linktext, from) {
    const exists = !!this.app.metadataCache.getFirstLinkpathDest(linktext, from);
    if (!exists) {
      parent.createSpan({ text, cls: "mdse-detail-missing", attr: { title: "undefined: no note with this name yet" } });
      return;
    }
    const a = parent.createEl("a", { text, cls: "internal-link", href: "#" });
    a.onclick = (e) => {
      e.preventDefault();
      const target = this.app.metadataCache.getFirstLinkpathDest(linktext, from);
      if (target) void this.show(target);
    };
  }
};

// src/obsidian/review.ts
var import_obsidian5 = require("obsidian");

// src/core/review.ts
var CATEGORIES = [
  { id: "provisional", label: "Provisional Relationships", help: "Links written with the provisional relationship. Replace each with an approved relationship when the real one is known." },
  { id: "missingInverse", label: "Missing Inverses", help: "A link exists on one note but the generated inverse is missing on the other." },
  { id: "orphanInverse", label: "Inverses With No Forward Link", help: "An inverse entry that no forward link backs up. Regenerating inverses would remove it." },
  { id: "offRule", label: "Off-Rule Links", help: "A link whose two note types the endpoint rules do not allow. Imported links stay as findings, not errors." },
  { id: "broken", label: "Broken References", help: "A relationship field points at a note that does not exist." },
  { id: "localModel", label: "Local Model Findings", help: "Problems in contextual part, endpoint, connection and flow records. These are read-only findings in WB-106." }
];
var key = (c, from, field, target) => `${c}|${from}|${field}|${target}`;
function toFindings(f, local = []) {
  const out = [];
  for (const e of f.provisional) out.push({ key: key("provisional", e.from, e.field, e.to), category: "provisional", from: e.from, to: e.to, field: e.field });
  for (const e of f.missingInverse) out.push({ key: key("missingInverse", e.from, e.field, e.to), category: "missingInverse", from: e.from, to: e.to, field: e.field });
  for (const e of f.orphanInverse) out.push({ key: key("orphanInverse", e.from, e.field, e.to), category: "orphanInverse", from: e.from, to: e.to, field: e.field });
  for (const e of f.offRule) out.push({ key: key("offRule", e.from, e.field, e.to), category: "offRule", from: e.from, to: e.to, field: e.field, reason: e.reason });
  for (const b of f.broken) out.push({ key: key("broken", b.from, b.field, b.link), category: "broken", from: b.from, field: b.field, link: b.link });
  for (const l of local) {
    const from = l.path ?? "(unknown Local Model owner)";
    const target = l.localId ?? `line:${l.line ?? 0}`;
    out.push({ key: key("localModel", from, l.code, target), category: "localModel", from, field: l.code, link: target, reason: l.message });
  }
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return out.sort((a, b) => order.get(a.category) - order.get(b.category) || a.from.localeCompare(b.from) || a.field.localeCompare(b.field) || (a.to ?? a.link ?? "").localeCompare(b.to ?? b.link ?? ""));
}
function countByCategory(list) {
  const n = { provisional: 0, missingInverse: 0, orphanInverse: 0, offRule: 0, broken: 0, localModel: 0 };
  for (const f of list) n[f.category]++;
  return n;
}
var base = (path) => path.replace(/^.*\//, "").replace(/\.md$/, "");
function filterFindings(list, index, f) {
  const q = (f.text ?? "").trim().toLowerCase();
  return list.filter((x) => {
    if (f.category && x.category !== f.category) return false;
    if (f.field && x.field !== f.field) return false;
    if (f.type && index.notes.get(x.from)?.type !== f.type) return false;
    if (q) {
      const hay = `${base(x.from)} ${x.to ? base(x.to) : ""} ${x.field} ${x.link ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}
function neighbour(list, from, direction, skip) {
  for (let i = from + direction; i >= 0 && i < list.length; i += direction) if (!skip.has(list[i].key)) return i;
  return -1;
}

// src/obsidian/review.ts
var REVIEW_VIEW = "mdse-review";
var ROW_LIMIT = 200;
var base2 = (path) => path.replace(/^.*\//, "").replace(/\.md$/, "");
async function openNote(app, path) {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof import_obsidian5.TFile) await app.workspace.getLeaf(false).openFile(f);
  else new import_obsidian5.Notice(`${path} no longer exists.`);
}
var ReviewView = class extends import_obsidian5.ItemView {
  constructor(leaf, host) {
    super(leaf);
    this.host = host;
    this.all = [];
    /** Findings resolved here since the last recompute; hidden until the index catches up. */
    this.resolved = /* @__PURE__ */ new Set();
    this.category = "provisional";
    this.text = "";
    this.type = "";
    this.field = "";
    this.timer = null;
  }
  getViewType() {
    return REVIEW_VIEW;
  }
  getDisplayText() {
    return "Workbench Review";
  }
  getIcon() {
    return "list-checks";
  }
  async onOpen() {
    this.contentEl.addClass("mdse-review");
    this.registerEvent(this.app.metadataCache.on("changed", () => this.later()));
    this.registerEvent(this.app.vault.on("delete", () => this.later()));
    this.registerEvent(this.app.vault.on("rename", () => this.later()));
    void this.refresh();
  }
  async onClose() {
    if (this.timer !== null) window.clearTimeout(this.timer);
  }
  later() {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.refresh();
    }, 1e3);
  }
  /** Consume the shared assurance snapshot; no view owns its own whole-model validation loop. */
  async refresh(force = false) {
    if (!this.host.ready()) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { text: "Workbench is still indexing. This screen will fill in when it finishes.", cls: "mdse-muted" });
      this.later();
      return;
    }
    const snapshot = await this.host.assurance(force);
    if (snapshot.error) {
      this.contentEl.empty();
      this.contentEl.createEl("h3", { text: "Review" });
      this.contentEl.createEl("p", { text: "Global assurance is temporarily unavailable. The core model and ordinary notes remain usable.", cls: "mdse-warn" });
      this.contentEl.createEl("p", { text: snapshot.error, cls: "mdse-muted" });
      this.contentEl.createEl("button", { text: "Retry assurance" }).onclick = () => void this.refresh(true);
      return;
    }
    this.all = snapshot.all;
    this.resolved.clear();
    this.render();
    if (snapshot.stale) this.later();
  }
  visible() {
    const list = filterFindings(this.all, this.host.index(), { category: this.category, text: this.text, type: this.type || void 0, field: this.field || void 0 });
    return list.filter((f) => !this.resolved.has(f.key));
  }
  render() {
    const el = this.contentEl;
    el.empty();
    const counts = countByCategory(this.all.filter((f) => !this.resolved.has(f.key)));
    const head = el.createDiv({ cls: "mdse-review-head" });
    head.createEl("h3", { text: "Review" });
    head.createEl("button", { text: "Refresh" }).onclick = () => void this.refresh(true);
    const cats = el.createDiv({ cls: "mdse-review-cats" });
    for (const c of CATEGORIES) {
      const b = cats.createEl("button", { cls: c.id === this.category ? "mdse-cat is-active" : "mdse-cat" });
      b.createSpan({ text: c.label });
      b.createSpan({ text: String(counts[c.id]), cls: counts[c.id] ? "mdse-count" : "mdse-count is-zero" });
      b.onclick = () => {
        this.category = c.id;
        this.type = "";
        this.field = "";
        this.render();
      };
    }
    el.createEl("p", { text: CATEGORIES.find((c) => c.id === this.category).help, cls: "mdse-muted" });
    const inCat = this.all.filter((f) => f.category === this.category);
    const types = [...new Set(inCat.map((f) => this.host.index().notes.get(f.from)?.type).filter((t) => !!t))].sort();
    const fields = [...new Set(inCat.map((f) => f.field))].sort();
    const bar = el.createDiv({ cls: "mdse-review-filters" });
    const search = bar.createEl("input", { type: "search", placeholder: "Search notes or relationship" });
    search.value = this.text;
    search.oninput = () => {
      this.text = search.value;
      this.renderList(listEl);
    };
    const pick = (label, values, current, set) => {
      const s = bar.createEl("select");
      s.createEl("option", { value: "", text: label });
      for (const v of values) s.createEl("option", { value: v, text: v });
      s.value = current;
      s.onchange = () => {
        set(s.value);
        this.renderList(listEl);
      };
    };
    pick("Any note type", types, this.type, (v) => this.type = v);
    pick("Any relationship", fields, this.field, (v) => this.field = v);
    const listEl = el.createDiv({ cls: "mdse-review-list" });
    this.renderList(listEl);
  }
  renderList(listEl) {
    listEl.empty();
    const list = this.visible();
    if (!list.length) {
      listEl.createEl("p", { text: this.all.some((f) => f.category === this.category) ? "Nothing matches these filters." : "No findings in this category.", cls: "mdse-muted" });
      return;
    }
    list.slice(0, ROW_LIMIT).forEach((f, i) => {
      const row = listEl.createDiv({ cls: "mdse-row" });
      row.createSpan({ text: base2(f.from), cls: "mdse-from" });
      row.createSpan({ text: f.field, cls: "mdse-field" });
      row.createSpan({ text: f.to ? base2(f.to) : f.link ?? "", cls: "mdse-to" });
      row.onclick = () => this.openFinding(list, i);
    });
    if (list.length > ROW_LIMIT) listEl.createEl("p", { text: `Showing the first ${ROW_LIMIT} of ${list.length}. Narrow the filters to see the rest.`, cls: "mdse-muted" });
  }
  openFinding(list, at) {
    new FindingModal(this.host, list, at, (key2) => this.markResolved(key2)).open();
  }
  markResolved(key2) {
    this.resolved.add(key2);
    this.render();
    this.later();
  }
};
var FindingModal = class extends import_obsidian5.Modal {
  constructor(host, list, start, onResolved) {
    super(host.app);
    this.host = host;
    this.list = list;
    this.onResolved = onResolved;
    /** Findings resolved in this modal; Previous / Next skip them. */
    this.done = /* @__PURE__ */ new Set();
    this.at = start;
  }
  onOpen() {
    this.draw();
  }
  onClose() {
    this.contentEl.empty();
  }
  go(direction) {
    const n = neighbour(this.list, this.at, direction, this.done);
    if (n < 0) {
      new import_obsidian5.Notice(direction === 1 ? "That was the last finding in this list." : "That was the first finding in this list.");
      return;
    }
    this.at = n;
    this.draw();
  }
  draw() {
    const f = this.list[this.at];
    const { contentEl } = this;
    contentEl.empty();
    const cat = CATEGORIES.find((c) => c.id === f.category);
    this.titleEl.setText(cat.label.replace(/s$/, ""));
    contentEl.createEl("p", { text: `${this.at + 1} of ${this.list.length}`, cls: "mdse-muted" });
    const index = this.host.index();
    const from = index.notes.get(f.from);
    const to = f.to ? index.notes.get(f.to) : void 0;
    const t = contentEl.createEl("table", { cls: "mdse-finding" });
    const row = (k, v) => {
      const tr = t.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v });
    };
    row(f.category === "orphanInverse" ? "Note with the inverse" : "Source", `${base2(f.from)}${from?.type ? ` (${from.type})` : ""}`);
    row(f.category === "orphanInverse" ? "Inverse field" : "Relationship", f.field);
    if (f.to) row(f.category === "orphanInverse" ? "Named as owner" : "Target", `${base2(f.to)}${to?.type ? ` (${to.type})` : ""}`);
    if (f.link) row("Unresolved link", f.link);
    if (f.reason) row("Why it is off-rule", f.reason);
    const explain = {
      provisional: "This link was written with the provisional relationship. Replace it with an approved relationship, or leave it if none fits yet.",
      missingInverse: "The forward link is there but the other note does not show it. Writing the inverse fixes that and changes only the other note.",
      orphanInverse: "No forward link backs this entry up. Check the owner note by hand before removing anything.",
      offRule: "Imported links stay as findings. Fix the link by hand, or leave it until the post-import review.",
      broken: "The link points at a note that does not exist. Fix the name in the note, or create the missing note.",
      localModel: "This finding is in a contextual Local Model record. WB-106 Review reports it here but does not rewrite Local Model records."
    };
    contentEl.createEl("p", { text: explain[f.category] });
    let action = null;
    let actionLabel = "";
    if (f.category === "provisional" && from && to && index.isElement(from) && index.isElement(to)) {
      const options = optionsBetween(this.host.schema(), from.type, to.type).filter((o) => !o.def.provisional);
      if (options.length) {
        const box = contentEl.createDiv({ cls: "mdse-options" });
        box.createEl("p", { text: "Valid replacements:", cls: "mdse-muted" });
        let chosen = 0;
        options.forEach((o, i) => {
          const [owner, target] = o.ownerIsFirst ? [from, to] : [to, from];
          const label = box.createEl("label", { cls: "mdse-option" });
          const radio = label.createEl("input", { type: "radio" });
          radio.name = "mdse-replacement";
          radio.checked = i === 0;
          radio.onchange = () => chosen = i;
          label.createSpan({ text: `${base2(owner.path)} ` });
          label.createEl("strong", { text: o.def.field });
          label.createSpan({ text: ` ${base2(target.path)}` });
        });
        actionLabel = "Replace relationship";
        action = async () => {
          const o = options[chosen];
          const writer = this.host.writer();
          const [owner, target] = o.ownerIsFirst ? [from, to] : [to, from];
          await writer.add(o.def, owner.path, target.path);
          const oldDef = this.host.schema().byField.get(f.field);
          if (oldDef) await writer.remove(oldDef, f.from, f.to);
          new import_obsidian5.Notice(`Replaced ${f.field} with ${o.def.field}. Undo last relationship change reverses the removal first.`, 1e4);
        };
      } else {
        contentEl.createEl("p", { text: "No approved relationship is allowed between these two classes. Leave it provisional.", cls: "mdse-muted" });
      }
    }
    if (f.category === "missingInverse" && from && to && index.isElement(from) && index.isElement(to)) {
      const def = this.host.schema().byField.get(f.field);
      if (def) {
        const problem = this.host.writer().check(def, f.from, f.to);
        if (problem) {
          contentEl.createEl("p", { text: `This link breaks its endpoint rule (${problem}), so its inverse is not written. Fix the link in the note, or leave it for the post-import review.`, cls: "mdse-muted" });
        } else {
          actionLabel = "Write missing inverse";
          action = async () => {
            await this.host.writer().add(def, f.from, f.to);
            new import_obsidian5.Notice(`Wrote the inverse on ${base2(f.to)}.`, 8e3);
          };
        }
      }
    }
    const buttons = contentEl.createDiv({ cls: "mdse-buttons" });
    buttons.createEl("button", { text: "Open source" }).onclick = () => void openNote(this.app, f.from);
    if (f.to) buttons.createEl("button", { text: "Open target" }).onclick = () => void openNote(this.app, f.to);
    const nav = contentEl.createDiv({ cls: "modal-button-container" });
    nav.createEl("button", { text: "Previous" }).onclick = () => this.go(-1);
    nav.createEl("button", { text: "Next" }).onclick = () => this.go(1);
    if (action) {
      const run = action;
      const b = nav.createEl("button", { text: actionLabel, cls: "mod-cta" });
      b.onclick = async () => {
        b.disabled = true;
        try {
          await run();
          this.done.add(f.key);
          this.onResolved(f.key);
          const next = neighbour(this.list, this.at, 1, this.done);
          if (next >= 0) {
            this.at = next;
            this.draw();
          } else this.close();
        } catch (e) {
          b.disabled = false;
          new import_obsidian5.Notice(`Not changed: ${e.message}`, 15e3);
        }
      };
    }
  }
};

// src/obsidian/writer.ts
var import_obsidian6 = require("obsidian");

// src/core/transaction.ts
var TransactionManager = class {
  constructor(validators = [], now = () => (/* @__PURE__ */ new Date()).toISOString()) {
    this.validators = validators;
    this.now = now;
    this.drafts = /* @__PURE__ */ new Map();
    this.undoStack = [];
    this.redoStack = [];
  }
  begin(id, label, scope) {
    if (this.drafts.has(id)) throw new Error(`Transaction ${id} already exists.`);
    const tx = { id, label, scope, status: "draft", operations: [], issues: [], createdAt: this.now() };
    tx.issues = this.validate(tx);
    this.drafts.set(id, tx);
    return this.snapshot(tx);
  }
  add(transactionId, operation) {
    const tx = this.requireDraft(transactionId);
    if (tx.operations.some((x) => x.id === operation.id)) throw new Error(`Operation ${operation.id} already exists in ${transactionId}.`);
    tx.operations.push(operation);
    tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }
  replace(transactionId, operation) {
    const tx = this.requireDraft(transactionId);
    const i = tx.operations.findIndex((x) => x.id === operation.id);
    if (i < 0) throw new Error(`Operation ${operation.id} does not exist in ${transactionId}.`);
    tx.operations[i] = operation;
    tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }
  remove(transactionId, operationId) {
    const tx = this.requireDraft(transactionId);
    tx.operations = tx.operations.filter((x) => x.id !== operationId);
    tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }
  review(transactionId) {
    const tx = this.require(transactionId);
    if (tx.status === "draft") tx.issues = this.validate(tx);
    return this.snapshot(tx);
  }
  canApply(transactionId) {
    const tx = this.requireDraft(transactionId);
    tx.issues = this.validate(tx);
    return !tx.issues.some(isBlocking);
  }
  async apply(transactionId, executor) {
    const tx = this.requireDraft(transactionId);
    tx.issues = this.validate(tx);
    const blocking = tx.issues.filter(isBlocking);
    if (blocking.length) throw new Error(`Transaction ${tx.label} has ${blocking.length} blocking validation issue${blocking.length === 1 ? "" : "s"}.`);
    if (!tx.operations.length) throw new Error(`Transaction ${tx.label} has no operations.`);
    const applied = await executor.apply(this.snapshot(tx));
    tx.status = "applied";
    const changes = tx.operations.flatMap((op) => op.changes);
    const entry = {
      transactionId: tx.id,
      label: tx.label,
      scope: tx.scope,
      appliedAt: this.now(),
      changes,
      reversible: changes.every((x) => x.reversible !== false)
    };
    this.undoStack.push({ entry, applied });
    this.redoStack.length = 0;
    this.drafts.delete(tx.id);
    return entry;
  }
  cancel(transactionId) {
    const tx = this.requireDraft(transactionId);
    tx.status = "cancelled";
    this.drafts.delete(transactionId);
    return this.snapshot(tx);
  }
  get canUndo() {
    return this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1].entry.reversible;
  }
  get canRedo() {
    const last = this.redoStack[this.redoStack.length - 1];
    return !!last && last.entry.reversible && !!last.applied.redo;
  }
  /**
   * Migration seam for mature writers that already performed a governed edit before the WB-114
   * coordinator existed. New planners should prefer begin/add/apply; existing writers register the
   * same guarded undo/redo action here so all Workbench edits share one chronological history.
   */
  recordApplied(transactionId, label, scope, changes, applied) {
    const entry = {
      transactionId,
      label,
      scope,
      appliedAt: this.now(),
      changes: changes.map((x) => ({ ...x, refs: [...x.refs] })),
      reversible: changes.every((x) => x.reversible !== false)
    };
    this.undoStack.push({ entry, applied });
    this.redoStack.length = 0;
    return { ...entry, changes: [...entry.changes] };
  }
  history() {
    return this.undoStack.map((x) => ({ ...x.entry, changes: [...x.entry.changes] }));
  }
  async undo() {
    const state = this.undoStack[this.undoStack.length - 1];
    if (!state) throw new Error("Nothing to undo.");
    if (!state.entry.reversible) throw new Error(`Cannot undo ${state.entry.label}: it was marked non-reversible.`);
    await state.applied.undo();
    this.undoStack.pop();
    this.redoStack.push(state);
    return { ...state.entry, changes: [...state.entry.changes] };
  }
  async redo() {
    const state = this.redoStack[this.redoStack.length - 1];
    if (!state) throw new Error("Nothing to redo.");
    if (!state.entry.reversible || !state.applied.redo) throw new Error(`Cannot redo ${state.entry.label}.`);
    await state.applied.redo();
    this.redoStack.pop();
    this.undoStack.push(state);
    return { ...state.entry, changes: [...state.entry.changes] };
  }
  validate(tx) {
    return this.validators.flatMap((validator) => validator(this.snapshot(tx)));
  }
  require(id) {
    const tx = this.drafts.get(id);
    if (!tx) throw new Error(`Transaction ${id} does not exist.`);
    return tx;
  }
  requireDraft(id) {
    const tx = this.require(id);
    if (tx.status !== "draft") throw new Error(`Transaction ${id} is ${tx.status}, not draft.`);
    return tx;
  }
  snapshot(tx) {
    return {
      ...tx,
      operations: tx.operations.map((op) => ({
        ...op,
        changes: op.changes.map((change) => ({ ...change, refs: [...change.refs] }))
      })),
      issues: tx.issues.map((issue) => ({ ...issue }))
    };
  }
};
function isBlocking(issue) {
  return issue.severity === "error" && issue.blocking !== false;
}

// src/core/frontmatter.ts
function linkTarget(value) {
  if (typeof value !== "string") return void 0;
  const m = /^\s*\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(value);
  return (m ? m[1] : value).trim() || void 0;
}
function asList(v) {
  if (v === void 0 || v === null || v === "") return [];
  return Array.isArray(v) ? [...v] : [v];
}
function sortLinks(list) {
  return list.sort(
    (a, b) => (linkTarget(a) ?? String(a)).localeCompare(linkTarget(b) ?? String(b), void 0, { sensitivity: "base" })
  );
}
function addLink(fm, field, linkText, same) {
  const list = asList(fm[field]);
  const already = same ?? ((v) => linkTarget(v)?.toLowerCase() === linkText.toLowerCase());
  if (list.some(already)) return false;
  list.push(`[[${linkText}]]`);
  fm[field] = sortLinks(list);
  return true;
}
function removeLink(fm, field, linkText, same) {
  const list = asList(fm[field]);
  const match = same ?? ((v) => linkTarget(v)?.toLowerCase() === linkText.toLowerCase());
  const kept = list.filter((v) => !match(v));
  if (kept.length === list.length) return false;
  fm[field] = kept;
  return true;
}
function canonicalOrder(schema) {
  const common = [...schema.commonProperties];
  const tagsAt = common.indexOf("tags");
  common.splice(tagsAt < 0 ? common.length : tagsAt, 0, ...schema.translatedOnlyProperties);
  const rel = [];
  for (const r of schema.relationships) {
    rel.push(r.field);
    if (r.inverse) rel.push(r.inverse);
  }
  return [...common, ...schema.optionalProperties, ...rel];
}
function orderProperties(fm, order) {
  const rank = new Map(order.map((k, i) => [k, i]));
  const keys = Object.keys(fm);
  const known = keys.filter((k) => rank.has(k)).sort((a, b) => rank.get(a) - rank.get(b));
  const rest = keys.filter((k) => !rank.has(k));
  const copy = { ...fm };
  for (const k of keys) delete fm[k];
  for (const k of [...known, ...rest]) fm[k] = copy[k];
}

// src/obsidian/writer.ts
function linkTextFor(app, target, sourcePath) {
  try {
    const md = app.fileManager.generateMarkdownLink(target, sourcePath);
    const m = /^\[\[([^\]|#]+)/.exec(md);
    if (m) return m[1].trim();
  } catch {
  }
  return app.metadataCache.fileToLinktext(target, sourcePath, true);
}
function pointsAt(app, target, sourcePath) {
  return (value) => {
    const text = linkTarget(value);
    if (!text) return false;
    return app.metadataCache.getFirstLinkpathDest((0, import_obsidian6.getLinkpath)(text), sourcePath)?.path === target.path;
  };
}
var RelationshipWriter = class {
  constructor(app, getSchema, getIndex, transactions = new TransactionManager()) {
    this.app = app;
    this.getSchema = getSchema;
    this.getIndex = getIndex;
    this.transactions = transactions;
    this.sequence = 0;
  }
  file(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian6.TFile)) throw new Error(`${path} no longer exists.`);
    return f;
  }
  /** Checks a proposed link. Returns the reason it cannot be made, or null. */
  check(def, ownerPath, targetPath) {
    const schema = this.getSchema();
    if (editingBlocked(schema)) return "The vault's schema is older than this Workbench supports, so editing is off.";
    if (ownerPath === targetPath) return "A note cannot be related to itself.";
    const index = this.getIndex();
    const owner = index.notes.get(ownerPath);
    const target = index.notes.get(targetPath);
    if (!index.isElement(owner) || !index.isElement(target)) return "Both notes must be model notes with a known type.";
    if (def.temporary) return `${def.field} is temporary and is not created by hand.`;
    const r = allows(def, owner.type, target.type);
    return r.ok ? null : r.reason ?? "Not allowed by the endpoint rules.";
  }
  async add(def, ownerPath, targetPath) {
    const problem = this.check(def, ownerPath, targetPath);
    if (problem) throw new Error(problem);
    const owner = this.file(ownerPath);
    const target = this.file(targetPath);
    const order = canonicalOrder(this.getSchema());
    const tx = { label: `${owner.basename} ${def.field} ${target.basename}`, files: [] };
    const edit = async (file, field, linkTo) => {
      const before = await this.app.vault.read(file);
      let changed = false;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        changed = addLink(fm, field, linkTextFor(this.app, linkTo, file.path), pointsAt(this.app, linkTo, file.path));
        if (changed) orderProperties(fm, order);
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };
    await edit(owner, def.field, target);
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);
    if (tx.files.length) this.record(tx, "relationship.add", this.refs(ownerPath, targetPath));
    return tx;
  }
  /** Removes a link and its inverse (WB-051: removal is explicit and confirmed by the caller). */
  async remove(def, ownerPath, targetPath) {
    const owner = this.file(ownerPath);
    const target = this.file(targetPath);
    const tx = { label: `remove ${owner.basename} ${def.field} ${target.basename}`, files: [] };
    const edit = async (file, field, linkTo) => {
      const before = await this.app.vault.read(file);
      let changed = false;
      await this.app.fileManager.processFrontMatter(file, (fm) => {
        changed = removeLink(fm, field, linkTextFor(this.app, linkTo, file.path), pointsAt(this.app, linkTo, file.path));
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };
    await edit(owner, def.field, target);
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);
    if (tx.files.length) this.record(tx, "relationship.remove", this.refs(ownerPath, targetPath));
    return tx;
  }
  /** Removes a link whose note does not exist (an undefined card, WB-092). There is no inverse to remove. */
  async removeMissing(path, field, linkText) {
    const file = this.file(path);
    const tx = { label: `remove ${file.basename} ${field} ${linkText}`, files: [] };
    const before = await this.app.vault.read(file);
    let changed = false;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      changed = removeLink(fm, field, linkText);
    });
    if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    if (tx.files.length) this.record(tx, "relationship.remove-missing", this.refs(path));
    return tx;
  }
  /**
   * Sets one ordinary property (WB-101). Never `type`, `id` or `uid`, never a relationship field (those go
   * through add and remove), and only a property the note already has: properties are not added or dropped
   * (AI_INSTRUCTIONS).
   */
  async setProperty(path, key2, value) {
    const schema = this.getSchema();
    if (editingBlocked(schema)) throw new Error("The vault's schema is older than this Workbench supports, so editing is off.");
    if (PROTECTED_PROPERTIES.has(key2)) throw new Error(`${key2} is never edited by hand.`);
    if (schema.byField.has(key2) || schema.byInverse.has(key2)) throw new Error(`${key2} is a relationship: change it under Relationships.`);
    const file = this.file(path);
    const tx = { label: `set ${key2} on ${file.basename}`, files: [] };
    const before = await this.app.vault.read(file);
    let present = true;
    await this.app.fileManager.processFrontMatter(file, (fm) => {
      if (!(key2 in fm)) {
        present = false;
        return;
      }
      fm[key2] = value;
    });
    if (!present) throw new Error(`${file.basename} has no ${key2} property, and properties are not added by hand.`);
    const after = await this.app.vault.read(file);
    if (after !== before) {
      tx.files.push({ path: file.path, before, after });
      this.record(tx, "property.set", this.refs(path));
    }
    return tx;
  }
  /** Replaces the note text below the properties. Refuses if the text changed since the popup loaded it. */
  async setBody(path, loadedBody, newBody) {
    const schema = this.getSchema();
    if (editingBlocked(schema)) throw new Error("The vault's schema is older than this Workbench supports, so editing is off.");
    const file = this.file(path);
    const tx = { label: `edit text of ${file.basename}`, files: [] };
    const before = await this.app.vault.read(file);
    if (before.includes("<!-- MDSE:LOCAL-MODEL START schema=")) throw new Error("Ordinary text editing is disabled on notes containing a governed Local Model until region-aware editing is implemented.");
    if (!bodyUnchanged(before, loadedBody)) throw new Error(`${file.basename} changed since the popup showed it. Close and reopen the popup, then edit again.`);
    const after = replaceBody(before, newBody);
    if (after !== before) {
      await this.app.vault.modify(file, after);
      tx.files.push({ path: file.path, before, after });
      this.record(tx, "body.edit", this.refs(path));
    }
    return tx;
  }
  get canUndo() {
    return this.transactions.canUndo;
  }
  get canRedo() {
    return this.transactions.canRedo;
  }
  async undo() {
    try {
      const entry = await this.transactions.undo();
      return "Undone: " + entry.label + ".";
    } catch (e) {
      return "Not undone: " + e.message;
    }
  }
  async redo() {
    try {
      const entry = await this.transactions.redo();
      return "Redone: " + entry.label + ".";
    } catch (e) {
      return "Not redone: " + e.message;
    }
  }
  refs(...paths) {
    const out = [];
    for (const path of paths) {
      const uid = this.getIndex().notes.get(path)?.uid;
      if (uid) out.push(noteRef(uid));
    }
    return out;
  }
  record(tx, kind, refs) {
    const id = "legacy-" + Date.now().toString(36) + "-" + (++this.sequence).toString(36);
    const change = { kind, summary: tx.label, refs };
    const applied = {
      undo: async () => {
        for (const s of tx.files) {
          const current = await this.app.vault.read(this.file(s.path));
          if (current !== s.after) throw new Error(s.path + ' changed after "' + tx.label + '".');
        }
        for (const s of tx.files) await this.app.vault.modify(this.file(s.path), s.before);
      },
      redo: async () => {
        for (const s of tx.files) {
          const current = await this.app.vault.read(this.file(s.path));
          if (current !== s.before) throw new Error(s.path + ' changed after undoing "' + tx.label + '".');
        }
        for (const s of tx.files) await this.app.vault.modify(this.file(s.path), s.after);
      }
    };
    this.transactions.recordApplied(id, tx.label, "atomic", [change], applied);
  }
};

// src/obsidian/localmodel.ts
var import_obsidian7 = require("obsidian");
function analyzeLocalModel(index, local, resolve) {
  const t0 = performance.now();
  const findings = validateLocalModels({ index, local, resolve });
  const byKind = {};
  let records = 0;
  for (const region of local.regions.values()) {
    for (const r of region.records) {
      records++;
      byKind[r.kind] = (byKind[r.kind] ?? 0) + 1;
    }
  }
  return { local, findings, notesWithRegion: local.regions.size, records, byKind, ms: Math.round(performance.now() - t0) };
}
async function writeFindingsReport(app, viewsFolder, scan) {
  const folder = (0, import_obsidian7.normalizePath)(viewsFolder);
  if (!await app.vault.adapter.exists(folder)) await app.vault.createFolder(folder);
  const path = `${folder}/Local Model Findings.md`;
  const text = renderFindingsReport(scan.findings, { notesWithRegion: scan.notesWithRegion, records: scan.records, byKind: scan.byKind }, { generated: (/* @__PURE__ */ new Date()).toISOString().slice(0, 10) });
  const existing = app.vault.getAbstractFileByPath(path);
  if (existing instanceof import_obsidian7.TFile) {
    await app.vault.modify(existing, text);
    return existing;
  }
  return app.vault.create(path, text);
}

// src/obsidian/cache.ts
var WORKBENCH_CACHE_ROOT = ".obsidian/plugins/mdse-workbench/cache";
var ObsidianCacheStorage = class {
  constructor(app) {
    this.app = app;
  }
  async mkdir(path) {
    if (!await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.mkdir(path);
  }
  async write(path, content) {
    await this.app.vault.adapter.write(path, content);
  }
  async read(path) {
    return this.app.vault.adapter.read(path);
  }
};
async function clearWorkbenchCache(app) {
  const a = app.vault.adapter;
  if (await a.exists(WORKBENCH_CACHE_ROOT)) await a.rmdir(WORKBENCH_CACHE_ROOT, true);
}

// src/obsidian/assurance.ts
var AssuranceManager = class {
  constructor(source) {
    this.source = source;
    this.cached = null;
    this.running = null;
  }
  peek() {
    const s = this.cached;
    return s && s.revision === this.source.revision() ? s : null;
  }
  async get(force = false) {
    if (!force) {
      const cached = this.peek();
      if (cached) return cached;
      if (this.running) return this.running;
    }
    const task = this.compute();
    this.running = task;
    try {
      return await task;
    } finally {
      if (this.running === task) this.running = null;
    }
  }
  invalidate() {
    this.cached = null;
  }
  async compute() {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      await this.source.settle();
      const revision = this.source.revision();
      const t0 = performance.now();
      try {
        const model = this.source.index().findings();
        const local = this.source.localFindings();
        const all = toFindings(model, local);
        const stale = this.source.revision() !== revision;
        last = {
          revision,
          computedAt: Date.now(),
          ms: Math.round(performance.now() - t0),
          stale,
          error: null,
          model,
          local,
          all,
          counts: countByCategory(all)
        };
        if (!stale) {
          this.cached = last;
          return last;
        }
      } catch (e) {
        const model = emptyFindings();
        const all = [];
        last = {
          revision,
          computedAt: Date.now(),
          ms: Math.round(performance.now() - t0),
          stale: this.source.revision() !== revision,
          error: e.message || String(e),
          model,
          local: [],
          all,
          counts: countByCategory(all)
        };
        if (!last.stale) {
          this.cached = last;
          return last;
        }
      }
    }
    return last;
  }
};
function emptyFindings() {
  return {
    missingInverse: [],
    orphanInverse: [],
    offRule: [],
    provisional: [],
    unresolvedLinks: 0,
    broken: []
  };
}

// src/main.ts
var QUIET_START_MS = 8e3;
var CORE_AFTER_METADATA_DELAY_MS = 1e3;
var LOCAL_BACKGROUND_DELAY_MS = 3e3;
var CACHE_QUIET_MS = 8e3;
var MIN_CACHE_WRITE_INTERVAL_MS = 3e4;
var DEFAULTS = {
  relationshipsPath: "99_System/03_Schemas/relationships.yaml",
  elementTypesPath: "99_System/03_Schemas/element-types.yaml",
  viewsFolder: "Workbench Views",
  canvasProbe: true,
  showDetails: true,
  warmCachePreview: false
};
function localCardTarget(text) {
  const m = /\[\[([^#\]|]+)#\^([^\]|]+)(?:\|[^\]]*)?\]\]/.exec(text ?? "");
  return m ? { target: m[1].trim(), localId: m[2].trim() } : null;
}
var MdseWorkbench = class extends import_obsidian8.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULTS };
    this.views = {};
    this.runtimeHistory = [];
    this.schema = null;
    this.indexer = null;
    this.writer = null;
    this.detail = null;
    this.statusEl = null;
    this.startupHandoffTimer = null;
    this.healthRefreshTimer = null;
    this.localBackgroundTimer = null;
    this.cacheWriteTimer = null;
    this.cacheWriteTask = null;
    this.lastCacheWriteAt = null;
    this.lastCacheWriteMs = null;
    this.lastCacheWriteError = null;
    this.lastCoreError = null;
    this.lastOccurrenceError = null;
    this.lastCachedRevision = null;
    this.lastWarmRestore = null;
    this.assurance = null;
    this.lastStartupWaitMs = null;
    this.lastTimeToCoreReadyMs = null;
    this.lastTimeToOccurrenceReadyMs = null;
    this.startupRunStartedAt = null;
    this.startPromise = null;
    this.pendingRebuild = false;
    /** Last foreground model/UI activity; background subsystems share this preemption signal. */
    this.lastChange = Date.now();
    /** Latched once Obsidian says its metadata/link-resolution pass is complete. */
    this.metadataResolved = false;
    this.unloaded = false;
  }
  async onload() {
    const stored = await this.loadData() ?? {};
    this.settings = { ...DEFAULTS, ...stored.settings ?? {} };
    this.views = stored.views ?? {};
    this.runtimeHistory = Array.isArray(stored.runtimeHistory) ? stored.runtimeHistory.slice(-20) : [];
    this.addSettingTab(new WorkbenchSettings(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.registerDomEvent(this.statusEl, "click", () => this.showRuntimeHealth());
    this.setRuntimeStatus("starting");
    this.detail = new NoteDetailPanel(this.app, {
      schema: () => this.schema,
      writer: () => this.writer,
      editBlocked: () => !this.isReady() ? "Workbench is still indexing; try again in a moment." : this.schema && editingBlocked(this.schema) ? "The vault's schema is older than this Workbench supports, so editing is off." : null,
      elements: (exclude) => this.elements().filter((r) => r.path !== exclude),
      relate: (a, b) => this.relate(a, b),
      undo: () => this.undo(),
      pickView: (path) => this.pickView(path)
    });
    this.addChild(this.detail);
    this.registerDetailClicks();
    this.addCommand({ id: "diagnostics", name: "Show diagnostics", callback: () => void this.diagnostics() });
    this.addCommand({ id: "runtime-health", name: "Show runtime health", callback: () => this.showRuntimeHealth() });
    this.addCommand({ id: "runtime-history", name: "Show runtime history", callback: () => this.showRuntimeHistory() });
    this.addCommand({ id: "inspect-semantic-cache", name: "Inspect semantic cache", callback: () => void this.inspectSemanticCache() });
    this.addCommand({ id: "clear-semantic-cache", name: "Clear semantic cache", callback: () => this.confirmClearSemanticCache() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => this.start(true) });
    this.addCommand({
      id: "explore-structure",
      name: "Explore structure of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path]))
    });
    this.addCommand({
      id: "explore-internal",
      name: "Explore internal structure of current Object",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], INTERNAL_PROFILE))
    });
    this.addCommand({
      id: "explore-functional",
      name: "Explore functional view of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], PROFILES.Functional))
    });
    this.addCommand({
      id: "explore-requirements",
      name: "Explore requirements view of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], PROFILES.Requirements))
    });
    const more = [
      ["explore-where-used", "Explore where-used view of current note", "Where Used"],
      ["explore-interfaces", "Explore interfaces view of current note", "Interfaces"],
      ["explore-verification", "Explore verification view of current note", "Verification"],
      ["explore-design", "Explore design view of current note", "Design"],
      ["explore-scenario", "Explore scenario view of current note", "Scenario"],
      ["explore-behavior", "Explore behavior view of current note", "Behavior"],
      ["explore-failure", "Explore failure and risk view of current note", "Failure and risk"],
      ["explore-evidence", "Explore evidence view of current note", "Evidence"]
    ];
    for (const [id, name, key2] of more) {
      this.addCommand({ id, name, checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path], PROFILES[key2])) });
    }
    this.addCommand({
      id: "explore-pick",
      name: "Explore view of current note\u2026",
      checkCallback: (checking) => this.withActive(checking, (f) => this.pickView(f.path))
    });
    this.addCommand({
      id: "check-view",
      name: "Check whether this view is current",
      callback: () => this.checkView()
    });
    this.addCommand({
      id: "relate",
      name: "Relate current note to another note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.pickTargetThenRelate(f.path))
    });
    this.addCommand({ id: "undo", name: "Undo last Workbench edit", callback: () => this.undo() });
    this.addCommand({
      id: "probe-canvas",
      name: "Check Canvas support (Phase 0 probe)",
      callback: () => new ReportModal(this.app, "Canvas support", probeReport(this.app), [
        "If 'Relate selected notes (Workbench)' appears when you right-click two selected notes on a canvas, the selection menu hook works."
      ]).open()
    });
    if (this.settings.canvasProbe) {
      registerSelectionMenu(this.app, (ref) => this.registerEvent(ref), (a, b) => this.relate(a.path, b.path));
    }
    this.registerView(
      REVIEW_VIEW,
      (leaf) => new ReviewView(leaf, {
        app: this.app,
        ready: () => this.isReady(),
        index: () => this.indexer.index,
        schema: () => this.schema,
        writer: () => this.writer,
        assurance: (force = false) => this.getAssurance(force)
      })
    );
    this.addCommand({ id: "open-review", name: "Open Review", callback: () => void this.openReview() });
    this.addCommand({ id: "local-model-findings", name: "Check Local Model (write findings report)", callback: () => void this.checkLocalModel() });
    this.addRibbonIcon("list-checks", "Workbench Review", () => void this.openReview());
    this.registerEvent(this.app.metadataCache.on("changed", () => this.markForegroundActivity()));
    this.registerEvent(this.app.metadataCache.on("resolved", () => {
      this.metadataResolved = true;
      this.indexer?.linkResolutionSettled();
    }));
    this.register(() => {
      this.unloaded = true;
      if (this.startupHandoffTimer !== null) window.clearTimeout(this.startupHandoffTimer);
      if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
      if (this.healthRefreshTimer !== null) window.clearTimeout(this.healthRefreshTimer);
      if (this.localBackgroundTimer !== null) window.clearTimeout(this.localBackgroundTimer);
    });
    this.app.workspace.onLayoutReady(() => {
      this.startupHandoffTimer = window.setTimeout(() => {
        this.startupHandoffTimer = null;
        if (!this.unloaded) void this.start(false);
      }, 0);
    });
  }
  setRuntimeStatus(state, detail = "") {
    if (!this.statusEl) return;
    const label = state === "starting" ? "MDSE Workbench: starting" : state === "waiting" ? "MDSE Workbench: waiting for vault" : state === "restoring" ? "MDSE Workbench: restoring cache" : state === "reconciling" ? "MDSE Workbench: reconciling" : state === "indexing" ? "MDSE Workbench: indexing" : state === "ready" ? "MDSE Workbench: ready" : "MDSE Workbench: attention";
    this.statusEl.setText(detail ? `${label} \xB7 ${detail}` : label);
    this.statusEl.setAttr("aria-label", "MDSE Workbench runtime status");
  }
  /** Cheap health summary from already-known state. Never runs global assurance. */
  runtimeHealth() {
    const indexer = this.indexer;
    const cachedAssurance = this.assurance?.peek() ?? null;
    return summarizeRuntimeHealth({
      ready: this.isReady(),
      building: !!indexer?.building,
      coreError: this.lastCoreError,
      occurrenceError: this.lastOccurrenceError,
      localPending: indexer?.localHydrationPending ?? 0,
      localQueued: indexer?.localHydrationQueued ?? 0,
      livePending: indexer?.liveUpdatePending ?? 0,
      localReadErrors: indexer?.localReadErrorCount ?? 0,
      schemaWarnings: this.schema?.warnings.length ?? 0,
      cacheWriteError: this.lastCacheWriteError,
      cacheCurrent: !!indexer && indexer.revision === this.lastCachedRevision,
      assurance: cachedAssurance ? {
        current: cachedAssurance.revision === indexer?.revision && !cachedAssurance.stale,
        findings: cachedAssurance.all.length,
        computedAt: cachedAssurance.computedAt,
        error: cachedAssurance.error
      } : null
    });
  }
  refreshRuntimeHealth() {
    if (!this.statusEl || !this.isReady()) return;
    const health = this.runtimeHealth();
    this.statusEl.setText(health.label);
    this.statusEl.setAttr("aria-label", `MDSE Workbench runtime health: ${health.detail}`);
  }
  showRuntimeHealth() {
    const health = this.runtimeHealth();
    new ReportModal(this.app, "MDSE Workbench runtime health", health.rows, [
      health.detail,
      "This view is lightweight: it reports already-known runtime state and does not trigger a whole-model assurance scan.",
      "Engineering findings are not treated as a runtime failure; open Review when you want the current global assurance results."
    ]).open();
  }
  markForegroundActivity() {
    this.lastChange = Date.now();
  }
  /** Single policy gate used by every optional/background Workbench subsystem. */
  backgroundWorkAllowed(indexer = this.indexer) {
    if (!indexer || this.indexer !== indexer) return false;
    return canRunBackgroundWork({
      unloaded: this.unloaded,
      ready: this.isReady(),
      building: indexer.building,
      rebuildPending: indexer.rebuildPending,
      liveUpdatePending: indexer.liveUpdatePending,
      quietForMs: Date.now() - this.lastChange,
      minimumQuietMs: LOCAL_BACKGROUND_DELAY_MS
    });
  }
  scheduleRuntimeHealthRefresh() {
    this.refreshRuntimeHealth();
    if (this.healthRefreshTimer !== null) window.clearTimeout(this.healthRefreshTimer);
    this.healthRefreshTimer = window.setTimeout(() => {
      this.healthRefreshTimer = null;
      this.refreshRuntimeHealth();
      const indexer = this.indexer;
      if (indexer && this.isReady() && indexer.liveUpdatePending + indexer.localHydrationActive > 0) {
        this.scheduleRuntimeHealthRefresh();
      }
    }, 400);
  }
  /**
   * Prefer Obsidian's own metadata/link-resolution completion signal over a fixed startup delay.
   * The quiet timer remains a conservative fallback for versions/environments that do not emit it
   * after Workbench loads.
   */
  async whenVaultQuiet() {
    while (!this.unloaded) {
      if (this.metadataResolved) {
        await new Promise((r) => window.setTimeout(r, CORE_AFTER_METADATA_DELAY_MS));
        return;
      }
      if (Date.now() - this.lastChange >= QUIET_START_MS) return;
      await new Promise((r) => window.setTimeout(r, 250));
    }
  }
  async saveAll() {
    await this.saveData({ settings: this.settings, views: this.views, runtimeHistory: this.runtimeHistory });
  }
  async recordRuntimeSample(indexer, stats) {
    if (this.unloaded || this.indexer !== indexer || indexer.stats?.builtAt !== stats.builtAt) return;
    this.runtimeHistory.push({
      at: Date.now(),
      mode: stats.mode,
      files: stats.files,
      elements: stats.elements,
      coreMs: stats.ms,
      timeToCoreReadyMs: this.lastTimeToCoreReadyMs,
      timeToOccurrenceReadyMs: this.lastTimeToOccurrenceReadyMs,
      startupWaitMs: this.lastStartupWaitMs,
      localHydrationMs: indexer.lastLocalHydrationMs,
      localCandidates: indexer.lastLocalHydrationCandidates,
      warmRestore: this.lastWarmRestore
    });
    this.runtimeHistory = this.runtimeHistory.slice(-20);
    await this.saveAll();
  }
  async markOccurrenceReady(indexer) {
    if (this.unloaded || this.indexer !== indexer || indexer.localHydrationPending > 0 || this.startupRunStartedAt === null) return;
    this.lastTimeToOccurrenceReadyMs = Math.round(performance.now() - this.startupRunStartedAt);
    const latest = this.runtimeHistory[this.runtimeHistory.length - 1];
    if (latest) {
      latest.timeToOccurrenceReadyMs = this.lastTimeToOccurrenceReadyMs;
      latest.localHydrationMs = indexer.lastLocalHydrationMs;
      latest.localCandidates = indexer.lastLocalHydrationCandidates;
      await this.saveAll();
    }
  }
  showRuntimeHistory() {
    const recent = this.runtimeHistory.slice(-10).reverse();
    const rows = recent.length ? recent.map((s) => [
      new Date(s.at).toLocaleString(),
      `${s.mode} \xB7 core ready ${s.timeToCoreReadyMs == null ? "n/a" : (s.timeToCoreReadyMs / 1e3).toFixed(2) + " s"} \xB7 occurrence ready ${s.timeToOccurrenceReadyMs == null ? "pending/n/a" : (s.timeToOccurrenceReadyMs / 1e3).toFixed(2) + " s"} \xB7 core work ${(s.coreMs / 1e3).toFixed(2)} s \xB7 Local work ${s.localHydrationMs === null ? "deferred" : (s.localHydrationMs / 1e3).toFixed(2) + " s"} (${s.localCandidates}) \xB7 wait ${s.startupWaitMs === null ? "n/a" : (s.startupWaitMs / 1e3).toFixed(2) + " s"}`
    ]) : [["Runtime history", "No completed startup samples yet."]];
    new ReportModal(this.app, "MDSE Workbench runtime history", rows, [
      "Local-only performance evidence; this history is stored in the git-ignored Workbench data.json.",
      "Use it to compare cold/full, warm/restored and reconciled startup behavior across candidate builds."
    ]).open();
  }
  /**
   * Stability-first capability staging: the core note graph is usable before occurrence bodies.
   * Local Model hydration starts later in the background, or immediately if an occurrence-aware
   * command/Review explicitly asks for it.
   */
  scheduleBackgroundLocalHydration() {
    if (this.localBackgroundTimer !== null) window.clearTimeout(this.localBackgroundTimer);
    const indexer = this.indexer;
    if (!indexer || !this.isReady() || !indexer.localHydrationPending) return;
    this.localBackgroundTimer = window.setTimeout(() => {
      this.localBackgroundTimer = null;
      if (this.unloaded || this.indexer !== indexer || !this.isReady()) return;
      if (!this.backgroundWorkAllowed(indexer)) {
        this.scheduleBackgroundLocalHydration();
        return;
      }
      indexer.beginDeferredLocalHydration(true);
      this.scheduleRuntimeHealthRefresh();
      void indexer.whenLocalSettled(false).then(() => {
        if (this.unloaded || this.indexer !== indexer) return;
        this.lastOccurrenceError = null;
        void this.markOccurrenceReady(indexer);
        this.refreshRuntimeHealth();
        this.scheduleSemanticCacheWrite();
      }).catch((e) => {
        if (this.unloaded || this.indexer !== indexer) return;
        this.lastOccurrenceError = e.message || String(e);
        this.refreshRuntimeHealth();
      });
    }, LOCAL_BACKGROUND_DELAY_MS);
  }
  /**
   * RTA-2 save-only cache path. Runtime restore is intentionally not enabled yet.
   * The write happens after Workbench is already ready and only after a short quiet period,
   * so cache persistence cannot block startup usability.
   */
  scheduleSemanticCacheWrite() {
    if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
    const indexer = this.indexer;
    if (!indexer?.stats || indexer.revision === this.lastCachedRevision) return;
    const sinceLast = this.lastCacheWriteAt === null ? Infinity : Date.now() - this.lastCacheWriteAt;
    const delay = Math.max(CACHE_QUIET_MS, MIN_CACHE_WRITE_INTERVAL_MS - sinceLast);
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      if (this.unloaded) return;
      const current = this.indexer;
      if (!current?.stats || current.revision === this.lastCachedRevision) return;
      if (!this.backgroundWorkAllowed(current) || Date.now() - this.lastChange < CACHE_QUIET_MS) {
        this.scheduleSemanticCacheWrite();
        return;
      }
      if (current.localHydrationPending > 0) {
        this.scheduleBackgroundLocalHydration();
        this.scheduleSemanticCacheWrite();
        return;
      }
      if (this.cacheWriteTask) return;
      let task;
      task = this.persistSemanticCache().finally(() => {
        if (this.cacheWriteTask === task) this.cacheWriteTask = null;
        const latest = this.indexer;
        if (!this.unloaded && latest?.stats && latest.revision !== this.lastCachedRevision) {
          this.scheduleSemanticCacheWrite();
        }
      });
      this.cacheWriteTask = task;
    }, delay);
  }
  async persistSemanticCache() {
    const schema = this.schema;
    const indexer = this.indexer;
    if (!schema || !indexer || indexer.building || !indexer.stats || indexer.revision === this.lastCachedRevision) return;
    const t0 = performance.now();
    try {
      await indexer.whenLocalSettled(false);
      if (indexer.building || indexer.rebuildPending) {
        this.scheduleSemanticCacheWrite();
        return;
      }
      if (indexer.localReadErrorCount) {
        this.lastCacheWriteError = `cache not updated: ${indexer.localReadErrorCount} Local Model read error(s)`;
        this.refreshRuntimeHealth();
        return;
      }
      const revision = indexer.revision;
      const createdAt = Date.now();
      const scope = { vaultUid: await this.loadVaultUid() };
      const cache = serializeSemanticState(
        indexer.index,
        indexer.local,
        indexer.fingerprints,
        schema,
        scope,
        this.manifest.version,
        createdAt
      );
      const generation = `g-${createdAt}`;
      await writeSemanticCacheGeneration(
        new ObsidianCacheStorage(this.app),
        WORKBENCH_CACHE_ROOT,
        cache,
        generation
      );
      this.lastCacheWriteAt = Date.now();
      this.lastCacheWriteMs = Math.round(performance.now() - t0);
      this.lastCacheWriteError = null;
      if (indexer.revision === revision) {
        this.lastCachedRevision = revision;
        indexer.markCacheCommitted(revision);
      } else this.scheduleSemanticCacheWrite();
      this.refreshRuntimeHealth();
    } catch (e) {
      this.lastCacheWriteMs = Math.round(performance.now() - t0);
      this.lastCacheWriteError = e.message;
      this.refreshRuntimeHealth();
    }
  }
  withActive(checking, run) {
    const f = this.app.workspace.getActiveFile();
    if (!f || f.extension !== "md") return false;
    if (!checking) run(f);
    return true;
  }
  async loadSchema() {
    const read = async (p) => (0, import_obsidian8.parseYaml)(await this.app.vault.adapter.read((0, import_obsidian8.normalizePath)(p)));
    return parseSchema(await read(this.settings.relationshipsPath), await read(this.settings.elementTypesPath));
  }
  async loadVaultUid() {
    const raw = (0, import_obsidian8.parseYaml)(await this.app.vault.adapter.read(".vault.yaml"));
    const uid = raw?.vault_uid;
    if (typeof uid !== "string" || !uid.trim() || uid.trim() === "UNINITIALIZED") {
      throw new Error(".vault.yaml does not yet have an initialized vault_uid.");
    }
    return uid.trim();
  }
  /**
   * Serialize startup/rebuild requests. Schema edits or a manual Rebuild command may arrive
   * while startup is still waiting/indexing; they queue one follow-up rebuild instead of
   * running two model initializations concurrently.
   */
  async start(rebuild) {
    if (this.startPromise) {
      if (rebuild) this.pendingRebuild = true;
      await this.startPromise;
      return;
    }
    this.startPromise = this.runStart(rebuild);
    try {
      await this.startPromise;
    } catch (e) {
      const message = e.message || String(e);
      this.lastCoreError = message;
      this.setRuntimeStatus("error", "core model unavailable");
      new import_obsidian8.Notice(`MDSE Workbench: core model startup failed. Obsidian remains usable. ${message} Use \u201CRebuild index\u201D after correcting the issue.`, 12e3);
    } finally {
      this.startPromise = null;
    }
    if (this.pendingRebuild && !this.unloaded) {
      this.pendingRebuild = false;
      await this.start(true);
    }
  }
  /** Load schema, build/restore the index, then follow vault changes (WB-033, WB-086, W-343/W-344). */
  async runStart(rebuild) {
    const runStartedAt = performance.now();
    this.lastCoreError = null;
    const firstStart = !this.indexer;
    if (firstStart) {
      this.startupRunStartedAt = runStartedAt;
      this.lastTimeToCoreReadyMs = null;
      this.lastTimeToOccurrenceReadyMs = null;
    }
    if (firstStart) {
      this.setRuntimeStatus("waiting");
      const waitStarted = performance.now();
      await this.whenVaultQuiet();
      this.lastStartupWaitMs = Math.round(performance.now() - waitStarted);
      if (this.unloaded) return;
    }
    this.setRuntimeStatus("starting");
    try {
      this.schema = await this.loadSchema();
    } catch (e) {
      const message = e.message || String(e);
      this.lastCoreError = `schema: ${message}`;
      this.setRuntimeStatus("error", "schema");
      new import_obsidian8.Notice(`MDSE Workbench: could not read the schema files. ${message} Check the paths in settings.`);
      return;
    }
    const schema = this.schema;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.indexer.setBackgroundIdleCheck(() => this.backgroundWorkAllowed(this.indexer));
      this.writer = new RelationshipWriter(this.app, () => this.schema, () => this.indexer.index);
      this.assurance = new AssuranceManager({
        revision: () => this.indexer.revision,
        settle: () => this.indexer.whenLocalSettled(),
        index: () => this.indexer.index,
        localFindings: () => {
          const indexer2 = this.indexer;
          const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
          return [
            ...validateLocalModels({ index: indexer2.index, local: indexer2.local, resolve }),
            ...indexer2.localReadFindings()
          ];
        }
      });
      const schemaPaths = () => [(0, import_obsidian8.normalizePath)(this.settings.relationshipsPath), (0, import_obsidian8.normalizePath)(this.settings.elementTypesPath)];
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (schemaPaths().includes(file.path)) return;
          this.indexer?.changed(file.path);
          this.scheduleRuntimeHealthRefresh();
          if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
        })
      );
      this.registerEvent(this.app.vault.on("delete", (f) => {
        this.indexer?.removed(f.path);
        this.scheduleRuntimeHealthRefresh();
        if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
      }));
      this.registerEvent(
        this.app.vault.on("rename", (f, old) => {
          this.indexer?.removed(old);
          this.indexer?.changed(f.path);
          this.scheduleRuntimeHealthRefresh();
          if (this.indexer?.stats) this.scheduleSemanticCacheWrite();
        })
      );
      this.registerEvent(
        this.app.vault.on("modify", (f) => {
          if (schemaPaths().includes(f.path)) void this.start(true);
        })
      );
      this.register(() => this.indexer?.dispose());
    } else {
      this.indexer.setSchema(schema);
    }
    const indexer = this.indexer;
    if (!indexer) return;
    let stats = null;
    if (firstStart && !rebuild && this.settings.warmCachePreview) {
      try {
        this.setRuntimeStatus("restoring");
        const scope = { vaultUid: await this.loadVaultUid() };
        const cache = await readSemanticCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
        const restored = restoreSemanticState(cache, schema, scope);
        const initialPlan = planReconciliation(restored.fingerprints, indexer.currentFingerprints());
        const initialMode = reconciliationMode(initialPlan);
        if (initialMode !== "full") {
          stats = indexer.installRestored(restored, cache.header.createdAt);
          this.lastCachedRevision = indexer.revision;
          const initialChanges = initialPlan.changed.length + initialPlan.added.length + initialPlan.deleted.length;
          this.lastWarmRestore = initialChanges ? `restored; ${initialChanges} path change(s) to reconcile` : "restored; cache matched current file fingerprints";
          indexer.enableLiveChanges();
          if (initialMode === "incremental") {
            this.setRuntimeStatus("reconciling", `${initialChanges} path change(s)`);
            stats = await indexer.reconcilePlan(initialPlan);
          }
          let after = planReconciliation(indexer.fingerprints, indexer.currentFingerprints());
          let afterMode = reconciliationMode(after);
          if (afterMode === "incremental") {
            const retryChanges = after.changed.length + after.added.length + after.deleted.length;
            this.setRuntimeStatus("reconciling", `${retryChanges} newer path change(s)`);
            stats = await indexer.reconcilePlan(after);
            after = planReconciliation(indexer.fingerprints, indexer.currentFingerprints());
            afterMode = reconciliationMode(after);
          }
          if (afterMode !== "none") stats = null;
        }
      } catch (e) {
        this.lastWarmRestore = `not used: ${e.message}`;
        stats = null;
      }
    }
    if (!stats) {
      indexer.enableLiveChanges();
      this.setRuntimeStatus("indexing");
      stats = await indexer.build();
    }
    this.lastTimeToCoreReadyMs = Math.round(performance.now() - runStartedAt);
    const localPending = indexer.localHydrationPending;
    if (!localPending) this.lastTimeToOccurrenceReadyMs = this.lastTimeToCoreReadyMs;
    this.setRuntimeStatus(
      "ready",
      `${stats.elements} elements \xB7 ${stats.mode}${localPending ? ` \xB7 occurrence features loading later` : ""}`
    );
    this.refreshRuntimeHealth();
    if (localPending) this.scheduleBackgroundLocalHydration();
    else this.scheduleSemanticCacheWrite();
    void this.recordRuntimeSample(indexer, stats);
    if (rebuild || schema.warnings.length) {
      new import_obsidian8.Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1e3).toFixed(1)} s${schema.warnings.length ? `; ${schema.warnings.length} schema warning(s), see diagnostics` : ""}.`);
    }
  }
  /** Quiet version of ready(): no notice. Used by Review, which waits and retries. */
  isReady() {
    return !!(this.schema && this.indexer && this.writer && !this.indexer.building && this.indexer.stats);
  }
  confirmClearSemanticCache() {
    new ConfirmModal(
      this.app,
      "Delete Workbench's disposable semantic cache? The Markdown/YAML model is not changed. The next startup will use the full rebuild path.",
      "Clear semantic cache",
      () => void this.clearSemanticCache()
    ).open();
  }
  async clearSemanticCache() {
    if (this.cacheWriteTimer !== null) {
      window.clearTimeout(this.cacheWriteTimer);
      this.cacheWriteTimer = null;
    }
    if (this.cacheWriteTask) {
      new import_obsidian8.Notice("MDSE Workbench: cache persistence is finishing. Try Clear semantic cache again in a moment.");
      return;
    }
    try {
      await clearWorkbenchCache(this.app);
      this.lastCacheWriteAt = null;
      this.lastCacheWriteMs = null;
      this.lastCacheWriteError = null;
      this.lastCachedRevision = null;
      this.lastWarmRestore = "cache cleared; next startup will rebuild from the vault";
      this.refreshRuntimeHealth();
      new import_obsidian8.Notice("MDSE Workbench: semantic cache cleared. Model files were not changed.");
    } catch (e) {
      new import_obsidian8.Notice(`MDSE Workbench: could not clear semantic cache: ${e.message}`, 12e3);
    }
  }
  async inspectSemanticCache() {
    const schema = this.schema;
    const indexer = this.indexer;
    if (!schema || !indexer) {
      new import_obsidian8.Notice("MDSE Workbench has not loaded the model schemas yet.");
      return;
    }
    try {
      const scope = { vaultUid: await this.loadVaultUid() };
      const cache = await readSemanticCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
      const restored = restoreSemanticState(cache, schema, scope);
      const current = indexer.currentFingerprints();
      const plan = planReconciliation(restored.fingerprints, current);
      const mode = reconciliationMode(plan);
      const localRecords = [...restored.local.regions.values()].reduce((n, region) => n + region.records.length, 0);
      const rows = [
        ["Cache producer", cache.header.producerVersion],
        ["Cache created", new Date(cache.header.createdAt).toLocaleString()],
        ["Cached notes", String(restored.index.size)],
        ["Cached Local Model records", String(localRecords)],
        ["Unchanged paths", String(plan.unchanged.length)],
        ["Changed paths", String(plan.changed.length)],
        ["Added paths", String(plan.added.length), plan.added.length > 0],
        ["Deleted paths", String(plan.deleted.length), plan.deleted.length > 0],
        ["Safe next-start mode", mode]
      ];
      new ReportModal(this.app, "MDSE semantic cache", rows, [
        "Inspection is read-only. The vault remains authoritative; cache state is always disposable.",
        mode === "incremental" && (plan.added.length || plan.deleted.length) ? "Path-set changes are safe to reconcile because semantic-cache v2 retains authored relationship links and re-resolves them against current Obsidian metadata." : mode === "full" ? "The pending change set exceeds the bounded incremental startup budget, so the safe next-start path is a full chunked rebuild." : ""
      ].filter(Boolean)).open();
    } catch (e) {
      new import_obsidian8.Notice(`Semantic cache is unavailable or invalid: ${e.message}`, 15e3);
    }
  }
  /** WB-111: validate the shared Local Model index, write the report and open it. */
  async checkLocalModel() {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const notice = new import_obsidian8.Notice("MDSE Workbench: checking Local Model\u2026", 0);
    try {
      const indexer = this.indexer;
      await indexer.whenLocalSettled();
      void this.markOccurrenceReady(indexer);
      const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
      const scan = analyzeLocalModel(indexer.index, indexer.local, resolve);
      const file = await writeFindingsReport(this.app, this.settings.viewsFolder, scan);
      const errors = scan.findings.filter((f) => f.severity === "error").length;
      new import_obsidian8.Notice(`Local Model: ${scan.notesWithRegion} notes, ${scan.records} records, ${errors} errors, ${scan.findings.length - errors} warnings (${(scan.ms / 1e3).toFixed(1)} s).`, 1e4);
      await this.app.workspace.getLeaf(false).openFile(file);
    } catch (e) {
      new import_obsidian8.Notice(`Local Model check failed: ${e.message}`, 15e3);
    } finally {
      notice.hide();
    }
  }
  async openReview() {
    this.markForegroundActivity();
    const existing = this.app.workspace.getLeavesOfType(REVIEW_VIEW)[0];
    const leaf = existing ?? this.app.workspace.getLeaf("tab");
    if (!existing) await leaf.setViewState({ type: REVIEW_VIEW, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }
  ready() {
    if (!this.schema || !this.indexer || this.indexer.building || !this.indexer.stats) {
      new import_obsidian8.Notice("MDSE Workbench is still indexing. Try again in a moment.");
      return false;
    }
    return true;
  }
  async getAssurance(force = false) {
    if (!this.assurance || !this.indexer || !this.schema) throw new Error("Workbench assurance is not ready.");
    const snapshot = await this.assurance.get(force);
    this.refreshRuntimeHealth();
    return snapshot;
  }
  async diagnostics() {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const s = this.indexer.stats;
    const schema = this.schema;
    const assurance = await this.getAssurance(false);
    const f = assurance.model;
    const dirtyBuckets = cacheDirtyBucketsForPaths(this.indexer.cacheDirtyPathsSnapshot());
    const mem = performance.memory;
    const rows = [
      ["Index mode", s.mode],
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
      ["Local Model hydration", this.indexer.localHydrationPending ? `${this.indexer.localHydrationPending} note(s) pending` : "settled"],
      ["Local Model read errors", String(this.indexer.localReadErrorCount), this.indexer.localReadErrorCount > 0],
      ["Startup quiet wait", this.lastStartupWaitMs === null ? "not measured" : `${(this.lastStartupWaitMs / 1e3).toFixed(2)} s`],
      ["Time to core ready", this.lastTimeToCoreReadyMs === null ? "not measured" : `${(this.lastTimeToCoreReadyMs / 1e3).toFixed(2)} s`],
      ["Time to occurrence ready", this.lastTimeToOccurrenceReadyMs === null ? this.indexer.localHydrationPending ? "pending" : "not measured" : `${(this.lastTimeToOccurrenceReadyMs / 1e3).toFixed(2)} s`],
      ["Index build", `${(s.ms / 1e3).toFixed(2)} s (target under 60 s)`, s.ms > 6e4],
      ["Assurance snapshot", assurance.error ? `unavailable \xB7 ${assurance.ms} ms \xB7 revision ${assurance.revision}` : `${assurance.ms} ms \xB7 revision ${assurance.revision}${assurance.stale ? " \xB7 stale/retrying" : ""}`, !!assurance.error],
      ["Assurance error", assurance.error ?? "none", !!assurance.error],
      ["Missing inverses", assurance.error ? "not evaluated" : String(f.missingInverse.length), !assurance.error && f.missingInverse.length > 0],
      ["Inverses with no forward link", assurance.error ? "not evaluated" : String(f.orphanInverse.length), !assurance.error && f.orphanInverse.length > 0],
      ["Links that break endpoint rules", assurance.error ? "not evaluated" : String(f.offRule.length)],
      ["Provisional links (tracesTo)", assurance.error ? "not evaluated" : String(f.provisional.length)],
      ["Unresolved relationship links", assurance.error ? "not evaluated" : String(f.unresolvedLinks), !assurance.error && f.unresolvedLinks > 0],
      ["relationships.yaml", schema.relationshipsVersion],
      ["element-types.yaml", schema.elementTypesVersion],
      ["Editing", editingBlocked(schema) ? "off (schema too old)" : "on", editingBlocked(schema)],
      ["Semantic cache mode", this.settings.warmCachePreview ? "warm restore preview enabled" : "save-only"],
      ["Warm restore", this.lastWarmRestore ?? "not attempted"],
      ["Semantic cache", this.lastCacheWriteError ? `write failed: ${this.lastCacheWriteError}` : this.lastCacheWriteAt ? `saved ${new Date(this.lastCacheWriteAt).toLocaleTimeString()}` : "not written yet", !!this.lastCacheWriteError],
      ["Semantic cache write", this.lastCacheWriteMs === null ? "not measured" : `${this.lastCacheWriteMs} ms`],
      ["Semantic cache persistence", this.cacheWriteTask ? "writing" : this.indexer.revision === this.lastCachedRevision ? "current" : "pending/coalesced"],
      ["Cache dirty paths", String(this.indexer.cacheDirtyPathCount)],
      ["Cache dirty buckets", `${dirtyBuckets.notes.length} note \xB7 ${dirtyBuckets.localRegions.length} local \xB7 ${dirtyBuckets.fingerprints.length} fingerprint`]
    ];
    if (mem) rows.push(["JavaScript heap in use", `${Math.round(mem.usedJSHeapSize / 1048576)} MB (whole Obsidian window)`]);
    new ReportModal(this.app, "MDSE Workbench diagnostics", rows, schema.warnings).open();
  }
  /** Lists the views that can start from this note's type and opens the one chosen. */
  pickView(path) {
    this.markForegroundActivity();
    if (!this.isReady()) {
      new import_obsidian8.Notice("MDSE Workbench is still indexing. Try again in a moment.");
      return;
    }
    const rec = this.indexer.index.notes.get(path);
    const type = rec?.type ?? "";
    const fits = Object.values(PROFILES).filter((p) => !p.startTypes || p.startTypes.includes(type));
    new ViewPicker(this.app, fits, rec?.name ?? "this note", (p) => void this.explore([path], p)).open();
  }
  async explore(starts, profile = STRUCTURE_PROFILE) {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const indexer = this.indexer;
    if (profileNeedsLocalOccurrences(profile)) {
      this.setRuntimeStatus("ready", `${indexer.stats?.elements ?? 0} elements \xB7 loading occurrence data for ${profile.name}`);
      await indexer.whenLocalSettled();
      void this.markOccurrenceReady(indexer);
      this.refreshRuntimeHealth();
    }
    const index = indexer.index;
    const t0 = performance.now();
    if (profile.startTypes) {
      const type = index.notes.get(starts[0])?.type ?? "";
      if (!profile.startTypes.includes(type)) {
        new import_obsidian8.Notice(`The ${profile.name} view starts from ${profile.startTypes.join(" or ")}. This note is ${type ? `a ${type}` : "not a model note"}.`);
        return;
      }
    }
    const baseView = traverse(index, starts, profile);
    const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
    const view = withLocalOccurrences(index, indexer.local, resolve, baseView, profile);
    if (view.depthOf.size <= 1 && view.omitted.size === 0) {
      new import_obsidian8.Notice(`Nothing to show: this note has no links the ${profile.name} view follows (${[...new Set(profile.steps.map((s) => s.field))].join(", ")}).`);
      return;
    }
    const canvas = toCanvas(index, view, profile);
    const name = (index.notes.get(starts[0])?.name ?? "view").replace(/[\\/:*?"<>|#^[\]]/g, "_");
    const folder = (0, import_obsidian8.normalizePath)(this.settings.viewsFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const path = (0, import_obsidian8.normalizePath)(`${folder}/${name} - ${view.profile}.canvas`);
    const json = JSON.stringify(canvas, null, "	");
    const existing = this.app.vault.getAbstractFileByPath(path);
    const file = existing instanceof import_obsidian8.TFile ? (await this.app.vault.modify(existing, json), existing) : await this.app.vault.create(path, json);
    this.views[path] = { starts: view.starts, profile: view.profile, signature: signature(view), at: Date.now() };
    await this.saveAll();
    const ms = Math.round(performance.now() - t0);
    await this.app.workspace.getLeaf(true).openFile(file);
    new import_obsidian8.Notice(`${view.profile}: ${view.depthOf.size} items${view.localNodes.size ? ` (${view.localNodes.size} local occurrences)` : ""}${view.undefinedCount ? `, ${view.undefinedCount} undefined` : ""} in ${ms} ms${view.capReached ? `, stopped at the ${profile.nodeCap}-item limit` : ""}.`);
  }
  /**
   * Clicking a card on a generated view opens its details (WB-099). It only watches clicks and never stops
   * them, so selecting and moving cards on the canvas works as before. It relies on Canvas internals that
   * Obsidian does not document (the card elements and `canvas.nodes`), so a fallback reads the card's
   * position and matches it to the canvas file; check it again on each Obsidian version.
   */
  registerDetailClicks() {
    let down = null;
    this.registerDomEvent(document, "pointerdown", (e) => down = { x: e.clientX, y: e.clientY }, true);
    this.registerDomEvent(
      document,
      "click",
      (e) => {
        const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5 : false;
        if (!this.settings.showDetails || moved || e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
        void this.onCanvasClick(e.target);
      },
      true
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view.getViewType() !== "canvas") this.detail?.closeIfClean();
      })
    );
  }
  isWorkbenchCanvas(file) {
    if (!file) return false;
    return !!this.views[file.path] || file.path.startsWith((0, import_obsidian8.normalizePath)(this.settings.viewsFolder) + "/");
  }
  async onCanvasClick(target) {
    const cardEl = target?.closest?.(".canvas-node");
    if (!cardEl || target?.closest("a, button, input, textarea")) return;
    const view = this.app.workspace.getLeavesOfType("canvas").map((l) => l.view).find((v) => v?.containerEl?.contains(cardEl));
    if (!view || !this.isWorkbenchCanvas(view.file)) return;
    let file = null;
    let localTarget = null;
    let missing = null;
    try {
      const nodes = view.canvas?.nodes;
      const list = nodes instanceof Map ? [...nodes.values()] : Array.isArray(nodes) ? nodes : [];
      const node = list.find((n) => n?.nodeEl === cardEl);
      if (node?.file instanceof import_obsidian8.TFile) file = node.file;
      else if (node) localTarget = localCardTarget(node.text) ?? null;
      if (node && !localTarget && !file) missing = undefinedName2(node.text);
    } catch {
    }
    if (!file && missing === null) {
      const pos = parseTranslate(cardEl.getAttribute("style"));
      if (pos) {
        try {
          const json = JSON.parse(await this.app.vault.cachedRead(view.file));
          const n = nodeAt(json.nodes ?? [], pos.x, pos.y);
          if (n?.file) {
            const f = this.app.vault.getAbstractFileByPath(n.file);
            if (f instanceof import_obsidian8.TFile) file = f;
          } else if (n) {
            localTarget = localCardTarget(n.text) ?? null;
            if (!localTarget) missing = undefinedName2(n.text);
          }
        } catch {
        }
      }
    }
    if (localTarget) {
      const owner = this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(localTarget.target), view.file.path);
      const record = owner ? this.indexer?.local.recordsOf(owner.path).find((r) => r.localId === localTarget?.localId) : void 0;
      if (owner && record) this.detail?.showLocal(owner, record);
      else if (owner) new import_obsidian8.Notice(`Local Model record ${localTarget.localId} was not found in ${owner.basename}.`);
    } else if (file) await this.detail?.show(file);
    else if (missing) this.detail?.showUndefined(missing);
  }
  async checkView() {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const indexer = this.indexer;
    const f = this.app.workspace.getActiveFile();
    const meta = f ? this.views[f.path] : void 0;
    if (!f || !meta) {
      new import_obsidian8.Notice("Open a view generated by Workbench first.");
      return;
    }
    const profile = PROFILES[meta.profile] ?? STRUCTURE_PROFILE;
    if (profileNeedsLocalOccurrences(profile)) {
      await indexer.whenLocalSettled();
      void this.markOccurrenceReady(indexer);
    }
    const index = indexer.index;
    const baseView = traverse(index, meta.starts, profile);
    const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
    const current = withLocalOccurrences(index, indexer.local, resolve, baseView, profile);
    const now = signature(current);
    if (now === meta.signature) new import_obsidian8.Notice("This view is current.");
    else
      new ConfirmModal(this.app, "The model changed since this view was generated.", "Refresh view", () => void this.explore(meta.starts, profile)).open();
  }
  elements() {
    const index = this.indexer.index;
    return [...index.notes.values()].filter((r) => index.isElement(r)).sort((a, b) => a.name.localeCompare(b.name));
  }
  pickTargetThenRelate(firstPath) {
    if (!this.ready()) return;
    const first = this.indexer.index.notes.get(firstPath);
    if (!this.indexer.index.isElement(first)) {
      new import_obsidian8.Notice("This note has no known type, so Workbench cannot relate it.");
      return;
    }
    new ElementPicker(
      this.app,
      this.elements().filter((r) => r.path !== firstPath),
      `Relate ${first.name} to\u2026`,
      (second) => this.relate(firstPath, second.path)
    ).open();
  }
  relate(firstPath, secondPath) {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const index = this.indexer.index;
    const a = index.notes.get(firstPath);
    const b = index.notes.get(secondPath);
    if (!index.isElement(a) || !index.isElement(b)) {
      new import_obsidian8.Notice("Both notes need a known type to be related.");
      return;
    }
    const options = optionsBetween(this.schema, a.type, b.type);
    new RelationshipPicker(this.app, options, a, b, async (o) => {
      const [owner, target] = o.ownerIsFirst ? [a, b] : [b, a];
      try {
        const tx = await this.writer.add(o.def, owner.path, target.path);
        new import_obsidian8.Notice(tx.files.length ? `Added: ${owner.name} ${o.def.field} ${target.name}.` : "That link already exists.", 8e3);
      } catch (e) {
        new import_obsidian8.Notice(`Not added: ${e.message}`, 15e3);
      }
    }).open();
  }
  async undo() {
    this.markForegroundActivity();
    if (!this.writer) return;
    new import_obsidian8.Notice(await this.writer.undo(), 15e3);
  }
};
var WorkbenchSettings = class extends import_obsidian8.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const text = (name, desc, key2) => new import_obsidian8.Setting(containerEl).setName(name).setDesc(desc).addText(
      (t) => t.setValue(this.plugin.settings[key2]).onChange(async (v) => {
        this.plugin.settings[key2] = v.trim();
        await this.plugin.saveAll();
      })
    );
    text("Relationship schema", "Path to relationships.yaml in this vault.", "relationshipsPath");
    text("Element types", "Path to element-types.yaml in this vault.", "elementTypesPath");
    text("Generated views folder", "Generated canvases are written here. Add this folder to .gitignore.", "viewsFolder");
    new import_obsidian8.Setting(containerEl).setName("Note details on click").setDesc("Clicking a note on a generated view (a canvas in the views folder) opens its properties and text in a popup. Uses Canvas internals that Obsidian does not document.").addToggle(
      (t) => t.setValue(this.plugin.settings.showDetails).onChange(async (v) => {
        this.plugin.settings.showDetails = v;
        if (!v) this.plugin.detail?.close();
        await this.plugin.saveAll();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("Canvas probe").setDesc("Adds 'Relate selected notes' to the canvas right-click menu, to test whether Canvas editing is possible (Phase 0). Reload Obsidian after changing.").addToggle(
      (t) => t.setValue(this.plugin.settings.canvasProbe).onChange(async (v) => {
        this.plugin.settings.canvasProbe = v;
        await this.plugin.saveAll();
      })
    );
    new import_obsidian8.Setting(containerEl).setName("Warm cache preview").setDesc("Pre-release RTA-3 test only. Restore a validated local semantic cache before reconciling the vault. Keep off in controlled releases until the startup gate passes.").addToggle(
      (t) => t.setValue(this.plugin.settings.warmCachePreview).onChange(async (v) => {
        this.plugin.settings.warmCachePreview = v;
        await this.plugin.saveAll();
      })
    );
  }
};
