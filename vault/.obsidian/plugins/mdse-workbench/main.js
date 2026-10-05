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
  const activeLocal = Math.max(0, input.localPending - input.localQueued);
  const assuranceCurrent = !!input.assurance?.current;
  const assuranceError = assuranceCurrent ? input.assurance?.error ?? null : null;
  const capabilities = {
    core: input.coreError ? { state: "failed", detail: input.coreError } : input.ready ? { state: "ready", detail: input.livePending ? `${input.livePending} live update(s) pending` : "ready" } : { state: "pending", detail: input.building ? "indexing" : input.schemaError ? "blocked by schema" : "starting" },
    occurrence: input.occurrenceError ? { state: "failed", detail: input.occurrenceError } : input.localReadErrors ? { state: "failed", detail: `${input.localReadErrors} read error(s)` } : activeLocal ? { state: "pending", detail: `${activeLocal} note(s) hydrating` } : input.localQueued ? { state: "pending", detail: `${input.localQueued} note(s) queued` } : input.ready ? { state: "ready", detail: "settled" } : { state: "pending", detail: "not yet available" },
    cache: input.cacheWriteError ? { state: "failed", detail: input.cacheWriteError } : input.cacheCurrent ? { state: "ready", detail: "current" } : { state: "pending", detail: input.cachePending ? "pending/coalesced" : "not current" },
    schema: input.schemaError ? { state: "failed", detail: input.schemaError } : input.schemaLoaded ? { state: "ready", detail: input.schemaWarnings ? `${input.schemaWarnings} warning(s)` : "compatible" } : { state: "pending", detail: "not loaded" },
    assurance: assuranceError ? { state: "failed", detail: assuranceError } : assuranceCurrent ? {
      state: "ready",
      detail: input.assurance.findings ? `${input.assurance.findings} finding(s)` : "current \xB7 no findings"
    } : {
      state: "pending",
      detail: input.assuranceActive ? "computing" : input.assurance ? "stale; recomputes on demand" : "not run for current model revision"
    }
  };
  const rows = [
    ["Core", `${capabilities.core.state} \xB7 ${capabilities.core.detail}`, capabilities.core.state === "failed"],
    ["Occurrence", `${capabilities.occurrence.state} \xB7 ${capabilities.occurrence.detail}`, capabilities.occurrence.state === "failed"],
    ["Cache", `${capabilities.cache.state} \xB7 ${capabilities.cache.detail}`, capabilities.cache.state === "failed"],
    ["Schema", `${capabilities.schema.state} \xB7 ${capabilities.schema.detail}`, capabilities.schema.state === "failed"],
    ["Assurance", `${capabilities.assurance.state} \xB7 ${capabilities.assurance.detail}`, capabilities.assurance.state === "failed"]
  ];
  const failed = Object.values(capabilities).filter((capability) => capability.state === "failed").length;
  if (failed) {
    return {
      level: "attention",
      label: `Workbench \xB7 ${failed} subsystem issue${failed === 1 ? "" : "s"}`,
      detail: "Capabilities are isolated; inspect runtime health for the affected subsystem.",
      capabilities,
      rows
    };
  }
  const pending = Object.values(capabilities).filter((capability) => capability.state === "pending").length;
  if (!input.ready) {
    return {
      level: input.building ? "syncing" : "starting",
      label: input.building ? "Workbench \xB7 indexing" : "Workbench \xB7 starting",
      detail: "Core model is not ready yet; other subsystem states are reported independently.",
      capabilities,
      rows
    };
  }
  if (input.livePending || input.localPending) {
    return {
      level: "syncing",
      label: input.livePending ? `Workbench \u2713 \xB7 applying ${input.livePending}` : activeLocal ? "Workbench \u2713 \xB7 occurrence data loading" : "Workbench \u2713 \xB7 occurrence data queued",
      detail: "Core availability is preserved while derived capability work finishes.",
      capabilities,
      rows
    };
  }
  if (input.assurance?.current && input.assurance.findings > 0) {
    return {
      level: "ready",
      label: `Workbench \u2713 \xB7 ${input.assurance.findings} review`,
      detail: "Runtime is healthy; engineering findings are available in Review.",
      capabilities,
      rows
    };
  }
  return {
    level: "ready",
    label: "Workbench \u2713",
    detail: pending ? "Core runtime is healthy; one or more optional capabilities are pending." : "Runtime capabilities are healthy.",
    capabilities,
    rows
  };
}

// src/core/background.ts
var BACKGROUND_RESUME_QUIET_MS = 3e3;
var BACKGROUND_MAX_DEFERRAL_MS = 3e4;
function canRunBackgroundWork(state) {
  return !state.unloaded && state.ready && !state.building && !state.rebuildPending && state.liveUpdatePending === 0 && (state.quietForMs >= state.minimumQuietMs || state.maxDeferralMs !== void 0 && state.waitingForMs !== void 0 && state.waitingForMs >= state.maxDeferralMs);
}
var RuntimeWorkPriority = {
  cacheWrite: 100,
  assurance: 200,
  backgroundHydration: 300,
  requestedHydration: 400,
  indexing: 500
};
function canStartRuntimeWork(requested, active) {
  const requestedPriority = RuntimeWorkPriority[requested];
  return !active.some((kind) => RuntimeWorkPriority[kind] > requestedPriority);
}

// src/core/cache-persistence.ts
var CACHE_PERSIST_QUIET_MS = 8e3;
var MIN_CACHE_PERSIST_INTERVAL_MS = 3e4;
function cachePersistenceDelayMs(nowMs, lastWriteAt, quietMs = CACHE_PERSIST_QUIET_MS, minimumIntervalMs = MIN_CACHE_PERSIST_INTERVAL_MS) {
  const sinceLast = lastWriteAt === null ? Number.POSITIVE_INFINITY : Math.max(0, nowMs - lastWriteAt);
  return Math.max(quietMs, minimumIntervalMs - sinceLast, 0);
}

// src/core/cache-mutation.ts
var CacheMutationGate = class {
  constructor() {
    this.clearTask = null;
  }
  get clearing() {
    return this.clearTask !== null;
  }
  writesAllowed() {
    return this.clearTask === null;
  }
  clear(activeWrite, remove) {
    if (this.clearTask) return this.clearTask;
    let task;
    task = (async () => {
      if (activeWrite) await activeWrite;
      await remove();
    })().finally(() => {
      if (this.clearTask === task) this.clearTask = null;
    });
    this.clearTask = task;
    return task;
  }
};

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

// src/core/localmodel.ts
var READABLE_VERSIONS = ["0.1", "0.2"];
var WRITABLE_VERSION = "0.2";
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
function localModelSourceFingerprint(text) {
  const lines = text.split(/\r?\n/);
  const markerLines = [];
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
    sourceFingerprint: localModelSourceFingerprint(text),
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
    if (!region.structured) return;
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
  isQuarantined(path) {
    const region = this.regions.get(path);
    return !!region && !region.structured;
  }
  quarantinedPaths() {
    return [...this.regions.entries()].filter(([, region]) => !region.structured).map(([path]) => path).sort();
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

// src/core/localmodel-edit.ts
var FIELD_ORDER = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "exposes", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier"],
  flow: ["definition", "identifier", "endpointA", "endpointB"]
};
function editableLocalRegion(text) {
  const region = parseLocalModel(text);
  if (!region) throw new Error("This note has no governed Local Model region.");
  if (!region.structured) throw new Error("The Local Model region has structural/schema errors and cannot be edited.");
  if (region.schemaVersion !== WRITABLE_VERSION) {
    throw new Error("Local Model schema " + (region.schemaVersion ?? "unknown") + " is read-only. Structured writes require schema " + WRITABLE_VERSION + ".");
  }
  return {
    region,
    lines: text.split(/\r?\n/),
    eol: text.includes("\r\n") ? "\r\n" : "\n"
  };
}
function planLocalRecordPatch(text, localId, patch, options = {}) {
  const editable = editableLocalRegion(text);
  const record = editable.region.records.find((r) => r.localId === localId);
  if (!record) throw new Error("Local Model record ^" + localId + " does not exist in this note.");
  const nextHeading = patch.heading === void 0 ? record.identifier : patch.heading.trim();
  if (!nextHeading) throw new Error("A Local Model record heading cannot be empty.");
  const fields = new Map(record.fields);
  for (const [key2, raw] of Object.entries(patch.fields ?? {})) {
    if (!FIELD_ORDER[record.kind].includes(key2)) throw new Error(key2 + " is not a governed field on a " + record.kind + " record.");
    if ((record.kind === "connection" || record.kind === "flow") && key2 === "usage") {
      throw new Error("usage is not valid on a " + record.kind + " record.");
    }
    const value = raw === null ? null : raw.trim();
    if (value === null || value === "" || key2 === "usage" && value === "standard") fields.delete(key2);
    else fields.set(key2, value);
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
  if (!options.allowInvalidTarget) assertTargetValid(parsed, localId);
  return {
    before: text,
    after,
    changed: after !== text,
    localId,
    kind: record.kind,
    findings: parsed.findings.slice()
  };
}
function recordLineRange(editable, record) {
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
function renderRecord(kind, heading, localId, fields) {
  const level = kind === "flow" ? "#####" : "####";
  const out = [level + " " + heading];
  const known = new Set(FIELD_ORDER[kind]);
  for (const key2 of FIELD_ORDER[kind]) {
    const value = fields.get(key2);
    if (value !== void 0 && value !== "") out.push("- " + key2 + ": " + value);
  }
  for (const [key2, value] of fields) {
    if (!known.has(key2) && value !== "") out.push("- " + key2 + ": " + value);
  }
  out.push("^" + localId);
  return out;
}
function nextLocalId(kind, ownerUid, now = /* @__PURE__ */ new Date()) {
  if (!/^\d{17}[a-z-]{13}$/.test(ownerUid)) {
    throw new Error("Cannot create a Local Model identity because the owner note UID is not a governed 30-character identity.");
  }
  const suffix = ownerUid.slice(-13);
  const pad2 = (value, width) => String(value).padStart(width, "0");
  const stamp = pad2(now.getUTCFullYear(), 4) + pad2(now.getUTCMonth() + 1, 2) + pad2(now.getUTCDate(), 2) + pad2(now.getUTCHours(), 2) + pad2(now.getUTCMinutes(), 2) + pad2(now.getUTCSeconds(), 2) + pad2(now.getUTCMilliseconds(), 3);
  const prefix = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
  return prefix[kind] + stamp + suffix;
}
function planLocalRecordDelete(text, localId) {
  const editable = editableLocalRegion(text);
  const record = editable.region.records.find((candidate) => candidate.localId === localId);
  if (!record) throw new Error("Local Model record ^" + localId + " does not exist in this note.");
  if (record.kind !== "part" && record.kind !== "endpoint" && record.kind !== "connection" && record.kind !== "flow") {
    throw new Error("This deletion slice supports part, endpoint, connection and flow occurrences only.");
  }
  const impacts = [];
  for (const source of editable.region.records) {
    if (source.localId === localId) continue;
    if (record.kind === "connection" && source.kind === "flow" && source.connectionId === localId) {
      impacts.push({
        sourceLocalId: source.localId,
        sourceKind: source.kind,
        sourceIdentifier: source.identifier,
        field: "connection"
      });
    }
    for (const [field, value] of source.fields) {
      for (const link of parseLinks(value)) {
        if (!link.target && link.blockId === localId) {
          impacts.push({
            sourceLocalId: source.localId,
            sourceKind: source.kind,
            sourceIdentifier: source.identifier,
            field
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
    identifier: record.identifier
  };
}
var SECTION_TITLE = {
  part: "Part Occurrences",
  endpoint: "Local Interfaces",
  connection: "Connections"
};
var SECTION_ORDER = ["part", "endpoint", "connection"];
function planLocalRecordCreate(text, input) {
  validateNewRecord(input);
  const existing = parseLocalModel(text);
  if (!existing) {
    if (/^##\s+Local Model\s*$/m.test(text)) {
      throw new Error("This note already has an ungoverned Local Model heading. Resolve it before structured creation.");
    }
    if (input.kind === "flow") throw new Error("A flow requires an existing connection.");
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const block2 = renderRecord(input.kind, input.heading.trim(), input.localId, normalizedFields(input.kind, input.fields));
    const regionLines = [
      "## Local Model",
      "<!-- MDSE:LOCAL-MODEL START schema=0.2 -->",
      "",
      "### " + SECTION_TITLE[input.kind],
      "",
      ...block2,
      "",
      "<!-- MDSE:LOCAL-MODEL END -->"
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
function checkedCreate(before, after, input) {
  const parsed = parseLocalModel(after);
  if (!parsed?.structured) throw new Error("Planned creation would make the Local Model region structurally unreadable.");
  const record = parsed.records.find((r) => r.localId === input.localId);
  if (!record || record.kind !== input.kind) throw new Error("Planned creation did not produce the requested " + input.kind + " record.");
  return { before, after, changed: after !== before, localId: input.localId, kind: input.kind, findings: parsed.findings.slice() };
}
function validateNewRecord(input) {
  if (!input.heading.trim()) throw new Error("A Local Model record heading cannot be empty.");
  const prefix = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
  const want = prefix[input.kind];
  if (!input.localId.startsWith(want) || !/^\d{17}[a-z-]{13}$/.test(input.localId.slice(want.length))) {
    throw new Error("Local Model ID " + input.localId + " is not a valid " + input.kind + " identity.");
  }
  for (const key2 of Object.keys(input.fields)) {
    if (!FIELD_ORDER[input.kind].includes(key2)) throw new Error(key2 + " is not a governed field on a " + input.kind + " record.");
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
function normalizedFields(kind, source) {
  const out = /* @__PURE__ */ new Map();
  for (const key2 of FIELD_ORDER[kind]) {
    const value = source[key2]?.trim();
    if (!value || key2 === "usage" && value === "standard") continue;
    out.set(key2, value);
  }
  return out;
}
function sectionInsertPoint(lines, region, kind) {
  const title = SECTION_TITLE[kind].toLowerCase();
  const end = region.endLine ? region.endLine - 1 : lines.length;
  let section = -1;
  for (let i = region.startLine ?? 1; i < end; i++) {
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
    for (let i = region.startLine ?? 1; i < end; i++) {
      const m = /^###\s+(.*?)\s*$/.exec(lines[i]);
      if (m && m[1].trim().toLowerCase() === laterTitle) return { line: i, existing: false };
    }
  }
  return { line: end, existing: false };
}
function endOfConnection(lines, region, connection) {
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
function assertTargetValid(region, localId) {
  const errors = region.findings.filter((finding) => finding.severity === "error" && finding.localId === localId);
  if (!errors.length) return;
  throw new Error("Local Model record ^" + localId + " is invalid: " + errors.map((x) => x.message).join(" "));
}

// src/core/model-edit.ts
var ModelEditService = class {
  constructor(store, ownerUid, transactions, externalLocalDeleteImpacts = () => []) {
    this.store = store;
    this.ownerUid = ownerUid;
    this.transactions = transactions;
    this.externalLocalDeleteImpacts = externalLocalDeleteImpacts;
    this.sequence = 0;
    this.pendingCreates = /* @__PURE__ */ new Map();
    this.pendingPatches = /* @__PURE__ */ new Map();
    this.pendingDeletes = /* @__PURE__ */ new Map();
  }
  async patchLocalRecord(path, localId, patch) {
    const before = await this.store.read(path);
    const plan = planLocalRecordPatch(before, localId, patch);
    if (!plan.changed) return { changed: false, plan };
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    const ref = localRef(uid, plan.kind, localId);
    const label = `edit ${plan.kind} ${localId}`;
    const txId = `local-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    this.transactions.begin(txId, label, "atomic");
    this.transactions.add(txId, {
      id: txId + "-patch",
      label,
      changes: [{
        kind: "local.patch",
        summary: label,
        refs: [ref],
        metadata: { path, localId, localKind: plan.kind }
      }]
    });
    try {
      await this.transactions.apply(txId, {
        apply: async () => this.applyGuarded(path, plan.before, plan.after, label)
      });
    } catch (error) {
      try {
        this.transactions.cancel(txId);
      } catch {
      }
      throw error;
    }
    return { changed: true, plan };
  }
  async stageLocalRecordPatch(path, localId, patch) {
    const before = await this.store.read(path);
    const plan = planLocalRecordPatch(before, localId, patch, { allowInvalidTarget: true });
    if (!plan.changed) throw new Error("This structural edit would not change the Local Model.");
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    const txId = `local-patch-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `reassign ${plan.kind} ${localId}`;
    this.transactions.begin(txId, label, "structural");
    const transaction = this.transactions.add(txId, {
      id: txId + "-patch",
      label,
      changes: [{
        kind: "local.patch",
        summary: label,
        refs: [localRef(uid, plan.kind, localId)],
        metadata: { path, localId, localKind: plan.kind }
      }]
    });
    this.pendingPatches.set(txId, { path, plan, label });
    return { transaction, plan, path };
  }
  reviewLocalPatch(transactionId) {
    const pending = this.requirePendingPatch(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path
    };
  }
  async applyLocalPatch(transactionId) {
    const pending = this.requirePendingPatch(transactionId);
    const blocking = pending.plan.findings.filter((finding) => finding.severity === "error");
    if (blocking.length) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blocking.length} blocking Local Model finding${blocking.length === 1 ? "" : "s"} \u2014 ${blocking.map((finding) => finding.message).join(" ")}`
      );
    }
    await this.transactions.apply(transactionId, {
      apply: async () => this.applyGuarded(pending.path, pending.plan.before, pending.plan.after, pending.label)
    });
    this.pendingPatches.delete(transactionId);
  }
  cancelLocalPatch(transactionId) {
    this.requirePendingPatch(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pendingPatches.delete(transactionId);
    return cancelled;
  }
  requirePendingPatch(transactionId) {
    const pending = this.pendingPatches.get(transactionId);
    if (!pending) throw new Error(`Structural Local Model patch transaction ${transactionId} does not exist.`);
    return pending;
  }
  /**
   * Stage creation of one Local Model record. Planning and validation happen now, but the vault is
   * untouched until applyLocalCreate(). This is the first structural Review / Apply / Cancel path.
   */
  async stageLocalRecordCreate(path, input) {
    const before = await this.store.read(path);
    const plan = planLocalRecordCreate(before, input);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    const txId = `local-struct-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `create ${input.kind} ${input.heading.trim()}`;
    this.transactions.begin(txId, label, "structural");
    const transaction = this.transactions.add(txId, {
      id: txId + "-create",
      label,
      changes: [{
        kind: "local.create",
        summary: label,
        refs: [localRef(uid, input.kind, input.localId)],
        metadata: { path, localId: input.localId, localKind: input.kind }
      }]
    });
    this.pendingCreates.set(txId, { path, plan, label });
    return { transaction, plan, path };
  }
  reviewLocalCreate(transactionId) {
    const pending = this.requirePendingCreate(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path
    };
  }
  async applyLocalCreate(transactionId) {
    const pending = this.requirePendingCreate(transactionId);
    const blocking = pending.plan.findings.filter((finding) => finding.severity === "error");
    if (blocking.length) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blocking.length} blocking Local Model finding${blocking.length === 1 ? "" : "s"} \u2014 ${blocking.map((finding) => finding.message).join(" ")}`
      );
    }
    try {
      await this.transactions.apply(transactionId, {
        apply: async () => this.applyGuarded(pending.path, pending.plan.before, pending.plan.after, pending.label)
      });
      this.pendingCreates.delete(transactionId);
    } catch (error) {
      throw error;
    }
  }
  cancelLocalCreate(transactionId) {
    this.requirePendingCreate(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pendingCreates.delete(transactionId);
    return cancelled;
  }
  requirePendingCreate(transactionId) {
    const pending = this.pendingCreates.get(transactionId);
    if (!pending) throw new Error(`Structural Local Model transaction ${transactionId} does not exist.`);
    return pending;
  }
  async stageLocalRecordDelete(path, localId) {
    const before = await this.store.read(path);
    const plan = planLocalRecordDelete(before, localId);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    const txId = `local-delete-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `delete ${plan.kind} ${plan.identifier}`;
    this.transactions.begin(txId, label, "structural");
    const transaction = this.transactions.add(txId, {
      id: txId + "-delete",
      label,
      changes: [{
        kind: "local.delete",
        summary: label,
        refs: [localRef(uid, plan.kind, plan.localId)],
        metadata: { path, localId: plan.localId, localKind: plan.kind }
      }]
    });
    this.pendingDeletes.set(txId, { path, plan, label, ownerUid: uid });
    return {
      transaction,
      plan,
      path,
      externalImpacts: this.externalLocalDeleteImpacts(path, localId)
    };
  }
  reviewLocalDelete(transactionId) {
    const pending = this.requirePendingDelete(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path,
      externalImpacts: this.externalLocalDeleteImpacts(pending.path, pending.plan.localId)
    };
  }
  async applyLocalDelete(transactionId) {
    const pending = this.requirePendingDelete(transactionId);
    const external = this.externalLocalDeleteImpacts(pending.path, pending.plan.localId);
    const blockingCount = pending.plan.impacts.length + external.length;
    if (blockingCount) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blockingCount} dependent model reference${blockingCount === 1 ? "" : "s"} still target this occurrence.`
      );
    }
    const blockingFindings = pending.plan.findings.filter((finding) => finding.severity === "error");
    if (blockingFindings.length) {
      throw new Error(
        `Cannot apply ${pending.label}: ${blockingFindings.length} blocking Local Model finding${blockingFindings.length === 1 ? "" : "s"}.`
      );
    }
    await this.transactions.apply(transactionId, {
      apply: async () => this.applyGuarded(pending.path, pending.plan.before, pending.plan.after, pending.label)
    });
    this.pendingDeletes.delete(transactionId);
  }
  cancelLocalDelete(transactionId) {
    this.requirePendingDelete(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pendingDeletes.delete(transactionId);
    return cancelled;
  }
  requirePendingDelete(transactionId) {
    const pending = this.pendingDeletes.get(transactionId);
    if (!pending) throw new Error(`Structural Local Model delete transaction ${transactionId} does not exist.`);
    return pending;
  }
  async applyGuarded(path, before, after, label) {
    const current = await this.store.read(path);
    if (current !== before) {
      throw new Error(`${path} changed while "${label}" was being prepared. Reopen the context and try again.`);
    }
    await this.store.write(path, after);
    return {
      undo: async () => {
        const latest = await this.store.read(path);
        if (latest !== after) throw new Error(`${path} changed after "${label}".`);
        await this.store.write(path, before);
      },
      redo: async () => {
        const latest = await this.store.read(path);
        if (latest !== before) throw new Error(`${path} changed after undoing "${label}".`);
        await this.store.write(path, after);
      }
    };
  }
};

// src/core/core-readiness.ts
function canPublishCoreReady(state) {
  return state.publicationGate && state.schemaLoaded && state.writerReady && state.statsAvailable && !state.sourceReconciliationPending && !state.building;
}

// src/core/startup-recovery.ts
async function recoverWithColdBuild(discardProvisionalState, coldBuild) {
  await discardProvisionalState();
  return await coldBuild();
}

// src/core/cache-size.ts
async function cacheTreeSizeBytes(storage, root) {
  let total = 0;
  const pending = [root];
  while (pending.length) {
    const folder = pending.pop();
    const listed = await storage.list(folder);
    pending.push(...listed.folders);
    for (const file of listed.files) {
      const stat = await storage.stat(file);
      if (stat && Number.isFinite(stat.size) && stat.size >= 0) total += stat.size;
    }
  }
  return total;
}
function formatCacheBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "unavailable";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib < 10 ? 1 : 0)} KiB`;
  const mib = kib / 1024;
  if (mib < 1024) return `${mib.toFixed(mib < 10 ? 1 : 0)} MiB`;
  const gib = mib / 1024;
  return `${gib.toFixed(gib < 10 ? 2 : 1)} GiB`;
}

// src/core/startup-handoff.ts
function scheduleStartupHandoff(schedule, cancel, run) {
  let active = true;
  const handle = schedule(() => {
    if (!active) return;
    active = false;
    run();
  });
  return {
    cancel: () => {
      if (!active) return;
      active = false;
      cancel(handle);
    }
  };
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
var CACHE_FORMAT_VERSION = 2;
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
function restoreCoreSemanticState(cache, schema, scope) {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.notes) || !isObject(cache.fingerprints)) {
    throw new Error("Malformed core semantic cache payload.");
  }
  const index = new ModelIndex(schema);
  for (const raw of cache.notes) index.upsert(deserializeNote(raw));
  const fingerprints = /* @__PURE__ */ new Map();
  for (const [path, raw] of Object.entries(cache.fingerprints)) {
    if (!isFingerprint(raw)) throw new Error(`Malformed fingerprint for ${path}.`);
    fingerprints.set(path, { ...raw });
  }
  return { index, fingerprints };
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
    sourceFingerprint: r.sourceFingerprint,
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
  if (typeof raw.sourceFingerprint !== "string" || !/^[0-9a-f]{8}$/.test(raw.sourceFingerprint)) throw new Error("Malformed Local Model source fingerprint in cache.");
  if (!(raw.schemaVersion === null || typeof raw.schemaVersion === "string")) throw new Error("Malformed Local Model schema version in cache.");
  if (!(raw.startLine === null || typeof raw.startLine === "number")) throw new Error("Malformed Local Model start line in cache.");
  if (!(raw.endLine === null || typeof raw.endLine === "number")) throw new Error("Malformed Local Model end line in cache.");
  return {
    sourceFingerprint: raw.sourceFingerprint,
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
      fingerprints: { count: fingerprintShards.length, total: Object.keys(cache.fingerprints).length, generations: fingerprintShards.map(() => generation) },
      notes: { count: noteShards.length, total: cache.notes.length, generations: noteShards.map(() => generation) },
      localRegions: { count: localShards.length, total: cache.localRegions.length, generations: localShards.map(() => generation) }
    },
    fingerprintShards,
    noteShards,
    localShards
  };
}
function joinSemanticCache(manifest, fingerprintShards, noteShards, localShards) {
  if (!isDiskManifest(manifest)) throw new Error("Malformed semantic cache manifest.");
  if (manifest.manifestVersion !== CACHE_MANIFEST_VERSION) throw new Error(`Unsupported cache manifest version ${manifest.manifestVersion}.`);
  return {
    ...joinCoreSemanticCache(manifest, fingerprintShards, noteShards),
    ...joinLocalSemanticCache(manifest, localShards)
  };
}
function joinCoreSemanticCache(manifest, fingerprintShards, noteShards) {
  return {
    header: manifest.header,
    fingerprints: joinFingerprintShards(manifest, fingerprintShards),
    notes: joinNoteShards(manifest, noteShards)
  };
}
function joinLocalSemanticCache(manifest, localShards) {
  return {
    header: manifest.header,
    localRegions: joinLocalShards(manifest, localShards)
  };
}
function joinFingerprintShards(manifest, shards) {
  if (shards.length !== manifest.fingerprints.count) throw new Error("Semantic cache fingerprint shard count mismatch.");
  const ordered = new Array(shards.length);
  for (const raw of shards) {
    if (!isObject(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || raw.generation !== expectedShardGeneration(manifest.fingerprints, raw.index, manifest.generation) || !Array.isArray(raw.fingerprints)) {
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
    if (!isObject(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || raw.generation !== expectedShardGeneration(manifest.notes, raw.index, manifest.generation) || !Array.isArray(raw.notes)) {
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
    if (!isObject(raw) || typeof raw.index !== "number" || !Number.isInteger(raw.index) || raw.index < 0 || raw.index >= shards.length || raw.generation !== expectedShardGeneration(manifest.localRegions, raw.index, manifest.generation) || !Array.isArray(raw.localRegions)) {
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
  if (!isObject(v) || !Number.isInteger(v.count) || !Number.isInteger(v.total) || v.count < 0 || v.total < 0) return false;
  if (v.generations === void 0) return true;
  return Array.isArray(v.generations) && v.generations.length === v.count && v.generations.every((generation) => typeof generation === "string" && generation.length > 0);
}
function expectedShardGeneration(set, index, fallback) {
  return set.generations?.[index] ?? fallback;
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
var MAX_INCREMENTAL_RECONCILIATION_PATHS = 300;
function reconciliationMode(plan, incrementalLimit = MAX_INCREMENTAL_RECONCILIATION_PATHS) {
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
    const path = `${slotRoot}/fingerprints-${pad(shard.index)}.json`;
    sharded.manifest.fingerprints.generations[shard.index] = await writeShardIfChanged(storage, path, shard, "fingerprints");
  }
  for (const shard of sharded.noteShards) {
    const path = `${slotRoot}/notes-${pad(shard.index)}.json`;
    sharded.manifest.notes.generations[shard.index] = await writeShardIfChanged(storage, path, shard, "notes");
  }
  for (const shard of sharded.localShards) {
    const path = `${slotRoot}/local-${pad(shard.index)}.json`;
    sharded.manifest.localRegions.generations[shard.index] = await writeShardIfChanged(storage, path, shard, "localRegions");
  }
  await storage.write(cacheManifestPaths(clean)[slot], JSON.stringify(sharded.manifest));
  return sharded.manifest;
}
async function cacheCandidates(storage, clean) {
  const manifests = await readManifestSlots(storage, clean);
  return manifests.flatMap((x, slot) => x.manifest ? [{ slot, manifest: x.manifest }] : []).sort(
    (a, b) => b.manifest.sequence - a.manifest.sequence || b.manifest.header.createdAt - a.manifest.header.createdAt || b.manifest.generation.localeCompare(a.manifest.generation)
  );
}
async function readCoreCacheGeneration(storage, root) {
  const clean = cleanRoot(root);
  const candidates = await cacheCandidates(storage, clean);
  if (!candidates.length) throw new Error("No semantic cache manifest is available.");
  const errors = [];
  for (const { slot, manifest } of candidates) {
    try {
      assertGeneration(manifest.generation);
      const slotRoot = cacheSlotPaths(clean)[slot];
      const [fingerprintShards, noteShards] = await Promise.all([
        readJsonSeries(storage, Array.from({ length: manifest.fingerprints.count }, (_, i) => `${slotRoot}/fingerprints-${pad(i)}.json`)),
        readJsonSeries(storage, Array.from({ length: manifest.notes.count }, (_, i) => `${slotRoot}/notes-${pad(i)}.json`))
      ]);
      return joinCoreSemanticCache(manifest, fingerprintShards, noteShards);
    } catch (e) {
      errors.push(`${MANIFEST_NAMES[slot]}: ${e.message}`);
    }
  }
  throw new Error(`No complete core semantic cache generation is readable. ${errors.join(" | ")}`);
}
async function readSemanticCacheGeneration(storage, root) {
  const clean = cleanRoot(root);
  const candidates = await cacheCandidates(storage, clean);
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
async function writeShardIfChanged(storage, path, desired, payloadKey) {
  const desiredPayload = desired[payloadKey];
  try {
    const existing = JSON.parse(await storage.read(path));
    if (isObject2(existing) && typeof existing.generation === "string" && typeof existing.index === "number" && existing.index === desired.index && Array.isArray(existing[payloadKey]) && Array.isArray(desiredPayload) && JSON.stringify(existing[payloadKey]) === JSON.stringify(desiredPayload)) {
      assertGeneration(existing.generation);
      return existing.generation;
    }
  } catch {
  }
  await storage.write(path, JSON.stringify(desired));
  return desired.generation;
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
  const shardSet = (x) => {
    if (!Number.isInteger(x.count) || x.count < 0 || !Number.isInteger(x.total) || x.total < 0) return false;
    if (x.generations === void 0) return true;
    return Array.isArray(x.generations) && x.generations.length === x.count && x.generations.every((generation) => typeof generation === "string" && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(generation));
  };
  return shardSet(v.fingerprints) && shardSet(v.notes) && shardSet(v.localRegions) && typeof v.header.createdAt === "number";
}

// src/core/edit-availability.ts
function editingBlockedReason(coreReady, schema) {
  if (!coreReady) return "Workbench is still indexing; try again in a moment.";
  if (!schema) return "Workbench schema is not available.";
  if (editingBlocked(schema)) return "The vault's schema is older than this Workbench supports, so editing is off.";
  return null;
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
  if (!profileNeedsLocalOccurrences(profile)) return base3;
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

// src/core/relationship-dependencies.ts
var TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES = 1e4;
function shouldUseFullRelationshipReresolution(candidateCount) {
  return candidateCount > TARGETED_RELATIONSHIP_RERESOLUTION_MAX_CANDIDATES;
}
var ReversePathDependencyIndex = class {
  constructor() {
    this.byTarget = /* @__PURE__ */ new Map();
    this.byAuthoredKey = /* @__PURE__ */ new Map();
    this.bySource = /* @__PURE__ */ new Map();
    this.authoredBySource = /* @__PURE__ */ new Map();
  }
  set(sourcePath, targetPaths, authoredLinkpaths = []) {
    this.remove(sourcePath);
    const targets = new Set([...targetPaths].filter((path) => path && path !== sourcePath));
    if (targets.size) {
      this.bySource.set(sourcePath, targets);
      for (const target of targets) addReverse(this.byTarget, target, sourcePath);
    }
    const authoredKeys = /* @__PURE__ */ new Set();
    for (const linkpath of authoredLinkpaths) for (const key2 of linkpathKeys(linkpath)) authoredKeys.add(key2);
    if (authoredKeys.size) {
      this.authoredBySource.set(sourcePath, authoredKeys);
      for (const key2 of authoredKeys) addReverse(this.byAuthoredKey, key2, sourcePath);
    }
  }
  remove(sourcePath) {
    removeReverseSource(this.byTarget, this.bySource.get(sourcePath), sourcePath);
    removeReverseSource(this.byAuthoredKey, this.authoredBySource.get(sourcePath), sourcePath);
    this.bySource.delete(sourcePath);
    this.authoredBySource.delete(sourcePath);
  }
  dependentsOf(targetPaths) {
    const out = /* @__PURE__ */ new Set();
    for (const target of targetPaths) {
      for (const source of this.byTarget.get(target) ?? []) out.add(source);
    }
    return [...out].sort();
  }
  /**
   * Conservative candidate lookup for add/delete/rename. It unions currently resolved target
   * dependencies with authored linkpath keys so newly resolvable links are not missed.
   */
  candidatesForPathChanges(paths) {
    const out = new Set(this.dependentsOf(paths));
    for (const path of paths) {
      for (const key2 of linkpathKeys(path)) {
        for (const source of this.byAuthoredKey.get(key2) ?? []) out.add(source);
      }
    }
    return [...out].sort();
  }
  /**
   * Per-path candidate fan-out used for runtime measurement. This is deliberately diagnostic:
   * it does not choose targeted vs full reconciliation and does not alter dependency semantics.
   */
  candidateFanOutForPathChanges(paths) {
    return [...new Set(paths)].sort().map((path) => ({ path, candidates: this.candidatesForPathChanges([path]).length }));
  }
  targetsOf(sourcePath) {
    return [...this.bySource.get(sourcePath) ?? []].sort();
  }
  clear() {
    this.byTarget.clear();
    this.byAuthoredKey.clear();
    this.bySource.clear();
    this.authoredBySource.clear();
  }
  get targetCount() {
    return this.byTarget.size;
  }
  get sourceCount() {
    return (/* @__PURE__ */ new Set([...this.bySource.keys(), ...this.authoredBySource.keys()])).size;
  }
  /**
   * Exact structural size of the derived accelerator.
   *
   * Memory growth is bounded by current source evidence rather than edit history: set() removes a
   * source's prior entries before replacing them. Each resolved source-target association appears
   * once in bySource and once in byTarget. Each normalized authored-key association appears once
   * in authoredBySource and once in byAuthoredKey. linkpathKeys() yields at most two keys.
   */
  size() {
    let resolvedAssociations = 0;
    for (const targets of this.bySource.values()) resolvedAssociations += targets.size;
    let authoredAssociations = 0;
    for (const keys of this.authoredBySource.values()) authoredAssociations += keys.size;
    return {
      sources: this.sourceCount,
      resolvedTargetKeys: this.byTarget.size,
      authoredKeys: this.byAuthoredKey.size,
      resolvedAssociations,
      authoredAssociations,
      storedMemberships: 2 * (resolvedAssociations + authoredAssociations)
    };
  }
  /**
   * Fail-closed consistency check for the derived reverse dependency surface.
   *
   * The index is only safe for targeted invalidation when every canonical source-side entry
   * is mirrored by the matching reverse entry and every reverse entry points back to canonical
   * source-side evidence. Any mismatch means the derived accelerator may be incomplete.
   */
  consistency(expected = []) {
    const issues = [];
    for (const [source, targets] of this.bySource) {
      for (const target of targets) {
        if (!(this.byTarget.get(target)?.has(source) ?? false)) {
          issues.push(`missing reverse target entry: ${source} -> ${target}`);
        }
      }
    }
    for (const [target, sources] of this.byTarget) {
      for (const source of sources) {
        if (!(this.bySource.get(source)?.has(target) ?? false)) {
          issues.push(`orphan reverse target entry: ${target} <- ${source}`);
        }
      }
    }
    for (const [source, keys] of this.authoredBySource) {
      for (const key2 of keys) {
        if (!(this.byAuthoredKey.get(key2)?.has(source) ?? false)) {
          issues.push(`missing reverse authored entry: ${source} -> ${key2}`);
        }
      }
    }
    for (const [key2, sources] of this.byAuthoredKey) {
      for (const source of sources) {
        if (!(this.authoredBySource.get(source)?.has(key2) ?? false)) {
          issues.push(`orphan reverse authored entry: ${key2} <- ${source}`);
        }
      }
    }
    for (const row of expected) {
      const expectedTargets = new Set([...row.targetPaths].filter((path) => path && path !== row.sourcePath));
      const actualTargets = this.bySource.get(row.sourcePath) ?? /* @__PURE__ */ new Set();
      if (!sameSet(expectedTargets, actualTargets)) {
        issues.push(`target evidence mismatch for ${row.sourcePath}`);
      }
      const expectedAuthored = /* @__PURE__ */ new Set();
      for (const linkpath of row.authoredLinkpaths ?? []) {
        for (const key2 of linkpathKeys(linkpath)) expectedAuthored.add(key2);
      }
      const actualAuthored = this.authoredBySource.get(row.sourcePath) ?? /* @__PURE__ */ new Set();
      if (!sameSet(expectedAuthored, actualAuthored)) {
        issues.push(`authored evidence mismatch for ${row.sourcePath}`);
      }
    }
    return { complete: issues.length === 0, issues };
  }
};
function addReverse(index, key2, sourcePath) {
  let sources = index.get(key2);
  if (!sources) index.set(key2, sources = /* @__PURE__ */ new Set());
  sources.add(sourcePath);
}
function removeReverseSource(index, keys, sourcePath) {
  if (!keys) return;
  for (const key2 of keys) {
    const sources = index.get(key2);
    if (!sources) continue;
    sources.delete(sourcePath);
    if (!sources.size) index.delete(key2);
  }
}
function linkpathKeys(value) {
  const withoutAlias = value.split("|", 1)[0];
  const withoutFragment = withoutAlias.split("#", 1)[0];
  const clean = withoutFragment.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\.md$/i, "").toLowerCase();
  if (!clean) return [];
  const slash = clean.lastIndexOf("/");
  const base3 = slash >= 0 ? clean.slice(slash + 1) : clean;
  return base3 === clean ? [clean] : [clean, base3];
}
function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const value of a) if (!b.has(value)) return false;
  return true;
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

// src/core/metadata-burst.ts
var MetadataChangeBurst = class {
  constructor(windowMs) {
    this.windowMs = windowMs;
    this.startedAt = 0;
    this.paths = /* @__PURE__ */ new Set();
    if (!(windowMs > 0) || !Number.isFinite(windowMs)) throw new Error("Metadata burst window must be a positive finite number.");
  }
  record(path, now) {
    if (!this.startedAt || now - this.startedAt > this.windowMs) {
      this.startedAt = now;
      this.paths.clear();
    }
    const distinct = !this.paths.has(path);
    this.paths.add(path);
    return { distinct, uniquePaths: this.paths.size };
  }
  reset() {
    this.startedAt = 0;
    this.paths.clear();
  }
};

// src/core/hydration-cancel.ts
function requeueHydrationPaths(deferred, active) {
  return [.../* @__PURE__ */ new Set([...deferred, ...active])].sort();
}

// src/core/single-flight.ts
var SingleFlightByKey = class {
  constructor() {
    this.active = /* @__PURE__ */ new Map();
  }
  get size() {
    return this.active.size;
  }
  keys() {
    return [...this.active.keys()];
  }
  get(key2) {
    return this.active.get(key2);
  }
  run(key2, start) {
    const existing = this.active.get(key2);
    if (existing) return existing;
    let task;
    task = start().finally(() => {
      if (this.active.get(key2) === task) this.active.delete(key2);
    });
    this.active.set(key2, task);
    return task;
  }
  clear() {
    this.active.clear();
  }
};

// src/core/occurrence-hydration.ts
function shouldPauseBackgroundOccurrence(state) {
  return !state.demanded && (!state.backgroundIdle || state.liveUpdatePending > 0 || state.requestedActive > 0);
}
function canPublishOccurrence(epoch, currentEpoch, revision, currentRevision) {
  return epoch === currentEpoch && currentRevision === revision;
}

// src/core/local-retention.ts
var DEFAULT_LOCAL_REGION_RETENTION_LIMIT = 256;
function localRegionEvictions(oldestToNewest, protectedPaths, limit = DEFAULT_LOCAL_REGION_RETENTION_LIMIT) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error("Local region retention limit must be a positive integer.");
  let retained = oldestToNewest.length;
  if (retained <= limit) return [];
  const evict = [];
  for (const path of oldestToNewest) {
    if (retained <= limit) break;
    if (protectedPaths.has(path)) continue;
    evict.push(path);
    retained--;
  }
  return evict;
}

// src/core/hydration-metrics.ts
function summarizeHydrationCosts(costs) {
  const rows = [...costs];
  if (!rows.length) return { owners: 0, averageMs: 0, maxMs: 0, maxPath: null, averageReadMs: 0, averageParseMs: 0 };
  let total = 0;
  let read = 0;
  let parse = 0;
  let max = rows[0];
  for (const row of rows) {
    total += row.totalMs;
    read += row.readMs;
    parse += row.parseMs;
    if (row.totalMs > max.totalMs || row.totalMs === max.totalMs && row.path.localeCompare(max.path) < 0) max = row;
  }
  return {
    owners: rows.length,
    averageMs: total / rows.length,
    maxMs: max.totalMs,
    maxPath: max.path,
    averageReadMs: read / rows.length,
    averageParseMs: parse / rows.length
  };
}

// src/core/source-reconciliation.ts
function hasPendingSourceReconciliation(state) {
  return state.building || state.rebuildPending || state.livePending > 0 || state.liveApplyTimerPending || state.liveApplyActive || state.relationshipResolvePending || state.relationshipResolveTimerPending || state.relationshipResolveActive;
}

// src/obsidian/indexer.ts
var CHUNK = 500;
var LOCAL_BLOCK_PREFIX = /^(part|ep|conn|flow)-/;
var BURST_REBUILD = 300;
var METADATA_BURST_WINDOW_MS = 1e4;
var QUIET_MS = 3e3;
var LIVE_DEBOUNCE_MS = 250;
var WORK_SLICE_MS = UI_WORK_SLICE_BUDGET_MS;
var yieldToUi = () => new Promise((resolve) => window.setTimeout(resolve, 0));
var RELATIONSHIP_RERESOLUTION_HISTORY_LIMIT = 20;
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
    this.metadataBurst = new MetadataChangeBurst(METADATA_BURST_WINDOW_MS);
    this.timer = null;
    /** Prevents a slower cachedRead from overwriting a newer Local Model edit. */
    this.localRevision = /* @__PURE__ */ new Map();
    /** Body reads started by incremental Local Model updates; consumers can wait for semantic consistency. */
    this.pendingLocalReads = /* @__PURE__ */ new Set();
    this.requestedLocalReads = /* @__PURE__ */ new Set();
    this.requestedHydrationPaths = /* @__PURE__ */ new Set();
    /** Shared owner body reads across background and requested occurrence hydration. */
    this.occurrenceReadFlights = new SingleFlightByKey();
    /** Monotonic in-session semantic revision used to coalesce disposable cache writes. */
    this.semanticRevision = 0;
    /** Paths whose derived cache buckets no longer match the last committed cache generation. */
    this.cacheDirtyPaths = /* @__PURE__ */ new Set();
    /** Cold-build Local Model hydration is deliberately decoupled from core note-graph readiness. */
    this.hydrationEpoch = 0;
    this.hydrationTask = null;
    /** Remaining owners in the active bulk hydration; retained so cancellation can requeue them. */
    this.activeHydrationPaths = [];
    this.deferredHydrationPaths = [];
    /** Evicted occurrence regions stay cold until an explicit occurrence consumer asks for them. */
    this.coldLocalPaths = /* @__PURE__ */ new Set();
    this.deferredHydrationEpoch = 0;
    /** Background occurrence hydration pauses while foreground activity resumes; explicit consumers promote it. */
    this.hydrationDemanded = false;
    this.backgroundIdle = () => true;
    this.hydrationRemaining = 0;
    this.hydrationStartedAt = null;
    this.lastHydrationMsValue = null;
    this.lastHydrationCandidatesValue = 0;
    /** Latest per-owner occurrence hydration cost; one row per owner, not an unbounded history. */
    this.hydrationCosts = /* @__PURE__ */ new Map();
    /** Read failures are scoped findings; they never make ordinary Markdown unusable. */
    this.localReadErrors = /* @__PURE__ */ new Map();
    /** Hydration/use recency for bounded steady-state Local Model retention. */
    this.localRetentionOrder = /* @__PURE__ */ new Map();
    this.localRetentionClock = 0;
    /** Rapid live edits are coalesced so one keystroke burst does not trigger repeated Local Model body reads. */
    this.livePending = /* @__PURE__ */ new Set();
    this.liveApplyTimer = null;
    this.liveApplyTask = null;
    /** Derived target-path → source-note lookup for targeted relationship re-resolution. */
    this.relationshipDependencies = new ReversePathDependencyIndex();
    /** Path-set changes can alter Obsidian wikilink resolution in otherwise unchanged notes. */
    this.relationshipResolveTimer = null;
    this.relationshipResolveTask = null;
    this.relationshipResolvePending = false;
    this.relationshipPathChanges = /* @__PURE__ */ new Set();
    /** Bounded in-memory evidence for path-set relationship invalidation fan-out (stability Step 33). */
    this.relationshipReresolutionHistoryValue = [];
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
    return this.hydrationRemaining + this.requestedLocalReads.size;
  }
  get localHydrationDemanded() {
    return this.requestedLocalReads.size > 0 || this.hydrationDemanded && (this.hydrationTask !== null || this.deferredHydrationPaths.length > 0);
  }
  get liveUpdatePending() {
    return this.livePending.size + (this.liveApplyTask ? 1 : 0);
  }
  get sourceReconciliationPending() {
    return hasPendingSourceReconciliation({
      building: this.building,
      rebuildPending: this.rebuildPending,
      livePending: this.livePending.size,
      liveApplyTimerPending: this.liveApplyTimer !== null,
      liveApplyActive: this.liveApplyTask !== null,
      relationshipResolvePending: this.relationshipResolvePending,
      relationshipResolveTimerPending: this.relationshipResolveTimer !== null,
      relationshipResolveActive: this.relationshipResolveTask !== null
    });
  }
  /** Wait until note/path semantics and relationship resolution are stable before deriving a view. */
  async whenSourceSettled() {
    while (this.sourceReconciliationPending) {
      const work = [];
      if (this.running) work.push(this.running);
      if (this.liveApplyTask) work.push(this.liveApplyTask);
      if (this.relationshipResolveTask) work.push(this.relationshipResolveTask);
      if (work.length) await Promise.all(work);
      else await new Promise((r) => window.setTimeout(r, 50));
    }
  }
  get lastLocalHydrationMs() {
    return this.lastHydrationMsValue;
  }
  get lastLocalHydrationCandidates() {
    return this.lastHydrationCandidatesValue;
  }
  get relationshipReresolutionHistory() {
    return this.relationshipReresolutionHistoryValue.map((sample) => ({
      ...sample,
      changedPaths: [...sample.changedPaths],
      fanOut: sample.fanOut.map((row) => ({ ...row }))
    }));
  }
  get lastRelationshipReresolution() {
    const sample = this.relationshipReresolutionHistoryValue[this.relationshipReresolutionHistoryValue.length - 1];
    return sample ? { ...sample, changedPaths: [...sample.changedPaths], fanOut: sample.fanOut.map((row) => ({ ...row })) } : null;
  }
  get relationshipDependencySize() {
    return this.relationshipDependencies.size();
  }
  recordRelationshipReresolution(sample) {
    this.relationshipReresolutionHistoryValue.push(sample);
    if (this.relationshipReresolutionHistoryValue.length > RELATIONSHIP_RERESOLUTION_HISTORY_LIMIT) {
      this.relationshipReresolutionHistoryValue.splice(
        0,
        this.relationshipReresolutionHistoryValue.length - RELATIONSHIP_RERESOLUTION_HISTORY_LIMIT
      );
    }
  }
  get localHydrationCostSummary() {
    return summarizeHydrationCosts(this.hydrationCosts.values());
  }
  hydrationCost(path) {
    const row = this.hydrationCosts.get(path);
    return row ? { ...row } : void 0;
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
  measureHydration(path, text, readStartedAt, readFinishedAt) {
    const parseStartedAt = performance.now();
    const region = parseLocalModel(text);
    const parseFinishedAt = performance.now();
    this.hydrationCosts.set(path, {
      path,
      readMs: readFinishedAt - readStartedAt,
      parseMs: parseFinishedAt - parseStartedAt,
      totalMs: parseFinishedAt - readStartedAt,
      bytes: new TextEncoder().encode(text).byteLength,
      records: region?.records.length ?? 0
    });
    return region;
  }
  setLocalRegion(path, region) {
    this.local.set(path, region);
    if (region) this.localRetentionOrder.set(path, ++this.localRetentionClock);
    else this.localRetentionOrder.delete(path);
  }
  removeLocalRegion(path) {
    this.local.remove(path);
    this.localRetentionOrder.delete(path);
  }
  /**
   * Return steady-state occurrence memory to a bounded size. Evicted regions remain discoverable
   * from authoritative Markdown and are requeued for future hydration.
   */
  trimLocalRetention(protectedPaths = [], limit = DEFAULT_LOCAL_REGION_RETENTION_LIMIT) {
    const ordered = [...this.local.regions.keys()].sort((a, b) => (this.localRetentionOrder.get(a) ?? 0) - (this.localRetentionOrder.get(b) ?? 0) || a.localeCompare(b));
    const evict = localRegionEvictions(ordered, new Set(protectedPaths), limit);
    if (!evict.length) return 0;
    for (const path of evict) {
      this.removeLocalRegion(path);
      const file = this.app.vault.getAbstractFileByPath(path);
      if (file instanceof import_obsidian.TFile && file.extension === "md" && this.mayHaveLocalModel(file)) this.coldLocalPaths.add(path);
    }
    return evict.length;
  }
  get localRetainedRegionCount() {
    return this.local.regions.size;
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
  occurrenceBody(path, file) {
    return this.occurrenceReadFlights.run(path, async () => {
      const readStartedAt = performance.now();
      const text = await this.app.vault.cachedRead(file);
      const readFinishedAt = performance.now();
      return { text, readStartedAt, readFinishedAt };
    });
  }
  /**
   * Invalidate in-flight occurrence hydration immediately when source semantics change.
   * Unfinished bulk owners return to the deferred queue. Epoch/revision guards prevent reads
   * already in flight from publishing stale occurrence data.
   */
  cancelOccurrenceHydration() {
    if (!this.hydrationTask && !this.requestedLocalReads.size) return;
    this.hydrationEpoch++;
    this.deferredHydrationPaths = requeueHydrationPaths(
      this.deferredHydrationPaths,
      [...this.activeHydrationPaths, ...this.requestedHydrationPaths]
    );
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationDemanded = false;
    this.hydrationRemaining = 0;
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
    if (demanded && this.coldLocalPaths.size) {
      this.deferredHydrationPaths = requeueHydrationPaths(this.deferredHydrationPaths, [...this.coldLocalPaths]);
      this.coldLocalPaths.clear();
      this.deferredHydrationEpoch = this.hydrationEpoch;
    }
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
  /**
   * Hydrate only the Local Model regions owned by the requested Object notes.
   * This is the foreground path for occurrence-aware views that already know their owners.
   * Unrelated deferred regions stay queued for background hydration.
   */
  async hydrateLocalOwners(paths) {
    const unique = [...new Set(paths)].sort();
    if (!unique.length) return;
    while (true) {
      const wanted = new Set(unique);
      this.deferredHydrationPaths = this.deferredHydrationPaths.filter((path) => !wanted.has(path));
      for (const path of wanted) this.coldLocalPaths.delete(path);
      const epoch = this.hydrationEpoch;
      const budget = new CooperativeBudget(WORK_SLICE_MS);
      for (const path of unique) {
        if (epoch !== this.hydrationEpoch) break;
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian.TFile) || file.extension !== "md" || !this.mayHaveLocalModel(file)) continue;
        const revision = (this.localRevision.get(path) ?? 0) + 1;
        this.localRevision.set(path, revision);
        this.requestedHydrationPaths.add(path);
        const task = (async () => {
          try {
            const { text, readStartedAt, readFinishedAt } = await this.occurrenceBody(path, file);
            if (!canPublishOccurrence(epoch, this.hydrationEpoch, revision, this.localRevision.get(path))) return;
            this.setLocalRegion(path, this.measureHydration(path, text, readStartedAt, readFinishedAt));
            this.localReadErrors.delete(path);
            this.bumpRevision(path);
          } catch (e) {
            if (!canPublishOccurrence(epoch, this.hydrationEpoch, revision, this.localRevision.get(path))) return;
            this.localReadErrors.set(path, e.message);
            this.bumpRevision(path);
          } finally {
            this.requestedHydrationPaths.delete(path);
          }
        })();
        this.requestedLocalReads.add(task);
        try {
          await task;
        } finally {
          this.requestedLocalReads.delete(task);
        }
        await budget.checkpoint(yieldToUi);
      }
      if (epoch === this.hydrationEpoch) return;
      await this.whenSourceSettled();
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
    this.index = new ModelIndex(schema);
    this.relationshipDependencies.clear();
    this.relationshipReresolutionHistoryValue = [];
    this.stats = null;
    this.cacheDirtyPaths.clear();
    this.bumpRevision();
  }
  /**
   * Drop any provisional restored/reconciled semantic state before the recovery cold build.
   *
   * Warm restore is an optimization only. If it fails or loses its reconciliation race, no
   * restored graph, reverse dependency evidence, fingerprints, Local Model state, or readiness
   * statistics may remain observable while authoritative Markdown is rebuilt cooperatively.
   */
  async discardProvisionalSemanticState() {
    this.liveChanges = false;
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.liveApplyTimer !== null) {
      window.clearTimeout(this.liveApplyTimer);
      this.liveApplyTimer = null;
    }
    if (this.relationshipResolveTimer !== null) {
      window.clearTimeout(this.relationshipResolveTimer);
      this.relationshipResolveTimer = null;
    }
    this.relationshipResolvePending = false;
    this.relationshipPathChanges.clear();
    const active = [];
    if (this.liveApplyTask) active.push(this.liveApplyTask);
    if (this.relationshipResolveTask) active.push(this.relationshipResolveTask);
    if (active.length) await Promise.allSettled(active);
    this.cancelOccurrenceHydration();
    this.hydrationEpoch++;
    this.localRevision.clear();
    this.index = new ModelIndex(this.schema);
    this.relationshipDependencies.clear();
    this.relationshipReresolutionHistoryValue = [];
    this.local = new LocalModelIndex();
    this.hydrationCosts.clear();
    this.coldLocalPaths.clear();
    this.localRetentionOrder.clear();
    this.localRetentionClock = 0;
    this.deferredHydrationPaths = [];
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationRemaining = 0;
    this.lastHydrationMsValue = null;
    this.lastHydrationCandidatesValue = 0;
    this.localReadErrors.clear();
    this.fingerprints.clear();
    this.dirty.clear();
    this.livePending.clear();
    this.cacheDirtyPaths.clear();
    this.stats = null;
    this.metadataBurst.reset();
    this.bumpRevision();
  }
  relationshipDependentsOf(paths) {
    return this.relationshipDependencies.dependentsOf(paths);
  }
  relationshipCandidatesForPathChanges(paths) {
    return this.relationshipDependencies.candidatesForPathChanges(paths);
  }
  relationshipTargets(rec) {
    const targets = /* @__PURE__ */ new Set();
    for (const values of rec.fields.values()) for (const path of values) targets.add(path);
    for (const ref of rec.localRefs ?? []) targets.add(ref.path);
    return [...targets];
  }
  syncRelationshipDependency(rec, sourcePath) {
    if (!rec) {
      this.relationshipDependencies.remove(sourcePath);
      return;
    }
    this.relationshipDependencies.set(sourcePath, this.relationshipTargets(rec), (rec.authoredLinks ?? []).map((link) => link.linkpath));
  }
  rebuildRelationshipDependencies() {
    this.relationshipDependencies.clear();
    for (const rec of this.index.notes.values()) this.syncRelationshipDependency(rec, rec.path);
  }
  relationshipDependencyConsistency() {
    const expected = [];
    for (const rec of this.index.notes.values()) {
      if (!rec.authoredLinks) {
        return {
          complete: false,
          issues: [`missing authored relationship evidence for ${rec.path}`]
        };
      }
      expected.push({
        sourcePath: rec.path,
        targetPaths: this.relationshipTargets(rec),
        authoredLinkpaths: rec.authoredLinks.map((link) => link.linkpath)
      });
    }
    return this.relationshipDependencies.consistency(expected);
  }
  /**
   * Install only the core semantic cache. Local Model regions remain deferred and are discovered
   * from Obsidian metadata without reading note bodies.
   */
  installRestoredCore(state, createdAt) {
    if (this.running) throw new Error("Cannot install restored state while indexing is active.");
    this.hydrationEpoch++;
    this.hydrationTask = null;
    this.hydrationDemanded = false;
    this.requestedLocalReads.clear();
    this.occurrenceReadFlights.clear();
    this.requestedHydrationPaths.clear();
    this.local = new LocalModelIndex();
    this.hydrationCosts.clear();
    this.coldLocalPaths.clear();
    this.localRetentionOrder.clear();
    this.localRetentionClock = 0;
    this.deferredHydrationPaths = this.app.vault.getMarkdownFiles().filter((file) => this.mayHaveLocalModel(file)).map((file) => file.path).sort();
    this.deferredHydrationEpoch = this.hydrationEpoch;
    this.hydrationRemaining = 0;
    this.hydrationStartedAt = null;
    this.lastHydrationMsValue = null;
    this.lastHydrationCandidatesValue = this.deferredHydrationPaths.length;
    this.localReadErrors.clear();
    this.index = state.index;
    this.rebuildRelationshipDependencies();
    this.fingerprints.clear();
    for (const [path, fp] of state.fingerprints) this.fingerprints.set(path, { ...fp });
    this.dirty.clear();
    this.cacheDirtyPaths.clear();
    this.metadataBurst.reset();
    this.bumpRevision();
    this.stats = this.makeStats("restored", 0, createdAt);
    return this.stats;
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
    this.rebuildRelationshipDependencies();
    this.local = state.local;
    this.fingerprints.clear();
    for (const [path, fp] of state.fingerprints) this.fingerprints.set(path, { ...fp });
    this.dirty.clear();
    this.cacheDirtyPaths.clear();
    this.metadataBurst.reset();
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
      this.relationshipDependencies.remove(path);
      this.removeLocalRegion(path);
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
    if (plan.added.length || plan.deleted.length) {
      const consistency = this.relationshipDependencyConsistency();
      if (!consistency.complete) {
        throw new Error(`Relationship dependency evidence is incomplete or inconsistent; full rebuild required: ${consistency.issues[0] ?? "unknown mismatch"}`);
      }
      const changedPaths = [...plan.added, ...plan.deleted];
      const fanOut = this.relationshipDependencies.candidateFanOutForPathChanges(changedPaths);
      const candidates = this.relationshipDependencies.candidatesForPathChanges(changedPaths);
      const full = shouldUseFullRelationshipReresolution(candidates.length);
      const startedAt = performance.now();
      const changedSourceCount = await this.reResolveRelationships(full ? void 0 : candidates);
      this.recordRelationshipReresolution({
        at: Date.now(),
        mode: full ? "full" : "targeted",
        changedPaths,
        fanOut,
        candidateCount: candidates.length,
        changedSourceCount,
        elapsedMs: performance.now() - startedAt
      });
    }
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
  async reResolveRelationships(sourcePaths) {
    const wanted = sourcePaths ? new Set(sourcePaths) : null;
    const notes = wanted ? [...wanted].map((path) => this.index.notes.get(path)).filter((rec) => !!rec) : [...this.index.notes.values()];
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
        const next = {
          ...rec,
          fields: resolved.fields,
          unresolved: resolved.unresolved,
          broken: resolved.broken,
          repeat: resolved.repeat,
          localRefs: resolved.localRefs
        };
        this.index.upsert(next);
        this.syncRelationshipDependency(next, rec.path);
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
  scheduleRelationshipReresolution(paths = []) {
    if (!this.liveChanges) return;
    for (const path of paths) this.relationshipPathChanges.add(path);
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
    const changedPaths = [...this.relationshipPathChanges].sort();
    this.relationshipPathChanges.clear();
    const consistency = this.relationshipDependencyConsistency();
    if (!consistency.complete) {
      this.scheduleRebuild();
      return;
    }
    const fanOut = this.relationshipDependencies.candidateFanOutForPathChanges(changedPaths);
    const candidates = this.relationshipDependencies.candidatesForPathChanges(changedPaths);
    const full = shouldUseFullRelationshipReresolution(candidates.length);
    const startedAt = performance.now();
    task = this.reResolveRelationships(full ? void 0 : candidates).then((changedSourceCount) => {
      this.recordRelationshipReresolution({
        at: Date.now(),
        mode: full ? "full" : "targeted",
        changedPaths,
        fanOut,
        candidateCount: candidates.length,
        changedSourceCount,
        elapsedMs: performance.now() - startedAt
      });
    }).finally(() => {
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
    this.syncRelationshipDependency(rec, path);
    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    if (this.mayHaveLocalModel(file)) {
      try {
        const text = await this.app.vault.cachedRead(file);
        if (this.localRevision.get(path) === revision) {
          this.setLocalRegion(path, parseLocalModel(text));
          this.localReadErrors.delete(path);
        }
      } catch (e) {
        if (this.localRevision.get(path) === revision) {
          this.removeLocalRegion(path);
          this.localReadErrors.set(path, e.message);
        }
      }
    } else {
      this.removeLocalRegion(path);
      this.localReadErrors.delete(path);
    }
    this.bumpRevision(path);
  }
  /**
   * Parse only notes prefiltered by Obsidian metadata as Local Model candidates. This runs after
   * the core note graph is already usable. Occurrence-aware consumers call whenLocalSettled().
   */
  startLocalHydration(files, epoch) {
    this.activeHydrationPaths = files.map((file) => file.path);
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
        while (shouldPauseBackgroundOccurrence({
          demanded: this.hydrationDemanded,
          backgroundIdle: this.backgroundIdle(),
          liveUpdatePending: this.liveUpdatePending,
          requestedActive: this.requestedLocalReads.size
        })) {
          await new Promise((r) => window.setTimeout(r, 250));
          if (epoch !== this.hydrationEpoch) return;
        }
        const file = files[i];
        const path = file.path;
        this.activeHydrationPaths = files.slice(i).map((candidate) => candidate.path);
        const revision = (this.localRevision.get(path) ?? 0) + 1;
        this.localRevision.set(path, revision);
        try {
          const { text, readStartedAt, readFinishedAt } = await this.occurrenceBody(path, file);
          if (canPublishOccurrence(epoch, this.hydrationEpoch, revision, this.localRevision.get(path))) {
            this.setLocalRegion(path, this.measureHydration(path, text, readStartedAt, readFinishedAt));
            this.localReadErrors.delete(path);
            this.cacheDirtyPaths.add(path);
            changed = true;
          }
        } catch (e) {
          if (canPublishOccurrence(epoch, this.hydrationEpoch, revision, this.localRevision.get(path))) {
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
        this.activeHydrationPaths = [];
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
    this.rebuildRelationshipDependencies();
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
    this.metadataBurst.reset();
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
    this.syncRelationshipDependency(rec, path);
    this.applyLocal(path, f instanceof import_obsidian.TFile ? f : null);
    this.bumpRevision(path);
  }
  /** Update one governed Local Model region without rebuilding the whole vault. */
  applyLocal(path, file) {
    const revision = (this.localRevision.get(path) ?? 0) + 1;
    this.localRevision.set(path, revision);
    if (!file || !this.mayHaveLocalModel(file)) {
      this.removeLocalRegion(path);
      this.localReadErrors.delete(path);
      return;
    }
    let task;
    task = this.app.vault.cachedRead(file).then((text) => {
      if (this.localRevision.get(path) !== revision) return;
      this.setLocalRegion(path, parseLocalModel(text));
      this.localReadErrors.delete(path);
      this.bumpRevision(path);
    }).catch((e) => {
      if (this.localRevision.get(path) !== revision) return;
      this.removeLocalRegion(path);
      this.localReadErrors.set(path, e.message);
      this.bumpRevision(path);
    }).finally(() => this.pendingLocalReads.delete(task));
    this.pendingLocalReads.add(task);
  }
  /** One file changed or was created. Rapid events are coalesced by path. */
  changed(path) {
    if (!this.liveChanges) return;
    this.cancelOccurrenceHydration();
    if (!this.stats || this.running) {
      this.dirty.add(path);
      return;
    }
    this.livePending.add(path);
    const burst = this.metadataBurst.record(path, Date.now());
    if (burst.uniquePaths >= BURST_REBUILD || this.livePending.size >= BURST_REBUILD) {
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
      const pathSetChanges = [];
      const liveBudget = new CooperativeBudget(WORK_SLICE_MS);
      for (let i = 0; i < paths.length; i++) {
        const path = paths[i];
        const existed = this.fingerprints.has(path);
        this.apply(path);
        const existsNow = this.fingerprints.has(path);
        if (existed !== existsNow) pathSetChanges.push(path);
        await liveBudget.checkpoint(yieldToUi);
      }
      if (pathSetChanges.length) this.scheduleRelationshipReresolution(pathSetChanges);
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
    this.relationshipPathChanges.clear();
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
var LocalPartCreateModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, localId, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.localId = localId;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.renderCompose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try {
        this.cancel(staged.transaction.id);
      } catch {
      }
    }
  }
  renderCompose() {
    this.titleEl.setText("Add part occurrence");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Create a contextual part occurrence inside ${this.ownerName}. Nothing is written until Review \u2192 Apply.`
    });
    const field = (label, value = "", placeholder = "") => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => e.stopPropagation();
      return input;
    };
    const heading = field("Occurrence name", "", "K1");
    const definition = field("Reusable definition", "", "[[Main Contactor]]");
    const usage = field("Usage", "standard", "standard");
    const multiplicity = field("Multiplicity", "", "optional");
    const id = this.contentEl.createEl("p", { cls: "mdse-muted", text: `Local ID: ${this.localId}` });
    id.setAttr("title", "Generated from the governed timestamp + author-suffix identity format.");
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          const fields = {
            definition: definition.value.trim()
          };
          if (usage.value.trim() && usage.value.trim() !== "standard") fields.usage = usage.value.trim();
          if (multiplicity.value.trim()) fields.multiplicity = multiplicity.value.trim();
          const staged = await this.stage({
            kind: "part",
            localId: this.localId,
            heading: heading.value.trim(),
            fields
          });
          this.staged = staged;
          this.renderReview(staged, {
            heading: heading.value.trim(),
            definition: definition.value.trim(),
            usage: usage.value.trim() || "standard",
            multiplicity: multiplicity.value.trim()
          });
        } catch (e) {
          new import_obsidian3.Notice(`Cannot stage occurrence: ${e.message}`, 12e3);
          review.disabled = false;
        }
      })();
    };
  }
  renderReview(staged, values) {
    this.titleEl.setText("Review new part occurrence");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const row = (key2, value) => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value || "\u2014" });
    };
    row("Owner", this.ownerName);
    row("Transaction", staged.transaction.label);
    row("Scope", staged.transaction.scope);
    row("Occurrence", values.heading);
    row("Reusable definition", values.definition);
    row("Usage", values.usage);
    row("Multiplicity", values.multiplicity);
    row("Local ID", staged.plan.localId);
    const findings = staged.plan.findings;
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (findings.length) {
      const box = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      box.createEl("strong", { text: blocking.length ? "Validation findings" : "Validation warnings" });
      for (const finding of findings) {
        box.createEl("p", {
          text: `${finding.severity.toUpperCase()}: ${finding.message}`,
          cls: finding.severity === "error" ? "mdse-warn" : void 0
        });
      }
    } else {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will write one structural Local Model change." });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.setAttr("title", blocking.length ? "Resolve blocking validation findings before Apply." : "Apply this staged structural change.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied(staged.plan.localId);
          new import_obsidian3.Notice(`Created part occurrence ${values.heading}.`, 5e3);
        } catch (e) {
          new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
          apply.disabled = false;
        }
      })();
    };
  }
};
var LocalOccurrenceDeleteModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, occurrenceName, occurrenceKind, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.occurrenceName = occurrenceName;
    this.occurrenceKind = occurrenceKind;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText(`Review ${this.occurrenceKind} occurrence deletion`);
    void this.load();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try {
        this.cancel(staged.transaction.id);
      } catch {
      }
    }
  }
  async load() {
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: "Checking structural dependencies before anything is changed\u2026" });
    try {
      const staged = await this.stage();
      this.staged = staged;
      this.renderReview(staged);
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `Cannot stage deletion: ${e.message}` });
      const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons.createEl("button", { text: "Close" }).onclick = () => this.close();
    }
  }
  renderReview(staged) {
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const row = (key2, value) => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value || "\u2014" });
    };
    row("Owner", this.ownerName);
    row("Occurrence", this.occurrenceName);
    row("Transaction", staged.transaction.label);
    row("Scope", staged.transaction.scope);
    row("Local ID", staged.plan.localId);
    const localImpacts = staged.plan.impacts;
    const externalImpacts = staged.externalImpacts;
    const blockingFindings = staged.plan.findings.filter((finding) => finding.severity === "error");
    const blocked = localImpacts.length + externalImpacts.length + blockingFindings.length > 0;
    const impactBox = this.contentEl.createDiv({ cls: "mdse-detail-state" });
    if (!blocked) {
      impactBox.createEl("strong", { text: "Impact review passed" });
      impactBox.createEl("p", { text: "No Local Model or indexed note-level references depend on this occurrence." });
    } else {
      impactBox.createEl("strong", { text: "Deletion blocked by dependencies" });
      for (const impact of localImpacts) {
        impactBox.createEl("p", {
          cls: "mdse-warn",
          text: `LOCAL: ${impact.sourceKind} "${impact.sourceIdentifier}" uses this occurrence through ${impact.field}.`
        });
      }
      for (const impact of externalImpacts) {
        impactBox.createEl("p", {
          cls: "mdse-warn",
          text: `MODEL: ${impact.path} targets this occurrence through ${impact.field}.`
        });
      }
      for (const finding of blockingFindings) {
        impactBox.createEl("p", { cls: "mdse-warn", text: `ERROR: ${finding.message}` });
      }
    }
    const warnings = staged.plan.findings.filter((finding) => finding.severity === "warning");
    if (warnings.length) {
      const warningBox = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      warningBox.createEl("strong", { text: "Warnings" });
      for (const finding of warnings) warningBox.createEl("p", { text: finding.message });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply deletion", cls: "mod-warning" });
    apply.disabled = blocked;
    apply.setAttr("title", blocked ? "Remove dependent references before deleting this occurrence." : "Delete this occurrence.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied();
          new import_obsidian3.Notice(`Deleted ${this.occurrenceKind} occurrence ${this.occurrenceName}.`, 5e3);
        } catch (e) {
          new import_obsidian3.Notice(`Not deleted: ${e.message}`, 12e3);
          apply.disabled = false;
        }
      })();
    };
  }
};
var LocalEndpointCreateModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, partName, partLocalId, localId, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.partName = partName;
    this.partLocalId = partLocalId;
    this.localId = localId;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.renderCompose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) {
      try {
        this.cancel(staged.transaction.id);
      } catch {
      }
    }
  }
  renderCompose() {
    this.titleEl.setText("Add endpoint occurrence");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Create an endpoint occurrence on part ${this.partName} in ${this.ownerName}. Parent/exposes/connection topology is intentionally deferred.`
    });
    const field = (label, value = "", placeholder = "") => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => e.stopPropagation();
      return input;
    };
    const heading = field("Endpoint name", "", "J1");
    const definition = field("Reusable definition", "", "[[CAN Port]]");
    const endpointKind = field("Endpoint kind", "", "physical");
    const usage = field("Usage", "standard", "standard");
    const multiplicity = field("Multiplicity", "", "optional");
    const part = this.contentEl.createEl("p", { cls: "mdse-muted", text: `Attached part: ${this.partName} (#^${this.partLocalId})` });
    part.setAttr("title", "The part relationship is fixed for this creation slice.");
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Local ID: ${this.localId}` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          const fields = {
            definition: definition.value.trim(),
            part: `[[#^${this.partLocalId}|${this.partName}]]`
          };
          if (endpointKind.value.trim()) fields.kind = endpointKind.value.trim();
          if (usage.value.trim() && usage.value.trim() !== "standard") fields.usage = usage.value.trim();
          if (multiplicity.value.trim()) fields.multiplicity = multiplicity.value.trim();
          const staged = await this.stage({
            kind: "endpoint",
            localId: this.localId,
            heading: heading.value.trim(),
            fields
          });
          this.staged = staged;
          this.renderReview(staged, {
            heading: heading.value.trim(),
            definition: definition.value.trim(),
            endpointKind: endpointKind.value.trim(),
            usage: usage.value.trim() || "standard",
            multiplicity: multiplicity.value.trim()
          });
        } catch (e) {
          new import_obsidian3.Notice(`Cannot stage endpoint: ${e.message}`, 12e3);
          review.disabled = false;
        }
      })();
    };
  }
  renderReview(staged, values) {
    this.titleEl.setText("Review new endpoint occurrence");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const row = (key2, value) => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value || "\u2014" });
    };
    row("Owner", this.ownerName);
    row("Part", this.partName);
    row("Transaction", staged.transaction.label);
    row("Scope", staged.transaction.scope);
    row("Endpoint", values.heading);
    row("Reusable definition", values.definition);
    row("Endpoint kind", values.endpointKind);
    row("Usage", values.usage);
    row("Multiplicity", values.multiplicity);
    row("Local ID", staged.plan.localId);
    const findings = staged.plan.findings;
    const blocking = findings.filter((finding) => finding.severity === "error");
    if (findings.length) {
      const box = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      box.createEl("strong", { text: blocking.length ? "Validation findings" : "Validation warnings" });
      for (const finding of findings) {
        box.createEl("p", {
          text: `${finding.severity.toUpperCase()}: ${finding.message}`,
          cls: finding.severity === "error" ? "mdse-warn" : void 0
        });
      }
    } else {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will add one endpoint occurrence attached to the selected part." });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied(staged.plan.localId);
          new import_obsidian3.Notice(`Created endpoint occurrence ${values.heading}.`, 5e3);
        } catch (e) {
          new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
          apply.disabled = false;
        }
      })();
    };
  }
};
var LocalConnectionCreateModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, source, options, localId, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.source = source;
    this.options = options;
    this.localId = localId;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.compose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try {
      this.cancel(staged.transaction.id);
    } catch {
    }
  }
  compose() {
    this.titleEl.setText("Add connection");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Connect ${this.source.identifier} to another endpoint in ${this.ownerName}. Flows are not created here.` });
    const input = (label, placeholder = "") => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const el = row.createEl("input", { type: "text", cls: "mdse-detail-input" });
      if (placeholder) el.setAttr("placeholder", placeholder);
      el.onkeydown = (e) => e.stopPropagation();
      return el;
    };
    const heading = input("Connection name", "Harness");
    const definition = input("Reusable definition", "optional");
    const pickRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    pickRow.createEl("label", { text: "Endpoint B" });
    const pick = pickRow.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose endpoint\u2026", value: "" });
    for (const ep of this.options) pick.createEl("option", { text: ep.identifier, value: ep.localId });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const target = this.options.find((ep) => ep.localId === pick.value);
        if (!target) throw new Error("Choose a second endpoint.");
        const fields = {
          endpointA: `[[#^${this.source.localId}|${this.source.identifier}]]`,
          endpointB: `[[#^${target.localId}|${target.identifier}]]`
        };
        if (definition.value.trim()) fields.definition = definition.value.trim();
        const staged = await this.stage({ kind: "connection", localId: this.localId, heading: heading.value.trim(), fields });
        this.staged = staged;
        this.review(staged, heading.value.trim(), definition.value.trim(), target);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage connection: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
  }
  review(staged, heading, definition, target) {
    this.titleEl.setText("Review new connection");
    this.contentEl.empty();
    const rows = [
      ["Owner", this.ownerName],
      ["Connection", heading],
      ["Endpoint A", this.source.identifier],
      ["Endpoint B", target.identifier],
      ["Reusable definition", definition],
      ["Local ID", staged.plan.localId]
    ];
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    for (const [k, v] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v || "\u2014" });
    }
    const blocking = staged.plan.findings.filter((f) => f.severity === "error");
    for (const f of staged.plan.findings) this.contentEl.createEl("p", { text: `${f.severity.toUpperCase()}: ${f.message}`, cls: f.severity === "error" ? "mdse-warn" : void 0 });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied(staged.plan.localId);
        new import_obsidian3.Notice(`Created connection ${heading}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalFlowCreateModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, connection, localId, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.connection = connection;
    this.localId = localId;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.compose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try {
      this.cancel(staged.transaction.id);
    } catch {
    }
  }
  compose() {
    this.titleEl.setText("Add flow");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Create a flow under connection ${this.connection.identifier} in ${this.ownerName}.` });
    const input = (label, placeholder = "") => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const el = row.createEl("input", { type: "text", cls: "mdse-detail-input" });
      if (placeholder) el.setAttr("placeholder", placeholder);
      el.onkeydown = (e) => e.stopPropagation();
      return el;
    };
    const heading = input("Flow name", "Commands");
    const definition = input("Reusable definition", "[[CAN Data]]");
    const roleA = input("Endpoint A role", "transmit");
    const roleB = input("Endpoint B role", "receive");
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Owning connection: ${this.connection.identifier} (#^${this.connection.localId})` });
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Local ID: ${this.localId}` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const staged = await this.stage({
          kind: "flow",
          localId: this.localId,
          connectionId: this.connection.localId,
          heading: heading.value.trim(),
          fields: {
            definition: definition.value.trim(),
            endpointA: roleA.value.trim(),
            endpointB: roleB.value.trim()
          }
        });
        this.staged = staged;
        this.review(staged, heading.value.trim(), definition.value.trim(), roleA.value.trim(), roleB.value.trim());
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage flow: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
  }
  review(staged, heading, definition, roleA, roleB) {
    this.titleEl.setText("Review new flow");
    this.contentEl.empty();
    const rows = [
      ["Owner", this.ownerName],
      ["Connection", this.connection.identifier],
      ["Flow", heading],
      ["Reusable definition", definition],
      ["Endpoint A role", roleA],
      ["Endpoint B role", roleB],
      ["Local ID", staged.plan.localId]
    ];
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    for (const [k, v] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v || "\u2014" });
    }
    const blocking = staged.plan.findings.filter((f) => f.severity === "error");
    for (const f of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${f.severity.toUpperCase()}: ${f.message}`, cls: f.severity === "error" ? "mdse-warn" : void 0 });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied(staged.plan.localId);
        new import_obsidian3.Notice(`Created flow ${heading}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalEndpointPartReassignModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, endpoint2, parts, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.endpoint = endpoint2;
    this.parts = parts;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.compose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try {
      this.cancel(staged.transaction.id);
    } catch {
    }
  }
  compose() {
    this.titleEl.setText("Reassign endpoint part");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Move endpoint ${this.endpoint.identifier} to another existing part occurrence in ${this.ownerName}.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "New part" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose part\u2026", value: "" });
    for (const part of this.parts) {
      pick.createEl("option", { text: `${part.identifier} \u2014 ^${part.localId}`, value: part.localId });
    }
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const target = this.parts.find((part) => part.localId === pick.value);
        if (!target) throw new Error("Choose a target part.");
        const staged = await this.stage(target);
        this.staged = staged;
        this.renderReview(staged, target);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage part reassignment: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
  }
  renderReview(staged, target) {
    this.titleEl.setText("Review endpoint part reassignment");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["New part", target.identifier],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [k, v] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v });
    }
    const blocking = staged.plan.findings.filter((f) => f.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint part assignment." });
    } else {
      for (const f of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${f.severity.toUpperCase()}: ${f.message}`, cls: f.severity === "error" ? "mdse-warn" : void 0 });
      }
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new import_obsidian3.Notice(`Reassigned endpoint ${this.endpoint.identifier} to ${target.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalEndpointParentReassignModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, endpoint2, endpoints, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.endpoint = endpoint2;
    this.endpoints = endpoints;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.compose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try {
      this.cancel(staged.transaction.id);
    } catch {
    }
  }
  compose() {
    this.titleEl.setText("Change endpoint parent");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Select another endpoint in ${this.ownerName} as the parent of ${this.endpoint.identifier}, or clear the parent relationship. Assigning a parent clears any direct part assignment because part and parent are mutually exclusive.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Parent endpoint" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose parent\u2026", value: "" });
    if (this.endpoint.parent) pick.createEl("option", { text: "Clear parent", value: "__clear__" });
    for (const candidate of this.endpoints) {
      pick.createEl("option", { text: `${candidate.identifier} \u2014 ^${candidate.localId}`, value: candidate.localId });
    }
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const target = pick.value === "__clear__" ? null : this.endpoints.find((candidate) => candidate.localId === pick.value);
        if (pick.value !== "__clear__" && !target) throw new Error("Choose a parent endpoint.");
        const staged = await this.stage(target ?? null);
        this.staged = staged;
        this.renderReview(staged, target ?? null);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage parent reassignment: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
  }
  renderReview(staged, target) {
    this.titleEl.setText("Review endpoint parent reassignment");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["New parent", target?.identifier ?? "none"],
      ["Direct part", target && this.endpoint.part ? "cleared" : this.endpoint.part?.alias ?? this.endpoint.part?.text ?? "none"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint parent assignment." });
    } else {
      for (const finding of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : void 0 });
      }
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new import_obsidian3.Notice(target ? `Reassigned endpoint ${this.endpoint.identifier} parent to ${target.identifier}.` : `Cleared parent from endpoint ${this.endpoint.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalEndpointExposureEditModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, endpoint2, addOptions, removeOptions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.endpoint = endpoint2;
    this.addOptions = addOptions;
    this.removeOptions = removeOptions;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.compose();
  }
  onClose() {
    const staged = this.staged;
    this.staged = null;
    this.contentEl.empty();
    if (staged && !this.applied) try {
      this.cancel(staged.transaction.id);
    } catch {
    }
  }
  compose() {
    this.titleEl.setText("Edit endpoint exposures");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Add or remove one same-note endpoint exposure for ${this.endpoint.identifier}. Existing equals and connection topology are not changed.` });
    const modeRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    modeRow.createEl("label", { text: "Change" });
    const mode = modeRow.createEl("select", { cls: "mdse-detail-input" });
    if (this.addOptions.length) mode.createEl("option", { text: "Add exposure", value: "add" });
    if (this.removeOptions.length) mode.createEl("option", { text: "Remove exposure", value: "remove" });
    const targetRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    targetRow.createEl("label", { text: "Endpoint" });
    const target = targetRow.createEl("select", { cls: "mdse-detail-input" });
    const refill = () => {
      target.empty();
      const options = mode.value === "remove" ? this.removeOptions : this.addOptions;
      target.createEl("option", { text: "Choose endpoint\u2026", value: "" });
      for (const option of options) {
        target.createEl("option", { text: `${option.identifier} \u2014 ^${option.localId}`, value: option.localId });
      }
    };
    mode.onchange = refill;
    refill();
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Endpoint: ${this.endpoint.identifier} (#^${this.endpoint.localId})` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const editMode = mode.value === "remove" ? "remove" : "add";
        const options = editMode === "remove" ? this.removeOptions : this.addOptions;
        const selected = options.find((option) => option.localId === target.value);
        if (!selected) throw new Error("Choose an endpoint.");
        const staged = await this.stage(editMode, selected);
        this.staged = staged;
        this.renderReview(staged, editMode, selected);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage exposure edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
  }
  renderReview(staged, mode, target) {
    this.titleEl.setText("Review endpoint exposure edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["Change", mode === "add" ? "add exposure" : "remove exposure"],
      ["Target endpoint", target.identifier],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint exposes field." });
    } else {
      for (const finding of staged.plan.findings) {
        this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : void 0 });
      }
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => {
      try {
        this.cancel(staged.transaction.id);
      } finally {
        this.staged = null;
        this.close();
      }
    };
    const apply = buttons.createEl("button", { text: "Apply", cls: "mod-cta" });
    apply.disabled = blocking.length > 0;
    apply.onclick = () => void (async () => {
      apply.disabled = true;
      try {
        await this.apply(staged.transaction.id);
        this.applied = true;
        this.staged = null;
        this.close();
        this.onApplied();
        new import_obsidian3.Notice(`${mode === "add" ? "Added" : "Removed"} exposure ${this.endpoint.identifier} \u2192 ${target.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
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
  /** WB-105/WB-106/WB-114: contextual Local Model details with safe atomic editing. */
  showLocal(file, record, editMode = false) {
    if (this.isDirty()) {
      new ConfirmModal(this.app, `Discard the unsaved text changes to ${this.current?.basename ?? "this note"}?`, "Discard", () => {
        this.bodyArea = null;
        this.showLocal(file, record, editMode);
      }).open();
      return;
    }
    this.generation++;
    this.current = file;
    this.currentLocal = record;
    const blocked = this.host.editBlocked();
    const localBlocked = record.sourceSchemaVersion !== "0.2" ? `Local Model schema ${record.sourceSchemaVersion || "unknown"} is read-only. Structured writes require schema 0.2.` : blocked;
    this.editing = editMode && !localBlocked;
    this.bodyArea = null;
    this.renderer?.unload();
    this.renderer = null;
    const root = this.ensure();
    root.empty();
    root.toggleClass("mdse-detail-editing", this.editing);
    const head = root.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: record.identifier }).setAttr("title", `${file.path}#^${record.localId}`);
    const edit = head.createEl("button", { text: this.editing ? "Done" : "Edit context", cls: this.editing ? "mdse-detail-btn mod-cta" : "mdse-detail-btn" });
    if (localBlocked && !this.editing) {
      edit.disabled = true;
      edit.setAttr("title", localBlocked);
    }
    edit.onclick = () => this.showLocal(file, record, !this.editing);
    if (this.editing) {
      const undo = head.createEl("button", { text: "Undo", cls: "mdse-detail-btn", attr: { title: "Undo the last Workbench edit" } });
      undo.disabled = !this.host.writer()?.canUndo;
      undo.onclick = async () => {
        await this.host.undo();
        await this.refreshLocal(file, record.localId, true);
      };
    }
    if (this.editing) {
      const addPart = head.createEl("button", { text: "Add part occurrence\u2026", cls: "mdse-detail-btn" });
      addPart.onclick = () => this.createPartOccurrence(file);
    }
    if (this.editing && record.kind === "part") {
      const addEndpoint = head.createEl("button", { text: "Add endpoint\u2026", cls: "mdse-detail-btn" });
      addEndpoint.onclick = () => this.createEndpointOccurrence(file, record);
    }
    if (this.editing && record.kind === "endpoint") {
      const reassignPart = head.createEl("button", { text: "Change part\u2026", cls: "mdse-detail-btn" });
      reassignPart.onclick = () => {
        void this.reassignEndpointPart(file, record);
      };
      const reassignParent = head.createEl("button", { text: "Change parent\u2026", cls: "mdse-detail-btn" });
      reassignParent.onclick = () => {
        void this.reassignEndpointParent(file, record);
      };
      const exposures = head.createEl("button", { text: "Edit exposures\u2026", cls: "mdse-detail-btn" });
      exposures.onclick = () => {
        void this.editEndpointExposures(file, record);
      };
      const connect = head.createEl("button", { text: "Connect to endpoint\u2026", cls: "mdse-detail-btn" });
      connect.onclick = () => {
        void this.createConnectionOccurrence(file, record);
      };
    }
    if (this.editing && record.kind === "connection") {
      const addFlow = head.createEl("button", { text: "Add flow\u2026", cls: "mdse-detail-btn" });
      addFlow.onclick = () => this.createFlowOccurrence(file, record);
    }
    if (this.editing && (record.kind === "part" || record.kind === "endpoint" || record.kind === "connection" || record.kind === "flow")) {
      const deleteOccurrence = head.createEl("button", { text: "Delete occurrence\u2026", cls: "mdse-detail-btn" });
      deleteOccurrence.onclick = () => this.deleteOccurrence(file, record);
    }
    const owner = head.createEl("button", { text: "Open owner", cls: "mdse-detail-btn" });
    owner.onclick = () => void this.app.workspace.getLeaf(true).openFile(file);
    const occurrence = head.createEl("button", { text: "Open occurrence", cls: "mdse-detail-btn" });
    occurrence.onclick = () => void this.app.workspace.openLinkText(`${file.path.replace(/\.md$/i, "")}#^${record.localId}`, file.path, true);
    head.createEl("button", { text: "\xD7", cls: "mdse-detail-btn", attr: { "aria-label": "Close" } }).onclick = () => this.close();
    const chips = root.createDiv({ cls: "mdse-detail-chips" });
    chips.createSpan({ cls: "mdse-detail-chip", text: record.kind });
    chips.createSpan({ cls: "mdse-detail-chip", text: "context" });
    if (record.usage !== "standard") chips.createSpan({ cls: "mdse-detail-chip", text: record.usage });
    if (record.endpointKind) chips.createSpan({ cls: "mdse-detail-chip", text: record.endpointKind });
    if (this.editing) chips.createSpan({ cls: "mdse-detail-chip mdse-detail-chip-edit", text: "editing context" });
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
    const editRow = (key2, value, patch, placeholder = "") => {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      const td = tr.createEl("td");
      const input = td.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => {
        if (e.key === "Enter") input.blur();
        e.stopPropagation();
      };
      input.onchange = () => void this.saveLocalPatch(file, record, patch(input.value));
    };
    const linkText = (r) => r?.text ?? "";
    const open = (r) => r?.target ? () => void this.app.workspace.openLinkText(r.target, file.path, true) : void 0;
    row("Owner", file.basename, () => void this.app.workspace.getLeaf(true).openFile(file));
    row("Local ID", record.localId);
    if (this.editing) editRow("Occurrence name", record.identifier, (value) => ({ heading: value }));
    else row("Occurrence name", record.identifier);
    row("Reusable definition", linkText(record.definition), open(record.definition));
    if (record.definition?.target) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: "Definition editing" });
      const td = tr.createEl("td");
      const button = td.createEl("button", { text: "Open definition", cls: "mdse-detail-btn" });
      button.setAttr("title", "Definition properties belong to the reusable definition note, not this occurrence context.");
      button.onclick = () => void this.app.workspace.openLinkText(record.definition.target, file.path, true);
    }
    if (this.editing && (record.kind === "part" || record.kind === "endpoint")) {
      editRow("Usage", record.usage, (value) => ({ fields: { usage: value } }), "standard");
      editRow("Multiplicity", record.multiplicity ?? "", (value) => ({ fields: { multiplicity: value || null } }));
    } else {
      row("Usage", record.usage !== "standard" ? record.usage : "");
      row("Multiplicity", record.multiplicity ?? "");
    }
    if (record.kind === "endpoint" && this.editing) {
      editRow("Endpoint kind", record.endpointKind ?? "", (value) => ({ fields: { kind: value || null } }));
    } else row("Endpoint kind", record.endpointKind ?? "");
    row("Part", linkText(record.part));
    row("Parent endpoint", linkText(record.parent));
    if (record.exposes.length) row("Exposes", record.exposes.map((r) => r.text).join(", "));
    if (record.equals.length) row("Equals (temporary)", record.equals.map((r) => r.text).join(", "));
    if (record.kind !== "flow") {
      row("Endpoint A", linkText(record.endpointA));
      row("Endpoint B", linkText(record.endpointB));
    }
    row("Connection", record.connectionId ?? "");
    if (record.kind === "flow") {
      if (this.editing) {
        editRow("Endpoint A role", record.roleA ?? "", (value) => ({ fields: { endpointA: value } }));
        editRow("Endpoint B role", record.roleB ?? "", (value) => ({ fields: { endpointB: value } }));
      } else {
        row("Endpoint A role", record.roleA ?? "");
        row("Endpoint B role", record.roleB ?? "");
      }
    }
    root.createEl("p", {
      cls: "mdse-muted",
      text: this.editing ? "Editing context only. Definition identity and structural/topology links remain separate and read-only here." : "This is contextual occurrence data stored in the owner note. Open the reusable definition separately to edit definition-level data."
    });
    root.scrollTop = 0;
  }
  async editEndpointExposures(file, endpoint2) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const endpoints = region.records.filter((record) => record.kind === "endpoint" && record.localId !== endpoint2.localId);
      const exposedIds = new Set(endpoint2.exposes.filter((link) => !link.target && link.blockId).map((link) => link.blockId));
      const addOptions = endpoints.filter((candidate) => !exposedIds.has(candidate.localId));
      const removeOptions = endpoints.filter((candidate) => exposedIds.has(candidate.localId));
      if (!addOptions.length && !removeOptions.length) throw new Error("This endpoint has no same-note exposure edit available.");
      new LocalEndpointExposureEditModal(
        this.app,
        file.basename,
        endpoint2,
        addOptions,
        removeOptions,
        (mode, target) => {
          const remaining = endpoint2.exposes.filter((link) => !(mode === "remove" && !link.target && link.blockId === target.localId)).map((link) => link.text);
          if (mode === "add") remaining.push(`[[#^${target.localId}|${target.identifier}]]`);
          return editor.stageLocalRecordPatch(file.path, endpoint2.localId, {
            fields: { exposes: remaining.length ? remaining.join(" ") : null }
          });
        },
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, endpoint2.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot edit endpoint exposures: ${e.message}`, 12e3);
    }
  }
  async reassignEndpointParent(file, endpoint2) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const currentParentId = endpoint2.parent?.blockId ?? "";
      const endpoints = region.records.filter(
        (record) => record.kind === "endpoint" && record.localId !== endpoint2.localId && record.localId !== currentParentId
      );
      if (!endpoints.length && !currentParentId) throw new Error("This note has no alternate endpoint occurrence to use as a parent.");
      new LocalEndpointParentReassignModal(
        this.app,
        file.basename,
        endpoint2,
        endpoints,
        (parent) => editor.stageLocalRecordPatch(file.path, endpoint2.localId, {
          fields: parent ? { parent: `[[#^${parent.localId}|${parent.identifier}]]`, part: null } : { parent: null }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, endpoint2.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot reassign endpoint parent: ${e.message}`, 12e3);
    }
  }
  async reassignEndpointPart(file, endpoint2) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const currentPartId = endpoint2.part?.blockId ?? "";
      const parts = region.records.filter((record) => record.kind === "part" && record.localId !== currentPartId);
      if (!parts.length) throw new Error("This note has no alternate part occurrence.");
      new LocalEndpointPartReassignModal(
        this.app,
        file.basename,
        endpoint2,
        parts,
        (part) => editor.stageLocalRecordPatch(file.path, endpoint2.localId, {
          fields: { part: `[[#^${part.localId}|${part.identifier}]]` }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, endpoint2.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot reassign endpoint part: ${e.message}`, 12e3);
    }
  }
  createFlowOccurrence(file, connection) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextLocalId("flow", ownerUid);
      new LocalFlowCreateModal(
        this.app,
        file.basename,
        connection,
        localId,
        (input) => editor.stageLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => {
          editor.cancelLocalCreate(transactionId);
        },
        (createdId) => {
          void this.refreshLocal(file, createdId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot create flow: ${e.message}`, 12e3);
    }
  }
  async createConnectionOccurrence(file, source) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const options = region.records.filter((record) => record.kind === "endpoint" && record.localId !== source.localId);
      if (!options.length) throw new Error("This note has no second endpoint occurrence to connect.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextLocalId("connection", ownerUid);
      new LocalConnectionCreateModal(
        this.app,
        file.basename,
        source,
        options,
        localId,
        (input) => editor.stageLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => {
          editor.cancelLocalCreate(transactionId);
        },
        (createdId) => {
          void this.refreshLocal(file, createdId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot create connection: ${e.message}`, 12e3);
    }
  }
  createEndpointOccurrence(file, part) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextLocalId("endpoint", ownerUid);
      new LocalEndpointCreateModal(
        this.app,
        file.basename,
        part.identifier,
        part.localId,
        localId,
        (input) => editor.stageLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => {
          editor.cancelLocalCreate(transactionId);
        },
        (createdId) => {
          void this.refreshLocal(file, createdId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot create endpoint: ${e.message}`, 12e3);
    }
  }
  deleteOccurrence(file, record) {
    if (record.kind !== "part" && record.kind !== "endpoint" && record.kind !== "connection" && record.kind !== "flow") return;
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalOccurrenceDeleteModal(
        this.app,
        file.basename,
        record.identifier,
        record.kind,
        () => editor.stageLocalRecordDelete(file.path, record.localId),
        (transactionId) => editor.applyLocalDelete(transactionId),
        (transactionId) => {
          editor.cancelLocalDelete(transactionId);
        },
        () => {
          void this.show(file, false);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot delete occurrence: ${e.message}`, 12e3);
    }
  }
  createPartOccurrence(file) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextLocalId("part", ownerUid);
      new LocalPartCreateModal(
        this.app,
        file.basename,
        localId,
        (input) => editor.stageLocalRecordCreate(file.path, input),
        (transactionId) => editor.applyLocalCreate(transactionId),
        (transactionId) => {
          editor.cancelLocalCreate(transactionId);
        },
        (createdId) => {
          void this.refreshLocal(file, createdId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot create occurrence: ${e.message}`, 12e3);
    }
  }
  async saveLocalPatch(file, record, patch) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const result = await editor.patchLocalRecord(file.path, record.localId, patch);
      if (result.changed) new import_obsidian4.Notice(`Saved context for ${record.identifier}.`, 3e3);
      await this.refreshLocal(file, record.localId, true);
    } catch (e) {
      new import_obsidian4.Notice(`Not saved: ${e.message}`, 12e3);
      await this.refreshLocal(file, record.localId, true);
    }
  }
  async refreshLocal(file, localId, editMode) {
    const text = await this.app.vault.read(file);
    const refreshed = parseLocalModel(text)?.records.find((candidate) => candidate.localId === localId);
    if (!refreshed) {
      new import_obsidian4.Notice(`Local Model record ${localId} is no longer present in ${file.basename}.`, 8e3);
      this.close();
      return;
    }
    this.showLocal(file, refreshed, editMode);
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
async function workbenchCacheSizeBytes(app) {
  const adapter = app.vault.adapter;
  if (!await adapter.exists(WORKBENCH_CACHE_ROOT)) return 0;
  try {
    return await cacheTreeSizeBytes(adapter, WORKBENCH_CACHE_ROOT);
  } catch {
    return null;
  }
}

// src/obsidian/assurance.ts
var AssuranceManager = class {
  constructor(source) {
    this.source = source;
    this.cached = null;
    this.running = null;
  }
  get active() {
    return this.running !== null;
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
    const task = this.compute(force);
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
  async compute(force) {
    let last = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      if ((!force || attempt > 0) && this.source.waitForBackgroundPermission) {
        await this.source.waitForBackgroundPermission();
      }
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
    /** Context edits apply atomically; structural Local Model part/endpoint create/delete, connection create/delete, flow create/delete, and endpoint part/parent reassignment use explicit Review / Apply / Cancel. */
    this.modelEditor = null;
    /** One semantic history stack for every Workbench model writer (WB-114). */
    this.transactions = new TransactionManager();
    this.detail = null;
    this.statusEl = null;
    this.cancelStartupHandoff = null;
    this.healthRefreshTimer = null;
    this.localBackgroundTimer = null;
    this.cacheWriteTimer = null;
    this.cacheWriteTask = null;
    this.cacheMutationGate = new CacheMutationGate();
    this.lastCacheWriteAt = null;
    this.lastCacheWriteMs = null;
    this.lastCacheWriteError = null;
    this.lastSchemaError = null;
    this.lastCoreError = null;
    this.lastOccurrenceError = null;
    this.lastCachedRevision = null;
    this.lastWarmRestore = null;
    this.assurance = null;
    this.lastStartupWaitMs = null;
    this.lastTimeToCoreReadyMs = null;
    this.lastTimeToOccurrenceReadyMs = null;
    this.startupRunStartedAt = null;
    /** Explicit publication gate: restored/build stats are internal until source validation settles. */
    this.coreReadyPublished = false;
    this.startPromise = null;
    this.pendingRebuild = false;
    /** Last foreground model/UI activity; background subsystems share this preemption signal. */
    this.lastChange = Date.now();
    /** First time each optional background lane became pending; intermittent edits must not starve it forever. */
    this.backgroundPendingSince = /* @__PURE__ */ new Map();
    /** Latched once Obsidian says its metadata/link-resolution pass is complete. */
    this.metadataResolved = false;
    /** Disposable integration-vault probe; absent in normal vaults. */
    this.integrationProbe = null;
    this.integrationPluginLoadedAt = null;
    this.integrationMetadataResolvedAt = null;
    this.integrationMetadataCoverageAt = null;
    this.unloaded = false;
  }
  async onload() {
    const stored = await this.loadData() ?? {};
    this.settings = { ...DEFAULTS, ...stored.settings ?? {} };
    this.views = stored.views ?? {};
    this.runtimeHistory = Array.isArray(stored.runtimeHistory) ? stored.runtimeHistory.slice(-20) : [];
    await this.loadIntegrationProbe();
    this.addSettingTab(new WorkbenchSettings(this.app, this));
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("mod-clickable");
    this.registerDomEvent(this.statusEl, "click", () => this.showRuntimeHealth());
    this.setRuntimeStatus("starting");
    this.detail = new NoteDetailPanel(this.app, {
      schema: () => this.schema,
      writer: () => this.writer,
      modelEditor: () => this.modelEditor,
      editBlocked: () => editingBlockedReason(this.isReady(), this.schema),
      elements: (exclude) => this.elements().filter((r) => r.path !== exclude),
      relate: (a, b) => this.relate(a, b),
      undo: () => this.undo(),
      pickView: (path) => this.pickView(path)
    });
    this.addChild(this.detail);
    this.registerDetailClicks();
    this.addCommand({
      id: "diagnostics",
      name: "Show diagnostics",
      checkCallback: (checking) => {
        if (!this.isReady()) return false;
        if (!checking) void this.diagnostics();
        return true;
      }
    });
    this.addCommand({ id: "runtime-health", name: "Show runtime health", callback: () => this.showRuntimeHealth() });
    this.addCommand({ id: "runtime-history", name: "Show runtime history", callback: () => this.showRuntimeHistory() });
    this.addCommand({
      id: "inspect-semantic-cache",
      name: "Inspect semantic cache",
      checkCallback: (checking) => {
        if (!this.isReady()) return false;
        if (!checking) void this.inspectSemanticCache();
        return true;
      }
    });
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
    this.addCommand({ id: "redo", name: "Redo last Workbench edit", callback: () => this.redo() });
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
      if (this.integrationProbe && this.integrationMetadataResolvedAt === null) {
        this.integrationMetadataResolvedAt = Date.now();
      }
      this.indexer?.linkResolutionSettled();
    }));
    this.register(() => {
      this.unloaded = true;
      this.cancelStartupHandoff?.();
      this.cancelStartupHandoff = null;
      if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
      if (this.healthRefreshTimer !== null) window.clearTimeout(this.healthRefreshTimer);
      if (this.localBackgroundTimer !== null) window.clearTimeout(this.localBackgroundTimer);
    });
    this.app.workspace.onLayoutReady(() => {
      const handoff = scheduleStartupHandoff(
        (run) => window.setTimeout(run, 0),
        (handle) => window.clearTimeout(handle),
        () => {
          this.cancelStartupHandoff = null;
          if (!this.unloaded) void this.start(false);
        }
      );
      this.cancelStartupHandoff = handoff.cancel;
    });
  }
  async loadIntegrationProbe() {
    try {
      const raw = await this.app.vault.adapter.read(".mdse_integration_probe.json");
      const parsed = JSON.parse(raw);
      if (typeof parsed.launchStartedAt !== "number") return;
      this.integrationProbe = {
        launchStartedAt: parsed.launchStartedAt,
        noteCount: typeof parsed.noteCount === "number" ? parsed.noteCount : void 0,
        label: typeof parsed.label === "string" ? parsed.label : void 0
      };
      this.integrationPluginLoadedAt = Date.now();
    } catch {
    }
  }
  async updateIntegrationResult(patch) {
    if (!this.integrationProbe) return;
    try {
      const path = ".mdse_integration_result.json";
      const current = JSON.parse(await this.app.vault.adapter.read(path));
      await this.app.vault.adapter.write(path, JSON.stringify({ ...current, ...patch }, null, 2) + "\n");
    } catch {
    }
  }
  async writeIntegrationColdResult(stats) {
    const probe = this.integrationProbe;
    if (!probe) return;
    const coreReadyAt = Date.now();
    let readableAt = null;
    let readableSource = null;
    try {
      const raw = JSON.parse(await this.app.vault.adapter.read(".mdse_integration_readable.json"));
      if (typeof raw.at === "number") {
        readableAt = raw.at;
        readableSource = typeof raw.source === "string" ? raw.source : "external-controller";
      }
    } catch {
    }
    let metadataResolvedAt = this.integrationMetadataResolvedAt;
    let metadataResolutionSource = metadataResolvedAt === null ? null : "workbench-resolved-event";
    if (metadataResolvedAt === null) {
      try {
        const raw = JSON.parse(await this.app.vault.adapter.read(".mdse_integration_metadata.json"));
        if (typeof raw.at === "number") {
          metadataResolvedAt = raw.at;
          metadataResolutionSource = typeof raw.source === "string" ? raw.source : "external-observer";
        }
      } catch {
      }
    }
    const result = {
      label: probe.label ?? "cold-integration",
      noteCount: probe.noteCount ?? stats.files,
      launchStartedAt: probe.launchStartedAt,
      pluginLoadedAt: this.integrationPluginLoadedAt,
      readableAt,
      readableSource,
      metadataResolvedAt,
      metadataResolutionSource,
      metadataCoverageReadyAt: this.integrationMetadataCoverageAt,
      launchToMetadataCoverageMs: this.integrationMetadataCoverageAt === null ? null : this.integrationMetadataCoverageAt - probe.launchStartedAt,
      coreReadyAt,
      occurrenceReadyAt: this.indexer?.localHydrationPending ? null : coreReadyAt,
      cacheReadyAt: null,
      launchToReadableMs: readableAt === null ? null : readableAt - probe.launchStartedAt,
      launchToPluginMs: this.integrationPluginLoadedAt === null ? null : this.integrationPluginLoadedAt - probe.launchStartedAt,
      launchToMetadataResolvedMs: metadataResolvedAt === null ? null : metadataResolvedAt - probe.launchStartedAt,
      launchToCoreReadyMs: coreReadyAt - probe.launchStartedAt,
      launchToOccurrenceReadyMs: this.indexer?.localHydrationPending ? null : coreReadyAt - probe.launchStartedAt,
      pluginToCoreReadyMs: this.integrationPluginLoadedAt === null ? null : coreReadyAt - this.integrationPluginLoadedAt,
      workbenchCoreWorkMs: stats.ms,
      files: stats.files,
      elements: stats.elements,
      links: stats.links,
      mode: stats.mode,
      measuredAt: new Date(coreReadyAt).toISOString()
    };
    await this.app.vault.adapter.write(".mdse_integration_result.json", JSON.stringify(result, null, 2) + "\n");
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
      schemaLoaded: !!this.schema,
      schemaError: this.lastSchemaError,
      schemaWarnings: this.schema?.warnings.length ?? 0,
      cacheWriteError: this.lastCacheWriteError,
      cacheCurrent: !!indexer && indexer.revision === this.lastCachedRevision,
      cachePending: !!indexer?.stats && (!!this.cacheWriteTask || this.cacheWriteTimer !== null || indexer.revision !== this.lastCachedRevision),
      assuranceActive: !!this.assurance?.active,
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
  activeRuntimeWork(indexer) {
    const active = [];
    if (indexer.building || indexer.rebuildPending) active.push("indexing");
    if (indexer.localHydrationActive > 0) {
      active.push(indexer.localHydrationDemanded ? "requestedHydration" : "backgroundHydration");
    }
    if (this.assurance?.active) active.push("assurance");
    if (this.cacheWriteTask) active.push("cacheWrite");
    return active;
  }
  markBackgroundPending(kind) {
    if (!this.backgroundPendingSince.has(kind)) this.backgroundPendingSince.set(kind, Date.now());
  }
  clearBackgroundPending(kind) {
    this.backgroundPendingSince.delete(kind);
  }
  backgroundWorkAllowed(kind, indexer = this.indexer) {
    if (!indexer || this.indexer !== indexer) return false;
    const now = Date.now();
    const pendingSince = this.backgroundPendingSince.get(kind);
    const base3 = canRunBackgroundWork({
      unloaded: this.unloaded,
      ready: this.isReady(),
      building: indexer.building,
      rebuildPending: indexer.rebuildPending,
      liveUpdatePending: indexer.liveUpdatePending,
      quietForMs: now - this.lastChange,
      minimumQuietMs: kind === "cacheWrite" ? CACHE_PERSIST_QUIET_MS : BACKGROUND_RESUME_QUIET_MS,
      waitingForMs: pendingSince === void 0 ? 0 : now - pendingSince,
      maxDeferralMs: BACKGROUND_MAX_DEFERRAL_MS
    });
    return base3 && canStartRuntimeWork(kind, this.activeRuntimeWork(indexer));
  }
  async waitForBackgroundWork(kind, indexer) {
    this.markBackgroundPending(kind);
    while (!this.unloaded && this.indexer === indexer && !this.backgroundWorkAllowed(kind, indexer)) {
      await new Promise((r) => window.setTimeout(r, 250));
    }
    if (this.unloaded || this.indexer !== indexer) throw new Error("Workbench background work was cancelled.");
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
      if (this.metadataResolved || Date.now() - this.lastChange >= QUIET_START_MS) break;
      await new Promise((r) => window.setTimeout(r, 250));
    }
    if (this.unloaded) return;
    const pending = new Set(this.app.vault.getMarkdownFiles().map((file) => file.path));
    while (!this.unloaded && pending.size) {
      for (const path of [...pending]) {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian8.TFile) || file.extension !== "md" || this.app.metadataCache.getFileCache(file)) {
          pending.delete(path);
        }
      }
      if (pending.size) await new Promise((r) => window.setTimeout(r, 250));
    }
    if (this.unloaded) return;
    if (this.integrationProbe) this.integrationMetadataCoverageAt = Date.now();
    await new Promise((r) => window.setTimeout(r, CORE_AFTER_METADATA_DELAY_MS));
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
    if (this.integrationProbe) {
      const occurrenceReadyAt = Date.now();
      await this.updateIntegrationResult({
        occurrenceReadyAt,
        launchToOccurrenceReadyMs: occurrenceReadyAt - this.integrationProbe.launchStartedAt
      });
    }
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
    if (!indexer || !this.isReady() || !indexer.localHydrationPending) {
      this.clearBackgroundPending("backgroundHydration");
      return;
    }
    this.markBackgroundPending("backgroundHydration");
    this.localBackgroundTimer = window.setTimeout(() => {
      this.localBackgroundTimer = null;
      if (this.unloaded || this.indexer !== indexer || !this.isReady()) return;
      if (!this.backgroundWorkAllowed("backgroundHydration", indexer)) {
        this.scheduleBackgroundLocalHydration();
        return;
      }
      indexer.beginDeferredLocalHydration(true);
      this.scheduleRuntimeHealthRefresh();
      void indexer.whenLocalSettled(false).then(() => {
        if (this.unloaded || this.indexer !== indexer) return;
        this.lastOccurrenceError = null;
        if (!indexer.localHydrationPending) this.clearBackgroundPending("backgroundHydration");
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
    if (!this.cacheMutationGate.writesAllowed()) return;
    if (this.cacheWriteTimer !== null) window.clearTimeout(this.cacheWriteTimer);
    const indexer = this.indexer;
    if (!indexer?.stats || indexer.revision === this.lastCachedRevision) {
      this.clearBackgroundPending("cacheWrite");
      return;
    }
    this.markBackgroundPending("cacheWrite");
    const delay = cachePersistenceDelayMs(Date.now(), this.lastCacheWriteAt);
    this.cacheWriteTimer = window.setTimeout(() => {
      this.cacheWriteTimer = null;
      if (this.unloaded) return;
      const current = this.indexer;
      if (!current?.stats || current.revision === this.lastCachedRevision) return;
      if (!this.backgroundWorkAllowed("cacheWrite", current)) {
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
      if (indexer.building || indexer.rebuildPending || !this.backgroundWorkAllowed("cacheWrite", indexer)) {
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
        this.clearBackgroundPending("cacheWrite");
        if (this.integrationProbe) {
          const cacheReadyAt = Date.now();
          await this.updateIntegrationResult({
            cacheReadyAt,
            launchToCacheReadyMs: cacheReadyAt - this.integrationProbe.launchStartedAt
          });
        }
      } else this.scheduleSemanticCacheWrite();
      indexer.trimLocalRetention();
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
    this.coreReadyPublished = false;
    this.lastCoreError = null;
    this.lastSchemaError = null;
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
      this.lastSchemaError = message;
      this.setRuntimeStatus("error", "schema");
      new import_obsidian8.Notice(`MDSE Workbench: could not read the schema files. ${message} Check the paths in settings.`);
      return;
    }
    const schema = this.schema;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.indexer.setBackgroundIdleCheck(() => this.backgroundWorkAllowed("backgroundHydration", this.indexer));
      this.writer = new RelationshipWriter(this.app, () => this.schema, () => this.indexer.index, this.transactions);
      const localFile = (path) => {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof import_obsidian8.TFile)) throw new Error(path + " no longer exists.");
        return file;
      };
      this.modelEditor = new ModelEditService(
        {
          read: (path) => this.app.vault.read(localFile(path)),
          write: (path, text) => this.app.vault.modify(localFile(path), text)
        },
        (path) => this.indexer.index.notes.get(path)?.uid ?? null,
        this.transactions,
        (ownerPath, localId) => {
          const impacts = [];
          for (const note of this.indexer.index.notes.values()) {
            for (const ref of note.localRefs ?? []) {
              if (ref.path === ownerPath && ref.localId === localId) impacts.push({ path: note.path, field: ref.field });
            }
          }
          return impacts;
        }
      );
      this.assurance = new AssuranceManager({
        revision: () => this.indexer.revision,
        // Assurance ranks below background occurrence hydration. It waits for occurrence work
        // without promoting deferred hydration into the requested/foreground priority lane.
        settle: () => this.indexer.whenLocalSettled(false),
        index: () => this.indexer.index,
        localFindings: () => {
          const indexer2 = this.indexer;
          const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
          return [
            ...validateLocalModels({ index: indexer2.index, local: indexer2.local, resolve }),
            ...indexer2.localReadFindings()
          ];
        },
        waitForBackgroundPermission: () => this.waitForBackgroundWork("assurance", this.indexer)
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
        const cache = await readCoreCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
        const restored = restoreCoreSemanticState(cache, schema, scope);
        const initialPlan = planReconciliation(restored.fingerprints, indexer.currentFingerprints());
        const initialMode = reconciliationMode(initialPlan);
        if (initialMode !== "full") {
          stats = indexer.installRestoredCore(restored, cache.header.createdAt);
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
      this.setRuntimeStatus("indexing");
      stats = await recoverWithColdBuild(
        () => indexer.discardProvisionalSemanticState(),
        async () => {
          indexer.enableLiveChanges();
          return await indexer.build();
        }
      );
    }
    await indexer.whenSourceSettled();
    if (!indexer.stats) throw new Error("Core source reconciliation settled without publishable index statistics.");
    stats = indexer.stats;
    this.coreReadyPublished = true;
    this.lastTimeToCoreReadyMs = Math.round(performance.now() - runStartedAt);
    const localPending = indexer.localHydrationPending;
    if (!localPending) this.lastTimeToOccurrenceReadyMs = this.lastTimeToCoreReadyMs;
    this.setRuntimeStatus(
      "ready",
      `${stats.elements} elements \xB7 ${stats.mode}${localPending ? ` \xB7 occurrence features loading later` : ""}`
    );
    this.refreshRuntimeHealth();
    await this.writeIntegrationColdResult(stats);
    if (localPending) this.scheduleBackgroundLocalHydration();
    else this.scheduleSemanticCacheWrite();
    void this.recordRuntimeSample(indexer, stats);
    if (rebuild || schema.warnings.length) {
      new import_obsidian8.Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1e3).toFixed(1)} s${schema.warnings.length ? `; ${schema.warnings.length} schema warning(s), see diagnostics` : ""}.`);
    }
  }
  /** Quiet version of ready(): no notice. Used by Review, which waits and retries. */
  isReady() {
    const indexer = this.indexer;
    return canPublishCoreReady({
      publicationGate: this.coreReadyPublished,
      schemaLoaded: !!this.schema,
      writerReady: !!this.writer,
      statsAvailable: !!indexer?.stats,
      sourceReconciliationPending: indexer?.sourceReconciliationPending ?? true,
      building: !!indexer?.building
    });
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
    try {
      await this.cacheMutationGate.clear(this.cacheWriteTask, () => clearWorkbenchCache(this.app));
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
    if (!this.isReady()) return;
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
      indexer.trimLocalRetention();
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
    if (!force) this.markBackgroundPending("assurance");
    try {
      const snapshot = await this.assurance.get(force);
      this.refreshRuntimeHealth();
      return snapshot;
    } finally {
      this.clearBackgroundPending("assurance");
    }
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
    const cacheSizeBytes = await workbenchCacheSizeBytes(this.app);
    const relationshipReconciliation = this.indexer.lastRelationshipReresolution;
    const relationshipDependencySize = this.indexer.relationshipDependencySize;
    const rows = [
      ["Index mode", s.mode],
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
      ["Relationship reconciliation", relationshipReconciliation ? `${relationshipReconciliation.mode} \xB7 ${relationshipReconciliation.candidateCount} candidate(s) \xB7 ${relationshipReconciliation.elapsedMs.toFixed(1)} ms` : "not measured"],
      ["Relationship sources changed", relationshipReconciliation ? String(relationshipReconciliation.changedSourceCount) : "not measured"],
      ["Reverse relationship index", `${relationshipDependencySize.sources} source(s) \xB7 ${relationshipDependencySize.resolvedTargetKeys + relationshipDependencySize.authoredKeys} key(s) \xB7 ${relationshipDependencySize.storedMemberships} stored membership(s)`],
      ["Reverse relationship associations", `${relationshipDependencySize.resolvedAssociations} resolved \xB7 ${relationshipDependencySize.authoredAssociations} authored-key`],
      ["Local Model hydration", this.indexer.localHydrationPending ? `${this.indexer.localHydrationPending} note(s) pending` : "settled"],
      ["Local Model read errors", String(this.indexer.localReadErrorCount), this.indexer.localReadErrorCount > 0],
      ["Hydration cost / Object", (() => {
        const h = this.indexer.localHydrationCostSummary;
        return h.owners ? `${h.averageMs.toFixed(2)} ms avg \xB7 read ${h.averageReadMs.toFixed(2)} ms \xB7 parse ${h.averageParseMs.toFixed(2)} ms \xB7 ${h.owners} owner(s)` : "not measured";
      })()],
      ["Slowest hydrated Object", (() => {
        const h = this.indexer.localHydrationCostSummary;
        return h.maxPath ? `${h.maxPath} \xB7 ${h.maxMs.toFixed(2)} ms` : "not measured";
      })()],
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
      ["Semantic cache size", cacheSizeBytes === null ? "unavailable" : formatCacheBytes(cacheSizeBytes)],
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
  /**
   * Exact Local Model owners knowable from the core graph alone.
   * null means the profile needs a vault-wide occurrence search to remain complete.
   */
  occurrenceOwnerPaths(profile, starts, baseDepths) {
    const index = this.indexer.index;
    switch (profile.name) {
      case "Internal": {
        const owner = starts[0];
        return owner && index.notes.get(owner)?.type === "Object" ? [owner] : [];
      }
      case "Structure":
        return [...baseDepths.entries()].filter(([path, depth]) => depth < profile.depth && index.notes.get(path)?.type === "Object").map(([path]) => path).sort();
      case "Requirements": {
        const owners = /* @__PURE__ */ new Set();
        for (const requirementPath of starts) {
          if (index.notes.get(requirementPath)?.type !== "Requirement") continue;
          for (const ref of index.notes.get(requirementPath)?.localRefs ?? []) if (ref.field === "appliesTo") owners.add(ref.path);
        }
        return [...owners].sort();
      }
      // Interfaces may follow cross-owner local topology and definition starts; Where Used is
      // inherently an inverse search across every hydrated owner. Keep both complete for now.
      case "Interfaces":
      case "Where Used":
        return null;
      default:
        return [];
    }
  }
  async explore(starts, profile = STRUCTURE_PROFILE) {
    this.markForegroundActivity();
    if (!this.ready()) return;
    const indexer = this.indexer;
    await indexer.whenSourceSettled();
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
    if (profileNeedsLocalOccurrences(profile)) {
      this.setRuntimeStatus("ready", `${indexer.stats?.elements ?? 0} elements \xB7 loading occurrence data for ${profile.name}`);
      const owners = this.occurrenceOwnerPaths(profile, starts, baseView.depthOf);
      if (owners === null) {
        await indexer.whenLocalSettled();
        void this.markOccurrenceReady(indexer);
      } else {
        await indexer.hydrateLocalOwners(owners);
      }
      this.refreshRuntimeHealth();
    }
    await indexer.whenSourceSettled();
    const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
    const view = profileNeedsLocalOccurrences(profile) ? withLocalOccurrences(index, indexer.local, resolve, baseView, profile) : baseView;
    if (view.depthOf.size <= 1 && view.omitted.size === 0) {
      new import_obsidian8.Notice(`Nothing to show: this note has no links the ${profile.name} view follows (${[...new Set(profile.steps.map((s) => s.field))].join(", ")}).`);
      return;
    }
    const canvas = toCanvas(index, view, profile);
    if (profileNeedsLocalOccurrences(profile)) indexer.trimLocalRetention();
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
    await indexer.whenSourceSettled();
    const index = indexer.index;
    const baseView = traverse(index, meta.starts, profile);
    if (profileNeedsLocalOccurrences(profile)) {
      const owners = this.occurrenceOwnerPaths(profile, meta.starts, baseView.depthOf);
      if (owners === null) {
        await indexer.whenLocalSettled();
        void this.markOccurrenceReady(indexer);
      } else {
        await indexer.hydrateLocalOwners(owners);
      }
    }
    await indexer.whenSourceSettled();
    const resolve = (target, from) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), from)?.path;
    const current = profileNeedsLocalOccurrences(profile) ? withLocalOccurrences(index, indexer.local, resolve, baseView, profile) : baseView;
    const now = signature(current);
    if (profileNeedsLocalOccurrences(profile)) indexer.trimLocalRetention();
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
  async redo() {
    this.markForegroundActivity();
    if (!this.writer) return;
    new import_obsidian8.Notice(await this.writer.redo(), 15e3);
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
