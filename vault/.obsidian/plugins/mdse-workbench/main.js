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
    const tx = this.requireOpen(transactionId);
    tx.issues = this.validate(tx);
    tx.status = "reviewed";
    return this.snapshot(tx);
  }
  canApply(transactionId) {
    const tx = this.requireOpen(transactionId);
    tx.issues = this.validate(tx);
    return (tx.scope === "atomic" || tx.status === "reviewed") && !tx.issues.some(isBlocking);
  }
  async apply(transactionId, executor) {
    const tx = this.requireOpen(transactionId);
    if (tx.scope === "structural" && tx.status !== "reviewed") {
      throw new Error(`Structural transaction ${tx.label} must be reviewed before Apply.`);
    }
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
    const tx = this.requireOpen(transactionId);
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
  async undoIfLatest(transactionId) {
    const state = this.undoStack[this.undoStack.length - 1];
    if (!state) throw new Error(`Cannot roll back ${transactionId}: semantic history is empty.`);
    if (state.entry.transactionId !== transactionId) {
      throw new Error(
        `Cannot roll back ${transactionId}: a newer semantic edit (${state.entry.label}) exists. Use normal Review/Undo rather than reverting through another edit.`
      );
    }
    return this.undo();
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
  requireOpen(id) {
    const tx = this.require(id);
    if (tx.status !== "draft" && tx.status !== "reviewed") {
      throw new Error(`Transaction ${id} is ${tx.status}, not open.`);
    }
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
var READABLE_VERSIONS = ["0.1", "0.2", "0.3", "0.4"];
var WRITABLE_VERSION = "0.4";
var PREFIX = { part: "part-", endpoint: "ep-", connection: "conn-", flow: "flow-" };
var SECTION_LEGACY = { "part occurrences": "part", "local interfaces": "endpoint", connections: "connection" };
var SECTION_04 = { parts: "part", interfaces: "endpoint", connections: "connection" };
var sectionFor = (version, title) => (version === "0.4" ? SECTION_04 : SECTION_LEGACY)[title.toLowerCase()] ?? null;
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
var ALLOWED_FIELDS_LEGACY = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "exposes", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier"],
  flow: ["definition", "identifier", "endpointA", "endpointB"]
};
var ALLOWED_FIELDS_04 = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier", "exposes"],
  flow: ["definition", "identifier", "endpointA", "endpointB"]
};
var allowedFields = (version, kind) => (version === "0.4" ? ALLOWED_FIELDS_04 : ALLOWED_FIELDS_LEGACY)[kind];
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
      else if (version !== "0.1" && !TOKEN_30.test(r.localId.slice(PREFIX[k].length))) add("record.block-id-malformed", `${label}: block ID ${r.localId} does not end in a 30-character identity token.`, r);
    }
    for (const key2 of r.fields.keys()) {
      if (key2 === "usage" && version === "0.1") add("record.unknown-field", `${label}: usage is not part of schema 0.1.`, r, "warning");
      else if (!allowedFields(version, r.kind).includes(key2) && key2 !== "usage") add("record.unknown-field", `${label}: unknown field ${key2}.`, r, "warning");
    }
    if (r.fields.has("usage")) {
      if (r.kind === "connection" || r.kind === "flow") add("record.usage-invalid", `${label}: usage is not valid on a ${r.kind}.`, r);
      else if (version !== "0.1" && !USAGES.includes(r.usage)) add("record.usage-invalid", `${label}: usage "${r.usage}" is not standard, variant or option.`, r);
    }
    if (!r.definition && (r.kind === "part" || r.kind === "flow" || r.kind === "endpoint" && (version === "0.1" || version === "0.2" || r.usageExplicit))) {
      add("record.missing-definition", `${label} has no definition link.`, r);
    }
    if (r.kind === "endpoint" && version === "0.4" && r.exposes.length) {
      add("exposure.owner-invalid", `${label}: exposes belongs to a Connection in schema 0.4.`, r);
    }
    if (r.definition && r.definition.blockId) add("definition.incompatible", `${label}: the definition must link to a note, not a block.`, r);
  }
  for (const [id, list2] of byId) if (list2.length > 1) add("record.duplicate-id", `Block ID ${id} is used by ${list2.length} records.`, list2[1]);
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
      if (version === "0.4") {
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
var COMPATIBLE = { part: "Object", endpoint: null, flow: "Item Flow", connection: null };
function compatibleDefinition(record, def) {
  if (record.kind !== "endpoint") {
    const expected = COMPATIBLE[record.kind];
    return expected && def.type !== expected ? expected : null;
  }
  if (record.sourceSchemaVersion === "0.4") {
    return def.type === "Object" && def.subtype === "interface" ? null : "Object / interface";
  }
  return def.type === "Port" ? null : "Port";
}
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
    for (const [code, list2] of [...by].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))) lines.push(`| \`${code}\` | ${list2[0].severity} | ${list2.length} |`);
    lines.push("");
    for (const [code, list2] of [...by].sort((a, b) => a[0].localeCompare(b[0]))) {
      lines.push(`## ${code}`, "");
      for (const f of list2.slice(0, per)) {
        const where = f.path ? `[[${f.path.replace(/\.md$/i, "")}${f.localId ? `#^${f.localId}` : ""}|${f.path.split("/").pop()?.replace(/\.md$/i, "")}]]` : "";
        lines.push(`- ${where} ${f.message}${f.line ? ` (line ${f.line})` : ""}`);
      }
      if (list2.length > per) lines.push(`- \u2026 ${list2.length - per} more`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

// src/core/localmodel-edit.ts
var FIELD_ORDER = {
  part: ["definition", "usage", "identifier", "multiplicity"],
  endpoint: ["definition", "usage", "identifier", "part", "parent", "equals", "multiplicity", "kind"],
  connection: ["endpointA", "endpointB", "definition", "identifier", "exposes"],
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
function nextAvailableLocalId(kind, ownerUid, existingLocalIds, now = /* @__PURE__ */ new Date()) {
  const occupied = existingLocalIds instanceof Set ? existingLocalIds : new Set(existingLocalIds);
  let candidateTime = new Date(now.getTime());
  for (let attempts = 0; attempts < 1e4; attempts++) {
    const candidate = nextLocalId(kind, ownerUid, candidateTime);
    if (!occupied.has(candidate)) return candidate;
    candidateTime = new Date(candidateTime.getTime() + 1);
  }
  throw new Error("Cannot allocate a unique Local Model identity after 10000 millisecond retries.");
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
function planLocalFlowMove(text, flowId, connectionId) {
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
    findings: parsed.findings.slice()
  };
}
var SECTION_TITLE = {
  part: "Parts",
  endpoint: "Interfaces",
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
      "<!-- MDSE:LOCAL-MODEL START schema=" + WRITABLE_VERSION + " -->",
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
function assertIndexedOwnerUidMatchesSource(path, before, indexedUid) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(before);
  const sourceUid = frontmatterMatch ? /^uid:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/m.exec(frontmatterMatch[1])?.[1]?.trim() ?? "" : "";
  if (!sourceUid || sourceUid !== indexedUid) {
    throw new Error(
      `Cannot stage structural Local Model edit for ${path}: indexed uid ${indexedUid} does not match source uid ${sourceUid || "none"}.`
    );
  }
}
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
    assertIndexedOwnerUidMatchesSource(path, before, uid);
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
  async stageLocalRecordPatch(path, localId, patch, semanticGuard) {
    const before = await this.store.read(path);
    const plan = planLocalRecordPatch(before, localId, patch, { allowInvalidTarget: true });
    if (!plan.changed) throw new Error("This structural edit would not change the Local Model.");
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);
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
    this.pendingPatches.set(txId, { path, plan, label, semanticGuard });
    return { transaction, plan, path };
  }
  async stageAndReviewLocalRecordPatch(path, localId, patch, semanticGuard) {
    const staged = await this.stageLocalRecordPatch(path, localId, patch, semanticGuard);
    return this.reviewLocalPatch(staged.transaction.id);
  }
  async stageAndReviewLocalFlowMove(path, flowId, connectionId) {
    const before = await this.store.read(path);
    const plan = planLocalFlowMove(before, flowId, connectionId);
    const uid = this.ownerUid(path);
    if (!uid) throw new Error(`${path} is not an indexed model note with a durable uid.`);
    assertIndexedOwnerUidMatchesSource(path, before, uid);
    const txId = `local-move-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `move flow ${flowId} to ${connectionId}`;
    this.transactions.begin(txId, label, "structural");
    this.transactions.add(txId, {
      id: txId + "-move",
      label,
      changes: [{
        kind: "local.move",
        summary: label,
        refs: [localRef(uid, "flow", flowId), localRef(uid, "connection", connectionId)],
        metadata: { path, localId: flowId, localKind: "flow", connectionId }
      }]
    });
    this.pendingPatches.set(txId, { path, plan, label });
    return {
      transaction: this.transactions.review(txId),
      plan,
      path
    };
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
      apply: async () => this.applyGuarded(
        pending.path,
        pending.plan.before,
        pending.plan.after,
        pending.label,
        pending.semanticGuard
      )
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
    assertIndexedOwnerUidMatchesSource(path, before, uid);
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
  async stageAndReviewLocalRecordCreate(path, input) {
    const staged = await this.stageLocalRecordCreate(path, input);
    return this.reviewLocalCreate(staged.transaction.id);
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
    assertIndexedOwnerUidMatchesSource(path, before, uid);
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
  async stageAndReviewLocalRecordDelete(path, localId) {
    const staged = await this.stageLocalRecordDelete(path, localId);
    return this.reviewLocalDelete(staged.transaction.id);
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
  async applyGuarded(path, before, after, label, semanticGuard) {
    if (semanticGuard) await semanticGuard();
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
        if (semanticGuard) await semanticGuard();
        const latest = await this.store.read(path);
        if (latest !== before) throw new Error(`${path} changed after undoing "${label}".`);
        await this.store.write(path, after);
      }
    };
  }
};

// src/core/definition-create.ts
var UID = /^\d{17}[A-Za-z]{13}$/;
var AUTHOR_SUFFIX = /^[A-Za-z]{13}$/;
function normalizeAuthorSuffix(value) {
  const normalized = value.replace(/[^A-Za-z]/g, "").toLowerCase();
  if (!AUTHOR_SUFFIX.test(normalized)) {
    throw new Error("Creator identity must be exactly 13 ASCII letters after normalization.");
  }
  return normalized;
}
function nextDefinitionUid(authorSuffix, now = /* @__PURE__ */ new Date()) {
  const suffix = normalizeAuthorSuffix(authorSuffix);
  const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
  const MM = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  const hh = String(now.getUTCHours()).padStart(2, "0");
  const mm = String(now.getUTCMinutes()).padStart(2, "0");
  const ss = String(now.getUTCSeconds()).padStart(2, "0");
  const mmm = String(now.getUTCMilliseconds()).padStart(3, "0");
  return `${yyyy}${MM}${dd}${hh}${mm}${ss}${mmm}${suffix}`;
}
function nextAvailableDefinitionUid(authorSuffix, inUse, now = /* @__PURE__ */ new Date()) {
  for (let offset = 0; offset < 1e3; offset++) {
    const uid = nextDefinitionUid(authorSuffix, new Date(now.getTime() + offset));
    if (!inUse(uid)) return uid;
  }
  throw new Error("Could not allocate a unique definition uid within the next 1000 milliseconds.");
}
function definitionTypeForLocalKind(kind) {
  if (kind === "part") return "Object";
  if (kind === "endpoint") return "Port";
  if (kind === "flow") return "Item Flow";
  return null;
}
function planDefinitionCreation(request) {
  const name = request.name.trim();
  const path = request.path.trim();
  const uid = request.uid.trim();
  const type = definitionTypeForLocalKind(request.localKind);
  if (!type) {
    throw new Error(`Local Model ${request.localKind} occurrences do not have a governed reusable-definition class.`);
  }
  if (!name) throw new Error("Definition name is required.");
  if (!path || !path.toLowerCase().endsWith(".md")) throw new Error("Definition path must be a Markdown file path.");
  if (!UID.test(uid)) throw new Error("Definition uid must be the governed 30-character UTC timestamp + author suffix token.");
  const text = [
    "---",
    `type: ${type}`,
    `uid: ${uid}`,
    "---",
    "",
    `# ${name}`,
    ""
  ].join("\n");
  return { path, name, type, uid, text };
}
var DefinitionCreationService = class {
  constructor(store, uidInUse, transactions, impactFor) {
    this.store = store;
    this.uidInUse = uidInUse;
    this.transactions = transactions;
    this.impactFor = impactFor;
    this.sequence = 0;
    this.pending = /* @__PURE__ */ new Map();
  }
  stage(request) {
    const plan = planDefinitionCreation(request);
    if (this.uidInUse(plan.uid)) throw new Error(`Definition uid ${plan.uid} is already in use.`);
    const id = `definition-create-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `create ${plan.type} definition ${plan.name}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-create",
      label,
      changes: [{
        kind: "definition.create",
        summary: label,
        refs: [noteRef(plan.uid)],
        metadata: { path: plan.path, type: plan.type, uid: plan.uid, name: plan.name }
      }]
    });
    this.pending.set(id, { plan, label });
    return { transaction, plan };
  }
  stageAndReview(request) {
    const staged = this.stage(request);
    return this.review(staged.transaction.id);
  }
  review(transactionId) {
    const pending = this.requirePending(transactionId);
    return { transaction: this.transactions.review(transactionId), plan: pending.plan };
  }
  async apply(transactionId) {
    const pending = this.requirePending(transactionId);
    const { plan, label } = pending;
    if (this.uidInUse(plan.uid)) throw new Error(`Cannot apply ${label}: uid ${plan.uid} is now in use.`);
    if (await this.store.exists(plan.path)) throw new Error(`Cannot apply ${label}: ${plan.path} already exists.`);
    await this.transactions.apply(transactionId, {
      apply: async () => {
        if (this.uidInUse(plan.uid)) throw new Error(`Cannot apply ${label}: uid ${plan.uid} is now in use.`);
        if (await this.store.exists(plan.path)) throw new Error(`Cannot apply ${label}: ${plan.path} already exists.`);
        await this.store.create(plan.path, plan.text);
        return {
          undo: async () => {
            if (this.impactFor) {
              const impact = await this.impactFor(plan.path);
              const activeReferences = impact.noteUses.length + impact.occurrenceUses.length;
              if (activeReferences) {
                throw new Error(`Cannot undo ${label}: ${activeReferences} active reference${activeReferences === 1 ? "" : "s"} now use the created definition.`);
              }
            }
            if (!await this.store.exists(plan.path)) throw new Error(`${plan.path} no longer exists after "${label}".`);
            const current = await this.store.read(plan.path);
            if (current !== plan.text) throw new Error(`${plan.path} changed after "${label}".`);
            await this.store.remove(plan.path);
          },
          redo: async () => {
            if (await this.store.exists(plan.path)) throw new Error(`${plan.path} exists after undoing "${label}".`);
            if (this.uidInUse(plan.uid)) throw new Error(`Cannot redo ${label}: uid ${plan.uid} is in use.`);
            await this.store.create(plan.path, plan.text);
          }
        };
      }
    });
    this.pending.delete(transactionId);
  }
  async rollbackApplied(transactionId) {
    await this.transactions.undoIfLatest(transactionId);
  }
  cancel(transactionId) {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }
  requirePending(transactionId) {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition creation transaction ${transactionId} does not exist.`);
    return pending;
  }
};

// node_modules/yaml/browser/dist/nodes/identity.js
var ALIAS = Symbol.for("yaml.alias");
var DOC = Symbol.for("yaml.document");
var MAP = Symbol.for("yaml.map");
var PAIR = Symbol.for("yaml.pair");
var SCALAR = Symbol.for("yaml.scalar");
var SEQ = Symbol.for("yaml.seq");
var NODE_TYPE = Symbol.for("yaml.node.type");
var isAlias = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === ALIAS;
var isDocument = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === DOC;
var isMap = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === MAP;
var isPair = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === PAIR;
var isScalar = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SCALAR;
var isSeq = (node) => !!node && typeof node === "object" && node[NODE_TYPE] === SEQ;
function isCollection(node) {
  if (node && typeof node === "object")
    switch (node[NODE_TYPE]) {
      case MAP:
      case SEQ:
        return true;
    }
  return false;
}
function isNode(node) {
  if (node && typeof node === "object")
    switch (node[NODE_TYPE]) {
      case ALIAS:
      case MAP:
      case SCALAR:
      case SEQ:
        return true;
    }
  return false;
}
var hasAnchor = (node) => (isScalar(node) || isCollection(node)) && !!node.anchor;

// node_modules/yaml/browser/dist/visit.js
var BREAK = Symbol("break visit");
var SKIP = Symbol("skip children");
var REMOVE = Symbol("remove node");
function visit(node, visitor) {
  const visitor_ = initVisitor(visitor);
  if (isDocument(node)) {
    const cd = visit_(null, node.contents, visitor_, Object.freeze([node]));
    if (cd === REMOVE)
      node.contents = null;
  } else
    visit_(null, node, visitor_, Object.freeze([]));
}
visit.BREAK = BREAK;
visit.SKIP = SKIP;
visit.REMOVE = REMOVE;
function visit_(key2, node, visitor, path) {
  const ctrl = callVisitor(key2, node, visitor, path);
  if (isNode(ctrl) || isPair(ctrl)) {
    replaceNode(key2, path, ctrl);
    return visit_(key2, ctrl, visitor, path);
  }
  if (typeof ctrl !== "symbol") {
    if (isCollection(node)) {
      path = Object.freeze(path.concat(node));
      for (let i = 0; i < node.items.length; ++i) {
        const ci = visit_(i, node.items[i], visitor, path);
        if (typeof ci === "number")
          i = ci - 1;
        else if (ci === BREAK)
          return BREAK;
        else if (ci === REMOVE) {
          node.items.splice(i, 1);
          i -= 1;
        }
      }
    } else if (isPair(node)) {
      path = Object.freeze(path.concat(node));
      const ck = visit_("key", node.key, visitor, path);
      if (ck === BREAK)
        return BREAK;
      else if (ck === REMOVE)
        node.key = null;
      const cv = visit_("value", node.value, visitor, path);
      if (cv === BREAK)
        return BREAK;
      else if (cv === REMOVE)
        node.value = null;
    }
  }
  return ctrl;
}
async function visitAsync(node, visitor) {
  const visitor_ = initVisitor(visitor);
  if (isDocument(node)) {
    const cd = await visitAsync_(null, node.contents, visitor_, Object.freeze([node]));
    if (cd === REMOVE)
      node.contents = null;
  } else
    await visitAsync_(null, node, visitor_, Object.freeze([]));
}
visitAsync.BREAK = BREAK;
visitAsync.SKIP = SKIP;
visitAsync.REMOVE = REMOVE;
async function visitAsync_(key2, node, visitor, path) {
  const ctrl = await callVisitor(key2, node, visitor, path);
  if (isNode(ctrl) || isPair(ctrl)) {
    replaceNode(key2, path, ctrl);
    return visitAsync_(key2, ctrl, visitor, path);
  }
  if (typeof ctrl !== "symbol") {
    if (isCollection(node)) {
      path = Object.freeze(path.concat(node));
      for (let i = 0; i < node.items.length; ++i) {
        const ci = await visitAsync_(i, node.items[i], visitor, path);
        if (typeof ci === "number")
          i = ci - 1;
        else if (ci === BREAK)
          return BREAK;
        else if (ci === REMOVE) {
          node.items.splice(i, 1);
          i -= 1;
        }
      }
    } else if (isPair(node)) {
      path = Object.freeze(path.concat(node));
      const ck = await visitAsync_("key", node.key, visitor, path);
      if (ck === BREAK)
        return BREAK;
      else if (ck === REMOVE)
        node.key = null;
      const cv = await visitAsync_("value", node.value, visitor, path);
      if (cv === BREAK)
        return BREAK;
      else if (cv === REMOVE)
        node.value = null;
    }
  }
  return ctrl;
}
function initVisitor(visitor) {
  if (typeof visitor === "object" && (visitor.Collection || visitor.Node || visitor.Value)) {
    return Object.assign({
      Alias: visitor.Node,
      Map: visitor.Node,
      Scalar: visitor.Node,
      Seq: visitor.Node
    }, visitor.Value && {
      Map: visitor.Value,
      Scalar: visitor.Value,
      Seq: visitor.Value
    }, visitor.Collection && {
      Map: visitor.Collection,
      Seq: visitor.Collection
    }, visitor);
  }
  return visitor;
}
function callVisitor(key2, node, visitor, path) {
  if (typeof visitor === "function")
    return visitor(key2, node, path);
  if (isMap(node))
    return visitor.Map?.(key2, node, path);
  if (isSeq(node))
    return visitor.Seq?.(key2, node, path);
  if (isPair(node))
    return visitor.Pair?.(key2, node, path);
  if (isScalar(node))
    return visitor.Scalar?.(key2, node, path);
  if (isAlias(node))
    return visitor.Alias?.(key2, node, path);
  return void 0;
}
function replaceNode(key2, path, node) {
  const parent = path[path.length - 1];
  if (isCollection(parent)) {
    parent.items[key2] = node;
  } else if (isPair(parent)) {
    if (key2 === "key")
      parent.key = node;
    else
      parent.value = node;
  } else if (isDocument(parent)) {
    parent.contents = node;
  } else {
    const pt = isAlias(parent) ? "alias" : "scalar";
    throw new Error(`Cannot replace node with ${pt} parent`);
  }
}

// node_modules/yaml/browser/dist/doc/directives.js
var escapeChars = {
  "!": "%21",
  ",": "%2C",
  "[": "%5B",
  "]": "%5D",
  "{": "%7B",
  "}": "%7D"
};
var escapeTagName = (tn) => tn.replace(/[!,[\]{}]/g, (ch) => escapeChars[ch]);
var Directives = class _Directives {
  constructor(yaml, tags) {
    this.docStart = null;
    this.docEnd = false;
    this.yaml = Object.assign({}, _Directives.defaultYaml, yaml);
    this.tags = Object.assign({}, _Directives.defaultTags, tags);
  }
  clone() {
    const copy = new _Directives(this.yaml, this.tags);
    copy.docStart = this.docStart;
    return copy;
  }
  /**
   * During parsing, get a Directives instance for the current document and
   * update the stream state according to the current version's spec.
   */
  atDocument() {
    const res = new _Directives(this.yaml, this.tags);
    switch (this.yaml.version) {
      case "1.1":
        this.atNextDocument = true;
        break;
      case "1.2":
        this.atNextDocument = false;
        this.yaml = {
          explicit: _Directives.defaultYaml.explicit,
          version: "1.2"
        };
        this.tags = Object.assign({}, _Directives.defaultTags);
        break;
    }
    return res;
  }
  /**
   * @param onError - May be called even if the action was successful
   * @returns `true` on success
   */
  add(line, onError) {
    if (this.atNextDocument) {
      this.yaml = { explicit: _Directives.defaultYaml.explicit, version: "1.1" };
      this.tags = Object.assign({}, _Directives.defaultTags);
      this.atNextDocument = false;
    }
    const parts = line.trim().split(/[ \t]+/);
    const name = parts.shift();
    switch (name) {
      case "%TAG": {
        if (parts.length !== 2) {
          onError(0, "%TAG directive should contain exactly two parts");
          if (parts.length < 2)
            return false;
        }
        const [handle, prefix] = parts;
        this.tags[handle] = prefix;
        return true;
      }
      case "%YAML": {
        this.yaml.explicit = true;
        if (parts.length !== 1) {
          onError(0, "%YAML directive should contain exactly one part");
          return false;
        }
        const [version] = parts;
        if (version === "1.1" || version === "1.2") {
          this.yaml.version = version;
          return true;
        } else {
          const isValid = /^\d+\.\d+$/.test(version);
          onError(6, `Unsupported YAML version ${version}`, isValid);
          return false;
        }
      }
      default:
        onError(0, `Unknown directive ${name}`, true);
        return false;
    }
  }
  /**
   * Resolves a tag, matching handles to those defined in %TAG directives.
   *
   * @returns Resolved tag, which may also be the non-specific tag `'!'` or a
   *   `'!local'` tag, or `null` if unresolvable.
   */
  tagName(source, onError) {
    if (source === "!")
      return "!";
    if (source[0] !== "!") {
      onError(`Not a valid tag: ${source}`);
      return null;
    }
    if (source[1] === "<") {
      const verbatim = source.slice(2, -1);
      if (verbatim === "!" || verbatim === "!!") {
        onError(`Verbatim tags aren't resolved, so ${source} is invalid.`);
        return null;
      }
      if (source[source.length - 1] !== ">")
        onError("Verbatim tags must end with a >");
      return verbatim;
    }
    const [, handle, suffix] = source.match(/^(.*!)([^!]*)$/s);
    if (!suffix)
      onError(`The ${source} tag has no suffix`);
    const prefix = this.tags[handle];
    if (prefix) {
      try {
        return prefix + decodeURIComponent(suffix);
      } catch (error) {
        onError(String(error));
        return null;
      }
    }
    if (handle === "!")
      return source;
    onError(`Could not resolve tag: ${source}`);
    return null;
  }
  /**
   * Given a fully resolved tag, returns its printable string form,
   * taking into account current tag prefixes and defaults.
   */
  tagString(tag) {
    for (const [handle, prefix] of Object.entries(this.tags)) {
      if (tag.startsWith(prefix))
        return handle + escapeTagName(tag.substring(prefix.length));
    }
    return tag[0] === "!" ? tag : `!<${tag}>`;
  }
  toString(doc) {
    const lines = this.yaml.explicit ? [`%YAML ${this.yaml.version || "1.2"}`] : [];
    const tagEntries = Object.entries(this.tags);
    let tagNames;
    if (doc && tagEntries.length > 0 && isNode(doc.contents)) {
      const tags = {};
      visit(doc.contents, (_key, node) => {
        if (isNode(node) && node.tag)
          tags[node.tag] = true;
      });
      tagNames = Object.keys(tags);
    } else
      tagNames = [];
    for (const [handle, prefix] of tagEntries) {
      if (handle === "!!" && prefix === "tag:yaml.org,2002:")
        continue;
      if (!doc || tagNames.some((tn) => tn.startsWith(prefix)))
        lines.push(`%TAG ${handle} ${prefix}`);
    }
    return lines.join("\n");
  }
};
Directives.defaultYaml = { explicit: false, version: "1.2" };
Directives.defaultTags = { "!!": "tag:yaml.org,2002:" };

// node_modules/yaml/browser/dist/doc/anchors.js
function anchorIsValid(anchor) {
  if (/[\x00-\x19\s,[\]{}]/.test(anchor)) {
    const sa = JSON.stringify(anchor);
    const msg = `Anchor must not contain whitespace or control characters: ${sa}`;
    throw new Error(msg);
  }
  return true;
}
function anchorNames(root) {
  const anchors = /* @__PURE__ */ new Set();
  visit(root, {
    Value(_key, node) {
      if (node.anchor)
        anchors.add(node.anchor);
    }
  });
  return anchors;
}
function findNewAnchor(prefix, exclude) {
  for (let i = 1; true; ++i) {
    const name = `${prefix}${i}`;
    if (!exclude.has(name))
      return name;
  }
}
function createNodeAnchors(doc, prefix) {
  const aliasObjects = [];
  const sourceObjects = /* @__PURE__ */ new Map();
  let prevAnchors = null;
  return {
    onAnchor: (source) => {
      aliasObjects.push(source);
      prevAnchors ?? (prevAnchors = anchorNames(doc));
      const anchor = findNewAnchor(prefix, prevAnchors);
      prevAnchors.add(anchor);
      return anchor;
    },
    /**
     * With circular references, the source node is only resolved after all
     * of its child nodes are. This is why anchors are set only after all of
     * the nodes have been created.
     */
    setAnchors: () => {
      for (const source of aliasObjects) {
        const ref = sourceObjects.get(source);
        if (typeof ref === "object" && ref.anchor && (isScalar(ref.node) || isCollection(ref.node))) {
          ref.node.anchor = ref.anchor;
        } else {
          const error = new Error("Failed to resolve repeated object (this should not happen)");
          error.source = source;
          throw error;
        }
      }
    },
    sourceObjects
  };
}

// node_modules/yaml/browser/dist/doc/applyReviver.js
function applyReviver(reviver, obj, key2, val) {
  if (val && typeof val === "object") {
    if (Array.isArray(val)) {
      for (let i = 0, len = val.length; i < len; ++i) {
        const v0 = val[i];
        const v1 = applyReviver(reviver, val, String(i), v0);
        if (v1 === void 0)
          delete val[i];
        else if (v1 !== v0)
          val[i] = v1;
      }
    } else if (val instanceof Map) {
      for (const k of Array.from(val.keys())) {
        const v0 = val.get(k);
        const v1 = applyReviver(reviver, val, k, v0);
        if (v1 === void 0)
          val.delete(k);
        else if (v1 !== v0)
          val.set(k, v1);
      }
    } else if (val instanceof Set) {
      for (const v0 of Array.from(val)) {
        const v1 = applyReviver(reviver, val, v0, v0);
        if (v1 === void 0)
          val.delete(v0);
        else if (v1 !== v0) {
          val.delete(v0);
          val.add(v1);
        }
      }
    } else {
      for (const [k, v0] of Object.entries(val)) {
        const v1 = applyReviver(reviver, val, k, v0);
        if (v1 === void 0)
          delete val[k];
        else if (v1 !== v0)
          val[k] = v1;
      }
    }
  }
  return reviver.call(obj, key2, val);
}

// node_modules/yaml/browser/dist/nodes/toJS.js
function toJS(value, arg, ctx) {
  if (Array.isArray(value))
    return value.map((v, i) => toJS(v, String(i), ctx));
  if (value && typeof value.toJSON === "function") {
    if (!ctx || !hasAnchor(value))
      return value.toJSON(arg, ctx);
    const data = { aliasCount: 0, count: 1, res: void 0 };
    ctx.anchors.set(value, data);
    ctx.onCreate = (res2) => {
      data.res = res2;
      delete ctx.onCreate;
    };
    const res = value.toJSON(arg, ctx);
    if (ctx.onCreate)
      ctx.onCreate(res);
    return res;
  }
  if (typeof value === "bigint" && !ctx?.keep)
    return Number(value);
  return value;
}

// node_modules/yaml/browser/dist/nodes/Node.js
var NodeBase = class {
  constructor(type) {
    Object.defineProperty(this, NODE_TYPE, { value: type });
  }
  /** Create a copy of this node.  */
  clone() {
    const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /** A plain JavaScript representation of this node. */
  toJS(doc, { mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    if (!isDocument(doc))
      throw new TypeError("A document argument is required");
    const ctx = {
      anchors: /* @__PURE__ */ new Map(),
      doc,
      keep: true,
      mapAsMap: mapAsMap === true,
      mapKeyWarned: false,
      maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
    };
    const res = toJS(this, "", ctx);
    if (typeof onAnchor === "function")
      for (const { count, res: res2 } of ctx.anchors.values())
        onAnchor(res2, count);
    return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
  }
};

// node_modules/yaml/browser/dist/nodes/Alias.js
var Alias = class extends NodeBase {
  constructor(source) {
    super(ALIAS);
    this.source = source;
    Object.defineProperty(this, "tag", {
      set() {
        throw new Error("Alias nodes cannot have tags");
      }
    });
  }
  /**
   * Resolve the value of this alias within `doc`, finding the last
   * instance of the `source` anchor before this node.
   */
  resolve(doc, ctx) {
    if (ctx?.maxAliasCount === 0)
      throw new ReferenceError("Alias resolution is disabled");
    let nodes;
    if (ctx?.aliasResolveCache) {
      nodes = ctx.aliasResolveCache;
    } else {
      nodes = [];
      visit(doc, {
        Node: (_key, node) => {
          if (isAlias(node) || hasAnchor(node))
            nodes.push(node);
        }
      });
      if (ctx)
        ctx.aliasResolveCache = nodes;
    }
    let found = void 0;
    for (const node of nodes) {
      if (node === this)
        break;
      if (node.anchor === this.source)
        found = node;
    }
    if (found && ctx) {
      const { anchors, doc: doc2, maxAliasCount } = ctx;
      let data = anchors.get(found);
      if (!data) {
        toJS(found, null, ctx);
        data = anchors.get(found);
      }
      if (data?.res === void 0) {
        const msg = "This should not happen: Alias anchor was not resolved?";
        throw new ReferenceError(msg);
      }
      if (maxAliasCount >= 0) {
        data.count += 1;
        if (data.aliasCount === 0)
          data.aliasCount = getAliasCount(doc2, found, anchors);
        if (data.count * data.aliasCount > maxAliasCount) {
          const msg = "Excessive alias count indicates a resource exhaustion attack";
          throw new ReferenceError(msg);
        }
      }
    }
    return found;
  }
  toJSON(_arg, ctx) {
    if (!ctx)
      return { source: this.source };
    const source = this.resolve(ctx.doc, ctx);
    if (!source) {
      const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
      throw new ReferenceError(msg);
    }
    return ctx.anchors.get(source).res;
  }
  toString(ctx, _onComment, _onChompKeep) {
    const src = `*${this.source}`;
    if (ctx) {
      anchorIsValid(this.source);
      if (ctx.options.verifyAliasOrder && !ctx.anchors.has(this.source)) {
        const msg = `Unresolved alias (the anchor must be set before the alias): ${this.source}`;
        throw new Error(msg);
      }
      if (ctx.implicitKey)
        return `${src} `;
    }
    return src;
  }
};
function getAliasCount(doc, node, anchors) {
  if (isAlias(node)) {
    const source = node.resolve(doc);
    const anchor = anchors && source && anchors.get(source);
    return anchor ? anchor.count * anchor.aliasCount : 0;
  } else if (isCollection(node)) {
    let count = 0;
    for (const item of node.items) {
      const c = getAliasCount(doc, item, anchors);
      if (c > count)
        count = c;
    }
    return count;
  } else if (isPair(node)) {
    const kc = getAliasCount(doc, node.key, anchors);
    const vc = getAliasCount(doc, node.value, anchors);
    return Math.max(kc, vc);
  }
  return 1;
}

// node_modules/yaml/browser/dist/nodes/Scalar.js
var isScalarValue = (value) => !value || typeof value !== "function" && typeof value !== "object";
var Scalar = class extends NodeBase {
  constructor(value) {
    super(SCALAR);
    this.value = value;
  }
  toJSON(arg, ctx) {
    return ctx?.keep ? this.value : toJS(this.value, arg, ctx);
  }
  toString() {
    return String(this.value);
  }
};
Scalar.BLOCK_FOLDED = "BLOCK_FOLDED";
Scalar.BLOCK_LITERAL = "BLOCK_LITERAL";
Scalar.PLAIN = "PLAIN";
Scalar.QUOTE_DOUBLE = "QUOTE_DOUBLE";
Scalar.QUOTE_SINGLE = "QUOTE_SINGLE";

// node_modules/yaml/browser/dist/doc/createNode.js
var defaultTagPrefix = "tag:yaml.org,2002:";
function findTagObject(value, tagName, tags) {
  if (tagName) {
    const match = tags.filter((t) => t.tag === tagName);
    const tagObj = match.find((t) => !t.format) ?? match[0];
    if (!tagObj)
      throw new Error(`Tag ${tagName} not found`);
    return tagObj;
  }
  return tags.find((t) => t.identify?.(value) && !t.format);
}
function createNode(value, tagName, ctx) {
  if (isDocument(value))
    value = value.contents;
  if (isNode(value))
    return value;
  if (isPair(value)) {
    const map2 = ctx.schema[MAP].createNode?.(ctx.schema, null, ctx);
    map2.items.push(value);
    return map2;
  }
  if (value instanceof String || value instanceof Number || value instanceof Boolean || typeof BigInt !== "undefined" && value instanceof BigInt) {
    value = value.valueOf();
  }
  const { aliasDuplicateObjects, onAnchor, onTagObj, schema: schema4, sourceObjects } = ctx;
  let ref = void 0;
  if (aliasDuplicateObjects && value && typeof value === "object") {
    ref = sourceObjects.get(value);
    if (ref) {
      ref.anchor ?? (ref.anchor = onAnchor(value));
      return new Alias(ref.anchor);
    } else {
      ref = { anchor: null, node: null };
      sourceObjects.set(value, ref);
    }
  }
  if (tagName?.startsWith("!!"))
    tagName = defaultTagPrefix + tagName.slice(2);
  let tagObj = findTagObject(value, tagName, schema4.tags);
  if (!tagObj) {
    if (value && typeof value.toJSON === "function") {
      value = value.toJSON();
    }
    if (!value || typeof value !== "object") {
      const node2 = new Scalar(value);
      if (ref)
        ref.node = node2;
      return node2;
    }
    tagObj = value instanceof Map ? schema4[MAP] : Symbol.iterator in Object(value) ? schema4[SEQ] : schema4[MAP];
  }
  if (onTagObj) {
    onTagObj(tagObj);
    delete ctx.onTagObj;
  }
  const node = tagObj?.createNode ? tagObj.createNode(ctx.schema, value, ctx) : typeof tagObj?.nodeClass?.from === "function" ? tagObj.nodeClass.from(ctx.schema, value, ctx) : new Scalar(value);
  if (tagName)
    node.tag = tagName;
  else if (!tagObj.default)
    node.tag = tagObj.tag;
  if (ref)
    ref.node = node;
  return node;
}

// node_modules/yaml/browser/dist/nodes/Collection.js
function collectionFromPath(schema4, path, value) {
  let v = value;
  for (let i = path.length - 1; i >= 0; --i) {
    const k = path[i];
    if (typeof k === "number" && Number.isInteger(k) && k >= 0) {
      const a = [];
      a[k] = v;
      v = a;
    } else {
      v = /* @__PURE__ */ new Map([[k, v]]);
    }
  }
  return createNode(v, void 0, {
    aliasDuplicateObjects: false,
    keepUndefined: false,
    onAnchor: () => {
      throw new Error("This should not happen, please report a bug.");
    },
    schema: schema4,
    sourceObjects: /* @__PURE__ */ new Map()
  });
}
var isEmptyPath = (path) => path == null || typeof path === "object" && !!path[Symbol.iterator]().next().done;
var Collection = class extends NodeBase {
  constructor(type, schema4) {
    super(type);
    Object.defineProperty(this, "schema", {
      value: schema4,
      configurable: true,
      enumerable: false,
      writable: true
    });
  }
  /**
   * Create a copy of this collection.
   *
   * @param schema - If defined, overwrites the original's schema
   */
  clone(schema4) {
    const copy = Object.create(Object.getPrototypeOf(this), Object.getOwnPropertyDescriptors(this));
    if (schema4)
      copy.schema = schema4;
    copy.items = copy.items.map((it) => isNode(it) || isPair(it) ? it.clone(schema4) : it);
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /**
   * Adds a value to the collection. For `!!map` and `!!omap` the value must
   * be a Pair instance or a `{ key, value }` object, which may not have a key
   * that already exists in the map.
   */
  addIn(path, value) {
    if (isEmptyPath(path))
      this.add(value);
    else {
      const [key2, ...rest] = path;
      const node = this.get(key2, true);
      if (isCollection(node))
        node.addIn(rest, value);
      else if (node === void 0 && this.schema)
        this.set(key2, collectionFromPath(this.schema, rest, value));
      else
        throw new Error(`Expected YAML collection at ${key2}. Remaining path: ${rest}`);
    }
  }
  /**
   * Removes a value from the collection.
   * @returns `true` if the item was found and removed.
   */
  deleteIn(path) {
    const [key2, ...rest] = path;
    if (rest.length === 0)
      return this.delete(key2);
    const node = this.get(key2, true);
    if (isCollection(node))
      return node.deleteIn(rest);
    else
      throw new Error(`Expected YAML collection at ${key2}. Remaining path: ${rest}`);
  }
  /**
   * Returns item at `key`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  getIn(path, keepScalar) {
    const [key2, ...rest] = path;
    const node = this.get(key2, true);
    if (rest.length === 0)
      return !keepScalar && isScalar(node) ? node.value : node;
    else
      return isCollection(node) ? node.getIn(rest, keepScalar) : void 0;
  }
  hasAllNullValues(allowScalar) {
    return this.items.every((node) => {
      if (!isPair(node))
        return false;
      const n = node.value;
      return n == null || allowScalar && isScalar(n) && n.value == null && !n.commentBefore && !n.comment && !n.tag;
    });
  }
  /**
   * Checks if the collection includes a value with the key `key`.
   */
  hasIn(path) {
    const [key2, ...rest] = path;
    if (rest.length === 0)
      return this.has(key2);
    const node = this.get(key2, true);
    return isCollection(node) ? node.hasIn(rest) : false;
  }
  /**
   * Sets a value in this collection. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  setIn(path, value) {
    const [key2, ...rest] = path;
    if (rest.length === 0) {
      this.set(key2, value);
    } else {
      const node = this.get(key2, true);
      if (isCollection(node))
        node.setIn(rest, value);
      else if (node === void 0 && this.schema)
        this.set(key2, collectionFromPath(this.schema, rest, value));
      else
        throw new Error(`Expected YAML collection at ${key2}. Remaining path: ${rest}`);
    }
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyComment.js
var stringifyComment = (str) => str.replace(/^(?!$)(?: $)?/gm, "#");
function indentComment(comment, indent) {
  if (/^\n+$/.test(comment))
    return comment.substring(1);
  return indent ? comment.replace(/^(?! *$)/gm, indent) : comment;
}
var lineComment = (str, indent, comment) => str.endsWith("\n") ? indentComment(comment, indent) : comment.includes("\n") ? "\n" + indentComment(comment, indent) : (str.endsWith(" ") ? "" : " ") + comment;

// node_modules/yaml/browser/dist/stringify/foldFlowLines.js
var FOLD_FLOW = "flow";
var FOLD_BLOCK = "block";
var FOLD_QUOTED = "quoted";
function foldFlowLines(text, indent, mode = "flow", { indentAtStart, lineWidth = 80, minContentWidth = 20, onFold, onOverflow } = {}) {
  if (!lineWidth || lineWidth < 0)
    return text;
  if (lineWidth < minContentWidth)
    minContentWidth = 0;
  const endStep = Math.max(1 + minContentWidth, 1 + lineWidth - indent.length);
  if (text.length <= endStep)
    return text;
  const folds = [];
  const escapedFolds = {};
  let end = lineWidth - indent.length;
  if (typeof indentAtStart === "number") {
    if (indentAtStart > lineWidth - Math.max(2, minContentWidth))
      folds.push(0);
    else
      end = lineWidth - indentAtStart;
  }
  let split = void 0;
  let prev = void 0;
  let overflow = false;
  let i = -1;
  let escStart = -1;
  let escEnd = -1;
  if (mode === FOLD_BLOCK) {
    i = consumeMoreIndentedLines(text, i, indent.length);
    if (i !== -1)
      end = i + endStep;
  }
  for (let ch; ch = text[i += 1]; ) {
    if (mode === FOLD_QUOTED && ch === "\\") {
      escStart = i;
      switch (text[i + 1]) {
        case "x":
          i += 3;
          break;
        case "u":
          i += 5;
          break;
        case "U":
          i += 9;
          break;
        default:
          i += 1;
      }
      escEnd = i;
    }
    if (ch === "\n") {
      if (mode === FOLD_BLOCK)
        i = consumeMoreIndentedLines(text, i, indent.length);
      end = i + indent.length + endStep;
      split = void 0;
    } else {
      if (ch === " " && prev && prev !== " " && prev !== "\n" && prev !== "	") {
        const next = text[i + 1];
        if (next && next !== " " && next !== "\n" && next !== "	")
          split = i;
      }
      if (i >= end) {
        if (split) {
          folds.push(split);
          end = split + endStep;
          split = void 0;
        } else if (mode === FOLD_QUOTED) {
          while (prev === " " || prev === "	") {
            prev = ch;
            ch = text[i += 1];
            overflow = true;
          }
          const j = i > escEnd + 1 ? i - 2 : escStart - 1;
          if (escapedFolds[j])
            return text;
          folds.push(j);
          escapedFolds[j] = true;
          end = j + endStep;
          split = void 0;
        } else {
          overflow = true;
        }
      }
    }
    prev = ch;
  }
  if (overflow && onOverflow)
    onOverflow();
  if (folds.length === 0)
    return text;
  if (onFold)
    onFold();
  let res = text.slice(0, folds[0]);
  for (let i2 = 0; i2 < folds.length; ++i2) {
    const fold = folds[i2];
    const end2 = folds[i2 + 1] || text.length;
    if (fold === 0)
      res = `
${indent}${text.slice(0, end2)}`;
    else {
      if (mode === FOLD_QUOTED && escapedFolds[fold])
        res += `${text[fold]}\\`;
      res += `
${indent}${text.slice(fold + 1, end2)}`;
    }
  }
  return res;
}
function consumeMoreIndentedLines(text, i, indent) {
  let end = i;
  let start = i + 1;
  let ch = text[start];
  while (ch === " " || ch === "	") {
    if (i < start + indent) {
      ch = text[++i];
    } else {
      do {
        ch = text[++i];
      } while (ch && ch !== "\n");
      end = i;
      start = i + 1;
      ch = text[start];
    }
  }
  return end;
}

// node_modules/yaml/browser/dist/stringify/stringifyString.js
var getFoldOptions = (ctx, isBlock2) => ({
  indentAtStart: isBlock2 ? ctx.indent.length : ctx.indentAtStart,
  lineWidth: ctx.options.lineWidth,
  minContentWidth: ctx.options.minContentWidth
});
var containsDocumentMarker = (str) => /^(%|---|\.\.\.)/m.test(str);
function lineLengthOverLimit(str, lineWidth, indentLength) {
  if (!lineWidth || lineWidth < 0)
    return false;
  const limit = lineWidth - indentLength;
  const strLen = str.length;
  if (strLen <= limit)
    return false;
  for (let i = 0, start = 0; i < strLen; ++i) {
    if (str[i] === "\n") {
      if (i - start > limit)
        return true;
      start = i + 1;
      if (strLen - start <= limit)
        return false;
    }
  }
  return true;
}
function doubleQuotedString(value, ctx) {
  const json = JSON.stringify(value);
  if (ctx.options.doubleQuotedAsJSON)
    return json;
  const { implicitKey } = ctx;
  const minMultiLineLength = ctx.options.doubleQuotedMinMultiLineLength;
  const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
  let str = "";
  let start = 0;
  for (let i = 0, ch = json[i]; ch; ch = json[++i]) {
    if (ch === " " && json[i + 1] === "\\" && json[i + 2] === "n") {
      str += json.slice(start, i) + "\\ ";
      i += 1;
      start = i;
      ch = "\\";
    }
    if (ch === "\\")
      switch (json[i + 1]) {
        case "u":
          {
            str += json.slice(start, i);
            const code = json.substr(i + 2, 4);
            switch (code) {
              case "0000":
                str += "\\0";
                break;
              case "0007":
                str += "\\a";
                break;
              case "000b":
                str += "\\v";
                break;
              case "001b":
                str += "\\e";
                break;
              case "0085":
                str += "\\N";
                break;
              case "00a0":
                str += "\\_";
                break;
              case "2028":
                str += "\\L";
                break;
              case "2029":
                str += "\\P";
                break;
              default:
                if (code.substr(0, 2) === "00")
                  str += "\\x" + code.substr(2);
                else
                  str += json.substr(i, 6);
            }
            i += 5;
            start = i + 1;
          }
          break;
        case "n":
          if (implicitKey || json[i + 2] === '"' || json.length < minMultiLineLength) {
            i += 1;
          } else {
            str += json.slice(start, i) + "\n\n";
            while (json[i + 2] === "\\" && json[i + 3] === "n" && json[i + 4] !== '"') {
              str += "\n";
              i += 2;
            }
            str += indent;
            if (json[i + 2] === " ")
              str += "\\";
            i += 1;
            start = i + 1;
          }
          break;
        default:
          i += 1;
      }
  }
  str = start ? str + json.slice(start) : json;
  return implicitKey ? str : foldFlowLines(str, indent, FOLD_QUOTED, getFoldOptions(ctx, false));
}
function singleQuotedString(value, ctx) {
  if (ctx.options.singleQuote === false || ctx.implicitKey && value.includes("\n") || /[ \t]\n|\n[ \t]/.test(value))
    return doubleQuotedString(value, ctx);
  const indent = ctx.indent || (containsDocumentMarker(value) ? "  " : "");
  const res = "'" + value.replace(/'/g, "''").replace(/\n+/g, `$&
${indent}`) + "'";
  return ctx.implicitKey ? res : foldFlowLines(res, indent, FOLD_FLOW, getFoldOptions(ctx, false));
}
function quotedString(value, ctx) {
  const { singleQuote } = ctx.options;
  let qs;
  if (singleQuote === false)
    qs = doubleQuotedString;
  else {
    const hasDouble = value.includes('"');
    const hasSingle = value.includes("'");
    if (hasDouble && !hasSingle)
      qs = singleQuotedString;
    else if (hasSingle && !hasDouble)
      qs = doubleQuotedString;
    else
      qs = singleQuote ? singleQuotedString : doubleQuotedString;
  }
  return qs(value, ctx);
}
var blockEndNewlines;
try {
  blockEndNewlines = new RegExp("(^|(?<!\n))\n+(?!\n|$)", "g");
} catch {
  blockEndNewlines = /\n+(?!\n|$)/g;
}
function blockString({ comment, type, value }, ctx, onComment, onChompKeep) {
  const { blockQuote, commentString, lineWidth } = ctx.options;
  if (!blockQuote || /\n[\t ]+$/.test(value)) {
    return quotedString(value, ctx);
  }
  const indent = ctx.indent || (ctx.forceBlockIndent || containsDocumentMarker(value) ? "  " : "");
  const literal = blockQuote === "literal" ? true : blockQuote === "folded" || type === Scalar.BLOCK_FOLDED ? false : type === Scalar.BLOCK_LITERAL ? true : !lineLengthOverLimit(value, lineWidth, indent.length);
  if (!value)
    return literal ? "|\n" : ">\n";
  let chomp;
  let endStart;
  for (endStart = value.length; endStart > 0; --endStart) {
    const ch = value[endStart - 1];
    if (ch !== "\n" && ch !== "	" && ch !== " ")
      break;
  }
  let end = value.substring(endStart);
  const endNlPos = end.indexOf("\n");
  if (endNlPos === -1) {
    chomp = "-";
  } else if (value === end || endNlPos !== end.length - 1) {
    chomp = "+";
    if (onChompKeep)
      onChompKeep();
  } else {
    chomp = "";
  }
  if (end) {
    value = value.slice(0, -end.length);
    if (end[end.length - 1] === "\n")
      end = end.slice(0, -1);
    end = end.replace(blockEndNewlines, `$&${indent}`);
  }
  let startWithSpace = false;
  let startEnd;
  let startNlPos = -1;
  for (startEnd = 0; startEnd < value.length; ++startEnd) {
    const ch = value[startEnd];
    if (ch === " ")
      startWithSpace = true;
    else if (ch === "\n")
      startNlPos = startEnd;
    else
      break;
  }
  let start = value.substring(0, startNlPos < startEnd ? startNlPos + 1 : startEnd);
  if (start) {
    value = value.substring(start.length);
    start = start.replace(/\n+/g, `$&${indent}`);
  }
  const indentSize = indent ? "2" : "1";
  let header = (startWithSpace ? indentSize : "") + chomp;
  if (comment) {
    header += " " + commentString(comment.replace(/ ?[\r\n]+/g, " "));
    if (onComment)
      onComment();
  }
  if (!literal) {
    const foldedValue = value.replace(/\n+/g, "\n$&").replace(/(?:^|\n)([\t ].*)(?:([\n\t ]*)\n(?![\n\t ]))?/g, "$1$2").replace(/\n+/g, `$&${indent}`);
    let literalFallback = false;
    const foldOptions = getFoldOptions(ctx, true);
    if (blockQuote !== "folded" && type !== Scalar.BLOCK_FOLDED) {
      foldOptions.onOverflow = () => {
        literalFallback = true;
      };
    }
    const body = foldFlowLines(`${start}${foldedValue}${end}`, indent, FOLD_BLOCK, foldOptions);
    if (!literalFallback)
      return `>${header}
${indent}${body}`;
  }
  value = value.replace(/\n+/g, `$&${indent}`);
  return `|${header}
${indent}${start}${value}${end}`;
}
function plainString(item, ctx, onComment, onChompKeep) {
  const { type, value } = item;
  const { actualString, implicitKey, indent, indentStep, inFlow } = ctx;
  if (implicitKey && value.includes("\n") || inFlow && /[[\]{},]/.test(value)) {
    return quotedString(value, ctx);
  }
  if (/^[\n\t ,[\]{}#&*!|>'"%@`]|^[?-]$|^[?-][ \t]|[\n:][ \t]|[ \t]\n|[\n\t ]#|[\n\t :]$/.test(value)) {
    return implicitKey || inFlow || !value.includes("\n") ? quotedString(value, ctx) : blockString(item, ctx, onComment, onChompKeep);
  }
  if (!implicitKey && !inFlow && type !== Scalar.PLAIN && value.includes("\n")) {
    return blockString(item, ctx, onComment, onChompKeep);
  }
  if (containsDocumentMarker(value)) {
    if (indent === "") {
      ctx.forceBlockIndent = true;
      return blockString(item, ctx, onComment, onChompKeep);
    } else if (implicitKey && indent === indentStep) {
      return quotedString(value, ctx);
    }
  }
  const str = value.replace(/\n+/g, `$&
${indent}`);
  if (actualString) {
    const test = (tag) => tag.default && tag.tag !== "tag:yaml.org,2002:str" && tag.test?.test(str);
    const { compat, tags } = ctx.doc.schema;
    if (tags.some(test) || compat?.some(test))
      return quotedString(value, ctx);
  }
  return implicitKey ? str : foldFlowLines(str, indent, FOLD_FLOW, getFoldOptions(ctx, false));
}
function stringifyString(item, ctx, onComment, onChompKeep) {
  const { implicitKey, inFlow } = ctx;
  const ss = typeof item.value === "string" ? item : Object.assign({}, item, { value: String(item.value) });
  let { type } = item;
  if (type !== Scalar.QUOTE_DOUBLE) {
    if (/[\x00-\x08\x0b-\x1f\x7f-\x9f\u{D800}-\u{DFFF}]/u.test(ss.value))
      type = Scalar.QUOTE_DOUBLE;
  }
  const _stringify = (_type) => {
    switch (_type) {
      case Scalar.BLOCK_FOLDED:
      case Scalar.BLOCK_LITERAL:
        return implicitKey || inFlow ? quotedString(ss.value, ctx) : blockString(ss, ctx, onComment, onChompKeep);
      case Scalar.QUOTE_DOUBLE:
        return doubleQuotedString(ss.value, ctx);
      case Scalar.QUOTE_SINGLE:
        return singleQuotedString(ss.value, ctx);
      case Scalar.PLAIN:
        return plainString(ss, ctx, onComment, onChompKeep);
      default:
        return null;
    }
  };
  let res = _stringify(type);
  if (res === null) {
    const { defaultKeyType, defaultStringType } = ctx.options;
    const t = implicitKey && defaultKeyType || defaultStringType;
    res = _stringify(t);
    if (res === null)
      throw new Error(`Unsupported default string type ${t}`);
  }
  return res;
}

// node_modules/yaml/browser/dist/stringify/stringify.js
function createStringifyContext(doc, options) {
  const opt = Object.assign({
    blockQuote: true,
    commentString: stringifyComment,
    defaultKeyType: null,
    defaultStringType: "PLAIN",
    directives: null,
    doubleQuotedAsJSON: false,
    doubleQuotedMinMultiLineLength: 40,
    falseStr: "false",
    flowCollectionPadding: true,
    indentSeq: true,
    lineWidth: 80,
    minContentWidth: 20,
    nullStr: "null",
    simpleKeys: false,
    singleQuote: null,
    trailingComma: false,
    trueStr: "true",
    verifyAliasOrder: true
  }, doc.schema.toStringOptions, options);
  let inFlow;
  switch (opt.collectionStyle) {
    case "block":
      inFlow = false;
      break;
    case "flow":
      inFlow = true;
      break;
    default:
      inFlow = null;
  }
  return {
    anchors: /* @__PURE__ */ new Set(),
    doc,
    flowCollectionPadding: opt.flowCollectionPadding ? " " : "",
    indent: "",
    indentStep: typeof opt.indent === "number" ? " ".repeat(opt.indent) : "  ",
    inFlow,
    options: opt
  };
}
function getTagObject(tags, item) {
  if (item.tag) {
    const match = tags.filter((t) => t.tag === item.tag);
    if (match.length > 0)
      return match.find((t) => t.format === item.format) ?? match[0];
  }
  let tagObj = void 0;
  let obj;
  if (isScalar(item)) {
    obj = item.value;
    let match = tags.filter((t) => t.identify?.(obj));
    if (match.length > 1) {
      const testMatch = match.filter((t) => t.test);
      if (testMatch.length > 0)
        match = testMatch;
    }
    tagObj = match.find((t) => t.format === item.format) ?? match.find((t) => !t.format);
  } else {
    obj = item;
    tagObj = tags.find((t) => t.nodeClass && obj instanceof t.nodeClass);
  }
  if (!tagObj) {
    const name = obj?.constructor?.name ?? (obj === null ? "null" : typeof obj);
    throw new Error(`Tag not resolved for ${name} value`);
  }
  return tagObj;
}
function stringifyProps(node, tagObj, { anchors, doc }) {
  if (!doc.directives)
    return "";
  const props = [];
  const anchor = (isScalar(node) || isCollection(node)) && node.anchor;
  if (anchor && anchorIsValid(anchor)) {
    anchors.add(anchor);
    props.push(`&${anchor}`);
  }
  const tag = node.tag ?? (tagObj.default ? null : tagObj.tag);
  if (tag)
    props.push(doc.directives.tagString(tag));
  return props.join(" ");
}
function stringify(item, ctx, onComment, onChompKeep) {
  if (isPair(item))
    return item.toString(ctx, onComment, onChompKeep);
  if (isAlias(item)) {
    if (ctx.doc.directives)
      return item.toString(ctx);
    if (ctx.resolvedAliases?.has(item)) {
      throw new TypeError(`Cannot stringify circular structure without alias nodes`);
    } else {
      if (ctx.resolvedAliases)
        ctx.resolvedAliases.add(item);
      else
        ctx.resolvedAliases = /* @__PURE__ */ new Set([item]);
      item = item.resolve(ctx.doc);
    }
  }
  let tagObj = void 0;
  const node = isNode(item) ? item : ctx.doc.createNode(item, { onTagObj: (o) => tagObj = o });
  tagObj ?? (tagObj = getTagObject(ctx.doc.schema.tags, node));
  const props = stringifyProps(node, tagObj, ctx);
  if (props.length > 0)
    ctx.indentAtStart = (ctx.indentAtStart ?? 0) + props.length + 1;
  const str = typeof tagObj.stringify === "function" ? tagObj.stringify(node, ctx, onComment, onChompKeep) : isScalar(node) ? stringifyString(node, ctx, onComment, onChompKeep) : node.toString(ctx, onComment, onChompKeep);
  if (!props)
    return str;
  return isScalar(node) || str[0] === "{" || str[0] === "[" ? `${props} ${str}` : `${props}
${ctx.indent}${str}`;
}

// node_modules/yaml/browser/dist/stringify/stringifyPair.js
function stringifyPair({ key: key2, value }, ctx, onComment, onChompKeep) {
  const { allNullValues, doc, indent, indentStep, options: { commentString, indentSeq, simpleKeys } } = ctx;
  let keyComment = isNode(key2) && key2.comment || null;
  if (simpleKeys) {
    if (keyComment) {
      throw new Error("With simple keys, key nodes cannot have comments");
    }
    if (isCollection(key2) || !isNode(key2) && typeof key2 === "object") {
      const msg = "With simple keys, collection cannot be used as a key value";
      throw new Error(msg);
    }
  }
  let explicitKey = !simpleKeys && (!key2 || keyComment && value == null && !ctx.inFlow || isCollection(key2) || (isScalar(key2) ? key2.type === Scalar.BLOCK_FOLDED || key2.type === Scalar.BLOCK_LITERAL : typeof key2 === "object"));
  ctx = Object.assign({}, ctx, {
    allNullValues: false,
    implicitKey: !explicitKey && (simpleKeys || !allNullValues),
    indent: indent + indentStep
  });
  let keyCommentDone = false;
  let chompKeep = false;
  let str = stringify(key2, ctx, () => keyCommentDone = true, () => chompKeep = true);
  if (!explicitKey && !ctx.inFlow && str.length > 1024) {
    if (simpleKeys)
      throw new Error("With simple keys, single line scalar must not span more than 1024 characters");
    explicitKey = true;
  }
  if (ctx.inFlow) {
    if (allNullValues || value == null) {
      if (keyCommentDone && onComment)
        onComment();
      return str === "" ? "?" : explicitKey ? `? ${str}` : str;
    }
  } else if (allNullValues && !simpleKeys || value == null && explicitKey) {
    str = `? ${str}`;
    if (keyComment && !keyCommentDone) {
      str += lineComment(str, ctx.indent, commentString(keyComment));
    } else if (chompKeep && onChompKeep)
      onChompKeep();
    return str;
  }
  if (keyCommentDone)
    keyComment = null;
  if (explicitKey) {
    if (keyComment)
      str += lineComment(str, ctx.indent, commentString(keyComment));
    str = `? ${str}
${indent}:`;
  } else {
    str = `${str}:`;
    if (keyComment)
      str += lineComment(str, ctx.indent, commentString(keyComment));
  }
  let vsb, vcb, valueComment;
  if (isNode(value)) {
    vsb = !!value.spaceBefore;
    vcb = value.commentBefore;
    valueComment = value.comment;
  } else {
    vsb = false;
    vcb = null;
    valueComment = null;
    if (value && typeof value === "object")
      value = doc.createNode(value);
  }
  ctx.implicitKey = false;
  if (!explicitKey && !keyComment && isScalar(value))
    ctx.indentAtStart = str.length + 1;
  chompKeep = false;
  if (!indentSeq && indentStep.length >= 2 && !ctx.inFlow && !explicitKey && isSeq(value) && !value.flow && !value.tag && !value.anchor) {
    ctx.indent = ctx.indent.substring(2);
  }
  let valueCommentDone = false;
  const valueStr = stringify(value, ctx, () => valueCommentDone = true, () => chompKeep = true);
  let ws = " ";
  if (keyComment || vsb || vcb) {
    ws = vsb ? "\n" : "";
    if (vcb) {
      const cs = commentString(vcb);
      ws += `
${indentComment(cs, ctx.indent)}`;
    }
    if (valueStr === "" && !ctx.inFlow) {
      if (ws === "\n" && valueComment)
        ws = "\n\n";
    } else {
      ws += `
${ctx.indent}`;
    }
  } else if (!explicitKey && isCollection(value)) {
    const vs0 = valueStr[0];
    const nl0 = valueStr.indexOf("\n");
    const hasNewline = nl0 !== -1;
    const flow = ctx.inFlow ?? value.flow ?? value.items.length === 0;
    if (hasNewline || !flow) {
      let hasPropsLine = false;
      if (hasNewline && (vs0 === "&" || vs0 === "!")) {
        let sp0 = valueStr.indexOf(" ");
        if (vs0 === "&" && sp0 !== -1 && sp0 < nl0 && valueStr[sp0 + 1] === "!") {
          sp0 = valueStr.indexOf(" ", sp0 + 1);
        }
        if (sp0 === -1 || nl0 < sp0)
          hasPropsLine = true;
      }
      if (!hasPropsLine)
        ws = `
${ctx.indent}`;
    }
  } else if (valueStr === "" || valueStr[0] === "\n") {
    ws = "";
  }
  str += ws + valueStr;
  if (ctx.inFlow) {
    if (valueCommentDone && onComment)
      onComment();
  } else if (valueComment && !valueCommentDone) {
    str += lineComment(str, ctx.indent, commentString(valueComment));
  } else if (chompKeep && onChompKeep) {
    onChompKeep();
  }
  return str;
}

// node_modules/yaml/browser/dist/log.js
function warn(logLevel, warning) {
  if (logLevel === "debug" || logLevel === "warn") {
    console.warn(warning);
  }
}

// node_modules/yaml/browser/dist/schema/yaml-1.1/merge.js
var MERGE_KEY = "<<";
var merge = {
  identify: (value) => value === MERGE_KEY || typeof value === "symbol" && value.description === MERGE_KEY,
  default: "key",
  tag: "tag:yaml.org,2002:merge",
  test: /^<<$/,
  resolve: () => Object.assign(new Scalar(Symbol(MERGE_KEY)), {
    addToJSMap: addMergeToJSMap
  }),
  stringify: () => MERGE_KEY
};
var isMergeKey = (ctx, key2) => (merge.identify(key2) || isScalar(key2) && (!key2.type || key2.type === Scalar.PLAIN) && merge.identify(key2.value)) && ctx?.doc.schema.tags.some((tag) => tag.tag === merge.tag && tag.default);
function addMergeToJSMap(ctx, map2, value) {
  const source = resolveAliasValue(ctx, value);
  if (isSeq(source))
    for (const it of source.items)
      mergeValue(ctx, map2, it);
  else if (Array.isArray(source))
    for (const it of source)
      mergeValue(ctx, map2, it);
  else
    mergeValue(ctx, map2, source);
}
function mergeValue(ctx, map2, value) {
  const source = resolveAliasValue(ctx, value);
  if (!isMap(source))
    throw new Error("Merge sources must be maps or map aliases");
  const srcMap = source.toJSON(null, ctx, Map);
  for (const [key2, value2] of srcMap) {
    if (map2 instanceof Map) {
      if (!map2.has(key2))
        map2.set(key2, value2);
    } else if (map2 instanceof Set) {
      map2.add(key2);
    } else if (!Object.prototype.hasOwnProperty.call(map2, key2)) {
      Object.defineProperty(map2, key2, {
        value: value2,
        writable: true,
        enumerable: true,
        configurable: true
      });
    }
  }
  return map2;
}
function resolveAliasValue(ctx, value) {
  return ctx && isAlias(value) ? value.resolve(ctx.doc, ctx) : value;
}

// node_modules/yaml/browser/dist/nodes/addPairToJSMap.js
function addPairToJSMap(ctx, map2, { key: key2, value }) {
  if (isNode(key2) && key2.addToJSMap)
    key2.addToJSMap(ctx, map2, value);
  else if (isMergeKey(ctx, key2))
    addMergeToJSMap(ctx, map2, value);
  else {
    const jsKey = toJS(key2, "", ctx);
    if (map2 instanceof Map) {
      map2.set(jsKey, toJS(value, jsKey, ctx));
    } else if (map2 instanceof Set) {
      map2.add(jsKey);
    } else {
      const stringKey = stringifyKey(key2, jsKey, ctx);
      const jsValue = toJS(value, stringKey, ctx);
      if (stringKey in map2)
        Object.defineProperty(map2, stringKey, {
          value: jsValue,
          writable: true,
          enumerable: true,
          configurable: true
        });
      else
        map2[stringKey] = jsValue;
    }
  }
  return map2;
}
function stringifyKey(key2, jsKey, ctx) {
  if (jsKey === null)
    return "";
  if (typeof jsKey !== "object")
    return String(jsKey);
  if (isNode(key2) && ctx?.doc) {
    const strCtx = createStringifyContext(ctx.doc, {});
    strCtx.anchors = /* @__PURE__ */ new Set();
    for (const node of ctx.anchors.keys())
      strCtx.anchors.add(node.anchor);
    strCtx.inFlow = true;
    strCtx.inStringifyKey = true;
    const strKey = key2.toString(strCtx);
    if (!ctx.mapKeyWarned) {
      let jsonStr = JSON.stringify(strKey);
      if (jsonStr.length > 40)
        jsonStr = jsonStr.substring(0, 36) + '..."';
      warn(ctx.doc.options.logLevel, `Keys with collection values will be stringified due to JS Object restrictions: ${jsonStr}. Set mapAsMap: true to use object keys.`);
      ctx.mapKeyWarned = true;
    }
    return strKey;
  }
  return JSON.stringify(jsKey);
}

// node_modules/yaml/browser/dist/nodes/Pair.js
function createPair(key2, value, ctx) {
  const k = createNode(key2, void 0, ctx);
  const v = createNode(value, void 0, ctx);
  return new Pair(k, v);
}
var Pair = class _Pair {
  constructor(key2, value = null) {
    Object.defineProperty(this, NODE_TYPE, { value: PAIR });
    this.key = key2;
    this.value = value;
  }
  clone(schema4) {
    let { key: key2, value } = this;
    if (isNode(key2))
      key2 = key2.clone(schema4);
    if (isNode(value))
      value = value.clone(schema4);
    return new _Pair(key2, value);
  }
  toJSON(_, ctx) {
    const pair = ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
    return addPairToJSMap(ctx, pair, this);
  }
  toString(ctx, onComment, onChompKeep) {
    return ctx?.doc ? stringifyPair(this, ctx, onComment, onChompKeep) : JSON.stringify(this);
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyCollection.js
function stringifyCollection(collection, ctx, options) {
  const flow = ctx.inFlow ?? collection.flow;
  const stringify4 = flow ? stringifyFlowCollection : stringifyBlockCollection;
  return stringify4(collection, ctx, options);
}
function stringifyBlockCollection({ comment, items }, ctx, { blockItemPrefix, flowChars, itemIndent, onChompKeep, onComment }) {
  const { indent, options: { commentString } } = ctx;
  const itemCtx = Object.assign({}, ctx, { indent: itemIndent, type: null });
  let chompKeep = false;
  const lines = [];
  for (let i = 0; i < items.length; ++i) {
    const item = items[i];
    let comment2 = null;
    if (isNode(item)) {
      if (!chompKeep && item.spaceBefore)
        lines.push("");
      addCommentBefore(ctx, lines, item.commentBefore, chompKeep);
      if (item.comment)
        comment2 = item.comment;
    } else if (isPair(item)) {
      const ik = isNode(item.key) ? item.key : null;
      if (ik) {
        if (!chompKeep && ik.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, ik.commentBefore, chompKeep);
      }
    }
    chompKeep = false;
    let str2 = stringify(item, itemCtx, () => comment2 = null, () => chompKeep = true);
    if (comment2)
      str2 += lineComment(str2, itemIndent, commentString(comment2));
    if (chompKeep && comment2)
      chompKeep = false;
    lines.push(blockItemPrefix + str2);
  }
  let str;
  if (lines.length === 0) {
    str = flowChars.start + flowChars.end;
  } else {
    str = lines[0];
    for (let i = 1; i < lines.length; ++i) {
      const line = lines[i];
      str += line ? `
${indent}${line}` : "\n";
    }
  }
  if (comment) {
    str += "\n" + indentComment(commentString(comment), indent);
    if (onComment)
      onComment();
  } else if (chompKeep && onChompKeep)
    onChompKeep();
  return str;
}
function stringifyFlowCollection({ items }, ctx, { flowChars, itemIndent }) {
  const { indent, indentStep, flowCollectionPadding: fcPadding, options: { commentString } } = ctx;
  itemIndent += indentStep;
  const itemCtx = Object.assign({}, ctx, {
    indent: itemIndent,
    inFlow: true,
    type: null
  });
  let reqNewline = false;
  let linesAtValue = 0;
  const lines = [];
  for (let i = 0; i < items.length; ++i) {
    const item = items[i];
    let comment = null;
    if (isNode(item)) {
      if (item.spaceBefore)
        lines.push("");
      addCommentBefore(ctx, lines, item.commentBefore, false);
      if (item.comment)
        comment = item.comment;
    } else if (isPair(item)) {
      const ik = isNode(item.key) ? item.key : null;
      if (ik) {
        if (ik.spaceBefore)
          lines.push("");
        addCommentBefore(ctx, lines, ik.commentBefore, false);
        if (ik.comment)
          reqNewline = true;
      }
      const iv = isNode(item.value) ? item.value : null;
      if (iv) {
        if (iv.comment)
          comment = iv.comment;
        if (iv.commentBefore)
          reqNewline = true;
      } else if (item.value == null && ik?.comment) {
        comment = ik.comment;
      }
    }
    if (comment)
      reqNewline = true;
    let str = stringify(item, itemCtx, () => comment = null);
    reqNewline || (reqNewline = lines.length > linesAtValue || str.includes("\n"));
    if (i < items.length - 1) {
      str += ",";
    } else if (ctx.options.trailingComma) {
      if (ctx.options.lineWidth > 0) {
        reqNewline || (reqNewline = lines.reduce((sum, line) => sum + line.length + 2, 2) + (str.length + 2) > ctx.options.lineWidth);
      }
      if (reqNewline) {
        str += ",";
      }
    }
    if (comment)
      str += lineComment(str, itemIndent, commentString(comment));
    lines.push(str);
    linesAtValue = lines.length;
  }
  const { start, end } = flowChars;
  if (lines.length === 0) {
    return start + end;
  } else {
    if (!reqNewline) {
      const len = lines.reduce((sum, line) => sum + line.length + 2, 2);
      reqNewline = ctx.options.lineWidth > 0 && len > ctx.options.lineWidth;
    }
    if (reqNewline) {
      let str = start;
      for (const line of lines)
        str += line ? `
${indentStep}${indent}${line}` : "\n";
      return `${str}
${indent}${end}`;
    } else {
      return `${start}${fcPadding}${lines.join(" ")}${fcPadding}${end}`;
    }
  }
}
function addCommentBefore({ indent, options: { commentString } }, lines, comment, chompKeep) {
  if (comment && chompKeep)
    comment = comment.replace(/^\n+/, "");
  if (comment) {
    const ic = indentComment(commentString(comment), indent);
    lines.push(ic.trimStart());
  }
}

// node_modules/yaml/browser/dist/nodes/YAMLMap.js
function findPair(items, key2) {
  const k = isScalar(key2) ? key2.value : key2;
  for (const it of items) {
    if (isPair(it)) {
      if (it.key === key2 || it.key === k)
        return it;
      if (isScalar(it.key) && it.key.value === k)
        return it;
    }
  }
  return void 0;
}
var YAMLMap = class extends Collection {
  static get tagName() {
    return "tag:yaml.org,2002:map";
  }
  constructor(schema4) {
    super(MAP, schema4);
    this.items = [];
  }
  /**
   * A generic collection parsing method that can be extended
   * to other node classes that inherit from YAMLMap
   */
  static from(schema4, obj, ctx) {
    const { keepUndefined, replacer } = ctx;
    const map2 = new this(schema4);
    const add = (key2, value) => {
      if (typeof replacer === "function")
        value = replacer.call(obj, key2, value);
      else if (Array.isArray(replacer) && !replacer.includes(key2))
        return;
      if (value !== void 0 || keepUndefined)
        map2.items.push(createPair(key2, value, ctx));
    };
    if (obj instanceof Map) {
      for (const [key2, value] of obj)
        add(key2, value);
    } else if (obj && typeof obj === "object") {
      for (const key2 of Object.keys(obj))
        add(key2, obj[key2]);
    }
    if (typeof schema4.sortMapEntries === "function") {
      map2.items.sort(schema4.sortMapEntries);
    }
    return map2;
  }
  /**
   * Adds a value to the collection.
   *
   * @param overwrite - If not set `true`, using a key that is already in the
   *   collection will throw. Otherwise, overwrites the previous value.
   */
  add(pair, overwrite) {
    let _pair;
    if (isPair(pair))
      _pair = pair;
    else if (!pair || typeof pair !== "object" || !("key" in pair)) {
      _pair = new Pair(pair, pair?.value);
    } else
      _pair = new Pair(pair.key, pair.value);
    const prev = findPair(this.items, _pair.key);
    const sortEntries = this.schema?.sortMapEntries;
    if (prev) {
      if (!overwrite)
        throw new Error(`Key ${_pair.key} already set`);
      if (isScalar(prev.value) && isScalarValue(_pair.value))
        prev.value.value = _pair.value;
      else
        prev.value = _pair.value;
    } else if (sortEntries) {
      const i = this.items.findIndex((item) => sortEntries(_pair, item) < 0);
      if (i === -1)
        this.items.push(_pair);
      else
        this.items.splice(i, 0, _pair);
    } else {
      this.items.push(_pair);
    }
  }
  delete(key2) {
    const it = findPair(this.items, key2);
    if (!it)
      return false;
    const del = this.items.splice(this.items.indexOf(it), 1);
    return del.length > 0;
  }
  get(key2, keepScalar) {
    const it = findPair(this.items, key2);
    const node = it?.value;
    return (!keepScalar && isScalar(node) ? node.value : node) ?? void 0;
  }
  has(key2) {
    return !!findPair(this.items, key2);
  }
  set(key2, value) {
    this.add(new Pair(key2, value), true);
  }
  /**
   * @param ctx - Conversion context, originally set in Document#toJS()
   * @param {Class} Type - If set, forces the returned collection type
   * @returns Instance of Type, Map, or Object
   */
  toJSON(_, ctx, Type) {
    const map2 = Type ? new Type() : ctx?.mapAsMap ? /* @__PURE__ */ new Map() : {};
    if (ctx?.onCreate)
      ctx.onCreate(map2);
    for (const item of this.items)
      addPairToJSMap(ctx, map2, item);
    return map2;
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    for (const item of this.items) {
      if (!isPair(item))
        throw new Error(`Map items must all be pairs; found ${JSON.stringify(item)} instead`);
    }
    if (!ctx.allNullValues && this.hasAllNullValues(false))
      ctx = Object.assign({}, ctx, { allNullValues: true });
    return stringifyCollection(this, ctx, {
      blockItemPrefix: "",
      flowChars: { start: "{", end: "}" },
      itemIndent: ctx.indent || "",
      onChompKeep,
      onComment
    });
  }
};

// node_modules/yaml/browser/dist/schema/common/map.js
var map = {
  collection: "map",
  default: true,
  nodeClass: YAMLMap,
  tag: "tag:yaml.org,2002:map",
  resolve(map2, onError) {
    if (!isMap(map2))
      onError("Expected a mapping for this tag");
    return map2;
  },
  createNode: (schema4, obj, ctx) => YAMLMap.from(schema4, obj, ctx)
};

// node_modules/yaml/browser/dist/nodes/YAMLSeq.js
var YAMLSeq = class extends Collection {
  static get tagName() {
    return "tag:yaml.org,2002:seq";
  }
  constructor(schema4) {
    super(SEQ, schema4);
    this.items = [];
  }
  add(value) {
    this.items.push(value);
  }
  /**
   * Removes a value from the collection.
   *
   * `key` must contain a representation of an integer for this to succeed.
   * It may be wrapped in a `Scalar`.
   *
   * @returns `true` if the item was found and removed.
   */
  delete(key2) {
    const idx = asItemIndex(key2);
    if (typeof idx !== "number")
      return false;
    const del = this.items.splice(idx, 1);
    return del.length > 0;
  }
  get(key2, keepScalar) {
    const idx = asItemIndex(key2);
    if (typeof idx !== "number")
      return void 0;
    const it = this.items[idx];
    return !keepScalar && isScalar(it) ? it.value : it;
  }
  /**
   * Checks if the collection includes a value with the key `key`.
   *
   * `key` must contain a representation of an integer for this to succeed.
   * It may be wrapped in a `Scalar`.
   */
  has(key2) {
    const idx = asItemIndex(key2);
    return typeof idx === "number" && idx < this.items.length;
  }
  /**
   * Sets a value in this collection. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   *
   * If `key` does not contain a representation of an integer, this will throw.
   * It may be wrapped in a `Scalar`.
   */
  set(key2, value) {
    const idx = asItemIndex(key2);
    if (typeof idx !== "number")
      throw new Error(`Expected a valid index, not ${key2}.`);
    const prev = this.items[idx];
    if (isScalar(prev) && isScalarValue(value))
      prev.value = value;
    else
      this.items[idx] = value;
  }
  toJSON(_, ctx) {
    const seq2 = [];
    if (ctx?.onCreate)
      ctx.onCreate(seq2);
    let i = 0;
    for (const item of this.items)
      seq2.push(toJS(item, String(i++), ctx));
    return seq2;
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    return stringifyCollection(this, ctx, {
      blockItemPrefix: "- ",
      flowChars: { start: "[", end: "]" },
      itemIndent: (ctx.indent || "") + "  ",
      onChompKeep,
      onComment
    });
  }
  static from(schema4, obj, ctx) {
    const { replacer } = ctx;
    const seq2 = new this(schema4);
    if (obj && Symbol.iterator in Object(obj)) {
      let i = 0;
      for (let it of obj) {
        if (typeof replacer === "function") {
          const key2 = obj instanceof Set ? it : String(i++);
          it = replacer.call(obj, key2, it);
        }
        seq2.items.push(createNode(it, void 0, ctx));
      }
    }
    return seq2;
  }
};
function asItemIndex(key2) {
  let idx = isScalar(key2) ? key2.value : key2;
  if (idx && typeof idx === "string")
    idx = Number(idx);
  return typeof idx === "number" && Number.isInteger(idx) && idx >= 0 ? idx : null;
}

// node_modules/yaml/browser/dist/schema/common/seq.js
var seq = {
  collection: "seq",
  default: true,
  nodeClass: YAMLSeq,
  tag: "tag:yaml.org,2002:seq",
  resolve(seq2, onError) {
    if (!isSeq(seq2))
      onError("Expected a sequence for this tag");
    return seq2;
  },
  createNode: (schema4, obj, ctx) => YAMLSeq.from(schema4, obj, ctx)
};

// node_modules/yaml/browser/dist/schema/common/string.js
var string = {
  identify: (value) => typeof value === "string",
  default: true,
  tag: "tag:yaml.org,2002:str",
  resolve: (str) => str,
  stringify(item, ctx, onComment, onChompKeep) {
    ctx = Object.assign({ actualString: true }, ctx);
    return stringifyString(item, ctx, onComment, onChompKeep);
  }
};

// node_modules/yaml/browser/dist/schema/common/null.js
var nullTag = {
  identify: (value) => value == null,
  createNode: () => new Scalar(null),
  default: true,
  tag: "tag:yaml.org,2002:null",
  test: /^(?:~|[Nn]ull|NULL)?$/,
  resolve: () => new Scalar(null),
  stringify: ({ source }, ctx) => typeof source === "string" && nullTag.test.test(source) ? source : ctx.options.nullStr
};

// node_modules/yaml/browser/dist/schema/core/bool.js
var boolTag = {
  identify: (value) => typeof value === "boolean",
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:[Tt]rue|TRUE|[Ff]alse|FALSE)$/,
  resolve: (str) => new Scalar(str[0] === "t" || str[0] === "T"),
  stringify({ source, value }, ctx) {
    if (source && boolTag.test.test(source)) {
      const sv = source[0] === "t" || source[0] === "T";
      if (value === sv)
        return source;
    }
    return value ? ctx.options.trueStr : ctx.options.falseStr;
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyNumber.js
function stringifyNumber({ format, minFractionDigits, tag, value }) {
  if (typeof value === "bigint")
    return String(value);
  const num = typeof value === "number" ? value : Number(value);
  if (!isFinite(num))
    return isNaN(num) ? ".nan" : num < 0 ? "-.inf" : ".inf";
  let n = Object.is(value, -0) ? "-0" : JSON.stringify(value);
  if (!format && minFractionDigits && (!tag || tag === "tag:yaml.org,2002:float") && /^-?\d/.test(n) && !n.includes("e")) {
    let i = n.indexOf(".");
    if (i < 0) {
      i = n.length;
      n += ".";
    }
    let d = minFractionDigits - (n.length - i - 1);
    while (d-- > 0)
      n += "0";
  }
  return n;
}

// node_modules/yaml/browser/dist/schema/core/float.js
var floatNaN = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
};
var floatExp = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "EXP",
  test: /^[-+]?(?:\.[0-9]+|[0-9]+(?:\.[0-9]*)?)[eE][-+]?[0-9]+$/,
  resolve: (str) => parseFloat(str),
  stringify(node) {
    const num = Number(node.value);
    return isFinite(num) ? num.toExponential() : stringifyNumber(node);
  }
};
var float = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^[-+]?(?:\.[0-9]+|[0-9]+\.[0-9]*)$/,
  resolve(str) {
    const node = new Scalar(parseFloat(str));
    const dot = str.indexOf(".");
    if (dot !== -1 && str[str.length - 1] === "0")
      node.minFractionDigits = str.length - dot - 1;
    return node;
  },
  stringify: stringifyNumber
};

// node_modules/yaml/browser/dist/schema/core/int.js
var intIdentify = (value) => typeof value === "bigint" || Number.isInteger(value);
var intResolve = (str, offset, radix, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str.substring(offset), radix);
function intStringify(node, radix, prefix) {
  const { value } = node;
  if (intIdentify(value) && value >= 0)
    return prefix + value.toString(radix);
  return stringifyNumber(node);
}
var intOct = {
  identify: (value) => intIdentify(value) && value >= 0,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "OCT",
  test: /^0o[0-7]+$/,
  resolve: (str, _onError, opt) => intResolve(str, 2, 8, opt),
  stringify: (node) => intStringify(node, 8, "0o")
};
var int = {
  identify: intIdentify,
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^[-+]?[0-9]+$/,
  resolve: (str, _onError, opt) => intResolve(str, 0, 10, opt),
  stringify: stringifyNumber
};
var intHex = {
  identify: (value) => intIdentify(value) && value >= 0,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "HEX",
  test: /^0x[0-9a-fA-F]+$/,
  resolve: (str, _onError, opt) => intResolve(str, 2, 16, opt),
  stringify: (node) => intStringify(node, 16, "0x")
};

// node_modules/yaml/browser/dist/schema/core/schema.js
var schema = [
  map,
  seq,
  string,
  nullTag,
  boolTag,
  intOct,
  int,
  intHex,
  floatNaN,
  floatExp,
  float
];

// node_modules/yaml/browser/dist/schema/json/schema.js
function intIdentify2(value) {
  return typeof value === "bigint" || Number.isInteger(value);
}
var stringifyJSON = ({ value }) => JSON.stringify(value);
var jsonScalars = [
  {
    identify: (value) => typeof value === "string",
    default: true,
    tag: "tag:yaml.org,2002:str",
    resolve: (str) => str,
    stringify: stringifyJSON
  },
  {
    identify: (value) => value == null,
    createNode: () => new Scalar(null),
    default: true,
    tag: "tag:yaml.org,2002:null",
    test: /^null$/,
    resolve: () => null,
    stringify: stringifyJSON
  },
  {
    identify: (value) => typeof value === "boolean",
    default: true,
    tag: "tag:yaml.org,2002:bool",
    test: /^true$|^false$/,
    resolve: (str) => str === "true",
    stringify: stringifyJSON
  },
  {
    identify: intIdentify2,
    default: true,
    tag: "tag:yaml.org,2002:int",
    test: /^-?(?:0|[1-9][0-9]*)$/,
    resolve: (str, _onError, { intAsBigInt }) => intAsBigInt ? BigInt(str) : parseInt(str, 10),
    stringify: ({ value }) => intIdentify2(value) ? value.toString() : JSON.stringify(value)
  },
  {
    identify: (value) => typeof value === "number",
    default: true,
    tag: "tag:yaml.org,2002:float",
    test: /^-?(?:0|[1-9][0-9]*)(?:\.[0-9]*)?(?:[eE][-+]?[0-9]+)?$/,
    resolve: (str) => parseFloat(str),
    stringify: stringifyJSON
  }
];
var jsonError = {
  default: true,
  tag: "",
  test: /^/,
  resolve(str, onError) {
    onError(`Unresolved plain scalar ${JSON.stringify(str)}`);
    return str;
  }
};
var schema2 = [map, seq].concat(jsonScalars, jsonError);

// node_modules/yaml/browser/dist/schema/yaml-1.1/binary.js
var binary = {
  identify: (value) => value instanceof Uint8Array,
  // Buffer inherits from Uint8Array
  default: false,
  tag: "tag:yaml.org,2002:binary",
  /**
   * Returns a Buffer in node and an Uint8Array in browsers
   *
   * To use the resulting buffer as an image, you'll want to do something like:
   *
   *   const blob = new Blob([buffer], { type: 'image/jpeg' })
   *   document.querySelector('#photo').src = URL.createObjectURL(blob)
   */
  resolve(src, onError) {
    if (typeof atob === "function") {
      const str = atob(src.replace(/[\n\r]/g, ""));
      const buffer = new Uint8Array(str.length);
      for (let i = 0; i < str.length; ++i)
        buffer[i] = str.charCodeAt(i);
      return buffer;
    } else {
      onError("This environment does not support reading binary tags; either Buffer or atob is required");
      return src;
    }
  },
  stringify({ comment, type, value }, ctx, onComment, onChompKeep) {
    if (!value)
      return "";
    const buf = value;
    let str;
    if (typeof btoa === "function") {
      let s = "";
      for (let i = 0; i < buf.length; ++i)
        s += String.fromCharCode(buf[i]);
      str = btoa(s);
    } else {
      throw new Error("This environment does not support writing binary tags; either Buffer or btoa is required");
    }
    type ?? (type = Scalar.BLOCK_LITERAL);
    if (type !== Scalar.QUOTE_DOUBLE) {
      const lineWidth = Math.max(ctx.options.lineWidth - ctx.indent.length, ctx.options.minContentWidth);
      const n = Math.ceil(str.length / lineWidth);
      const lines = new Array(n);
      for (let i = 0, o = 0; i < n; ++i, o += lineWidth) {
        lines[i] = str.substr(o, lineWidth);
      }
      str = lines.join(type === Scalar.BLOCK_LITERAL ? "\n" : " ");
    }
    return stringifyString({ comment, type, value: str }, ctx, onComment, onChompKeep);
  }
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/pairs.js
function resolvePairs(seq2, onError) {
  if (isSeq(seq2)) {
    for (let i = 0; i < seq2.items.length; ++i) {
      let item = seq2.items[i];
      if (isPair(item))
        continue;
      else if (isMap(item)) {
        if (item.items.length > 1)
          onError("Each pair must have its own sequence indicator");
        const pair = item.items[0] || new Pair(new Scalar(null));
        if (item.commentBefore)
          pair.key.commentBefore = pair.key.commentBefore ? `${item.commentBefore}
${pair.key.commentBefore}` : item.commentBefore;
        if (item.comment) {
          const cn = pair.value ?? pair.key;
          cn.comment = cn.comment ? `${item.comment}
${cn.comment}` : item.comment;
        }
        item = pair;
      }
      seq2.items[i] = isPair(item) ? item : new Pair(item);
    }
  } else
    onError("Expected a sequence for this tag");
  return seq2;
}
function createPairs(schema4, iterable, ctx) {
  const { replacer } = ctx;
  const pairs3 = new YAMLSeq(schema4);
  pairs3.tag = "tag:yaml.org,2002:pairs";
  let i = 0;
  if (iterable && Symbol.iterator in Object(iterable))
    for (let it of iterable) {
      if (typeof replacer === "function")
        it = replacer.call(iterable, String(i++), it);
      let key2, value;
      if (Array.isArray(it)) {
        if (it.length === 2) {
          key2 = it[0];
          value = it[1];
        } else
          throw new TypeError(`Expected [key, value] tuple: ${it}`);
      } else if (it && it instanceof Object) {
        const keys = Object.keys(it);
        if (keys.length === 1) {
          key2 = keys[0];
          value = it[key2];
        } else {
          throw new TypeError(`Expected tuple with one key, not ${keys.length} keys`);
        }
      } else {
        key2 = it;
      }
      pairs3.items.push(createPair(key2, value, ctx));
    }
  return pairs3;
}
var pairs = {
  collection: "seq",
  default: false,
  tag: "tag:yaml.org,2002:pairs",
  resolve: resolvePairs,
  createNode: createPairs
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/omap.js
var YAMLOMap = class _YAMLOMap extends YAMLSeq {
  constructor() {
    super();
    this.add = YAMLMap.prototype.add.bind(this);
    this.delete = YAMLMap.prototype.delete.bind(this);
    this.get = YAMLMap.prototype.get.bind(this);
    this.has = YAMLMap.prototype.has.bind(this);
    this.set = YAMLMap.prototype.set.bind(this);
    this.tag = _YAMLOMap.tag;
  }
  /**
   * If `ctx` is given, the return type is actually `Map<unknown, unknown>`,
   * but TypeScript won't allow widening the signature of a child method.
   */
  toJSON(_, ctx) {
    if (!ctx)
      return super.toJSON(_);
    const map2 = /* @__PURE__ */ new Map();
    if (ctx?.onCreate)
      ctx.onCreate(map2);
    for (const pair of this.items) {
      let key2, value;
      if (isPair(pair)) {
        key2 = toJS(pair.key, "", ctx);
        value = toJS(pair.value, key2, ctx);
      } else {
        key2 = toJS(pair, "", ctx);
      }
      if (map2.has(key2))
        throw new Error("Ordered maps must not include duplicate keys");
      map2.set(key2, value);
    }
    return map2;
  }
  static from(schema4, iterable, ctx) {
    const pairs3 = createPairs(schema4, iterable, ctx);
    const omap2 = new this();
    omap2.items = pairs3.items;
    return omap2;
  }
};
YAMLOMap.tag = "tag:yaml.org,2002:omap";
var omap = {
  collection: "seq",
  identify: (value) => value instanceof Map,
  nodeClass: YAMLOMap,
  default: false,
  tag: "tag:yaml.org,2002:omap",
  resolve(seq2, onError) {
    const pairs3 = resolvePairs(seq2, onError);
    const seenKeys = [];
    for (const { key: key2 } of pairs3.items) {
      if (isScalar(key2)) {
        if (seenKeys.includes(key2.value)) {
          onError(`Ordered maps must not include duplicate keys: ${key2.value}`);
        } else {
          seenKeys.push(key2.value);
        }
      }
    }
    return Object.assign(new YAMLOMap(), pairs3);
  },
  createNode: (schema4, iterable, ctx) => YAMLOMap.from(schema4, iterable, ctx)
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/bool.js
function boolStringify({ value, source }, ctx) {
  const boolObj = value ? trueTag : falseTag;
  if (source && boolObj.test.test(source))
    return source;
  return value ? ctx.options.trueStr : ctx.options.falseStr;
}
var trueTag = {
  identify: (value) => value === true,
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:Y|y|[Yy]es|YES|[Tt]rue|TRUE|[Oo]n|ON)$/,
  resolve: () => new Scalar(true),
  stringify: boolStringify
};
var falseTag = {
  identify: (value) => value === false,
  default: true,
  tag: "tag:yaml.org,2002:bool",
  test: /^(?:N|n|[Nn]o|NO|[Ff]alse|FALSE|[Oo]ff|OFF)$/,
  resolve: () => new Scalar(false),
  stringify: boolStringify
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/float.js
var floatNaN2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^(?:[-+]?\.(?:inf|Inf|INF)|\.nan|\.NaN|\.NAN)$/,
  resolve: (str) => str.slice(-3).toLowerCase() === "nan" ? NaN : str[0] === "-" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY,
  stringify: stringifyNumber
};
var floatExp2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "EXP",
  test: /^[-+]?(?:[0-9][0-9_]*)?(?:\.[0-9_]*)?[eE][-+]?[0-9]+$/,
  resolve: (str) => parseFloat(str.replace(/_/g, "")),
  stringify(node) {
    const num = Number(node.value);
    return isFinite(num) ? num.toExponential() : stringifyNumber(node);
  }
};
var float2 = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  test: /^[-+]?(?:[0-9][0-9_]*)?\.[0-9_]*$/,
  resolve(str) {
    const node = new Scalar(parseFloat(str.replace(/_/g, "")));
    const dot = str.indexOf(".");
    if (dot !== -1) {
      const f = str.substring(dot + 1).replace(/_/g, "");
      if (f[f.length - 1] === "0")
        node.minFractionDigits = f.length;
    }
    return node;
  },
  stringify: stringifyNumber
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/int.js
var intIdentify3 = (value) => typeof value === "bigint" || Number.isInteger(value);
function intResolve2(str, offset, radix, { intAsBigInt }) {
  const sign = str[0];
  if (sign === "-" || sign === "+")
    offset += 1;
  str = str.substring(offset).replace(/_/g, "");
  if (intAsBigInt) {
    switch (radix) {
      case 2:
        str = `0b${str}`;
        break;
      case 8:
        str = `0o${str}`;
        break;
      case 16:
        str = `0x${str}`;
        break;
    }
    const n2 = BigInt(str);
    return sign === "-" ? BigInt(-1) * n2 : n2;
  }
  const n = parseInt(str, radix);
  return sign === "-" ? -1 * n : n;
}
function intStringify2(node, radix, prefix) {
  const { value } = node;
  if (intIdentify3(value)) {
    const str = value.toString(radix);
    return value < 0 ? "-" + prefix + str.substr(1) : prefix + str;
  }
  return stringifyNumber(node);
}
var intBin = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "BIN",
  test: /^[-+]?0b[0-1_]+$/,
  resolve: (str, _onError, opt) => intResolve2(str, 2, 2, opt),
  stringify: (node) => intStringify2(node, 2, "0b")
};
var intOct2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "OCT",
  test: /^[-+]?0[0-7_]+$/,
  resolve: (str, _onError, opt) => intResolve2(str, 1, 8, opt),
  stringify: (node) => intStringify2(node, 8, "0")
};
var int2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  test: /^[-+]?[0-9][0-9_]*$/,
  resolve: (str, _onError, opt) => intResolve2(str, 0, 10, opt),
  stringify: stringifyNumber
};
var intHex2 = {
  identify: intIdentify3,
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "HEX",
  test: /^[-+]?0x[0-9a-fA-F_]+$/,
  resolve: (str, _onError, opt) => intResolve2(str, 2, 16, opt),
  stringify: (node) => intStringify2(node, 16, "0x")
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/set.js
var YAMLSet = class _YAMLSet extends YAMLMap {
  constructor(schema4) {
    super(schema4);
    this.tag = _YAMLSet.tag;
  }
  add(key2) {
    let pair;
    if (isPair(key2))
      pair = key2;
    else if (key2 && typeof key2 === "object" && "key" in key2 && "value" in key2 && key2.value === null)
      pair = new Pair(key2.key, null);
    else
      pair = new Pair(key2, null);
    const prev = findPair(this.items, pair.key);
    if (!prev)
      this.items.push(pair);
  }
  /**
   * If `keepPair` is `true`, returns the Pair matching `key`.
   * Otherwise, returns the value of that Pair's key.
   */
  get(key2, keepPair) {
    const pair = findPair(this.items, key2);
    return !keepPair && isPair(pair) ? isScalar(pair.key) ? pair.key.value : pair.key : pair;
  }
  set(key2, value) {
    if (typeof value !== "boolean")
      throw new Error(`Expected boolean value for set(key, value) in a YAML set, not ${typeof value}`);
    const prev = findPair(this.items, key2);
    if (prev && !value) {
      this.items.splice(this.items.indexOf(prev), 1);
    } else if (!prev && value) {
      this.items.push(new Pair(key2));
    }
  }
  toJSON(_, ctx) {
    return super.toJSON(_, ctx, Set);
  }
  toString(ctx, onComment, onChompKeep) {
    if (!ctx)
      return JSON.stringify(this);
    if (this.hasAllNullValues(true))
      return super.toString(Object.assign({}, ctx, { allNullValues: true }), onComment, onChompKeep);
    else
      throw new Error("Set items must all have null values");
  }
  static from(schema4, iterable, ctx) {
    const { replacer } = ctx;
    const set2 = new this(schema4);
    if (iterable && Symbol.iterator in Object(iterable))
      for (let value of iterable) {
        if (typeof replacer === "function")
          value = replacer.call(iterable, value, value);
        set2.items.push(createPair(value, null, ctx));
      }
    return set2;
  }
};
YAMLSet.tag = "tag:yaml.org,2002:set";
var set = {
  collection: "map",
  identify: (value) => value instanceof Set,
  nodeClass: YAMLSet,
  default: false,
  tag: "tag:yaml.org,2002:set",
  createNode: (schema4, iterable, ctx) => YAMLSet.from(schema4, iterable, ctx),
  resolve(map2, onError) {
    if (isMap(map2)) {
      if (map2.hasAllNullValues(true))
        return Object.assign(new YAMLSet(), map2);
      else
        onError("Set items must all have null values");
    } else
      onError("Expected a mapping for this tag");
    return map2;
  }
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/timestamp.js
function parseSexagesimal(str, asBigInt) {
  const sign = str[0];
  const parts = sign === "-" || sign === "+" ? str.substring(1) : str;
  const num = (n) => asBigInt ? BigInt(n) : Number(n);
  const res = parts.replace(/_/g, "").split(":").reduce((res2, p) => res2 * num(60) + num(p), num(0));
  return sign === "-" ? num(-1) * res : res;
}
function stringifySexagesimal(node) {
  let { value } = node;
  let num = (n) => n;
  if (typeof value === "bigint")
    num = (n) => BigInt(n);
  else if (isNaN(value) || !isFinite(value))
    return stringifyNumber(node);
  let sign = "";
  if (value < 0) {
    sign = "-";
    value *= num(-1);
  }
  const _60 = num(60);
  const parts = [value % _60];
  if (value < 60) {
    parts.unshift(0);
  } else {
    value = (value - parts[0]) / _60;
    parts.unshift(value % _60);
    if (value >= 60) {
      value = (value - parts[0]) / _60;
      parts.unshift(value);
    }
  }
  return sign + parts.map((n) => String(n).padStart(2, "0")).join(":").replace(/000000\d*$/, "");
}
var intTime = {
  identify: (value) => typeof value === "bigint" || Number.isInteger(value),
  default: true,
  tag: "tag:yaml.org,2002:int",
  format: "TIME",
  test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+$/,
  resolve: (str, _onError, { intAsBigInt }) => parseSexagesimal(str, intAsBigInt),
  stringify: stringifySexagesimal
};
var floatTime = {
  identify: (value) => typeof value === "number",
  default: true,
  tag: "tag:yaml.org,2002:float",
  format: "TIME",
  test: /^[-+]?[0-9][0-9_]*(?::[0-5]?[0-9])+\.[0-9_]*$/,
  resolve: (str) => parseSexagesimal(str, false),
  stringify: stringifySexagesimal
};
var timestamp = {
  identify: (value) => value instanceof Date,
  default: true,
  tag: "tag:yaml.org,2002:timestamp",
  // If the time zone is omitted, the timestamp is assumed to be specified in UTC. The time part
  // may be omitted altogether, resulting in a date format. In such a case, the time part is
  // assumed to be 00:00:00Z (start of day, UTC).
  test: RegExp("^([0-9]{4})-([0-9]{1,2})-([0-9]{1,2})(?:(?:t|T|[ \\t]+)([0-9]{1,2}):([0-9]{1,2}):([0-9]{1,2}(\\.[0-9]+)?)(?:[ \\t]*(Z|[-+][012]?[0-9](?::[0-9]{2})?))?)?$"),
  resolve(str) {
    const match = str.match(timestamp.test);
    if (!match)
      throw new Error("!!timestamp expects a date, starting with yyyy-mm-dd");
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const millisec = match[7] ? Number((match[7] + "00").substr(1, 3)) : 0;
    let date = Date.UTC(year, month - 1, day, hour || 0, minute || 0, second || 0, millisec);
    const tz = match[8];
    if (tz && tz !== "Z") {
      let d = parseSexagesimal(tz, false);
      if (Math.abs(d) < 30)
        d *= 60;
      date -= 6e4 * d;
    }
    return new Date(date);
  },
  stringify: ({ value }) => value?.toISOString().replace(/(T00:00:00)?\.000Z$/, "") ?? ""
};

// node_modules/yaml/browser/dist/schema/yaml-1.1/schema.js
var schema3 = [
  map,
  seq,
  string,
  nullTag,
  trueTag,
  falseTag,
  intBin,
  intOct2,
  int2,
  intHex2,
  floatNaN2,
  floatExp2,
  float2,
  binary,
  merge,
  omap,
  pairs,
  set,
  intTime,
  floatTime,
  timestamp
];

// node_modules/yaml/browser/dist/schema/tags.js
var schemas = /* @__PURE__ */ new Map([
  ["core", schema],
  ["failsafe", [map, seq, string]],
  ["json", schema2],
  ["yaml11", schema3],
  ["yaml-1.1", schema3]
]);
var tagsByName = {
  binary,
  bool: boolTag,
  float,
  floatExp,
  floatNaN,
  floatTime,
  int,
  intHex,
  intOct,
  intTime,
  map,
  merge,
  null: nullTag,
  omap,
  pairs,
  seq,
  set,
  timestamp
};
var coreKnownTags = {
  "tag:yaml.org,2002:binary": binary,
  "tag:yaml.org,2002:merge": merge,
  "tag:yaml.org,2002:omap": omap,
  "tag:yaml.org,2002:pairs": pairs,
  "tag:yaml.org,2002:set": set,
  "tag:yaml.org,2002:timestamp": timestamp
};
function getTags(customTags, schemaName, addMergeTag) {
  const schemaTags = schemas.get(schemaName);
  if (schemaTags && !customTags) {
    return addMergeTag && !schemaTags.includes(merge) ? schemaTags.concat(merge) : schemaTags.slice();
  }
  let tags = schemaTags;
  if (!tags) {
    if (Array.isArray(customTags))
      tags = [];
    else {
      const keys = Array.from(schemas.keys()).filter((key2) => key2 !== "yaml11").map((key2) => JSON.stringify(key2)).join(", ");
      throw new Error(`Unknown schema "${schemaName}"; use one of ${keys} or define customTags array`);
    }
  }
  if (Array.isArray(customTags)) {
    for (const tag of customTags)
      tags = tags.concat(tag);
  } else if (typeof customTags === "function") {
    tags = customTags(tags.slice());
  }
  if (addMergeTag)
    tags = tags.concat(merge);
  return tags.reduce((tags2, tag) => {
    const tagObj = typeof tag === "string" ? tagsByName[tag] : tag;
    if (!tagObj) {
      const tagName = JSON.stringify(tag);
      const keys = Object.keys(tagsByName).map((key2) => JSON.stringify(key2)).join(", ");
      throw new Error(`Unknown custom tag ${tagName}; use one of ${keys}`);
    }
    if (!tags2.includes(tagObj))
      tags2.push(tagObj);
    return tags2;
  }, []);
}

// node_modules/yaml/browser/dist/schema/Schema.js
var sortMapEntriesByKey = (a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
var Schema = class _Schema {
  constructor({ compat, customTags, merge: merge2, resolveKnownTags, schema: schema4, sortMapEntries, toStringDefaults }) {
    this.compat = Array.isArray(compat) ? getTags(compat, "compat") : compat ? getTags(null, compat) : null;
    this.name = typeof schema4 === "string" && schema4 || "core";
    this.knownTags = resolveKnownTags ? coreKnownTags : {};
    this.tags = getTags(customTags, this.name, merge2);
    this.toStringOptions = toStringDefaults ?? null;
    Object.defineProperty(this, MAP, { value: map });
    Object.defineProperty(this, SCALAR, { value: string });
    Object.defineProperty(this, SEQ, { value: seq });
    this.sortMapEntries = typeof sortMapEntries === "function" ? sortMapEntries : sortMapEntries === true ? sortMapEntriesByKey : null;
  }
  clone() {
    const copy = Object.create(_Schema.prototype, Object.getOwnPropertyDescriptors(this));
    copy.tags = this.tags.slice();
    return copy;
  }
};

// node_modules/yaml/browser/dist/stringify/stringifyDocument.js
function stringifyDocument(doc, options) {
  const lines = [];
  let hasDirectives = options.directives === true;
  if (options.directives !== false && doc.directives) {
    const dir = doc.directives.toString(doc);
    if (dir) {
      lines.push(dir);
      hasDirectives = true;
    } else if (doc.directives.docStart)
      hasDirectives = true;
  }
  if (hasDirectives)
    lines.push("---");
  const ctx = createStringifyContext(doc, options);
  const { commentString } = ctx.options;
  if (doc.commentBefore) {
    if (lines.length !== 1)
      lines.unshift("");
    const cs = commentString(doc.commentBefore);
    lines.unshift(indentComment(cs, ""));
  }
  let chompKeep = false;
  let contentComment = null;
  if (doc.contents) {
    if (isNode(doc.contents)) {
      if (doc.contents.spaceBefore && hasDirectives)
        lines.push("");
      if (doc.contents.commentBefore) {
        const cs = commentString(doc.contents.commentBefore);
        lines.push(indentComment(cs, ""));
      }
      ctx.forceBlockIndent = !!doc.comment;
      contentComment = doc.contents.comment;
    }
    const onChompKeep = contentComment ? void 0 : () => chompKeep = true;
    let body = stringify(doc.contents, ctx, () => contentComment = null, onChompKeep);
    if (contentComment)
      body += lineComment(body, "", commentString(contentComment));
    if ((body[0] === "|" || body[0] === ">") && lines[lines.length - 1] === "---") {
      lines[lines.length - 1] = `--- ${body}`;
    } else
      lines.push(body);
  } else {
    lines.push(stringify(doc.contents, ctx));
  }
  if (doc.directives?.docEnd) {
    if (doc.comment) {
      const cs = commentString(doc.comment);
      if (cs.includes("\n")) {
        lines.push("...");
        lines.push(indentComment(cs, ""));
      } else {
        lines.push(`... ${cs}`);
      }
    } else {
      lines.push("...");
    }
  } else {
    let dc = doc.comment;
    if (dc && chompKeep)
      dc = dc.replace(/^\n+/, "");
    if (dc) {
      if ((!chompKeep || contentComment) && lines[lines.length - 1] !== "")
        lines.push("");
      lines.push(indentComment(commentString(dc), ""));
    }
  }
  return lines.join("\n") + "\n";
}

// node_modules/yaml/browser/dist/doc/Document.js
var Document = class _Document {
  constructor(value, replacer, options) {
    this.commentBefore = null;
    this.comment = null;
    this.errors = [];
    this.warnings = [];
    Object.defineProperty(this, NODE_TYPE, { value: DOC });
    let _replacer = null;
    if (typeof replacer === "function" || Array.isArray(replacer)) {
      _replacer = replacer;
    } else if (options === void 0 && replacer) {
      options = replacer;
      replacer = void 0;
    }
    const opt = Object.assign({
      intAsBigInt: false,
      keepSourceTokens: false,
      logLevel: "warn",
      prettyErrors: true,
      strict: true,
      stringKeys: false,
      uniqueKeys: true,
      version: "1.2"
    }, options);
    this.options = opt;
    let { version } = opt;
    if (options?._directives) {
      this.directives = options._directives.atDocument();
      if (this.directives.yaml.explicit)
        version = this.directives.yaml.version;
    } else
      this.directives = new Directives({ version });
    this.setSchema(version, options);
    this.contents = value === void 0 ? null : this.createNode(value, _replacer, options);
  }
  /**
   * Create a deep copy of this Document and its contents.
   *
   * Custom Node values that inherit from `Object` still refer to their original instances.
   */
  clone() {
    const copy = Object.create(_Document.prototype, {
      [NODE_TYPE]: { value: DOC }
    });
    copy.commentBefore = this.commentBefore;
    copy.comment = this.comment;
    copy.errors = this.errors.slice();
    copy.warnings = this.warnings.slice();
    copy.options = Object.assign({}, this.options);
    if (this.directives)
      copy.directives = this.directives.clone();
    copy.schema = this.schema.clone();
    copy.contents = isNode(this.contents) ? this.contents.clone(copy.schema) : this.contents;
    if (this.range)
      copy.range = this.range.slice();
    return copy;
  }
  /** Adds a value to the document. */
  add(value) {
    if (assertCollection(this.contents))
      this.contents.add(value);
  }
  /** Adds a value to the document. */
  addIn(path, value) {
    if (assertCollection(this.contents))
      this.contents.addIn(path, value);
  }
  /**
   * Create a new `Alias` node, ensuring that the target `node` has the required anchor.
   *
   * If `node` already has an anchor, `name` is ignored.
   * Otherwise, the `node.anchor` value will be set to `name`,
   * or if an anchor with that name is already present in the document,
   * `name` will be used as a prefix for a new unique anchor.
   * If `name` is undefined, the generated anchor will use 'a' as a prefix.
   */
  createAlias(node, name) {
    if (!node.anchor) {
      const prev = anchorNames(this);
      node.anchor = // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      !name || prev.has(name) ? findNewAnchor(name || "a", prev) : name;
    }
    return new Alias(node.anchor);
  }
  createNode(value, replacer, options) {
    let _replacer = void 0;
    if (typeof replacer === "function") {
      value = replacer.call({ "": value }, "", value);
      _replacer = replacer;
    } else if (Array.isArray(replacer)) {
      const keyToStr = (v) => typeof v === "number" || v instanceof String || v instanceof Number;
      const asStr = replacer.filter(keyToStr).map(String);
      if (asStr.length > 0)
        replacer = replacer.concat(asStr);
      _replacer = replacer;
    } else if (options === void 0 && replacer) {
      options = replacer;
      replacer = void 0;
    }
    const { aliasDuplicateObjects, anchorPrefix, flow, keepUndefined, onTagObj, tag } = options ?? {};
    const { onAnchor, setAnchors, sourceObjects } = createNodeAnchors(
      this,
      // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing
      anchorPrefix || "a"
    );
    const ctx = {
      aliasDuplicateObjects: aliasDuplicateObjects ?? true,
      keepUndefined: keepUndefined ?? false,
      onAnchor,
      onTagObj,
      replacer: _replacer,
      schema: this.schema,
      sourceObjects
    };
    const node = createNode(value, tag, ctx);
    if (flow && isCollection(node))
      node.flow = true;
    setAnchors();
    return node;
  }
  /**
   * Convert a key and a value into a `Pair` using the current schema,
   * recursively wrapping all values as `Scalar` or `Collection` nodes.
   */
  createPair(key2, value, options = {}) {
    const k = this.createNode(key2, null, options);
    const v = this.createNode(value, null, options);
    return new Pair(k, v);
  }
  /**
   * Removes a value from the document.
   * @returns `true` if the item was found and removed.
   */
  delete(key2) {
    return assertCollection(this.contents) ? this.contents.delete(key2) : false;
  }
  /**
   * Removes a value from the document.
   * @returns `true` if the item was found and removed.
   */
  deleteIn(path) {
    if (isEmptyPath(path)) {
      if (this.contents == null)
        return false;
      this.contents = null;
      return true;
    }
    return assertCollection(this.contents) ? this.contents.deleteIn(path) : false;
  }
  /**
   * Returns item at `key`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  get(key2, keepScalar) {
    return isCollection(this.contents) ? this.contents.get(key2, keepScalar) : void 0;
  }
  /**
   * Returns item at `path`, or `undefined` if not found. By default unwraps
   * scalar values from their surrounding node; to disable set `keepScalar` to
   * `true` (collections are always returned intact).
   */
  getIn(path, keepScalar) {
    if (isEmptyPath(path))
      return !keepScalar && isScalar(this.contents) ? this.contents.value : this.contents;
    return isCollection(this.contents) ? this.contents.getIn(path, keepScalar) : void 0;
  }
  /**
   * Checks if the document includes a value with the key `key`.
   */
  has(key2) {
    return isCollection(this.contents) ? this.contents.has(key2) : false;
  }
  /**
   * Checks if the document includes a value at `path`.
   */
  hasIn(path) {
    if (isEmptyPath(path))
      return this.contents !== void 0;
    return isCollection(this.contents) ? this.contents.hasIn(path) : false;
  }
  /**
   * Sets a value in this document. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  set(key2, value) {
    if (this.contents == null) {
      this.contents = collectionFromPath(this.schema, [key2], value);
    } else if (assertCollection(this.contents)) {
      this.contents.set(key2, value);
    }
  }
  /**
   * Sets a value in this document. For `!!set`, `value` needs to be a
   * boolean to add/remove the item from the set.
   */
  setIn(path, value) {
    if (isEmptyPath(path)) {
      this.contents = value;
    } else if (this.contents == null) {
      this.contents = collectionFromPath(this.schema, Array.from(path), value);
    } else if (assertCollection(this.contents)) {
      this.contents.setIn(path, value);
    }
  }
  /**
   * Change the YAML version and schema used by the document.
   * A `null` version disables support for directives, explicit tags, anchors, and aliases.
   * It also requires the `schema` option to be given as a `Schema` instance value.
   *
   * Overrides all previously set schema options.
   */
  setSchema(version, options = {}) {
    if (typeof version === "number")
      version = String(version);
    let opt;
    switch (version) {
      case "1.1":
        if (this.directives)
          this.directives.yaml.version = "1.1";
        else
          this.directives = new Directives({ version: "1.1" });
        opt = { resolveKnownTags: false, schema: "yaml-1.1" };
        break;
      case "1.2":
      case "next":
        if (this.directives)
          this.directives.yaml.version = version;
        else
          this.directives = new Directives({ version });
        opt = { resolveKnownTags: true, schema: "core" };
        break;
      case null:
        if (this.directives)
          delete this.directives;
        opt = null;
        break;
      default: {
        const sv = JSON.stringify(version);
        throw new Error(`Expected '1.1', '1.2' or null as first argument, but found: ${sv}`);
      }
    }
    if (options.schema instanceof Object)
      this.schema = options.schema;
    else if (opt)
      this.schema = new Schema(Object.assign(opt, options));
    else
      throw new Error(`With a null YAML version, the { schema: Schema } option is required`);
  }
  // json & jsonArg are only used from toJSON()
  toJS({ json, jsonArg, mapAsMap, maxAliasCount, onAnchor, reviver } = {}) {
    const ctx = {
      anchors: /* @__PURE__ */ new Map(),
      doc: this,
      keep: !json,
      mapAsMap: mapAsMap === true,
      mapKeyWarned: false,
      maxAliasCount: typeof maxAliasCount === "number" ? maxAliasCount : 100
    };
    const res = toJS(this.contents, jsonArg ?? "", ctx);
    if (typeof onAnchor === "function")
      for (const { count, res: res2 } of ctx.anchors.values())
        onAnchor(res2, count);
    return typeof reviver === "function" ? applyReviver(reviver, { "": res }, "", res) : res;
  }
  /**
   * A JSON representation of the document `contents`.
   *
   * @param jsonArg Used by `JSON.stringify` to indicate the array index or
   *   property name.
   */
  toJSON(jsonArg, onAnchor) {
    return this.toJS({ json: true, jsonArg, mapAsMap: false, onAnchor });
  }
  /** A YAML representation of the document. */
  toString(options = {}) {
    if (this.errors.length > 0)
      throw new Error("Document with errors cannot be stringified");
    if ("indent" in options && (!Number.isInteger(options.indent) || Number(options.indent) <= 0)) {
      const s = JSON.stringify(options.indent);
      throw new Error(`"indent" option must be a positive integer, not ${s}`);
    }
    return stringifyDocument(this, options);
  }
};
function assertCollection(contents) {
  if (isCollection(contents))
    return true;
  throw new Error("Expected a YAML collection as document contents");
}

// node_modules/yaml/browser/dist/errors.js
var YAMLError = class extends Error {
  constructor(name, pos, code, message) {
    super();
    this.name = name;
    this.code = code;
    this.message = message;
    this.pos = pos;
  }
};
var YAMLParseError = class extends YAMLError {
  constructor(pos, code, message) {
    super("YAMLParseError", pos, code, message);
  }
};
var YAMLWarning = class extends YAMLError {
  constructor(pos, code, message) {
    super("YAMLWarning", pos, code, message);
  }
};
var prettifyError = (src, lc) => (error) => {
  if (error.pos[0] === -1)
    return;
  error.linePos = error.pos.map((pos) => lc.linePos(pos));
  const { line, col } = error.linePos[0];
  error.message += ` at line ${line}, column ${col}`;
  let ci = col - 1;
  let lineStr = src.substring(lc.lineStarts[line - 1], lc.lineStarts[line]).replace(/[\n\r]+$/, "");
  if (ci >= 60 && lineStr.length > 80) {
    const trimStart = Math.min(ci - 39, lineStr.length - 79);
    lineStr = "\u2026" + lineStr.substring(trimStart);
    ci -= trimStart - 1;
  }
  if (lineStr.length > 80)
    lineStr = lineStr.substring(0, 79) + "\u2026";
  if (line > 1 && /^ *$/.test(lineStr.substring(0, ci))) {
    let prev = src.substring(lc.lineStarts[line - 2], lc.lineStarts[line - 1]);
    if (prev.length > 80)
      prev = prev.substring(0, 79) + "\u2026\n";
    lineStr = prev + lineStr;
  }
  if (/[^ ]/.test(lineStr)) {
    let count = 1;
    const end = error.linePos[1];
    if (end?.line === line && end.col > col) {
      count = Math.max(1, Math.min(end.col - col, 80 - ci));
    }
    const pointer = " ".repeat(ci) + "^".repeat(count);
    error.message += `:

${lineStr}
${pointer}
`;
  }
};

// node_modules/yaml/browser/dist/compose/resolve-props.js
function resolveProps(tokens, { flow, indicator, next, offset, onError, parentIndent, startOnNewline }) {
  let spaceBefore = false;
  let atNewline = startOnNewline;
  let hasSpace = startOnNewline;
  let comment = "";
  let commentSep = "";
  let hasNewline = false;
  let reqSpace = false;
  let tab = null;
  let anchor = null;
  let tag = null;
  let newlineAfterProp = null;
  let comma = null;
  let found = null;
  let start = null;
  for (const token of tokens) {
    if (reqSpace) {
      if (token.type !== "space" && token.type !== "newline" && token.type !== "comma")
        onError(token.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
      reqSpace = false;
    }
    if (tab) {
      if (atNewline && token.type !== "comment" && token.type !== "newline") {
        onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
      }
      tab = null;
    }
    switch (token.type) {
      case "space":
        if (!flow && (indicator !== "doc-start" || next?.type !== "flow-collection") && token.source.includes("	")) {
          tab = token;
        }
        hasSpace = true;
        break;
      case "comment": {
        if (!hasSpace)
          onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
        const cb = token.source.substring(1) || " ";
        if (!comment)
          comment = cb;
        else
          comment += commentSep + cb;
        commentSep = "";
        atNewline = false;
        break;
      }
      case "newline":
        if (atNewline) {
          if (comment)
            comment += token.source;
          else if (!found || indicator !== "seq-item-ind")
            spaceBefore = true;
        } else
          commentSep += token.source;
        atNewline = true;
        hasNewline = true;
        if (anchor || tag)
          newlineAfterProp = token;
        hasSpace = true;
        break;
      case "anchor":
        if (anchor)
          onError(token, "MULTIPLE_ANCHORS", "A node can have at most one anchor");
        if (token.source.endsWith(":"))
          onError(token.offset + token.source.length - 1, "BAD_ALIAS", "Anchor ending in : is ambiguous", true);
        anchor = token;
        start ?? (start = token.offset);
        atNewline = false;
        hasSpace = false;
        reqSpace = true;
        break;
      case "tag": {
        if (tag)
          onError(token, "MULTIPLE_TAGS", "A node can have at most one tag");
        tag = token;
        start ?? (start = token.offset);
        atNewline = false;
        hasSpace = false;
        reqSpace = true;
        break;
      }
      case indicator:
        if (anchor || tag)
          onError(token, "BAD_PROP_ORDER", `Anchors and tags must be after the ${token.source} indicator`);
        if (found)
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.source} in ${flow ?? "collection"}`);
        found = token;
        atNewline = indicator === "seq-item-ind" || indicator === "explicit-key-ind";
        hasSpace = false;
        break;
      case "comma":
        if (flow) {
          if (comma)
            onError(token, "UNEXPECTED_TOKEN", `Unexpected , in ${flow}`);
          comma = token;
          atNewline = false;
          hasSpace = false;
          break;
        }
      // else fallthrough
      default:
        onError(token, "UNEXPECTED_TOKEN", `Unexpected ${token.type} token`);
        atNewline = false;
        hasSpace = false;
    }
  }
  const last = tokens[tokens.length - 1];
  const end = last ? last.offset + last.source.length : offset;
  if (reqSpace && next && next.type !== "space" && next.type !== "newline" && next.type !== "comma" && (next.type !== "scalar" || next.source !== "")) {
    onError(next.offset, "MISSING_CHAR", "Tags and anchors must be separated from the next token by white space");
  }
  if (tab && (atNewline && tab.indent <= parentIndent || next?.type === "block-map" || next?.type === "block-seq"))
    onError(tab, "TAB_AS_INDENT", "Tabs are not allowed as indentation");
  return {
    comma,
    found,
    spaceBefore,
    comment,
    hasNewline,
    anchor,
    tag,
    newlineAfterProp,
    end,
    start: start ?? end
  };
}

// node_modules/yaml/browser/dist/compose/util-contains-newline.js
function containsNewline(key2) {
  if (!key2)
    return null;
  switch (key2.type) {
    case "alias":
    case "scalar":
    case "double-quoted-scalar":
    case "single-quoted-scalar":
      if (key2.source.includes("\n"))
        return true;
      if (key2.end) {
        for (const st of key2.end)
          if (st.type === "newline")
            return true;
      }
      return false;
    case "flow-collection":
      for (const it of key2.items) {
        for (const st of it.start)
          if (st.type === "newline")
            return true;
        if (it.sep) {
          for (const st of it.sep)
            if (st.type === "newline")
              return true;
        }
        if (containsNewline(it.key) || containsNewline(it.value))
          return true;
      }
      return false;
    default:
      return true;
  }
}

// node_modules/yaml/browser/dist/compose/util-flow-indent-check.js
function flowIndentCheck(indent, fc, onError) {
  if (fc?.type === "flow-collection") {
    const end = fc.end[0];
    if (end.indent === indent && (end.source === "]" || end.source === "}") && containsNewline(fc)) {
      const msg = "Flow end indicator should be more indented than parent";
      onError(end, "BAD_INDENT", msg, true);
    }
  }
}

// node_modules/yaml/browser/dist/compose/util-map-includes.js
function mapIncludes(ctx, items, search) {
  const { uniqueKeys } = ctx.options;
  if (uniqueKeys === false)
    return false;
  const isEqual = typeof uniqueKeys === "function" ? uniqueKeys : (a, b) => a === b || isScalar(a) && isScalar(b) && a.value === b.value;
  return items.some((pair) => isEqual(pair.key, search));
}

// node_modules/yaml/browser/dist/compose/resolve-block-map.js
var startColMsg = "All mapping items must start at the same column";
function resolveBlockMap({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bm, onError, tag) {
  const NodeClass = tag?.nodeClass ?? YAMLMap;
  const map2 = new NodeClass(ctx.schema);
  if (ctx.atRoot)
    ctx.atRoot = false;
  let offset = bm.offset;
  let commentEnd = null;
  for (const collItem of bm.items) {
    const { start, key: key2, sep, value } = collItem;
    const keyProps = resolveProps(start, {
      indicator: "explicit-key-ind",
      next: key2 ?? sep?.[0],
      offset,
      onError,
      parentIndent: bm.indent,
      startOnNewline: true
    });
    const implicitKey = !keyProps.found;
    if (implicitKey) {
      if (key2) {
        if (key2.type === "block-seq")
          onError(offset, "BLOCK_AS_IMPLICIT_KEY", "A block sequence may not be used as an implicit map key");
        else if ("indent" in key2 && key2.indent !== bm.indent)
          onError(offset, "BAD_INDENT", startColMsg);
      }
      if (!keyProps.anchor && !keyProps.tag && !sep) {
        commentEnd = keyProps.end;
        if (keyProps.comment) {
          if (map2.comment)
            map2.comment += "\n" + keyProps.comment;
          else
            map2.comment = keyProps.comment;
        }
        continue;
      }
      if (keyProps.newlineAfterProp || containsNewline(key2)) {
        onError(key2 ?? start[start.length - 1], "MULTILINE_IMPLICIT_KEY", "Implicit keys need to be on a single line");
      }
    } else if (keyProps.found?.indent !== bm.indent) {
      onError(offset, "BAD_INDENT", startColMsg);
    }
    ctx.atKey = true;
    const keyStart = keyProps.end;
    const keyNode = key2 ? composeNode2(ctx, key2, keyProps, onError) : composeEmptyNode2(ctx, keyStart, start, null, keyProps, onError);
    if (ctx.schema.compat)
      flowIndentCheck(bm.indent, key2, onError);
    ctx.atKey = false;
    if (mapIncludes(ctx, map2.items, keyNode))
      onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
    const valueProps = resolveProps(sep ?? [], {
      indicator: "map-value-ind",
      next: value,
      offset: keyNode.range[2],
      onError,
      parentIndent: bm.indent,
      startOnNewline: !key2 || key2.type === "block-scalar"
    });
    offset = valueProps.end;
    if (valueProps.found) {
      if (implicitKey) {
        if (value?.type === "block-map" && !valueProps.hasNewline)
          onError(offset, "BLOCK_AS_IMPLICIT_KEY", "Nested mappings are not allowed in compact mappings");
        if (ctx.options.strict && keyProps.start < valueProps.found.offset - 1024)
          onError(keyNode.range, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit block mapping key");
      }
      const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : composeEmptyNode2(ctx, offset, sep, null, valueProps, onError);
      if (ctx.schema.compat)
        flowIndentCheck(bm.indent, value, onError);
      offset = valueNode.range[2];
      const pair = new Pair(keyNode, valueNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      map2.items.push(pair);
    } else {
      if (implicitKey)
        onError(keyNode.range, "MISSING_CHAR", "Implicit map keys need to be followed by map values");
      if (valueProps.comment) {
        if (keyNode.comment)
          keyNode.comment += "\n" + valueProps.comment;
        else
          keyNode.comment = valueProps.comment;
      }
      const pair = new Pair(keyNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      map2.items.push(pair);
    }
  }
  if (commentEnd && commentEnd < offset)
    onError(commentEnd, "IMPOSSIBLE", "Map comment with trailing content");
  map2.range = [bm.offset, offset, commentEnd ?? offset];
  return map2;
}

// node_modules/yaml/browser/dist/compose/resolve-block-seq.js
function resolveBlockSeq({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, bs, onError, tag) {
  const NodeClass = tag?.nodeClass ?? YAMLSeq;
  const seq2 = new NodeClass(ctx.schema);
  if (ctx.atRoot)
    ctx.atRoot = false;
  if (ctx.atKey)
    ctx.atKey = false;
  let offset = bs.offset;
  let commentEnd = null;
  for (const { start, value } of bs.items) {
    const props = resolveProps(start, {
      indicator: "seq-item-ind",
      next: value,
      offset,
      onError,
      parentIndent: bs.indent,
      startOnNewline: true
    });
    if (!props.found) {
      if (props.anchor || props.tag || value) {
        if (value?.type === "block-seq")
          onError(props.end, "BAD_INDENT", "All sequence items must start at the same column");
        else
          onError(offset, "MISSING_CHAR", "Sequence item without - indicator");
      } else {
        commentEnd = props.end;
        if (props.comment)
          seq2.comment = props.comment;
        continue;
      }
    }
    const node = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, start, null, props, onError);
    if (ctx.schema.compat)
      flowIndentCheck(bs.indent, value, onError);
    offset = node.range[2];
    seq2.items.push(node);
  }
  seq2.range = [bs.offset, offset, commentEnd ?? offset];
  return seq2;
}

// node_modules/yaml/browser/dist/compose/resolve-end.js
function resolveEnd(end, offset, reqSpace, onError) {
  let comment = "";
  if (end) {
    let hasSpace = false;
    let sep = "";
    for (const token of end) {
      const { source, type } = token;
      switch (type) {
        case "space":
          hasSpace = true;
          break;
        case "comment": {
          if (reqSpace && !hasSpace)
            onError(token, "MISSING_CHAR", "Comments must be separated from other tokens by white space characters");
          const cb = source.substring(1) || " ";
          if (!comment)
            comment = cb;
          else
            comment += sep + cb;
          sep = "";
          break;
        }
        case "newline":
          if (comment)
            sep += source;
          hasSpace = true;
          break;
        default:
          onError(token, "UNEXPECTED_TOKEN", `Unexpected ${type} at node end`);
      }
      offset += source.length;
    }
  }
  return { comment, offset };
}

// node_modules/yaml/browser/dist/compose/resolve-flow-collection.js
var blockMsg = "Block collections are not allowed within flow collections";
var isBlock = (token) => token && (token.type === "block-map" || token.type === "block-seq");
function resolveFlowCollection({ composeNode: composeNode2, composeEmptyNode: composeEmptyNode2 }, ctx, fc, onError, tag) {
  const isMap2 = fc.start.source === "{";
  const fcName = isMap2 ? "flow map" : "flow sequence";
  const NodeClass = tag?.nodeClass ?? (isMap2 ? YAMLMap : YAMLSeq);
  const coll = new NodeClass(ctx.schema);
  coll.flow = true;
  const atRoot = ctx.atRoot;
  if (atRoot)
    ctx.atRoot = false;
  if (ctx.atKey)
    ctx.atKey = false;
  let offset = fc.offset + fc.start.source.length;
  for (let i = 0; i < fc.items.length; ++i) {
    const collItem = fc.items[i];
    const { start, key: key2, sep, value } = collItem;
    const props = resolveProps(start, {
      flow: fcName,
      indicator: "explicit-key-ind",
      next: key2 ?? sep?.[0],
      offset,
      onError,
      parentIndent: fc.indent,
      startOnNewline: false
    });
    if (!props.found) {
      if (!props.anchor && !props.tag && !sep && !value) {
        if (i === 0 && props.comma)
          onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
        else if (i < fc.items.length - 1)
          onError(props.start, "UNEXPECTED_TOKEN", `Unexpected empty item in ${fcName}`);
        if (props.comment) {
          if (coll.comment)
            coll.comment += "\n" + props.comment;
          else
            coll.comment = props.comment;
        }
        offset = props.end;
        continue;
      }
      if (!isMap2 && ctx.options.strict && containsNewline(key2))
        onError(
          key2,
          // checked by containsNewline()
          "MULTILINE_IMPLICIT_KEY",
          "Implicit keys of flow sequence pairs need to be on a single line"
        );
    }
    if (i === 0) {
      if (props.comma)
        onError(props.comma, "UNEXPECTED_TOKEN", `Unexpected , in ${fcName}`);
    } else {
      if (!props.comma)
        onError(props.start, "MISSING_CHAR", `Missing , between ${fcName} items`);
      if (props.comment) {
        let prevItemComment = "";
        loop: for (const st of start) {
          switch (st.type) {
            case "comma":
            case "space":
              break;
            case "comment":
              prevItemComment = st.source.substring(1);
              break loop;
            default:
              break loop;
          }
        }
        if (prevItemComment) {
          let prev = coll.items[coll.items.length - 1];
          if (isPair(prev))
            prev = prev.value ?? prev.key;
          if (prev.comment)
            prev.comment += "\n" + prevItemComment;
          else
            prev.comment = prevItemComment;
          props.comment = props.comment.substring(prevItemComment.length + 1);
        }
      }
    }
    if (!isMap2 && !sep && !props.found) {
      const valueNode = value ? composeNode2(ctx, value, props, onError) : composeEmptyNode2(ctx, props.end, sep, null, props, onError);
      coll.items.push(valueNode);
      offset = valueNode.range[2];
      if (isBlock(value))
        onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
    } else {
      ctx.atKey = true;
      const keyStart = props.end;
      const keyNode = key2 ? composeNode2(ctx, key2, props, onError) : composeEmptyNode2(ctx, keyStart, start, null, props, onError);
      if (isBlock(key2))
        onError(keyNode.range, "BLOCK_IN_FLOW", blockMsg);
      ctx.atKey = false;
      const valueProps = resolveProps(sep ?? [], {
        flow: fcName,
        indicator: "map-value-ind",
        next: value,
        offset: keyNode.range[2],
        onError,
        parentIndent: fc.indent,
        startOnNewline: false
      });
      if (valueProps.found) {
        if (!isMap2 && !props.found && ctx.options.strict) {
          if (sep)
            for (const st of sep) {
              if (st === valueProps.found)
                break;
              if (st.type === "newline") {
                onError(st, "MULTILINE_IMPLICIT_KEY", "Implicit keys of flow sequence pairs need to be on a single line");
                break;
              }
            }
          if (props.start < valueProps.found.offset - 1024)
            onError(valueProps.found, "KEY_OVER_1024_CHARS", "The : indicator must be at most 1024 chars after the start of an implicit flow sequence key");
        }
      } else if (value) {
        if ("source" in value && value.source?.[0] === ":")
          onError(value, "MISSING_CHAR", `Missing space after : in ${fcName}`);
        else
          onError(valueProps.start, "MISSING_CHAR", `Missing , or : between ${fcName} items`);
      }
      const valueNode = value ? composeNode2(ctx, value, valueProps, onError) : valueProps.found ? composeEmptyNode2(ctx, valueProps.end, sep, null, valueProps, onError) : null;
      if (valueNode) {
        if (isBlock(value))
          onError(valueNode.range, "BLOCK_IN_FLOW", blockMsg);
      } else if (valueProps.comment) {
        if (keyNode.comment)
          keyNode.comment += "\n" + valueProps.comment;
        else
          keyNode.comment = valueProps.comment;
      }
      const pair = new Pair(keyNode, valueNode);
      if (ctx.options.keepSourceTokens)
        pair.srcToken = collItem;
      if (isMap2) {
        const map2 = coll;
        if (mapIncludes(ctx, map2.items, keyNode))
          onError(keyStart, "DUPLICATE_KEY", "Map keys must be unique");
        map2.items.push(pair);
      } else {
        const map2 = new YAMLMap(ctx.schema);
        map2.flow = true;
        map2.items.push(pair);
        const endRange = (valueNode ?? keyNode).range;
        map2.range = [keyNode.range[0], endRange[1], endRange[2]];
        coll.items.push(map2);
      }
      offset = valueNode ? valueNode.range[2] : valueProps.end;
    }
  }
  const expectedEnd = isMap2 ? "}" : "]";
  const [ce, ...ee] = fc.end;
  let cePos = offset;
  if (ce?.source === expectedEnd)
    cePos = ce.offset + ce.source.length;
  else {
    const name = fcName[0].toUpperCase() + fcName.substring(1);
    const msg = atRoot ? `${name} must end with a ${expectedEnd}` : `${name} in block collection must be sufficiently indented and end with a ${expectedEnd}`;
    onError(offset, atRoot ? "MISSING_CHAR" : "BAD_INDENT", msg);
    if (ce && ce.source.length !== 1)
      ee.unshift(ce);
  }
  if (ee.length > 0) {
    const end = resolveEnd(ee, cePos, ctx.options.strict, onError);
    if (end.comment) {
      if (coll.comment)
        coll.comment += "\n" + end.comment;
      else
        coll.comment = end.comment;
    }
    coll.range = [fc.offset, cePos, end.offset];
  } else {
    coll.range = [fc.offset, cePos, cePos];
  }
  return coll;
}

// node_modules/yaml/browser/dist/compose/compose-collection.js
function resolveCollection(CN2, ctx, token, onError, tagName, tag) {
  const coll = token.type === "block-map" ? resolveBlockMap(CN2, ctx, token, onError, tag) : token.type === "block-seq" ? resolveBlockSeq(CN2, ctx, token, onError, tag) : resolveFlowCollection(CN2, ctx, token, onError, tag);
  const Coll = coll.constructor;
  if (tagName === "!" || tagName === Coll.tagName) {
    coll.tag = Coll.tagName;
    return coll;
  }
  if (tagName)
    coll.tag = tagName;
  return coll;
}
function composeCollection(CN2, ctx, token, props, onError) {
  const tagToken = props.tag;
  const tagName = !tagToken ? null : ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg));
  if (token.type === "block-seq") {
    const { anchor, newlineAfterProp: nl } = props;
    const lastProp = anchor && tagToken ? anchor.offset > tagToken.offset ? anchor : tagToken : anchor ?? tagToken;
    if (lastProp && (!nl || nl.offset < lastProp.offset)) {
      const message = "Missing newline after block sequence props";
      onError(lastProp, "MISSING_CHAR", message);
    }
  }
  const expType = token.type === "block-map" ? "map" : token.type === "block-seq" ? "seq" : token.start.source === "{" ? "map" : "seq";
  if (!tagToken || !tagName || tagName === "!" || tagName === YAMLMap.tagName && expType === "map" || tagName === YAMLSeq.tagName && expType === "seq") {
    return resolveCollection(CN2, ctx, token, onError, tagName);
  }
  let tag = ctx.schema.tags.find((t) => t.tag === tagName && t.collection === expType);
  if (!tag) {
    const kt = ctx.schema.knownTags[tagName];
    if (kt?.collection === expType) {
      ctx.schema.tags.push(Object.assign({}, kt, { default: false }));
      tag = kt;
    } else {
      if (kt) {
        onError(tagToken, "BAD_COLLECTION_TYPE", `${kt.tag} used for ${expType} collection, but expects ${kt.collection ?? "scalar"}`, true);
      } else {
        onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, true);
      }
      return resolveCollection(CN2, ctx, token, onError, tagName);
    }
  }
  const coll = resolveCollection(CN2, ctx, token, onError, tagName, tag);
  const res = tag.resolve?.(coll, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg), ctx.options) ?? coll;
  const node = isNode(res) ? res : new Scalar(res);
  node.range = coll.range;
  node.tag = tagName;
  if (tag?.format)
    node.format = tag.format;
  return node;
}

// node_modules/yaml/browser/dist/compose/resolve-block-scalar.js
function resolveBlockScalar(ctx, scalar2, onError) {
  const start = scalar2.offset;
  const header = parseBlockScalarHeader(scalar2, ctx.options.strict, onError);
  if (!header)
    return { value: "", type: null, comment: "", range: [start, start, start] };
  const type = header.mode === ">" ? Scalar.BLOCK_FOLDED : Scalar.BLOCK_LITERAL;
  const lines = scalar2.source ? splitLines(scalar2.source) : [];
  let chompStart = lines.length;
  for (let i = lines.length - 1; i >= 0; --i) {
    const content = lines[i][1];
    if (content === "" || content === "\r")
      chompStart = i;
    else
      break;
  }
  if (chompStart === 0) {
    const value2 = header.chomp === "+" && lines.length > 0 ? "\n".repeat(Math.max(1, lines.length - 1)) : "";
    let end2 = start + header.length;
    if (scalar2.source)
      end2 += scalar2.source.length;
    return { value: value2, type, comment: header.comment, range: [start, end2, end2] };
  }
  let trimIndent = scalar2.indent + header.indent;
  let offset = scalar2.offset + header.length;
  let contentStart = 0;
  for (let i = 0; i < chompStart; ++i) {
    const [indent, content] = lines[i];
    if (content === "" || content === "\r") {
      if (header.indent === 0 && indent.length > trimIndent)
        trimIndent = indent.length;
    } else {
      if (indent.length < trimIndent) {
        const message = "Block scalars with more-indented leading empty lines must use an explicit indentation indicator";
        onError(offset + indent.length, "MISSING_CHAR", message);
      }
      if (header.indent === 0)
        trimIndent = indent.length;
      contentStart = i;
      if (trimIndent === 0 && !ctx.atRoot) {
        const message = "Block scalar values in collections must be indented";
        onError(offset, "BAD_INDENT", message);
      }
      break;
    }
    offset += indent.length + content.length + 1;
  }
  for (let i = lines.length - 1; i >= chompStart; --i) {
    if (lines[i][0].length > trimIndent)
      chompStart = i + 1;
  }
  let value = "";
  let sep = "";
  let prevMoreIndented = false;
  for (let i = 0; i < contentStart; ++i)
    value += lines[i][0].slice(trimIndent) + "\n";
  for (let i = contentStart; i < chompStart; ++i) {
    let [indent, content] = lines[i];
    offset += indent.length + content.length + 1;
    const crlf = content[content.length - 1] === "\r";
    if (crlf)
      content = content.slice(0, -1);
    if (content && indent.length < trimIndent) {
      const src = header.indent ? "explicit indentation indicator" : "first line";
      const message = `Block scalar lines must not be less indented than their ${src}`;
      onError(offset - content.length - (crlf ? 2 : 1), "BAD_INDENT", message);
      indent = "";
    }
    if (type === Scalar.BLOCK_LITERAL) {
      value += sep + indent.slice(trimIndent) + content;
      sep = "\n";
    } else if (indent.length > trimIndent || content[0] === "	") {
      if (sep === " ")
        sep = "\n";
      else if (!prevMoreIndented && sep === "\n")
        sep = "\n\n";
      value += sep + indent.slice(trimIndent) + content;
      sep = "\n";
      prevMoreIndented = true;
    } else if (content === "") {
      if (sep === "\n")
        value += "\n";
      else
        sep = "\n";
    } else {
      value += sep + content;
      sep = " ";
      prevMoreIndented = false;
    }
  }
  switch (header.chomp) {
    case "-":
      break;
    case "+":
      for (let i = chompStart; i < lines.length; ++i)
        value += "\n" + lines[i][0].slice(trimIndent);
      if (value[value.length - 1] !== "\n")
        value += "\n";
      break;
    default:
      value += "\n";
  }
  const end = start + header.length + scalar2.source.length;
  return { value, type, comment: header.comment, range: [start, end, end] };
}
function parseBlockScalarHeader({ offset, props }, strict, onError) {
  if (props[0].type !== "block-scalar-header") {
    onError(props[0], "IMPOSSIBLE", "Block scalar header not found");
    return null;
  }
  const { source } = props[0];
  const mode = source[0];
  let indent = 0;
  let chomp = "";
  let error = -1;
  for (let i = 1; i < source.length; ++i) {
    const ch = source[i];
    if (!chomp && (ch === "-" || ch === "+"))
      chomp = ch;
    else {
      const n = Number(ch);
      if (!indent && n)
        indent = n;
      else if (error === -1)
        error = offset + i;
    }
  }
  if (error !== -1)
    onError(error, "UNEXPECTED_TOKEN", `Block scalar header includes extra characters: ${source}`);
  let hasSpace = false;
  let comment = "";
  let length = source.length;
  for (let i = 1; i < props.length; ++i) {
    const token = props[i];
    switch (token.type) {
      case "space":
        hasSpace = true;
      // fallthrough
      case "newline":
        length += token.source.length;
        break;
      case "comment":
        if (strict && !hasSpace) {
          const message = "Comments must be separated from other tokens by white space characters";
          onError(token, "MISSING_CHAR", message);
        }
        length += token.source.length;
        comment = token.source.substring(1);
        break;
      case "error":
        onError(token, "UNEXPECTED_TOKEN", token.message);
        length += token.source.length;
        break;
      /* istanbul ignore next should not happen */
      default: {
        const message = `Unexpected token in block scalar header: ${token.type}`;
        onError(token, "UNEXPECTED_TOKEN", message);
        const ts = token.source;
        if (ts && typeof ts === "string")
          length += ts.length;
      }
    }
  }
  return { mode, indent, chomp, comment, length };
}
function splitLines(source) {
  const split = source.split(/\n( *)/);
  const first = split[0];
  const m = first.match(/^( *)/);
  const line0 = m?.[1] ? [m[1], first.slice(m[1].length)] : ["", first];
  const lines = [line0];
  for (let i = 1; i < split.length; i += 2)
    lines.push([split[i], split[i + 1]]);
  return lines;
}

// node_modules/yaml/browser/dist/compose/resolve-flow-scalar.js
function resolveFlowScalar(scalar2, strict, onError) {
  const { offset, type, source, end } = scalar2;
  let _type;
  let value;
  const _onError = (rel, code, msg) => onError(offset + rel, code, msg);
  switch (type) {
    case "scalar":
      _type = Scalar.PLAIN;
      value = plainValue(source, _onError);
      break;
    case "single-quoted-scalar":
      _type = Scalar.QUOTE_SINGLE;
      value = singleQuotedValue(source, _onError);
      break;
    case "double-quoted-scalar":
      _type = Scalar.QUOTE_DOUBLE;
      value = doubleQuotedValue(source, _onError);
      break;
    /* istanbul ignore next should not happen */
    default:
      onError(scalar2, "UNEXPECTED_TOKEN", `Expected a flow scalar value, but found: ${type}`);
      return {
        value: "",
        type: null,
        comment: "",
        range: [offset, offset + source.length, offset + source.length]
      };
  }
  const valueEnd = offset + source.length;
  const re = resolveEnd(end, valueEnd, strict, onError);
  return {
    value,
    type: _type,
    comment: re.comment,
    range: [offset, valueEnd, re.offset]
  };
}
function plainValue(source, onError) {
  let badChar = "";
  switch (source[0]) {
    /* istanbul ignore next should not happen */
    case "	":
      badChar = "a tab character";
      break;
    case ",":
      badChar = "flow indicator character ,";
      break;
    case "%":
      badChar = "directive indicator character %";
      break;
    case "|":
    case ">": {
      badChar = `block scalar indicator ${source[0]}`;
      break;
    }
    case "@":
    case "`": {
      badChar = `reserved character ${source[0]}`;
      break;
    }
  }
  if (badChar)
    onError(0, "BAD_SCALAR_START", `Plain value cannot start with ${badChar}`);
  return unfoldLines(source);
}
function singleQuotedValue(source, onError) {
  if (source[source.length - 1] !== "'" || source.length === 1)
    onError(source.length, "MISSING_CHAR", "Missing closing 'quote");
  return unfoldLines(source.slice(1, -1)).replace(/''/g, "'");
}
function unfoldLines(source) {
  const line = /(.*?)\r?\n/sy;
  let match = line.exec(source);
  if (!match)
    return source;
  let trimEnd, trimBoth;
  try {
    trimEnd = new RegExp("(?<![ 	])[ 	]+$");
    trimBoth = new RegExp("^[ 	]+|(?<![ 	])[ 	]+$", "g");
  } catch {
    trimEnd = /[ \t]+$/;
    trimBoth = /^[ \t]+|[ \t]+$/g;
  }
  let res = match[1].replace(trimEnd, "");
  let sep = " ";
  let pos = line.lastIndex;
  while (match = line.exec(source)) {
    const lm = match[1].replace(trimBoth, "");
    if (lm === "") {
      if (sep === "\n")
        res += sep;
      else
        sep = "\n";
    } else {
      res += sep + lm;
      sep = " ";
    }
    pos = line.lastIndex;
  }
  const last = /[ \t]*(.*)/sy;
  last.lastIndex = pos;
  match = last.exec(source);
  return res + sep + (match?.[1] ?? "");
}
function doubleQuotedValue(source, onError) {
  let res = "";
  for (let i = 1; i < source.length - 1; ++i) {
    const ch = source[i];
    if (ch === "\r" && source[i + 1] === "\n")
      continue;
    if (ch === "\n") {
      const { fold, offset } = foldNewline(source, i);
      res += fold;
      i = offset;
    } else if (ch === "\\") {
      let next = source[++i];
      const cc = escapeCodes[next];
      if (cc)
        res += cc;
      else if (next === "\n") {
        next = source[i + 1];
        while (next === " " || next === "	")
          next = source[++i + 1];
      } else if (next === "\r" && source[i + 1] === "\n") {
        next = source[++i + 1];
        while (next === " " || next === "	")
          next = source[++i + 1];
      } else if (next === "x" || next === "u" || next === "U") {
        const length = next === "x" ? 2 : next === "u" ? 4 : 8;
        res += parseCharCode(source, i + 1, length, onError);
        i += length;
      } else {
        const raw = source.substr(i - 1, 2);
        onError(i - 1, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
        res += raw;
      }
    } else if (ch === " " || ch === "	") {
      const wsStart = i;
      let next = source[i + 1];
      while (next === " " || next === "	")
        next = source[++i + 1];
      if (next !== "\n" && !(next === "\r" && source[i + 2] === "\n"))
        res += i > wsStart ? source.slice(wsStart, i + 1) : ch;
    } else {
      res += ch;
    }
  }
  if (source[source.length - 1] !== '"' || source.length === 1)
    onError(source.length, "MISSING_CHAR", 'Missing closing "quote');
  return res;
}
function foldNewline(source, offset) {
  let fold = "";
  let ch = source[offset + 1];
  while (ch === " " || ch === "	" || ch === "\n" || ch === "\r") {
    if (ch === "\r" && source[offset + 2] !== "\n")
      break;
    if (ch === "\n")
      fold += "\n";
    offset += 1;
    ch = source[offset + 1];
  }
  if (!fold)
    fold = " ";
  return { fold, offset };
}
var escapeCodes = {
  "0": "\0",
  // null character
  a: "\x07",
  // bell character
  b: "\b",
  // backspace
  e: "\x1B",
  // escape character
  f: "\f",
  // form feed
  n: "\n",
  // line feed
  r: "\r",
  // carriage return
  t: "	",
  // horizontal tab
  v: "\v",
  // vertical tab
  N: "\x85",
  // Unicode next line
  _: "\xA0",
  // Unicode non-breaking space
  L: "\u2028",
  // Unicode line separator
  P: "\u2029",
  // Unicode paragraph separator
  " ": " ",
  '"': '"',
  "/": "/",
  "\\": "\\",
  "	": "	"
};
function parseCharCode(source, offset, length, onError) {
  const cc = source.substr(offset, length);
  const ok = cc.length === length && /^[0-9a-fA-F]+$/.test(cc);
  const code = ok ? parseInt(cc, 16) : NaN;
  try {
    return String.fromCodePoint(code);
  } catch {
    const raw = source.substr(offset - 2, length + 2);
    onError(offset - 2, "BAD_DQ_ESCAPE", `Invalid escape sequence ${raw}`);
    return raw;
  }
}

// node_modules/yaml/browser/dist/compose/compose-scalar.js
function composeScalar(ctx, token, tagToken, onError) {
  const { value, type, comment, range } = token.type === "block-scalar" ? resolveBlockScalar(ctx, token, onError) : resolveFlowScalar(token, ctx.options.strict, onError);
  const tagName = tagToken ? ctx.directives.tagName(tagToken.source, (msg) => onError(tagToken, "TAG_RESOLVE_FAILED", msg)) : null;
  let tag;
  if (ctx.options.stringKeys && ctx.atKey) {
    tag = ctx.schema[SCALAR];
  } else if (tagName)
    tag = findScalarTagByName(ctx.schema, value, tagName, tagToken, onError);
  else if (token.type === "scalar")
    tag = findScalarTagByTest(ctx, value, token, onError);
  else
    tag = ctx.schema[SCALAR];
  let scalar2;
  try {
    const res = tag.resolve(value, (msg) => onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg), ctx.options);
    scalar2 = isScalar(res) ? res : new Scalar(res);
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    onError(tagToken ?? token, "TAG_RESOLVE_FAILED", msg);
    scalar2 = new Scalar(value);
  }
  scalar2.range = range;
  scalar2.source = value;
  if (type)
    scalar2.type = type;
  if (tagName)
    scalar2.tag = tagName;
  if (tag.format)
    scalar2.format = tag.format;
  if (comment)
    scalar2.comment = comment;
  return scalar2;
}
function findScalarTagByName(schema4, value, tagName, tagToken, onError) {
  if (tagName === "!")
    return schema4[SCALAR];
  const matchWithTest = [];
  for (const tag of schema4.tags) {
    if (!tag.collection && tag.tag === tagName) {
      if (tag.default && tag.test)
        matchWithTest.push(tag);
      else
        return tag;
    }
  }
  for (const tag of matchWithTest)
    if (tag.test?.test(value))
      return tag;
  const kt = schema4.knownTags[tagName];
  if (kt && !kt.collection) {
    schema4.tags.push(Object.assign({}, kt, { default: false, test: void 0 }));
    return kt;
  }
  onError(tagToken, "TAG_RESOLVE_FAILED", `Unresolved tag: ${tagName}`, tagName !== "tag:yaml.org,2002:str");
  return schema4[SCALAR];
}
function findScalarTagByTest({ atKey, directives, schema: schema4 }, value, token, onError) {
  const tag = schema4.tags.find((tag2) => (tag2.default === true || atKey && tag2.default === "key") && tag2.test?.test(value)) || schema4[SCALAR];
  if (schema4.compat) {
    const compat = schema4.compat.find((tag2) => tag2.default && tag2.test?.test(value)) ?? schema4[SCALAR];
    if (tag.tag !== compat.tag) {
      const ts = directives.tagString(tag.tag);
      const cs = directives.tagString(compat.tag);
      const msg = `Value may be parsed as either ${ts} or ${cs}`;
      onError(token, "TAG_RESOLVE_FAILED", msg, true);
    }
  }
  return tag;
}

// node_modules/yaml/browser/dist/compose/util-empty-scalar-position.js
function emptyScalarPosition(offset, before, pos) {
  if (before) {
    pos ?? (pos = before.length);
    for (let i = pos - 1; i >= 0; --i) {
      let st = before[i];
      switch (st.type) {
        case "space":
        case "comment":
        case "newline":
          offset -= st.source.length;
          continue;
      }
      st = before[++i];
      while (st?.type === "space") {
        offset += st.source.length;
        st = before[++i];
      }
      break;
    }
  }
  return offset;
}

// node_modules/yaml/browser/dist/compose/compose-node.js
var CN = { composeNode, composeEmptyNode };
function composeNode(ctx, token, props, onError) {
  const atKey = ctx.atKey;
  const { spaceBefore, comment, anchor, tag } = props;
  let node;
  let isSrcToken = true;
  switch (token.type) {
    case "alias":
      node = composeAlias(ctx, token, onError);
      if (anchor || tag)
        onError(token, "ALIAS_PROPS", "An alias node must not specify any properties");
      break;
    case "scalar":
    case "single-quoted-scalar":
    case "double-quoted-scalar":
    case "block-scalar":
      node = composeScalar(ctx, token, tag, onError);
      if (anchor)
        node.anchor = anchor.source.substring(1);
      break;
    case "block-map":
    case "block-seq":
    case "flow-collection":
      try {
        node = composeCollection(CN, ctx, token, props, onError);
        if (anchor)
          node.anchor = anchor.source.substring(1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        onError(token, "RESOURCE_EXHAUSTION", message);
      }
      break;
    default: {
      const message = token.type === "error" ? token.message : `Unsupported token (type: ${token.type})`;
      onError(token, "UNEXPECTED_TOKEN", message);
      isSrcToken = false;
    }
  }
  node ?? (node = composeEmptyNode(ctx, token.offset, void 0, null, props, onError));
  if (anchor && node.anchor === "")
    onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
  if (atKey && ctx.options.stringKeys && (!isScalar(node) || typeof node.value !== "string" || node.tag && node.tag !== "tag:yaml.org,2002:str")) {
    const msg = "With stringKeys, all keys must be strings";
    onError(tag ?? token, "NON_STRING_KEY", msg);
  }
  if (spaceBefore)
    node.spaceBefore = true;
  if (comment) {
    if (token.type === "scalar" && token.source === "")
      node.comment = comment;
    else
      node.commentBefore = comment;
  }
  if (ctx.options.keepSourceTokens && isSrcToken)
    node.srcToken = token;
  return node;
}
function composeEmptyNode(ctx, offset, before, pos, { spaceBefore, comment, anchor, tag, end }, onError) {
  const token = {
    type: "scalar",
    offset: emptyScalarPosition(offset, before, pos),
    indent: -1,
    source: ""
  };
  const node = composeScalar(ctx, token, tag, onError);
  if (anchor) {
    node.anchor = anchor.source.substring(1);
    if (node.anchor === "")
      onError(anchor, "BAD_ALIAS", "Anchor cannot be an empty string");
  }
  if (spaceBefore)
    node.spaceBefore = true;
  if (comment) {
    node.comment = comment;
    node.range[2] = end;
  }
  return node;
}
function composeAlias({ options }, { offset, source, end }, onError) {
  const alias = new Alias(source.substring(1));
  if (alias.source === "")
    onError(offset, "BAD_ALIAS", "Alias cannot be an empty string");
  if (alias.source.endsWith(":"))
    onError(offset + source.length - 1, "BAD_ALIAS", "Alias ending in : is ambiguous", true);
  const valueEnd = offset + source.length;
  const re = resolveEnd(end, valueEnd, options.strict, onError);
  alias.range = [offset, valueEnd, re.offset];
  if (re.comment)
    alias.comment = re.comment;
  return alias;
}

// node_modules/yaml/browser/dist/compose/compose-doc.js
function composeDoc(options, directives, { offset, start, value, end }, onError) {
  const opts = Object.assign({ _directives: directives }, options);
  const doc = new Document(void 0, opts);
  const ctx = {
    atKey: false,
    atRoot: true,
    directives: doc.directives,
    options: doc.options,
    schema: doc.schema
  };
  const props = resolveProps(start, {
    indicator: "doc-start",
    next: value ?? end?.[0],
    offset,
    onError,
    parentIndent: 0,
    startOnNewline: true
  });
  if (props.found) {
    doc.directives.docStart = true;
    if (value && (value.type === "block-map" || value.type === "block-seq") && !props.hasNewline)
      onError(props.end, "MISSING_CHAR", "Block collection cannot start on same line with directives-end marker");
  }
  doc.contents = value ? composeNode(ctx, value, props, onError) : composeEmptyNode(ctx, props.end, start, null, props, onError);
  const contentEnd = doc.contents.range[2];
  const re = resolveEnd(end, contentEnd, false, onError);
  if (re.comment)
    doc.comment = re.comment;
  doc.range = [offset, contentEnd, re.offset];
  return doc;
}

// node_modules/yaml/browser/dist/compose/composer.js
function getErrorPos(src) {
  if (typeof src === "number")
    return [src, src + 1];
  if (Array.isArray(src))
    return src.length === 2 ? src : [src[0], src[1]];
  const { offset, source } = src;
  return [offset, offset + (typeof source === "string" ? source.length : 1)];
}
function parsePrelude(prelude) {
  let comment = "";
  let atComment = false;
  let afterEmptyLine = false;
  for (let i = 0; i < prelude.length; ++i) {
    const source = prelude[i];
    switch (source[0]) {
      case "#":
        comment += (comment === "" ? "" : afterEmptyLine ? "\n\n" : "\n") + (source.substring(1) || " ");
        atComment = true;
        afterEmptyLine = false;
        break;
      case "%":
        if (prelude[i + 1]?.[0] !== "#")
          i += 1;
        atComment = false;
        break;
      default:
        if (!atComment)
          afterEmptyLine = true;
        atComment = false;
    }
  }
  return { comment, afterEmptyLine };
}
var Composer = class {
  constructor(options = {}) {
    this.doc = null;
    this.atDirectives = false;
    this.prelude = [];
    this.errors = [];
    this.warnings = [];
    this.onError = (source, code, message, warning) => {
      const pos = getErrorPos(source);
      if (warning)
        this.warnings.push(new YAMLWarning(pos, code, message));
      else
        this.errors.push(new YAMLParseError(pos, code, message));
    };
    this.directives = new Directives({ version: options.version || "1.2" });
    this.options = options;
  }
  decorate(doc, afterDoc) {
    const { comment, afterEmptyLine } = parsePrelude(this.prelude);
    if (comment) {
      const dc = doc.contents;
      if (afterDoc) {
        doc.comment = doc.comment ? `${doc.comment}
${comment}` : comment;
      } else if (afterEmptyLine || doc.directives.docStart || !dc) {
        doc.commentBefore = comment;
      } else if (isCollection(dc) && !dc.flow && dc.items.length > 0) {
        let it = dc.items[0];
        if (isPair(it))
          it = it.key;
        const cb = it.commentBefore;
        it.commentBefore = cb ? `${comment}
${cb}` : comment;
      } else {
        const cb = dc.commentBefore;
        dc.commentBefore = cb ? `${comment}
${cb}` : comment;
      }
    }
    if (afterDoc) {
      for (let i = 0; i < this.errors.length; ++i)
        doc.errors.push(this.errors[i]);
      for (let i = 0; i < this.warnings.length; ++i)
        doc.warnings.push(this.warnings[i]);
    } else {
      doc.errors = this.errors;
      doc.warnings = this.warnings;
    }
    this.prelude = [];
    this.errors = [];
    this.warnings = [];
  }
  /**
   * Current stream status information.
   *
   * Mostly useful at the end of input for an empty stream.
   */
  streamInfo() {
    return {
      comment: parsePrelude(this.prelude).comment,
      directives: this.directives,
      errors: this.errors,
      warnings: this.warnings
    };
  }
  /**
   * Compose tokens into documents.
   *
   * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
   * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
   */
  *compose(tokens, forceDoc = false, endOffset = -1) {
    for (const token of tokens)
      yield* this.next(token);
    yield* this.end(forceDoc, endOffset);
  }
  /** Advance the composer by one CST token. */
  *next(token) {
    switch (token.type) {
      case "directive":
        this.directives.add(token.source, (offset, message, warning) => {
          const pos = getErrorPos(token);
          pos[0] += offset;
          this.onError(pos, "BAD_DIRECTIVE", message, warning);
        });
        this.prelude.push(token.source);
        this.atDirectives = true;
        break;
      case "document": {
        const doc = composeDoc(this.options, this.directives, token, this.onError);
        if (this.atDirectives && !doc.directives.docStart)
          this.onError(token, "MISSING_CHAR", "Missing directives-end/doc-start indicator line");
        this.decorate(doc, false);
        if (this.doc)
          yield this.doc;
        this.doc = doc;
        this.atDirectives = false;
        break;
      }
      case "byte-order-mark":
      case "space":
        break;
      case "comment":
      case "newline":
        this.prelude.push(token.source);
        break;
      case "error": {
        const msg = token.source ? `${token.message}: ${JSON.stringify(token.source)}` : token.message;
        const error = new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg);
        if (this.atDirectives || !this.doc)
          this.errors.push(error);
        else
          this.doc.errors.push(error);
        break;
      }
      case "doc-end": {
        if (!this.doc) {
          const msg = "Unexpected doc-end without preceding document";
          this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", msg));
          break;
        }
        this.doc.directives.docEnd = true;
        const end = resolveEnd(token.end, token.offset + token.source.length, this.doc.options.strict, this.onError);
        this.decorate(this.doc, true);
        if (end.comment) {
          const dc = this.doc.comment;
          this.doc.comment = dc ? `${dc}
${end.comment}` : end.comment;
        }
        this.doc.range[2] = end.offset;
        break;
      }
      default:
        this.errors.push(new YAMLParseError(getErrorPos(token), "UNEXPECTED_TOKEN", `Unsupported token ${token.type}`));
    }
  }
  /**
   * Call at end of input to yield any remaining document.
   *
   * @param forceDoc - If the stream contains no document, still emit a final document including any comments and directives that would be applied to a subsequent document.
   * @param endOffset - Should be set if `forceDoc` is also set, to set the document range end and to indicate errors correctly.
   */
  *end(forceDoc = false, endOffset = -1) {
    if (this.doc) {
      this.decorate(this.doc, true);
      yield this.doc;
      this.doc = null;
    } else if (forceDoc) {
      const opts = Object.assign({ _directives: this.directives }, this.options);
      const doc = new Document(void 0, opts);
      if (this.atDirectives)
        this.onError(endOffset, "MISSING_CHAR", "Missing directives-end indicator line");
      doc.range = [0, endOffset, endOffset];
      this.decorate(doc, false);
      yield doc;
    }
  }
};

// node_modules/yaml/browser/dist/parse/cst-visit.js
var BREAK2 = Symbol("break visit");
var SKIP2 = Symbol("skip children");
var REMOVE2 = Symbol("remove item");
function visit2(cst, visitor) {
  if ("type" in cst && cst.type === "document")
    cst = { start: cst.start, value: cst.value };
  _visit(Object.freeze([]), cst, visitor);
}
visit2.BREAK = BREAK2;
visit2.SKIP = SKIP2;
visit2.REMOVE = REMOVE2;
visit2.itemAtPath = (cst, path) => {
  let item = cst;
  for (const [field, index] of path) {
    const tok = item?.[field];
    if (tok && "items" in tok) {
      item = tok.items[index];
    } else
      return void 0;
  }
  return item;
};
visit2.parentCollection = (cst, path) => {
  const parent = visit2.itemAtPath(cst, path.slice(0, -1));
  const field = path[path.length - 1][0];
  const coll = parent?.[field];
  if (coll && "items" in coll)
    return coll;
  throw new Error("Parent collection not found");
};
function _visit(path, item, visitor) {
  let ctrl = visitor(item, path);
  if (typeof ctrl === "symbol")
    return ctrl;
  for (const field of ["key", "value"]) {
    const token = item[field];
    if (token && "items" in token) {
      for (let i = 0; i < token.items.length; ++i) {
        const ci = _visit(Object.freeze(path.concat([[field, i]])), token.items[i], visitor);
        if (typeof ci === "number")
          i = ci - 1;
        else if (ci === BREAK2)
          return BREAK2;
        else if (ci === REMOVE2) {
          token.items.splice(i, 1);
          i -= 1;
        }
      }
      if (typeof ctrl === "function" && field === "key")
        ctrl = ctrl(item, path);
    }
  }
  return typeof ctrl === "function" ? ctrl(item, path) : ctrl;
}

// node_modules/yaml/browser/dist/parse/cst.js
var BOM = "\uFEFF";
var DOCUMENT = "";
var FLOW_END = "";
var SCALAR2 = "";
function tokenType(source) {
  switch (source) {
    case BOM:
      return "byte-order-mark";
    case DOCUMENT:
      return "doc-mode";
    case FLOW_END:
      return "flow-error-end";
    case SCALAR2:
      return "scalar";
    case "---":
      return "doc-start";
    case "...":
      return "doc-end";
    case "":
    case "\n":
    case "\r\n":
      return "newline";
    case "-":
      return "seq-item-ind";
    case "?":
      return "explicit-key-ind";
    case ":":
      return "map-value-ind";
    case "{":
      return "flow-map-start";
    case "}":
      return "flow-map-end";
    case "[":
      return "flow-seq-start";
    case "]":
      return "flow-seq-end";
    case ",":
      return "comma";
  }
  switch (source[0]) {
    case " ":
    case "	":
      return "space";
    case "#":
      return "comment";
    case "%":
      return "directive-line";
    case "*":
      return "alias";
    case "&":
      return "anchor";
    case "!":
      return "tag";
    case "'":
      return "single-quoted-scalar";
    case '"':
      return "double-quoted-scalar";
    case "|":
    case ">":
      return "block-scalar-header";
  }
  return null;
}

// node_modules/yaml/browser/dist/parse/lexer.js
function isEmpty(ch) {
  switch (ch) {
    case void 0:
    case " ":
    case "\n":
    case "\r":
    case "	":
      return true;
    default:
      return false;
  }
}
var hexDigits = new Set("0123456789ABCDEFabcdef");
var tagChars = new Set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-#;/?:@&=+$_.!~*'()");
var flowIndicatorChars = new Set(",[]{}");
var invalidAnchorChars = new Set(" ,[]{}\n\r	");
var isNotAnchorChar = (ch) => !ch || invalidAnchorChars.has(ch);
var Lexer = class {
  constructor() {
    this.atEnd = false;
    this.blockScalarIndent = -1;
    this.blockScalarKeep = false;
    this.buffer = "";
    this.flowKey = false;
    this.flowLevel = 0;
    this.indentNext = 0;
    this.indentValue = 0;
    this.lineEndPos = null;
    this.next = null;
    this.pos = 0;
  }
  /**
   * Generate YAML tokens from the `source` string. If `incomplete`,
   * a part of the last line may be left as a buffer for the next call.
   *
   * @returns A generator of lexical tokens
   */
  *lex(source, incomplete = false) {
    if (source) {
      if (typeof source !== "string")
        throw TypeError("source is not a string");
      this.buffer = this.buffer ? this.buffer + source : source;
      this.lineEndPos = null;
    }
    this.atEnd = !incomplete;
    let next = this.next ?? "stream";
    while (next && (incomplete || this.hasChars(1)))
      next = yield* this.parseNext(next);
  }
  atLineEnd() {
    let i = this.pos;
    let ch = this.buffer[i];
    while (ch === " " || ch === "	")
      ch = this.buffer[++i];
    if (!ch || ch === "#" || ch === "\n")
      return true;
    if (ch === "\r")
      return this.buffer[i + 1] === "\n";
    return false;
  }
  charAt(n) {
    return this.buffer[this.pos + n];
  }
  continueScalar(offset) {
    let ch = this.buffer[offset];
    if (this.indentNext > 0) {
      let indent = 0;
      while (ch === " ")
        ch = this.buffer[++indent + offset];
      if (ch === "\r") {
        const next = this.buffer[indent + offset + 1];
        if (next === "\n" || !next && !this.atEnd)
          return offset + indent + 1;
      }
      return ch === "\n" || indent >= this.indentNext || !ch && !this.atEnd ? offset + indent : -1;
    }
    if (ch === "-" || ch === ".") {
      const dt = this.buffer.substr(offset, 3);
      if ((dt === "---" || dt === "...") && isEmpty(this.buffer[offset + 3]))
        return -1;
    }
    return offset;
  }
  getLine() {
    let end = this.lineEndPos;
    if (typeof end !== "number" || end !== -1 && end < this.pos) {
      end = this.buffer.indexOf("\n", this.pos);
      this.lineEndPos = end;
    }
    if (end === -1)
      return this.atEnd ? this.buffer.substring(this.pos) : null;
    if (this.buffer[end - 1] === "\r")
      end -= 1;
    return this.buffer.substring(this.pos, end);
  }
  hasChars(n) {
    return this.pos + n <= this.buffer.length;
  }
  setNext(state) {
    this.buffer = this.buffer.substring(this.pos);
    this.pos = 0;
    this.lineEndPos = null;
    this.next = state;
    return null;
  }
  peek(n) {
    return this.buffer.substr(this.pos, n);
  }
  *parseNext(next) {
    switch (next) {
      case "stream":
        return yield* this.parseStream();
      case "line-start":
        return yield* this.parseLineStart();
      case "block-start":
        return yield* this.parseBlockStart();
      case "doc":
        return yield* this.parseDocument();
      case "flow":
        return yield* this.parseFlowCollection();
      case "quoted-scalar":
        return yield* this.parseQuotedScalar();
      case "block-scalar":
        return yield* this.parseBlockScalar();
      case "plain-scalar":
        return yield* this.parsePlainScalar();
    }
  }
  *parseStream() {
    let line = this.getLine();
    if (line === null)
      return this.setNext("stream");
    if (line[0] === BOM) {
      yield* this.pushCount(1);
      line = line.substring(1);
    }
    if (line[0] === "%") {
      let dirEnd = line.length;
      let cs = line.indexOf("#");
      while (cs !== -1) {
        const ch = line[cs - 1];
        if (ch === " " || ch === "	") {
          dirEnd = cs - 1;
          break;
        } else {
          cs = line.indexOf("#", cs + 1);
        }
      }
      while (true) {
        const ch = line[dirEnd - 1];
        if (ch === " " || ch === "	")
          dirEnd -= 1;
        else
          break;
      }
      const n = (yield* this.pushCount(dirEnd)) + (yield* this.pushSpaces(true));
      yield* this.pushCount(line.length - n);
      this.pushNewline();
      return "stream";
    }
    if (this.atLineEnd()) {
      const sp = yield* this.pushSpaces(true);
      yield* this.pushCount(line.length - sp);
      yield* this.pushNewline();
      return "stream";
    }
    yield DOCUMENT;
    return yield* this.parseLineStart();
  }
  *parseLineStart() {
    const ch = this.charAt(0);
    if (!ch && !this.atEnd)
      return this.setNext("line-start");
    if (ch === "-" || ch === ".") {
      if (!this.atEnd && !this.hasChars(4))
        return this.setNext("line-start");
      const s = this.peek(3);
      if ((s === "---" || s === "...") && isEmpty(this.charAt(3))) {
        yield* this.pushCount(3);
        this.indentValue = 0;
        this.indentNext = 0;
        return s === "---" ? "doc" : "stream";
      }
    }
    this.indentValue = yield* this.pushSpaces(false);
    if (this.indentNext > this.indentValue && !isEmpty(this.charAt(1)))
      this.indentNext = this.indentValue;
    return yield* this.parseBlockStart();
  }
  *parseBlockStart() {
    const [ch0, ch1] = this.peek(2);
    if (!ch1 && !this.atEnd)
      return this.setNext("block-start");
    if ((ch0 === "-" || ch0 === "?" || ch0 === ":") && isEmpty(ch1)) {
      const n = (yield* this.pushCount(1)) + (yield* this.pushSpaces(true));
      this.indentNext = this.indentValue + 1;
      this.indentValue += n;
      return "block-start";
    }
    return "doc";
  }
  *parseDocument() {
    yield* this.pushSpaces(true);
    const line = this.getLine();
    if (line === null)
      return this.setNext("doc");
    let n = yield* this.pushIndicators();
    switch (line[n]) {
      case "#":
        yield* this.pushCount(line.length - n);
      // fallthrough
      case void 0:
        yield* this.pushNewline();
        return yield* this.parseLineStart();
      case "{":
      case "[":
        yield* this.pushCount(1);
        this.flowKey = false;
        this.flowLevel = 1;
        return "flow";
      case "}":
      case "]":
        yield* this.pushCount(1);
        return "doc";
      case "*":
        yield* this.pushUntil(isNotAnchorChar);
        return "doc";
      case '"':
      case "'":
        return yield* this.parseQuotedScalar();
      case "|":
      case ">":
        n += yield* this.parseBlockScalarHeader();
        n += yield* this.pushSpaces(true);
        yield* this.pushCount(line.length - n);
        yield* this.pushNewline();
        return yield* this.parseBlockScalar();
      default:
        return yield* this.parsePlainScalar();
    }
  }
  *parseFlowCollection() {
    let nl, sp;
    let indent = -1;
    do {
      nl = yield* this.pushNewline();
      if (nl > 0) {
        sp = yield* this.pushSpaces(false);
        this.indentValue = indent = sp;
      } else {
        sp = 0;
      }
      sp += yield* this.pushSpaces(true);
    } while (nl + sp > 0);
    const line = this.getLine();
    if (line === null)
      return this.setNext("flow");
    if (indent !== -1 && indent < this.indentNext && line[0] !== "#" || indent === 0 && (line.startsWith("---") || line.startsWith("...")) && isEmpty(line[3])) {
      const atFlowEndMarker = indent === this.indentNext - 1 && this.flowLevel === 1 && (line[0] === "]" || line[0] === "}");
      if (!atFlowEndMarker) {
        this.flowLevel = 0;
        yield FLOW_END;
        return yield* this.parseLineStart();
      }
    }
    let n = 0;
    while (line[n] === ",") {
      n += yield* this.pushCount(1);
      n += yield* this.pushSpaces(true);
      this.flowKey = false;
    }
    n += yield* this.pushIndicators();
    switch (line[n]) {
      case void 0:
        return "flow";
      case "#":
        yield* this.pushCount(line.length - n);
        return "flow";
      case "{":
      case "[":
        yield* this.pushCount(1);
        this.flowKey = false;
        this.flowLevel += 1;
        return "flow";
      case "}":
      case "]":
        yield* this.pushCount(1);
        this.flowKey = true;
        this.flowLevel -= 1;
        return this.flowLevel ? "flow" : "doc";
      case "*":
        yield* this.pushUntil(isNotAnchorChar);
        return "flow";
      case '"':
      case "'":
        this.flowKey = true;
        return yield* this.parseQuotedScalar();
      case ":": {
        const next = this.charAt(1);
        if (this.flowKey || isEmpty(next) || next === ",") {
          this.flowKey = false;
          yield* this.pushCount(1);
          yield* this.pushSpaces(true);
          return "flow";
        }
      }
      // fallthrough
      default:
        this.flowKey = false;
        return yield* this.parsePlainScalar();
    }
  }
  *parseQuotedScalar() {
    const quote = this.charAt(0);
    let end = this.buffer.indexOf(quote, this.pos + 1);
    if (quote === "'") {
      while (end !== -1 && this.buffer[end + 1] === "'")
        end = this.buffer.indexOf("'", end + 2);
    } else {
      while (end !== -1) {
        let n = 0;
        while (this.buffer[end - 1 - n] === "\\")
          n += 1;
        if (n % 2 === 0)
          break;
        end = this.buffer.indexOf('"', end + 1);
      }
    }
    const qb = this.buffer.substring(0, end);
    let nl = qb.indexOf("\n", this.pos);
    if (nl !== -1) {
      while (nl !== -1) {
        const cs = this.continueScalar(nl + 1);
        if (cs === -1)
          break;
        nl = qb.indexOf("\n", cs);
      }
      if (nl !== -1) {
        end = nl - (qb[nl - 1] === "\r" ? 2 : 1);
      }
    }
    if (end === -1) {
      if (!this.atEnd)
        return this.setNext("quoted-scalar");
      end = this.buffer.length;
    }
    yield* this.pushToIndex(end + 1, false);
    return this.flowLevel ? "flow" : "doc";
  }
  *parseBlockScalarHeader() {
    this.blockScalarIndent = -1;
    this.blockScalarKeep = false;
    let i = this.pos;
    while (true) {
      const ch = this.buffer[++i];
      if (ch === "+")
        this.blockScalarKeep = true;
      else if (ch > "0" && ch <= "9")
        this.blockScalarIndent = Number(ch) - 1;
      else if (ch !== "-")
        break;
    }
    return yield* this.pushUntil((ch) => isEmpty(ch) || ch === "#");
  }
  *parseBlockScalar() {
    let nl = this.pos - 1;
    let indent = 0;
    let ch;
    loop: for (let i2 = this.pos; ch = this.buffer[i2]; ++i2) {
      switch (ch) {
        case " ":
          indent += 1;
          break;
        case "\n":
          nl = i2;
          indent = 0;
          break;
        case "\r": {
          const next = this.buffer[i2 + 1];
          if (!next && !this.atEnd)
            return this.setNext("block-scalar");
          if (next === "\n")
            break;
        }
        // fallthrough
        default:
          break loop;
      }
    }
    if (!ch && !this.atEnd)
      return this.setNext("block-scalar");
    if (indent >= this.indentNext) {
      if (this.blockScalarIndent === -1)
        this.indentNext = indent;
      else {
        this.indentNext = this.blockScalarIndent + (this.indentNext === 0 ? 1 : this.indentNext);
      }
      do {
        const cs = this.continueScalar(nl + 1);
        if (cs === -1)
          break;
        nl = this.buffer.indexOf("\n", cs);
      } while (nl !== -1);
      if (nl === -1) {
        if (!this.atEnd)
          return this.setNext("block-scalar");
        nl = this.buffer.length;
      }
    }
    let i = nl + 1;
    ch = this.buffer[i];
    while (ch === " ")
      ch = this.buffer[++i];
    if (ch === "	") {
      while (ch === "	" || ch === " " || ch === "\r" || ch === "\n")
        ch = this.buffer[++i];
      nl = i - 1;
    } else if (!this.blockScalarKeep) {
      do {
        let i2 = nl - 1;
        let ch2 = this.buffer[i2];
        if (ch2 === "\r")
          ch2 = this.buffer[--i2];
        const lastChar = i2;
        while (ch2 === " ")
          ch2 = this.buffer[--i2];
        if (ch2 === "\n" && i2 >= this.pos && i2 + 1 + indent > lastChar)
          nl = i2;
        else
          break;
      } while (true);
    }
    yield SCALAR2;
    yield* this.pushToIndex(nl + 1, true);
    return yield* this.parseLineStart();
  }
  *parsePlainScalar() {
    const inFlow = this.flowLevel > 0;
    let end = this.pos - 1;
    let i = this.pos - 1;
    let ch;
    while (ch = this.buffer[++i]) {
      if (ch === ":") {
        const next = this.buffer[i + 1];
        if (isEmpty(next) || inFlow && flowIndicatorChars.has(next))
          break;
        end = i;
      } else if (isEmpty(ch)) {
        let next = this.buffer[i + 1];
        if (ch === "\r") {
          if (next === "\n") {
            i += 1;
            ch = "\n";
            next = this.buffer[i + 1];
          } else
            end = i;
        }
        if (next === "#" || inFlow && flowIndicatorChars.has(next))
          break;
        if (ch === "\n") {
          const cs = this.continueScalar(i + 1);
          if (cs === -1)
            break;
          i = Math.max(i, cs - 2);
        }
      } else {
        if (inFlow && flowIndicatorChars.has(ch))
          break;
        end = i;
      }
    }
    if (!ch && !this.atEnd)
      return this.setNext("plain-scalar");
    yield SCALAR2;
    yield* this.pushToIndex(end + 1, true);
    return inFlow ? "flow" : "doc";
  }
  *pushCount(n) {
    if (n > 0) {
      yield this.buffer.substr(this.pos, n);
      this.pos += n;
      return n;
    }
    return 0;
  }
  *pushToIndex(i, allowEmpty) {
    const s = this.buffer.slice(this.pos, i);
    if (s) {
      yield s;
      this.pos += s.length;
      return s.length;
    } else if (allowEmpty)
      yield "";
    return 0;
  }
  *pushIndicators() {
    let n = 0;
    loop: while (true) {
      switch (this.charAt(0)) {
        case "!":
          n += yield* this.pushTag();
          n += yield* this.pushSpaces(true);
          continue loop;
        case "&":
          n += yield* this.pushUntil(isNotAnchorChar);
          n += yield* this.pushSpaces(true);
          continue loop;
        case "-":
        // this is an error
        case "?":
        // this is an error outside flow collections
        case ":": {
          const inFlow = this.flowLevel > 0;
          const ch1 = this.charAt(1);
          if (isEmpty(ch1) || inFlow && flowIndicatorChars.has(ch1)) {
            if (!inFlow)
              this.indentNext = this.indentValue + 1;
            else if (this.flowKey)
              this.flowKey = false;
            n += yield* this.pushCount(1);
            n += yield* this.pushSpaces(true);
            continue loop;
          }
        }
      }
      break loop;
    }
    return n;
  }
  *pushTag() {
    if (this.charAt(1) === "<") {
      let i = this.pos + 2;
      let ch = this.buffer[i];
      while (!isEmpty(ch) && ch !== ">")
        ch = this.buffer[++i];
      return yield* this.pushToIndex(ch === ">" ? i + 1 : i, false);
    } else {
      let i = this.pos + 1;
      let ch = this.buffer[i];
      while (ch) {
        if (tagChars.has(ch))
          ch = this.buffer[++i];
        else if (ch === "%" && hexDigits.has(this.buffer[i + 1]) && hexDigits.has(this.buffer[i + 2])) {
          ch = this.buffer[i += 3];
        } else
          break;
      }
      return yield* this.pushToIndex(i, false);
    }
  }
  *pushNewline() {
    const ch = this.buffer[this.pos];
    if (ch === "\n")
      return yield* this.pushCount(1);
    else if (ch === "\r" && this.charAt(1) === "\n")
      return yield* this.pushCount(2);
    else
      return 0;
  }
  *pushSpaces(allowTabs) {
    let i = this.pos - 1;
    let ch;
    do {
      ch = this.buffer[++i];
    } while (ch === " " || allowTabs && ch === "	");
    const n = i - this.pos;
    if (n > 0) {
      yield this.buffer.substr(this.pos, n);
      this.pos = i;
    }
    return n;
  }
  *pushUntil(test) {
    let i = this.pos;
    let ch = this.buffer[i];
    while (!test(ch))
      ch = this.buffer[++i];
    return yield* this.pushToIndex(i, false);
  }
};

// node_modules/yaml/browser/dist/parse/line-counter.js
var LineCounter = class {
  constructor() {
    this.lineStarts = [];
    this.addNewLine = (offset) => this.lineStarts.push(offset);
    this.linePos = (offset) => {
      let low = 0;
      let high = this.lineStarts.length;
      while (low < high) {
        const mid = low + high >> 1;
        if (this.lineStarts[mid] < offset)
          low = mid + 1;
        else
          high = mid;
      }
      if (this.lineStarts[low] === offset)
        return { line: low + 1, col: 1 };
      if (low === 0)
        return { line: 0, col: offset };
      const start = this.lineStarts[low - 1];
      return { line: low, col: offset - start + 1 };
    };
  }
};

// node_modules/yaml/browser/dist/parse/parser.js
function includesToken(list2, type) {
  for (let i = 0; i < list2.length; ++i)
    if (list2[i].type === type)
      return true;
  return false;
}
function findNonEmptyIndex(list2) {
  for (let i = 0; i < list2.length; ++i) {
    switch (list2[i].type) {
      case "space":
      case "comment":
      case "newline":
        break;
      default:
        return i;
    }
  }
  return -1;
}
function isFlowToken(token) {
  switch (token?.type) {
    case "alias":
    case "scalar":
    case "single-quoted-scalar":
    case "double-quoted-scalar":
    case "flow-collection":
      return true;
    default:
      return false;
  }
}
function getPrevProps(parent) {
  switch (parent.type) {
    case "document":
      return parent.start;
    case "block-map": {
      const it = parent.items[parent.items.length - 1];
      return it.sep ?? it.start;
    }
    case "block-seq":
      return parent.items[parent.items.length - 1].start;
    /* istanbul ignore next should not happen */
    default:
      return [];
  }
}
function getFirstKeyStartProps(prev) {
  if (prev.length === 0)
    return [];
  let i = prev.length;
  loop: while (--i >= 0) {
    switch (prev[i].type) {
      case "doc-start":
      case "explicit-key-ind":
      case "map-value-ind":
      case "seq-item-ind":
      case "newline":
        break loop;
    }
  }
  while (prev[++i]?.type === "space") {
  }
  return prev.splice(i, prev.length);
}
function arrayPushArray(target, source) {
  if (source.length < 1e5)
    Array.prototype.push.apply(target, source);
  else
    for (let i = 0; i < source.length; ++i)
      target.push(source[i]);
}
function fixFlowSeqItems(fc) {
  if (fc.start.type === "flow-seq-start") {
    for (const it of fc.items) {
      if (it.sep && !it.value && !includesToken(it.start, "explicit-key-ind") && !includesToken(it.sep, "map-value-ind")) {
        if (it.key)
          it.value = it.key;
        delete it.key;
        if (isFlowToken(it.value)) {
          if (it.value.end)
            arrayPushArray(it.value.end, it.sep);
          else
            it.value.end = it.sep;
        } else
          arrayPushArray(it.start, it.sep);
        delete it.sep;
      }
    }
  }
}
var Parser = class {
  /**
   * @param onNewLine - If defined, called separately with the start position of
   *   each new line (in `parse()`, including the start of input).
   */
  constructor(onNewLine) {
    this.atNewLine = true;
    this.atScalar = false;
    this.indent = 0;
    this.offset = 0;
    this.onKeyLine = false;
    this.stack = [];
    this.source = "";
    this.type = "";
    this.lexer = new Lexer();
    this.onNewLine = onNewLine;
  }
  /**
   * Parse `source` as a YAML stream.
   * If `incomplete`, a part of the last line may be left as a buffer for the next call.
   *
   * Errors are not thrown, but yielded as `{ type: 'error', message }` tokens.
   *
   * @returns A generator of tokens representing each directive, document, and other structure.
   */
  *parse(source, incomplete = false) {
    if (this.onNewLine && this.offset === 0)
      this.onNewLine(0);
    for (const lexeme of this.lexer.lex(source, incomplete))
      yield* this.next(lexeme);
    if (!incomplete)
      yield* this.end();
  }
  /**
   * Advance the parser by the `source` of one lexical token.
   */
  *next(source) {
    this.source = source;
    if (this.atScalar) {
      this.atScalar = false;
      yield* this.step();
      this.offset += source.length;
      return;
    }
    const type = tokenType(source);
    if (!type) {
      const message = `Not a YAML token: ${source}`;
      yield* this.pop({ type: "error", offset: this.offset, message, source });
      this.offset += source.length;
    } else if (type === "scalar") {
      this.atNewLine = false;
      this.atScalar = true;
      this.type = "scalar";
    } else {
      this.type = type;
      yield* this.step();
      switch (type) {
        case "newline":
          this.atNewLine = true;
          this.indent = 0;
          if (this.onNewLine)
            this.onNewLine(this.offset + source.length);
          break;
        case "space":
          if (this.atNewLine && source[0] === " ")
            this.indent += source.length;
          break;
        case "explicit-key-ind":
        case "map-value-ind":
        case "seq-item-ind":
          if (this.atNewLine)
            this.indent += source.length;
          break;
        case "doc-mode":
        case "flow-error-end":
          return;
        default:
          this.atNewLine = false;
      }
      this.offset += source.length;
    }
  }
  /** Call at end of input to push out any remaining constructions */
  *end() {
    while (this.stack.length > 0)
      yield* this.pop();
  }
  get sourceToken() {
    const st = {
      type: this.type,
      offset: this.offset,
      indent: this.indent,
      source: this.source
    };
    return st;
  }
  *step() {
    const top = this.peek(1);
    if (this.type === "doc-end" && top?.type !== "doc-end") {
      while (this.stack.length > 0)
        yield* this.pop();
      this.stack.push({
        type: "doc-end",
        offset: this.offset,
        source: this.source
      });
      return;
    }
    if (!top)
      return yield* this.stream();
    switch (top.type) {
      case "document":
        return yield* this.document(top);
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
        return yield* this.scalar(top);
      case "block-scalar":
        return yield* this.blockScalar(top);
      case "block-map":
        return yield* this.blockMap(top);
      case "block-seq":
        return yield* this.blockSequence(top);
      case "flow-collection":
        return yield* this.flowCollection(top);
      case "doc-end":
        return yield* this.documentEnd(top);
    }
    yield* this.pop();
  }
  peek(n) {
    return this.stack[this.stack.length - n];
  }
  *pop(error) {
    const token = error ?? this.stack.pop();
    if (!token) {
      const message = "Tried to pop an empty stack";
      yield { type: "error", offset: this.offset, source: "", message };
    } else if (this.stack.length === 0) {
      yield token;
    } else {
      const top = this.peek(1);
      if (token.type === "block-scalar") {
        token.indent = "indent" in top ? top.indent : 0;
      } else if (token.type === "flow-collection" && top.type === "document") {
        token.indent = 0;
      }
      if (token.type === "flow-collection")
        fixFlowSeqItems(token);
      switch (top.type) {
        case "document":
          top.value = token;
          break;
        case "block-scalar":
          top.props.push(token);
          break;
        case "block-map": {
          const it = top.items[top.items.length - 1];
          if (it.value) {
            top.items.push({ start: [], key: token, sep: [] });
            this.onKeyLine = true;
            return;
          } else if (it.sep) {
            it.value = token;
          } else {
            Object.assign(it, { key: token, sep: [] });
            this.onKeyLine = !it.explicitKey;
            return;
          }
          break;
        }
        case "block-seq": {
          const it = top.items[top.items.length - 1];
          if (it.value)
            top.items.push({ start: [], value: token });
          else
            it.value = token;
          break;
        }
        case "flow-collection": {
          const it = top.items[top.items.length - 1];
          if (!it || it.value)
            top.items.push({ start: [], key: token, sep: [] });
          else if (it.sep)
            it.value = token;
          else
            Object.assign(it, { key: token, sep: [] });
          return;
        }
        /* istanbul ignore next should not happen */
        default:
          yield* this.pop();
          yield* this.pop(token);
      }
      if ((top.type === "document" || top.type === "block-map" || top.type === "block-seq") && (token.type === "block-map" || token.type === "block-seq")) {
        const last = token.items[token.items.length - 1];
        if (last && !last.sep && !last.value && last.start.length > 0 && findNonEmptyIndex(last.start) === -1 && (token.indent === 0 || last.start.every((st) => st.type !== "comment" || st.indent < token.indent))) {
          if (top.type === "document")
            top.end = last.start;
          else
            top.items.push({ start: last.start });
          token.items.splice(-1, 1);
        }
      }
    }
  }
  *stream() {
    switch (this.type) {
      case "directive-line":
        yield { type: "directive", offset: this.offset, source: this.source };
        return;
      case "byte-order-mark":
      case "space":
      case "comment":
      case "newline":
        yield this.sourceToken;
        return;
      case "doc-mode":
      case "doc-start": {
        const doc = {
          type: "document",
          offset: this.offset,
          start: []
        };
        if (this.type === "doc-start")
          doc.start.push(this.sourceToken);
        this.stack.push(doc);
        return;
      }
    }
    yield {
      type: "error",
      offset: this.offset,
      message: `Unexpected ${this.type} token in YAML stream`,
      source: this.source
    };
  }
  *document(doc) {
    if (doc.value)
      return yield* this.lineEnd(doc);
    switch (this.type) {
      case "doc-start": {
        if (findNonEmptyIndex(doc.start) !== -1) {
          yield* this.pop();
          yield* this.step();
        } else
          doc.start.push(this.sourceToken);
        return;
      }
      case "anchor":
      case "tag":
      case "space":
      case "comment":
      case "newline":
        doc.start.push(this.sourceToken);
        return;
    }
    const bv = this.startBlockValue(doc);
    if (bv)
      this.stack.push(bv);
    else {
      yield {
        type: "error",
        offset: this.offset,
        message: `Unexpected ${this.type} token in YAML document`,
        source: this.source
      };
    }
  }
  *scalar(scalar2) {
    if (this.type === "map-value-ind") {
      const prev = getPrevProps(this.peek(2));
      const start = getFirstKeyStartProps(prev);
      let sep;
      if (scalar2.end) {
        sep = scalar2.end;
        sep.push(this.sourceToken);
        delete scalar2.end;
      } else
        sep = [this.sourceToken];
      const map2 = {
        type: "block-map",
        offset: scalar2.offset,
        indent: scalar2.indent,
        items: [{ start, key: scalar2, sep }]
      };
      this.onKeyLine = true;
      this.stack[this.stack.length - 1] = map2;
    } else
      yield* this.lineEnd(scalar2);
  }
  *blockScalar(scalar2) {
    switch (this.type) {
      case "space":
      case "comment":
      case "newline":
        scalar2.props.push(this.sourceToken);
        return;
      case "scalar":
        scalar2.source = this.source;
        this.atNewLine = true;
        this.indent = 0;
        if (this.onNewLine) {
          let nl = this.source.indexOf("\n") + 1;
          while (nl !== 0) {
            this.onNewLine(this.offset + nl);
            nl = this.source.indexOf("\n", nl) + 1;
          }
        }
        yield* this.pop();
        break;
      /* istanbul ignore next should not happen */
      default:
        yield* this.pop();
        yield* this.step();
    }
  }
  *blockMap(map2) {
    const it = map2.items[map2.items.length - 1];
    switch (this.type) {
      case "newline":
        this.onKeyLine = false;
        if (it.value) {
          const end = "end" in it.value ? it.value.end : void 0;
          const last = Array.isArray(end) ? end[end.length - 1] : void 0;
          if (last?.type === "comment")
            end?.push(this.sourceToken);
          else
            map2.items.push({ start: [this.sourceToken] });
        } else if (it.sep) {
          it.sep.push(this.sourceToken);
        } else {
          it.start.push(this.sourceToken);
        }
        return;
      case "space":
      case "comment":
        if (it.value) {
          map2.items.push({ start: [this.sourceToken] });
        } else if (it.sep) {
          it.sep.push(this.sourceToken);
        } else {
          if (this.atIndentedComment(it.start, map2.indent)) {
            const prev = map2.items[map2.items.length - 2];
            const end = prev?.value?.end;
            if (Array.isArray(end)) {
              arrayPushArray(end, it.start);
              end.push(this.sourceToken);
              map2.items.pop();
              return;
            }
          }
          it.start.push(this.sourceToken);
        }
        return;
    }
    if (this.indent >= map2.indent) {
      const atMapIndent = !this.onKeyLine && this.indent === map2.indent;
      const atNextItem = atMapIndent && (it.sep || it.explicitKey) && this.type !== "seq-item-ind";
      let start = [];
      if (atNextItem && it.sep && !it.value) {
        const nl = [];
        for (let i = 0; i < it.sep.length; ++i) {
          const st = it.sep[i];
          switch (st.type) {
            case "newline":
              nl.push(i);
              break;
            case "space":
              break;
            case "comment":
              if (st.indent > map2.indent)
                nl.length = 0;
              break;
            default:
              nl.length = 0;
          }
        }
        if (nl.length >= 2)
          start = it.sep.splice(nl[1]);
      }
      switch (this.type) {
        case "anchor":
        case "tag":
          if (atNextItem || it.value) {
            start.push(this.sourceToken);
            map2.items.push({ start });
            this.onKeyLine = true;
          } else if (it.sep) {
            it.sep.push(this.sourceToken);
          } else {
            it.start.push(this.sourceToken);
          }
          return;
        case "explicit-key-ind":
          if (!it.sep && !it.explicitKey) {
            it.start.push(this.sourceToken);
            it.explicitKey = true;
          } else if (atNextItem || it.value) {
            start.push(this.sourceToken);
            map2.items.push({ start, explicitKey: true });
          } else {
            this.stack.push({
              type: "block-map",
              offset: this.offset,
              indent: this.indent,
              items: [{ start: [this.sourceToken], explicitKey: true }]
            });
          }
          this.onKeyLine = true;
          return;
        case "map-value-ind":
          if (it.explicitKey) {
            if (!it.sep) {
              if (includesToken(it.start, "newline")) {
                Object.assign(it, { key: null, sep: [this.sourceToken] });
              } else {
                const start2 = getFirstKeyStartProps(it.start);
                this.stack.push({
                  type: "block-map",
                  offset: this.offset,
                  indent: this.indent,
                  items: [{ start: start2, key: null, sep: [this.sourceToken] }]
                });
              }
            } else if (it.value) {
              map2.items.push({ start: [], key: null, sep: [this.sourceToken] });
            } else if (includesToken(it.sep, "map-value-ind")) {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start, key: null, sep: [this.sourceToken] }]
              });
            } else if (isFlowToken(it.key) && !includesToken(it.sep, "newline")) {
              const start2 = getFirstKeyStartProps(it.start);
              const key2 = it.key;
              const sep = it.sep;
              sep.push(this.sourceToken);
              delete it.key;
              delete it.sep;
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: start2, key: key2, sep }]
              });
            } else if (start.length > 0) {
              it.sep = it.sep.concat(start, this.sourceToken);
            } else {
              it.sep.push(this.sourceToken);
            }
          } else {
            if (!it.sep) {
              Object.assign(it, { key: null, sep: [this.sourceToken] });
            } else if (it.value || atNextItem) {
              map2.items.push({ start, key: null, sep: [this.sourceToken] });
            } else if (includesToken(it.sep, "map-value-ind")) {
              this.stack.push({
                type: "block-map",
                offset: this.offset,
                indent: this.indent,
                items: [{ start: [], key: null, sep: [this.sourceToken] }]
              });
            } else {
              it.sep.push(this.sourceToken);
            }
          }
          this.onKeyLine = true;
          return;
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar": {
          const fs = this.flowScalar(this.type);
          if (atNextItem || it.value) {
            map2.items.push({ start, key: fs, sep: [] });
            this.onKeyLine = true;
          } else if (it.sep) {
            this.stack.push(fs);
          } else {
            Object.assign(it, { key: fs, sep: [] });
            this.onKeyLine = true;
          }
          return;
        }
        default: {
          const bv = this.startBlockValue(map2);
          if (bv) {
            if (bv.type === "block-seq") {
              if (!it.explicitKey && it.sep && !includesToken(it.sep, "newline")) {
                yield* this.pop({
                  type: "error",
                  offset: this.offset,
                  message: "Unexpected block-seq-ind on same line with key",
                  source: this.source
                });
                return;
              }
            } else if (atMapIndent) {
              map2.items.push({ start });
            }
            this.stack.push(bv);
            return;
          }
        }
      }
    }
    yield* this.pop();
    yield* this.step();
  }
  *blockSequence(seq2) {
    const it = seq2.items[seq2.items.length - 1];
    switch (this.type) {
      case "newline":
        if (it.value) {
          const end = "end" in it.value ? it.value.end : void 0;
          const last = Array.isArray(end) ? end[end.length - 1] : void 0;
          if (last?.type === "comment")
            end?.push(this.sourceToken);
          else
            seq2.items.push({ start: [this.sourceToken] });
        } else
          it.start.push(this.sourceToken);
        return;
      case "space":
      case "comment":
        if (it.value)
          seq2.items.push({ start: [this.sourceToken] });
        else {
          if (this.atIndentedComment(it.start, seq2.indent)) {
            const prev = seq2.items[seq2.items.length - 2];
            const end = prev?.value?.end;
            if (Array.isArray(end)) {
              arrayPushArray(end, it.start);
              end.push(this.sourceToken);
              seq2.items.pop();
              return;
            }
          }
          it.start.push(this.sourceToken);
        }
        return;
      case "anchor":
      case "tag":
        if (it.value || this.indent <= seq2.indent)
          break;
        it.start.push(this.sourceToken);
        return;
      case "seq-item-ind":
        if (this.indent !== seq2.indent)
          break;
        if (it.value || includesToken(it.start, "seq-item-ind"))
          seq2.items.push({ start: [this.sourceToken] });
        else
          it.start.push(this.sourceToken);
        return;
    }
    if (this.indent > seq2.indent) {
      const bv = this.startBlockValue(seq2);
      if (bv) {
        this.stack.push(bv);
        return;
      }
    }
    yield* this.pop();
    yield* this.step();
  }
  *flowCollection(fc) {
    const it = fc.items[fc.items.length - 1];
    if (this.type === "flow-error-end") {
      let top;
      do {
        yield* this.pop();
        top = this.peek(1);
      } while (top?.type === "flow-collection");
    } else if (fc.end.length === 0) {
      switch (this.type) {
        case "comma":
        case "explicit-key-ind":
          if (!it || it.sep)
            fc.items.push({ start: [this.sourceToken] });
          else
            it.start.push(this.sourceToken);
          return;
        case "map-value-ind":
          if (!it || it.value)
            fc.items.push({ start: [], key: null, sep: [this.sourceToken] });
          else if (it.sep)
            it.sep.push(this.sourceToken);
          else
            Object.assign(it, { key: null, sep: [this.sourceToken] });
          return;
        case "space":
        case "comment":
        case "newline":
        case "anchor":
        case "tag":
          if (!it || it.value)
            fc.items.push({ start: [this.sourceToken] });
          else if (it.sep)
            it.sep.push(this.sourceToken);
          else
            it.start.push(this.sourceToken);
          return;
        case "alias":
        case "scalar":
        case "single-quoted-scalar":
        case "double-quoted-scalar": {
          const fs = this.flowScalar(this.type);
          if (!it || it.value)
            fc.items.push({ start: [], key: fs, sep: [] });
          else if (it.sep)
            this.stack.push(fs);
          else
            Object.assign(it, { key: fs, sep: [] });
          return;
        }
        case "flow-map-end":
        case "flow-seq-end":
          fc.end.push(this.sourceToken);
          return;
      }
      const bv = this.startBlockValue(fc);
      if (bv)
        this.stack.push(bv);
      else {
        yield* this.pop();
        yield* this.step();
      }
    } else {
      const parent = this.peek(2);
      if (parent.type === "block-map" && (this.type === "map-value-ind" && parent.indent === fc.indent || this.type === "newline" && !parent.items[parent.items.length - 1].sep)) {
        yield* this.pop();
        yield* this.step();
      } else if (this.type === "map-value-ind" && parent.type !== "flow-collection") {
        const prev = getPrevProps(parent);
        const start = getFirstKeyStartProps(prev);
        fixFlowSeqItems(fc);
        const sep = fc.end.splice(1, fc.end.length);
        sep.push(this.sourceToken);
        const map2 = {
          type: "block-map",
          offset: fc.offset,
          indent: fc.indent,
          items: [{ start, key: fc, sep }]
        };
        this.onKeyLine = true;
        this.stack[this.stack.length - 1] = map2;
      } else {
        yield* this.lineEnd(fc);
      }
    }
  }
  flowScalar(type) {
    if (this.onNewLine) {
      let nl = this.source.indexOf("\n") + 1;
      while (nl !== 0) {
        this.onNewLine(this.offset + nl);
        nl = this.source.indexOf("\n", nl) + 1;
      }
    }
    return {
      type,
      offset: this.offset,
      indent: this.indent,
      source: this.source
    };
  }
  startBlockValue(parent) {
    switch (this.type) {
      case "alias":
      case "scalar":
      case "single-quoted-scalar":
      case "double-quoted-scalar":
        return this.flowScalar(this.type);
      case "block-scalar-header":
        return {
          type: "block-scalar",
          offset: this.offset,
          indent: this.indent,
          props: [this.sourceToken],
          source: ""
        };
      case "flow-map-start":
      case "flow-seq-start":
        return {
          type: "flow-collection",
          offset: this.offset,
          indent: this.indent,
          start: this.sourceToken,
          items: [],
          end: []
        };
      case "seq-item-ind":
        return {
          type: "block-seq",
          offset: this.offset,
          indent: this.indent,
          items: [{ start: [this.sourceToken] }]
        };
      case "explicit-key-ind": {
        this.onKeyLine = true;
        const prev = getPrevProps(parent);
        const start = getFirstKeyStartProps(prev);
        start.push(this.sourceToken);
        return {
          type: "block-map",
          offset: this.offset,
          indent: this.indent,
          items: [{ start, explicitKey: true }]
        };
      }
      case "map-value-ind": {
        this.onKeyLine = true;
        const prev = getPrevProps(parent);
        const start = getFirstKeyStartProps(prev);
        return {
          type: "block-map",
          offset: this.offset,
          indent: this.indent,
          items: [{ start, key: null, sep: [this.sourceToken] }]
        };
      }
    }
    return null;
  }
  atIndentedComment(start, indent) {
    if (this.type !== "comment")
      return false;
    if (this.indent <= indent)
      return false;
    return start.every((st) => st.type === "newline" || st.type === "space");
  }
  *documentEnd(docEnd) {
    if (this.type !== "doc-mode") {
      if (docEnd.end)
        docEnd.end.push(this.sourceToken);
      else
        docEnd.end = [this.sourceToken];
      if (this.type === "newline")
        yield* this.pop();
    }
  }
  *lineEnd(token) {
    switch (this.type) {
      case "comma":
      case "doc-start":
      case "doc-end":
      case "flow-seq-end":
      case "flow-map-end":
      case "map-value-ind":
        yield* this.pop();
        yield* this.step();
        break;
      case "newline":
        this.onKeyLine = false;
      // fallthrough
      case "space":
      case "comment":
      default:
        if (token.end)
          token.end.push(this.sourceToken);
        else
          token.end = [this.sourceToken];
        if (this.type === "newline")
          yield* this.pop();
    }
  }
};

// node_modules/yaml/browser/dist/public-api.js
function parseOptions(options) {
  const prettyErrors = options.prettyErrors !== false;
  const lineCounter = options.lineCounter || prettyErrors && new LineCounter() || null;
  return { lineCounter, prettyErrors };
}
function parseDocument(source, options = {}) {
  const { lineCounter, prettyErrors } = parseOptions(options);
  const parser = new Parser(lineCounter?.addNewLine);
  const composer = new Composer(options);
  let doc = null;
  for (const _doc of composer.compose(parser.parse(source), true, source.length)) {
    if (!doc)
      doc = _doc;
    else if (doc.options.logLevel !== "silent") {
      doc.errors.push(new YAMLParseError(_doc.range.slice(0, 2), "MULTIPLE_DOCS", "Source contains multiple documents; please use YAML.parseAllDocuments()"));
      break;
    }
  }
  if (prettyErrors && lineCounter) {
    doc.errors.forEach(prettifyError(source, lineCounter));
    doc.warnings.forEach(prettifyError(source, lineCounter));
  }
  return doc;
}

// src/core/definition-lifecycle.ts
function assessDefinitionDeletion(impact) {
  const noteUses = [...impact.noteUses].sort(
    (a, b) => a.fromPath.localeCompare(b.fromPath) || a.field.localeCompare(b.field)
  );
  const occurrenceUses = [...impact.occurrenceUses].sort(
    (a, b) => a.ownerPath.localeCompare(b.ownerPath) || a.kind.localeCompare(b.kind) || a.identifier.localeCompare(b.identifier) || a.localId.localeCompare(b.localId)
  );
  const blockers = [
    ...noteUses.map((use) => `MODEL: ${use.fromPath} references this definition through ${use.field}.`),
    ...occurrenceUses.map(
      (use) => `LOCAL: ${use.ownerPath} contains ${use.kind} "${use.identifier}" (^${use.localId}) using this definition.`
    )
  ];
  return {
    allowed: blockers.length === 0,
    blockers,
    noteUseCount: noteUses.length,
    occurrenceUseCount: occurrenceUses.length
  };
}
function planDefinitionRetirement(definitionPath, currentStatus, impact) {
  const status = typeof currentStatus === "string" && currentStatus.trim() ? currentStatus.trim().toLowerCase() : null;
  const assessment = assessDefinitionDeletion(impact);
  return {
    definitionPath,
    fromStatus: status,
    toStatus: "retired",
    changed: status !== "retired",
    noteUseCount: assessment.noteUseCount,
    occurrenceUseCount: assessment.occurrenceUseCount,
    impactRows: assessment.blockers,
    preservesReferences: true
  };
}

// src/core/definition-delete.ts
var DefinitionDeletionService = class {
  constructor(store, impactFor, transactions, uidInUse) {
    this.store = store;
    this.impactFor = impactFor;
    this.transactions = transactions;
    this.uidInUse = uidInUse;
    this.sequence = 0;
    this.pending = /* @__PURE__ */ new Map();
  }
  async stage(path, uid) {
    if (!await this.store.exists(path)) throw new Error(`${path} does not exist.`);
    const before = await this.store.read(path);
    const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(before);
    if (!frontmatterMatch) throw new Error(`${path} must begin with YAML frontmatter.`);
    const doc = parseDocument(frontmatterMatch[1]);
    if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
    const storedUid = String(doc.get("uid") ?? "").trim();
    if (!storedUid || storedUid !== uid) {
      throw new Error(`Cannot stage deletion of ${path}: expected uid ${uid}, found ${storedUid || "none"}.`);
    }
    const impact = assessDefinitionDeletion(await this.impactFor(path));
    const id = `definition-delete-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `delete definition ${path}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-delete",
      label,
      changes: [{
        kind: "definition.delete",
        summary: label,
        refs: [noteRef(uid)],
        metadata: {
          path,
          noteUseCount: impact.noteUseCount,
          occurrenceUseCount: impact.occurrenceUseCount
        }
      }]
    });
    this.pending.set(id, { path, uid, before, label, impact });
    return { transaction, path, uid, impact };
  }
  async stageAndReview(path, uid) {
    const staged = await this.stage(path, uid);
    return this.review(staged.transaction.id);
  }
  review(transactionId) {
    const pending = this.requirePending(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      path: pending.path,
      uid: pending.uid,
      impact: pending.impact
    };
  }
  async apply(transactionId) {
    const pending = this.requirePending(transactionId);
    const latestImpact = assessDefinitionDeletion(await this.impactFor(pending.path));
    if (!latestImpact.allowed) {
      throw new Error(
        `Cannot apply ${pending.label}: ${latestImpact.noteUseCount + latestImpact.occurrenceUseCount} active reference${latestImpact.noteUseCount + latestImpact.occurrenceUseCount === 1 ? "" : "s"} remain.`
      );
    }
    if (!await this.store.exists(pending.path)) throw new Error(`Cannot apply ${pending.label}: definition no longer exists.`);
    const current = await this.store.read(pending.path);
    if (current !== pending.before) throw new Error(`Cannot apply ${pending.label}: definition changed after Review.`);
    await this.transactions.apply(transactionId, {
      apply: async () => {
        const impact = assessDefinitionDeletion(await this.impactFor(pending.path));
        if (!impact.allowed) throw new Error(`Cannot apply ${pending.label}: active references appeared after Review.`);
        if (!await this.store.exists(pending.path)) throw new Error(`${pending.path} no longer exists.`);
        const latest = await this.store.read(pending.path);
        if (latest !== pending.before) throw new Error(`${pending.path} changed after Review.`);
        await this.store.remove(pending.path);
        return {
          undo: async () => {
            if (await this.store.exists(pending.path)) throw new Error(`${pending.path} already exists; cannot restore deleted definition.`);
            if (this.uidInUse?.(pending.uid)) {
              throw new Error(`Cannot undo ${pending.label}: uid ${pending.uid} is now in use.`);
            }
            await this.store.create(pending.path, pending.before);
          },
          redo: async () => {
            const impactNow = assessDefinitionDeletion(await this.impactFor(pending.path));
            if (!impactNow.allowed) throw new Error(`Cannot redo ${pending.label}: active references exist.`);
            if (!await this.store.exists(pending.path)) throw new Error(`${pending.path} no longer exists before redo.`);
            const restored = await this.store.read(pending.path);
            if (restored !== pending.before) throw new Error(`${pending.path} changed after undoing ${pending.label}.`);
            await this.store.remove(pending.path);
          }
        };
      }
    });
    this.pending.delete(transactionId);
  }
  cancel(transactionId) {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }
  requirePending(transactionId) {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition deletion transaction ${transactionId} does not exist.`);
    return pending;
  }
};

// src/core/definition-retire.ts
function impactSignature(impact) {
  const note = impact.noteUses.map((use) => `${use.fromPath}|${use.field}`).sort().join("\n");
  const occurrence = impact.occurrenceUses.map((use) => `${use.ownerPath}|${use.kind}|${use.identifier}|${use.localId}`).sort().join("\n");
  return `${note}
--
${occurrence}`;
}
function retireDefinitionText(text) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Definition note must begin with YAML frontmatter.");
  const yaml = match[1];
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw new Error(`Definition frontmatter is invalid YAML: ${doc.errors[0]?.message ?? "parse error"}`);
  const currentStatus = doc.get("status");
  const node = doc.get("status", true);
  let nextYaml;
  if (node === void 0 || node === null) {
    const addition = `${yaml.endsWith("\n") || yaml.length === 0 ? "" : "\n"}status: retired`;
    nextYaml = yaml + addition;
  } else {
    const range = node.range;
    if (!range) throw new Error("Cannot safely update status; YAML source range is unavailable.");
    nextYaml = yaml.slice(0, range[0]) + "retired" + yaml.slice(range[1]);
  }
  const after = `---
${nextYaml}
---
${text.slice(match[0].length)}`;
  return { text: after, currentStatus };
}
var DefinitionRetirementService = class {
  constructor(store, impactFor, transactions) {
    this.store = store;
    this.impactFor = impactFor;
    this.transactions = transactions;
    this.sequence = 0;
    this.pending = /* @__PURE__ */ new Map();
  }
  async stage(path, uid) {
    if (!await this.store.exists(path)) throw new Error(`${path} does not exist.`);
    const before = await this.store.read(path);
    const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(before);
    if (!frontmatterMatch) throw new Error(`${path} must begin with YAML frontmatter.`);
    const doc = parseDocument(frontmatterMatch[1]);
    if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
    const storedUid = String(doc.get("uid") ?? "").trim();
    if (!storedUid || storedUid !== uid) {
      throw new Error(`Cannot stage retirement of ${path}: expected uid ${uid}, found ${storedUid || "none"}.`);
    }
    const transformed = retireDefinitionText(before);
    const impact = await this.impactFor(path);
    const plan = planDefinitionRetirement(path, transformed.currentStatus, impact);
    const id = `definition-retire-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `retire definition ${path}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-retire",
      label,
      changes: [{
        kind: "definition.retire",
        summary: label,
        refs: [noteRef(uid)],
        metadata: {
          path,
          fromStatus: plan.fromStatus,
          toStatus: plan.toStatus,
          noteUseCount: plan.noteUseCount,
          occurrenceUseCount: plan.occurrenceUseCount,
          preservesReferences: true
        }
      }]
    });
    this.pending.set(id, {
      path,
      uid,
      before,
      after: transformed.text,
      label,
      plan,
      impactSignature: impactSignature(impact)
    });
    return { transaction, plan, path, uid };
  }
  async stageAndReview(path, uid) {
    const staged = await this.stage(path, uid);
    return this.review(staged.transaction.id);
  }
  review(transactionId) {
    const pending = this.requirePending(transactionId);
    return {
      transaction: this.transactions.review(transactionId),
      plan: pending.plan,
      path: pending.path,
      uid: pending.uid
    };
  }
  async apply(transactionId) {
    const pending = this.requirePending(transactionId);
    if (!pending.plan.changed) throw new Error(`${pending.path} is already retired.`);
    const latestImpact = await this.impactFor(pending.path);
    if (impactSignature(latestImpact) !== pending.impactSignature) {
      throw new Error("Dependent usage changed after Review. Reopen retirement review before Apply.");
    }
    if (!await this.store.exists(pending.path)) throw new Error(`${pending.path} no longer exists.`);
    const current = await this.store.read(pending.path);
    if (current !== pending.before) throw new Error(`${pending.path} changed after Review.`);
    await this.transactions.apply(transactionId, {
      apply: async () => {
        const latestImpact2 = await this.impactFor(pending.path);
        if (impactSignature(latestImpact2) !== pending.impactSignature) {
          throw new Error("Dependent usage changed after Review.");
        }
        if (!await this.store.exists(pending.path)) throw new Error(`${pending.path} no longer exists.`);
        const latest = await this.store.read(pending.path);
        if (latest !== pending.before) throw new Error(`${pending.path} changed after Review.`);
        await this.store.write(pending.path, pending.after);
        return {
          undo: async () => {
            if (!await this.store.exists(pending.path)) throw new Error(`${pending.path} no longer exists after retirement.`);
            const retired = await this.store.read(pending.path);
            if (retired !== pending.after) throw new Error(`${pending.path} changed after retirement.`);
            await this.store.write(pending.path, pending.before);
          },
          redo: async () => {
            const latestImpact3 = await this.impactFor(pending.path);
            if (impactSignature(latestImpact3) !== pending.impactSignature) {
              throw new Error(`Cannot redo ${pending.label}: dependent usage changed after Review.`);
            }
            if (!await this.store.exists(pending.path)) throw new Error(`${pending.path} no longer exists before retirement redo.`);
            const restored = await this.store.read(pending.path);
            if (restored !== pending.before) throw new Error(`${pending.path} changed after undoing retirement.`);
            await this.store.write(pending.path, pending.after);
          }
        };
      }
    });
    this.pending.delete(transactionId);
  }
  cancel(transactionId) {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }
  requirePending(transactionId) {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition retirement transaction ${transactionId} does not exist.`);
    return pending;
  }
};

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
function sortLinks(list2) {
  return list2.sort(
    (a, b) => (linkTarget(a) ?? String(a)).localeCompare(linkTarget(b) ?? String(b), void 0, { sensitivity: "base" })
  );
}
function addLink(fm, field, linkText, same) {
  const list2 = asList(fm[field]);
  const already = same ?? ((v) => linkTarget(v)?.toLowerCase() === linkText.toLowerCase());
  if (list2.some(already)) return false;
  list2.push(`[[${linkText}]]`);
  fm[field] = sortLinks(list2);
  return true;
}
function removeLink(fm, field, linkText, same) {
  const list2 = asList(fm[field]);
  const match = same ?? ((v) => linkTarget(v)?.toLowerCase() === linkText.toLowerCase());
  const kept = list2.filter((v) => !match(v));
  if (kept.length === list2.length) return false;
  if (kept.length) fm[field] = kept;
  else delete fm[field];
  return true;
}
function canonicalOrder(schema4) {
  const common = [...schema4.commonProperties];
  const tagsAt = common.indexOf("tags");
  common.splice(tagsAt < 0 ? common.length : tagsAt, 0, ...schema4.translatedOnlyProperties);
  const rel = [];
  for (const r of schema4.relationships) {
    rel.push(r.field);
    if (r.inverse) rel.push(r.inverse);
  }
  return [...common, ...schema4.optionalProperties, ...rel];
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

// src/core/definition-supersede.ts
var LIFECYCLE_PROVENANCE_FIELDS = /* @__PURE__ */ new Set(["supersedes", "supersededBy"]);
function definitionMigrationCandidates(impact) {
  return [
    ...impact.noteUses.filter((use) => !LIFECYCLE_PROVENANCE_FIELDS.has(use.field)).map((use) => ({
      scope: "note",
      ownerPath: use.fromPath,
      field: use.field
    })),
    ...impact.occurrenceUses.map((use) => ({
      scope: "occurrence",
      ownerPath: use.ownerPath,
      field: "definition",
      localId: use.localId,
      kind: use.kind,
      identifier: use.identifier
    }))
  ].sort(
    (a, b) => a.ownerPath.localeCompare(b.ownerPath) || a.scope.localeCompare(b.scope) || a.field.localeCompare(b.field) || (a.scope === "occurrence" ? a.localId : "").localeCompare(b.scope === "occurrence" ? b.localId : "")
  );
}
function planDefinitionSupersession(request) {
  const replacedPath = request.replacedPath.trim();
  const replacementPath = request.replacementPath.trim();
  const replacedType = request.replacedType.trim();
  const replacementType = request.replacementType.trim();
  const status = (request.replacementStatus ?? "").trim().toLowerCase();
  const blockers = [];
  const warnings = [];
  if (!replacedPath || !replacementPath) blockers.push("Both replaced and replacement definition paths are required.");
  if (replacedPath && replacementPath && replacedPath === replacementPath) blockers.push("A definition cannot supersede itself.");
  if (!replacedType || !replacementType) blockers.push("Both definitions must have governed model types.");
  if (replacedType && replacementType && replacedType !== replacementType) {
    blockers.push(`Supersession requires the same model class; ${replacementType} cannot supersede ${replacedType}.`);
  }
  if (status === "retired") warnings.push("The selected replacement definition is already retired.");
  const migrationCandidates = definitionMigrationCandidates(request.impact);
  return {
    replacedPath,
    replacementPath,
    relationshipField: "supersedes",
    valid: blockers.length === 0,
    blockers,
    warnings,
    migrationCandidates,
    rewritesReferences: false
  };
}

// src/core/definition-supersede-service.ts
function frontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Definition note must begin with YAML frontmatter.");
  return { yaml: match[1], body: text.slice(match[0].length), prefixLength: match[0].length };
}
function withRelationship(text, sourcePath, field, targetPath, resolve, linkText) {
  const parsed = frontmatter(text);
  const doc = parseDocument(parsed.yaml);
  if (doc.errors.length) throw new Error(`Definition frontmatter is invalid YAML: ${doc.errors[0]?.message ?? "parse error"}`);
  const link = `[[${linkText(targetPath, sourcePath)}]]`;
  const node = doc.get(field, true);
  if (node === void 0 || node === null) {
    const addition = `${parsed.yaml.endsWith("\n") || parsed.yaml.length === 0 ? "" : "\n"}${field}:
  - "${link}"`;
    return `---
${parsed.yaml}${addition}
---
${parsed.body}`;
  }
  const nodeValue = (value) => {
    if (typeof value === "object" && value !== null && "toJSON" in value) {
      const toJSON = value.toJSON;
      if (typeof toJSON === "function") return toJSON.call(value);
    }
    return value;
  };
  const values = isSeq(node) ? node.items.map((item) => String(nodeValue(item) ?? "")) : [String(nodeValue(node) ?? "")];
  for (const value of values) {
    const target = linkTarget(value);
    if (!target) continue;
    const resolved = resolve(target, sourcePath);
    if (!resolved) {
      throw new Error(
        `Cannot safely update ${field}; existing relationship target "${target}" cannot be resolved from ${sourcePath}.`
      );
    }
    if (resolved === targetPath) return text;
  }
  values.push(link);
  values.sort((a, b) => a.localeCompare(b, void 0, { sensitivity: "base" }));
  const range = node.range;
  if (!range) throw new Error(`Cannot safely update ${field}; YAML source range is unavailable.`);
  const replacement = values.length === 1 ? `"${values[0]}"` : `
${values.map((value) => `  - "${value}"`).join("\n")}`;
  const yaml = parsed.yaml.slice(0, range[0]) + replacement + parsed.yaml.slice(range[1]);
  return `---
${yaml}
---
${parsed.body}`;
}
function impactSignature2(impact) {
  const note = impact.noteUses.map((use) => `${use.fromPath}|${use.field}`).sort().join("\n");
  const occurrence = impact.occurrenceUses.map((use) => `${use.ownerPath}|${use.kind}|${use.identifier}|${use.localId}`).sort().join("\n");
  return `${note}
--
${occurrence}`;
}
var DefinitionSupersessionService = class {
  constructor(store, impactFor, resolve, linkText, transactions) {
    this.store = store;
    this.impactFor = impactFor;
    this.resolve = resolve;
    this.linkText = linkText;
    this.transactions = transactions;
    this.sequence = 0;
    this.pending = /* @__PURE__ */ new Map();
  }
  async stage(request) {
    if (!await this.store.exists(request.replacedPath)) throw new Error(`${request.replacedPath} does not exist.`);
    if (!await this.store.exists(request.replacementPath)) throw new Error(`${request.replacementPath} does not exist.`);
    const replacedBefore = await this.store.read(request.replacedPath);
    const replacementBefore = await this.store.read(request.replacementPath);
    const sourceSemantics = (text, path) => {
      const parsed = frontmatter(text);
      const doc = parseDocument(parsed.yaml);
      if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
      const uid = String(doc.get("uid") ?? "").trim();
      const type = String(doc.get("type") ?? "").trim();
      const rawStatus = doc.get("status");
      const status = rawStatus === void 0 || rawStatus === null ? null : String(rawStatus).trim();
      return { uid, type, status };
    };
    const replacedSource = sourceSemantics(replacedBefore, request.replacedPath);
    const replacedSourceUid = replacedSource.uid;
    if (!replacedSourceUid || replacedSourceUid !== request.replacedUid) {
      throw new Error(`Cannot stage supersession: expected ${request.replacedPath} uid ${request.replacedUid}, found ${replacedSourceUid || "none"}.`);
    }
    const replacementSource = sourceSemantics(replacementBefore, request.replacementPath);
    const replacementSourceUid = replacementSource.uid;
    if (!replacementSourceUid || replacementSourceUid !== request.replacementUid) {
      throw new Error(`Cannot stage supersession: expected ${request.replacementPath} uid ${request.replacementUid}, found ${replacementSourceUid || "none"}.`);
    }
    const impact = await this.impactFor(request.replacedPath);
    const plan = planDefinitionSupersession({
      replacedPath: request.replacedPath,
      replacedType: replacedSource.type,
      replacementPath: request.replacementPath,
      replacementType: replacementSource.type,
      replacementStatus: replacementSource.status,
      impact
    });
    if (!plan.valid) throw new Error(plan.blockers.join(" "));
    const replacementAfter = withRelationship(
      replacementBefore,
      request.replacementPath,
      "supersedes",
      request.replacedPath,
      this.resolve,
      this.linkText
    );
    const replacedAfter = withRelationship(
      replacedBefore,
      request.replacedPath,
      "supersededBy",
      request.replacementPath,
      this.resolve,
      this.linkText
    );
    const id = `definition-supersede-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `supersede ${request.replacedPath} with ${request.replacementPath}`;
    this.transactions.begin(id, label, "structural");
    const transaction = this.transactions.add(id, {
      id: id + "-relationship",
      label,
      changes: [{
        kind: "definition.supersede",
        summary: label,
        refs: [noteRef(request.replacementUid), noteRef(request.replacedUid)],
        metadata: {
          replacedPath: request.replacedPath,
          replacementPath: request.replacementPath,
          migrationCandidates: plan.migrationCandidates.length,
          rewritesReferences: false
        }
      }]
    });
    this.pending.set(id, {
      request,
      plan,
      replacedBefore,
      replacementBefore,
      replacedAfter,
      replacementAfter,
      impactSignature: impactSignature2(impact),
      label
    });
    return { transaction, plan };
  }
  async stageAndReview(request) {
    const staged = await this.stage(request);
    return this.review(staged.transaction.id);
  }
  review(transactionId) {
    const pending = this.requirePending(transactionId);
    return { transaction: this.transactions.review(transactionId), plan: pending.plan };
  }
  async apply(transactionId) {
    const pending = this.requirePending(transactionId);
    const latestImpact = await this.impactFor(pending.request.replacedPath);
    if (impactSignature2(latestImpact) !== pending.impactSignature) {
      throw new Error("Dependent usage changed after Review. Reopen supersession review before Apply.");
    }
    if (!await this.store.exists(pending.request.replacedPath) || !await this.store.exists(pending.request.replacementPath)) {
      throw new Error("One of the supersession definitions no longer exists.");
    }
    if (await this.store.read(pending.request.replacedPath) !== pending.replacedBefore) {
      throw new Error(`${pending.request.replacedPath} changed after Review.`);
    }
    if (await this.store.read(pending.request.replacementPath) !== pending.replacementBefore) {
      throw new Error(`${pending.request.replacementPath} changed after Review.`);
    }
    await this.transactions.apply(transactionId, {
      apply: async () => {
        const latest = await this.impactFor(pending.request.replacedPath);
        if (impactSignature2(latest) !== pending.impactSignature) {
          throw new Error("Dependent usage changed after Review.");
        }
        await this.store.write(pending.request.replacementPath, pending.replacementAfter);
        try {
          await this.store.write(pending.request.replacedPath, pending.replacedAfter);
        } catch (error) {
          await this.store.write(pending.request.replacementPath, pending.replacementBefore);
          throw error;
        }
        return {
          undo: async () => {
            if (await this.store.read(pending.request.replacementPath) !== pending.replacementAfter) throw new Error(`${pending.request.replacementPath} changed after supersession.`);
            if (await this.store.read(pending.request.replacedPath) !== pending.replacedAfter) throw new Error(`${pending.request.replacedPath} changed after supersession.`);
            await this.store.write(pending.request.replacementPath, pending.replacementBefore);
            await this.store.write(pending.request.replacedPath, pending.replacedBefore);
          },
          redo: async () => {
            const latestImpact2 = await this.impactFor(pending.request.replacedPath);
            if (impactSignature2(latestImpact2) !== pending.impactSignature) {
              throw new Error(`Cannot redo ${pending.label}: dependent usage changed after Review.`);
            }
            if (await this.store.read(pending.request.replacementPath) !== pending.replacementBefore) throw new Error(`${pending.request.replacementPath} changed after undoing supersession.`);
            if (await this.store.read(pending.request.replacedPath) !== pending.replacedBefore) throw new Error(`${pending.request.replacedPath} changed after undoing supersession.`);
            await this.store.write(pending.request.replacementPath, pending.replacementAfter);
            try {
              await this.store.write(pending.request.replacedPath, pending.replacedAfter);
            } catch (error) {
              await this.store.write(pending.request.replacementPath, pending.replacementBefore);
              throw error;
            }
          }
        };
      }
    });
    this.pending.delete(transactionId);
  }
  cancel(transactionId) {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }
  requirePending(transactionId) {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition supersession transaction ${transactionId} does not exist.`);
    return pending;
  }
};

// src/core/definition-note-migrate.ts
function planDefinitionNoteMigration(request) {
  const ownerPath = request.ownerPath.trim();
  const field = request.field.trim();
  const replacedPath = request.replacedPath.trim();
  const replacementPath = request.replacementPath.trim();
  const currentTargets = [...request.currentTargets];
  if (!ownerPath) throw new Error("Relationship owner path is required.");
  if (!field) throw new Error("Relationship field is required.");
  if (!replacedPath || !replacementPath) throw new Error("Both superseded and replacement definition paths are required.");
  if (replacedPath === replacementPath) throw new Error("Superseded and replacement definitions must be different.");
  const symmetric = request.relationship.kind === "symmetric";
  const authoredAsForward = request.relationship.field === field;
  const authoredAsInverse = !symmetric && !!request.relationship.inverse && request.relationship.inverse === field;
  if (!authoredAsForward && !authoredAsInverse) {
    const expected = request.relationship.inverse ? `${request.relationship.field} or ${request.relationship.inverse}` : request.relationship.field;
    throw new Error(`Relationship schema mismatch: expected ${expected}, got ${field}.`);
  }
  if (!currentTargets.includes(replacedPath)) {
    throw new Error(`Relationship changed from the superseded definition; ${field} no longer targets ${replacedPath}.`);
  }
  if (currentTargets.includes(replacementPath)) {
    throw new Error(`Relationship already targets replacement definition ${replacementPath}.`);
  }
  const inverseField = symmetric ? field : authoredAsInverse ? request.relationship.field : request.relationship.inverse ?? null;
  const inverseMutations = [];
  if (inverseField) {
    inverseMutations.push({
      path: replacedPath,
      field: inverseField,
      removeTarget: ownerPath
    });
    inverseMutations.push({
      path: replacementPath,
      field: inverseField,
      addTarget: ownerPath
    });
  }
  return {
    ownerPath,
    field,
    replacedPath,
    replacementPath,
    inverseField,
    symmetric,
    authoredAsInverse,
    sourceMutation: { removeTarget: replacedPath, addTarget: replacementPath },
    inverseMutations
  };
}

// src/core/definition-note-migrate-service.ts
function frontmatter2(text) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error("Model note must begin with YAML frontmatter.");
  const yaml = match[1];
  const doc = parseDocument(yaml);
  if (doc.errors.length) throw new Error(`Model note frontmatter is invalid YAML: ${doc.errors[0]?.message ?? "parse error"}`);
  return { doc, yaml, body: text.slice(match[0].length) };
}
function list(value) {
  if (value === void 0 || value === null || value === "") return [];
  if (Array.isArray(value)) return [...value];
  if (typeof value === "object" && value !== null && "toJSON" in value) {
    const toJSON = value.toJSON;
    if (typeof toJSON === "function") return list(toJSON.call(value));
  }
  return [value];
}
function fieldPairRange(doc, yaml, field) {
  const contents = doc.contents;
  const pair = contents?.items?.find((item) => {
    const key2 = item.key;
    if (!key2) return false;
    const value = typeof key2.toJSON === "function" ? key2.toJSON() : void 0;
    return String(value ?? "") === field;
  });
  const keyRange = pair?.key?.range;
  if (!keyRange) return null;
  const start = yaml.lastIndexOf("\n", Math.max(0, keyRange[0] - 1)) + 1;
  let cursor = yaml.indexOf("\n", keyRange[1]);
  if (cursor < 0) return [start, yaml.length];
  cursor += 1;
  while (cursor < yaml.length) {
    const next = yaml.indexOf("\n", cursor);
    const end = next < 0 ? yaml.length : next;
    const line = yaml.slice(cursor, end);
    if (line.length > 0 && !/^\s/.test(line)) break;
    cursor = next < 0 ? yaml.length : next + 1;
  }
  return [start, cursor];
}
function mutateRelationship(text, sourcePath, field, removePath, addPath, resolve, linkText) {
  const { doc, yaml, body } = frontmatter2(text);
  const values = list(doc.get(field));
  const kept = removePath ? values.filter((value) => {
    const target = linkTarget(value);
    return !target || resolve(target, sourcePath) !== removePath;
  }) : values;
  if (addPath) {
    const already = kept.some((value) => {
      const target = linkTarget(value);
      return !!target && resolve(target, sourcePath) === addPath;
    });
    if (!already) kept.push(`[[${linkText(addPath, sourcePath)}]]`);
  }
  const sorted = kept.sort((a, b) => String(a).localeCompare(String(b), void 0, { sensitivity: "base" }));
  const node = doc.get(field, true);
  let nextYaml;
  if (sorted.length === 0) {
    if (node === void 0 || node === null) return text;
    const pairRange = fieldPairRange(doc, yaml, field);
    if (!pairRange) throw new Error(`Cannot safely remove empty ${field}; YAML property source range is unavailable.`);
    nextYaml = yaml.slice(0, pairRange[0]) + yaml.slice(pairRange[1]);
    if (nextYaml.endsWith("\n")) nextYaml = nextYaml.slice(0, -1);
  } else {
    const encoded = "\n" + sorted.map((value) => `  - ${JSON.stringify(String(value))}`).join("\n");
    if (node === void 0 || node === null) {
      const addition = `${yaml.endsWith("\n") || yaml.length === 0 ? "" : "\n"}${field}:${encoded}`;
      nextYaml = yaml + addition;
    } else {
      const range = node.range;
      if (!range) throw new Error(`Cannot safely update ${field}; YAML source range is unavailable.`);
      nextYaml = yaml.slice(0, range[0]) + encoded.trimStart() + yaml.slice(range[1]);
    }
  }
  return `---
${nextYaml}
---
${body}`;
}
var DefinitionNoteMigrationService = class {
  constructor(store, resolve, linkText, transactions) {
    this.store = store;
    this.resolve = resolve;
    this.linkText = linkText;
    this.transactions = transactions;
    this.sequence = 0;
    this.pending = /* @__PURE__ */ new Map();
  }
  async stage(request) {
    if (!await this.store.exists(request.ownerPath)) throw new Error(`${request.ownerPath} no longer exists.`);
    if (!await this.store.exists(request.replacedPath)) throw new Error(`${request.replacedPath} no longer exists.`);
    if (!await this.store.exists(request.replacementPath)) throw new Error(`${request.replacementPath} no longer exists.`);
    const ownerBefore = await this.store.read(request.ownerPath);
    const replacedBefore = request.replacedPath === request.ownerPath ? ownerBefore : await this.store.read(request.replacedPath);
    const replacementBefore = request.replacementPath === request.ownerPath ? ownerBefore : request.replacementPath === request.replacedPath ? replacedBefore : await this.store.read(request.replacementPath);
    const validateUid = (text, path, expected) => {
      if (!expected) return;
      const parsed = frontmatter2(text);
      const storedUid = String(parsed.doc.get("uid") ?? "").trim();
      if (!storedUid || storedUid !== expected) {
        throw new Error(`Cannot stage relationship migration: expected ${path} uid ${expected}, found ${storedUid || "none"}.`);
      }
    };
    validateUid(ownerBefore, request.ownerPath, request.ownerUid);
    validateUid(replacedBefore, request.replacedPath, request.replacedUid);
    validateUid(replacementBefore, request.replacementPath, request.replacementUid);
    const parsedOwner = frontmatter2(ownerBefore);
    const currentTargets = list(parsedOwner.doc.get(request.field)).map((value) => linkTarget(value)).filter((target) => !!target).map((target) => this.resolve(target, request.ownerPath)).filter((target) => !!target);
    const plan = planDefinitionNoteMigration({
      ownerPath: request.ownerPath,
      field: request.field,
      replacedPath: request.replacedPath,
      replacementPath: request.replacementPath,
      relationship: request.relationship,
      currentTargets
    });
    const beforeByPath = /* @__PURE__ */ new Map();
    beforeByPath.set(request.ownerPath, ownerBefore);
    const need = plan.inverseMutations.map((mutation) => mutation.path);
    for (const path of [...new Set(need)]) beforeByPath.set(path, await this.store.read(path));
    for (const mutation of plan.inverseMutations) {
      const text = beforeByPath.get(mutation.path);
      const parsed = frontmatter2(text);
      const targets = list(parsed.doc.get(mutation.field)).map((value) => linkTarget(value)).filter((target) => !!target).map((target) => this.resolve(target, mutation.path)).filter((target) => !!target);
      if (mutation.removeTarget && !targets.includes(mutation.removeTarget)) {
        throw new Error(
          `Relationship integrity mismatch: ${mutation.path}.${mutation.field} does not point back to ${mutation.removeTarget}; migration will not repair it silently.`
        );
      }
      if (mutation.addTarget && targets.includes(mutation.addTarget)) {
        throw new Error(
          `Relationship integrity mismatch: ${mutation.path}.${mutation.field} already points to ${mutation.addTarget}; migration will not create a duplicate.`
        );
      }
    }
    const afterByPath = new Map(beforeByPath);
    afterByPath.set(request.ownerPath, mutateRelationship(
      beforeByPath.get(request.ownerPath),
      request.ownerPath,
      request.field,
      plan.sourceMutation.removeTarget,
      plan.sourceMutation.addTarget,
      this.resolve,
      this.linkText
    ));
    for (const mutation of plan.inverseMutations) {
      const current = afterByPath.get(mutation.path);
      afterByPath.set(mutation.path, mutateRelationship(
        current,
        mutation.path,
        mutation.field,
        mutation.removeTarget,
        mutation.addTarget,
        this.resolve,
        this.linkText
      ));
    }
    const files = [...beforeByPath.entries()].map(([path, before]) => ({ path, before, after: afterByPath.get(path) }));
    const id = `definition-note-migrate-${Date.now().toString(36)}-${(++this.sequence).toString(36)}`;
    const label = `migrate ${request.ownerPath} ${request.field} to ${request.replacementPath}`;
    this.transactions.begin(id, label, "structural");
    const refs = [];
    if (request.ownerUid) refs.push(noteRef(request.ownerUid));
    if (request.replacedUid) refs.push(noteRef(request.replacedUid));
    if (request.replacementUid) refs.push(noteRef(request.replacementUid));
    const transaction = this.transactions.add(id, {
      id: id + "-relationship",
      label,
      changes: [{
        kind: "definition.note-migrate",
        summary: label,
        refs,
        metadata: {
          ownerPath: request.ownerPath,
          field: request.field,
          replacedPath: request.replacedPath,
          replacementPath: request.replacementPath,
          inverseField: plan.inverseField,
          affectedFiles: files.length
        }
      }]
    });
    this.pending.set(id, { plan, label, files, replacementUid: request.replacementUid });
    return { transaction, plan, affectedPaths: files.map((file) => file.path) };
  }
  async stageAndReview(request) {
    const staged = await this.stage(request);
    return this.review(staged.transaction.id);
  }
  review(transactionId) {
    const pending = this.requirePending(transactionId);
    return { transaction: this.transactions.review(transactionId), plan: pending.plan, affectedPaths: pending.files.map((file) => file.path) };
  }
  async apply(transactionId) {
    const pending = this.requirePending(transactionId);
    await this.transactions.apply(transactionId, {
      apply: async () => {
        if (!await this.store.exists(pending.plan.replacementPath)) {
          throw new Error(`${pending.plan.replacementPath} no longer exists; reopen supersession migration review.`);
        }
        if (pending.replacementUid) {
          const currentReplacement = await this.store.read(pending.plan.replacementPath);
          const parsedReplacement = frontmatter2(currentReplacement);
          const currentUid = String(parsedReplacement.doc.get("uid") ?? "").trim();
          if (!currentUid || currentUid !== pending.replacementUid) {
            throw new Error(
              `${pending.plan.replacementPath} identity changed; expected uid ${pending.replacementUid}, found ${currentUid || "none"}. Reopen supersession migration review.`
            );
          }
        }
        for (const file of pending.files) {
          const current = await this.store.read(file.path);
          if (current !== file.before) throw new Error(`${file.path} changed after Review.`);
        }
        const written = [];
        try {
          for (const file of pending.files) {
            await this.store.write(file.path, file.after);
            written.push(file);
          }
        } catch (error) {
          for (const file of written.reverse()) await this.store.write(file.path, file.before);
          throw error;
        }
        return {
          undo: async () => {
            for (const file of pending.files) {
              if (await this.store.read(file.path) !== file.after) throw new Error(`${file.path} changed after ${pending.label}.`);
            }
            const reverted = [];
            try {
              for (const file of pending.files) {
                await this.store.write(file.path, file.before);
                reverted.push(file);
              }
            } catch (error) {
              for (const file of reverted.reverse()) await this.store.write(file.path, file.after);
              throw error;
            }
          },
          redo: async () => {
            if (!await this.store.exists(pending.plan.replacementPath)) {
              throw new Error(`${pending.plan.replacementPath} no longer exists; reopen supersession migration review.`);
            }
            if (pending.replacementUid) {
              const currentReplacement = await this.store.read(pending.plan.replacementPath);
              const parsedReplacement = frontmatter2(currentReplacement);
              const currentUid = String(parsedReplacement.doc.get("uid") ?? "").trim();
              if (!currentUid || currentUid !== pending.replacementUid) {
                throw new Error(
                  `${pending.plan.replacementPath} identity changed; expected uid ${pending.replacementUid}, found ${currentUid || "none"}. Reopen supersession migration review.`
                );
              }
            }
            for (const file of pending.files) {
              if (await this.store.read(file.path) !== file.before) throw new Error(`${file.path} changed after undoing ${pending.label}.`);
            }
            const rewritten = [];
            try {
              for (const file of pending.files) {
                await this.store.write(file.path, file.after);
                rewritten.push(file);
              }
            } catch (error) {
              for (const file of rewritten.reverse()) await this.store.write(file.path, file.before);
              throw error;
            }
          }
        };
      }
    });
    this.pending.delete(transactionId);
  }
  cancel(transactionId) {
    this.requirePending(transactionId);
    const cancelled = this.transactions.cancel(transactionId);
    this.pending.delete(transactionId);
    return cancelled;
  }
  requirePending(transactionId) {
    const pending = this.pending.get(transactionId);
    if (!pending) throw new Error(`Definition note migration transaction ${transactionId} does not exist.`);
    return pending;
  }
};

// src/core/definition-migrate.ts
function planDefinitionOccurrenceMigration(request) {
  const ownerPath = request.ownerPath.trim();
  const localId = request.localId.trim();
  const currentDefinitionPath = request.currentDefinitionPath?.trim() || null;
  const replacedPath = request.replacedPath.trim();
  const replacementPath = request.replacementPath.trim();
  if (!ownerPath) throw new Error("Occurrence owner path is required.");
  if (!localId) throw new Error("Occurrence local id is required.");
  if (!replacedPath || !replacementPath) throw new Error("Both superseded and replacement definition paths are required.");
  if (replacedPath === replacementPath) throw new Error("Superseded and replacement definitions must be different.");
  if (!currentDefinitionPath) throw new Error("Occurrence no longer has a resolvable reusable definition.");
  if (currentDefinitionPath !== replacedPath) {
    throw new Error(`Occurrence definition changed from the superseded definition; expected ${replacedPath}, found ${currentDefinitionPath}.`);
  }
  return {
    ownerPath,
    localId,
    replacedPath,
    replacementPath,
    definitionLink: `[[${replacementPath.replace(/\.md$/i, "")}]]`
  };
}
function assertDefinitionSourceUid(text, path, expectedUid) {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error(`${path} must begin with YAML frontmatter.`);
  const doc = parseDocument(match[1]);
  if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
  const sourceUid = String(doc.get("uid") ?? "").trim();
  if (!sourceUid || sourceUid !== expectedUid) {
    throw new Error(
      `${path} identity changed; expected uid ${expectedUid}, found ${sourceUid || "none"}. Reopen supersession migration review.`
    );
  }
}

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
function optionsBetween(schema4, firstClass, secondClass) {
  const out = [];
  for (const def of schema4.relationships) {
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
  constructor(schema4) {
    this.schema = schema4;
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
        let list2 = this.inEdges.get(to);
        if (!list2) this.inEdges.set(to, list2 = []);
        list2.push(e);
      }
    }
    if (out.length) this.outEdges.set(rec.path, out);
  }
  remove(path) {
    if (!this.notes.delete(path)) return;
    for (const e of this.outEdges.get(path) ?? []) {
      const list2 = this.inEdges.get(e.to);
      if (!list2) continue;
      const kept = list2.filter((x) => x !== e);
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
  /**
   * Every authored governed relationship that points at the target path, regardless of whether
   * the field is the schema's forward or inverse spelling. Lifecycle impact must use this instead
   * of in(), because inverse-authored relationships are intentionally not materialized as graph edges.
   */
  authoredUsesOf(path) {
    const uses = [];
    for (const rec of this.notes.values()) {
      for (const [field, targets] of rec.fields) {
        if (!this.schema.byField.has(field) && !this.schema.byInverse.has(field)) continue;
        if (targets.includes(path)) uses.push({ from: rec.path, to: path, field });
      }
    }
    return uses.sort((a, b) => a.from.localeCompare(b.from) || a.field.localeCompare(b.field));
  }
  edgeCount() {
    let n = 0;
    for (const list2 of this.outEdges.values()) n += list2.length;
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
function pairs2(v, where, warnings) {
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
      excludePairs: pairs2(raw.excludePairs, where, warnings),
      provisional: raw.provisional === true,
      temporary: kind === "temporary" || raw.temporary === true,
      order: order++
    });
  };
  const section = (name, kind) => {
    const list2 = relationshipsYaml[name];
    if (list2 === void 0) return;
    if (!Array.isArray(list2)) {
      warnings.push(`relationships.yaml: "${name}" is not a list; skipped.`);
      return;
    }
    for (const raw of list2) {
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
function editingBlocked(schema4) {
  return compareVersions(schema4.relationshipsVersion, MIN_RELATIONSHIPS_VERSION) < 0;
}
function schemaSignature(schema4) {
  const endpoint2 = (v) => v === "any" ? "any" : v.join(",");
  const rows = [
    `relationshipsVersion=${schema4.relationshipsVersion}`,
    `elementTypesVersion=${schema4.elementTypesVersion}`,
    `common=${schema4.commonProperties.join(",")}`,
    `optional=${schema4.optionalProperties.join(",")}`,
    `translatedOnly=${schema4.translatedOnlyProperties.join(",")}`,
    ...schema4.classes.map((c) => `class|${c.name}|${c.prefix ?? ""}|${c.subtypes.join(",")}`),
    ...schema4.relationships.map(
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
var CACHE_SEMANTIC_VERSION = 4;
function expectedCompatibility(schema4, scope) {
  return {
    formatVersion: CACHE_FORMAT_VERSION,
    semanticVersion: CACHE_SEMANTIC_VERSION,
    vaultUid: scope.vaultUid,
    relationshipsVersion: schema4.relationshipsVersion,
    elementTypesVersion: schema4.elementTypesVersion,
    schemaSignature: schemaSignature(schema4),
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
function serializeSemanticState(index, local, fingerprints, schema4, scope, producerVersion, createdAt = Date.now()) {
  const notes = [...index.notes.values()].sort((a, b) => a.path.localeCompare(b.path)).map(serializeNote);
  const localRegions = [...local.regions.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([path, region]) => [path, serializeRegion(region)]);
  return {
    header: { ...expectedCompatibility(schema4, scope), createdAt, producerVersion },
    fingerprints: Object.fromEntries([...fingerprints.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    notes,
    localRegions
  };
}
function restoreCoreSemanticState(cache, schema4, scope) {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema4, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.notes) || !isObject(cache.fingerprints)) {
    throw new Error("Malformed core semantic cache payload.");
  }
  const index = new ModelIndex(schema4);
  for (const raw of cache.notes) index.upsert(deserializeNote(raw));
  const fingerprints = /* @__PURE__ */ new Map();
  for (const [path, raw] of Object.entries(cache.fingerprints)) {
    if (!isFingerprint(raw)) throw new Error(`Malformed fingerprint for ${path}.`);
    fingerprints.set(path, { ...raw });
  }
  return { index, fingerprints };
}
function restoreSemanticState(cache, schema4, scope) {
  const problem = cacheCompatibilityProblem(cache, expectedCompatibility(schema4, scope));
  if (problem) throw new Error(`Incompatible semantic cache: ${problem}.`);
  if (!isObject(cache) || !Array.isArray(cache.notes) || !Array.isArray(cache.localRegions) || !isObject(cache.fingerprints)) {
    throw new Error("Malformed semantic cache payload.");
  }
  const index = new ModelIndex(schema4);
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
    ...n.subtype !== void 0 ? { subtype: n.subtype } : {},
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
  const subtype = optionalString(raw, "subtype");
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
    ...subtype !== void 0 ? { subtype } : {},
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
function expectedShardGeneration(set2, index, fallback) {
  return set2.generations?.[index] ?? fallback;
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
function editingBlockedReason(coreReady, schema4) {
  if (!coreReady) return "Workbench is still indexing; try again in a moment.";
  if (!schema4) return "Workbench schema is not available.";
  if (editingBlocked(schema4)) return "The vault's schema is older than this Workbench supports, so editing is off.";
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
  const boundarySide = /* @__PURE__ */ new Map();
  boundary.forEach((r, i) => boundarySide.set(r.localId, i % 2 === 0 ? "left" : "right"));
  const exposureSide = /* @__PURE__ */ new Map();
  for (const connection of connections) {
    if (connection.sourceSchemaVersion !== "0.4") continue;
    for (const link of connection.exposes) {
      const outer = linkedLocal(local, resolve, ownerPath, link);
      if (!outer || outer.record.kind !== "endpoint" || outer.record.part || outer.record.parent) continue;
      const side = boundarySide.get(outer.record.localId);
      if (!side) continue;
      for (const end of [connection.endpointA, connection.endpointB]) {
        const inner = linkedLocal(local, resolve, ownerPath, end);
        if (inner?.record.kind === "endpoint" && (inner.record.part || inner.record.parent)) exposureSide.set(inner.record.localId, side);
      }
    }
  }
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
    if (r.sourceSchemaVersion === "0.4") continue;
    const from = nodeId(r);
    for (const link of r.exposes) {
      const t = linkedLocal(local, resolve, ownerPath, link);
      if (!t || t.record.kind !== "endpoint") continue;
      const to = nodeId(t.record);
      if (!pos.has(r.localId) || !pos.has(t.record.localId)) continue;
      edges.push(edge(
        "legacy-expose:" + r.localId + ":" + t.record.localId,
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
    const list2 = flowsByConnection.get(f.connectionId) ?? [];
    list2.push(f);
    flowsByConnection.set(f.connectionId, list2);
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
    if (r.sourceSchemaVersion === "0.4") {
      const innerCandidates = [a.record, b.record].filter((x) => x.part || x.parent);
      for (const link of r.exposes) {
        const outer = linkedLocal(local, resolve, ownerPath, link);
        if (!outer || outer.record.kind !== "endpoint" || outer.record.part || outer.record.parent) continue;
        const outerPos = pos.get(outer.record.localId);
        if (!outerPos) continue;
        const inner = innerCandidates.map((record) => ({ record, p: pos.get(record.localId) })).filter((x) => !!x.p).sort((x, y) => {
          const dx = x.p.x + x.p.width / 2 - (outerPos.x + outerPos.width / 2);
          const dy = x.p.y + x.p.height / 2 - (outerPos.y + outerPos.height / 2);
          const ex = y.p.x + y.p.width / 2 - (outerPos.x + outerPos.width / 2);
          const ey = y.p.y + y.p.height / 2 - (outerPos.y + outerPos.height / 2);
          return dx * dx + dy * dy - (ex * ex + ey * ey);
        })[0];
        if (!inner) continue;
        edges.push(edge(
          "expose:" + r.localId + ":" + outer.record.localId,
          nodeId(inner.record),
          nodeId(outer.record),
          sideToward(inner.p, outerPos),
          sideToward(outerPos, inner.p),
          (r.identifier || "connection") + " exposes",
          "none"
        ));
      }
    }
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
  startTypes: ["Object", "Behavior"],
  steps: [
    { field: "performs", direction: "out", from: ["Object"], to: ["Behavior"], atStartOnly: true, undefinedOk: true },
    { field: "performs", direction: "in", from: ["Behavior"], to: ["Object"] },
    { field: "hasChild", direction: "in", from: ["Behavior"], to: ["Behavior"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Behavior"], to: ["Behavior"] },
    { field: "precedes", direction: "in", from: ["Behavior"], to: ["Behavior"], undefinedOk: false },
    { field: "precedes", direction: "out", from: ["Behavior"], to: ["Behavior"], undefinedOk: true }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var REQ_HOLDERS = ["Object", "Behavior", "Condition", "Use Case", "Verification"];
var REQUIREMENTS_PROFILE = {
  name: "Requirements",
  description: "A requirement with its parents, children, derivation, satisfiers and verifiers; or an element with its requirements.",
  startTypes: ["Requirement", ...REQ_HOLDERS],
  steps: [
    { field: "hasChild", direction: "in", from: ["Requirement"], to: ["Requirement", "Object", "Behavior", "Condition"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Requirement"], to: ["Requirement"] },
    { field: "hasChild", direction: "out", from: ["Object", "Behavior", "Condition"], to: ["Requirement"], atStartOnly: true },
    { field: "derivedFrom", direction: "out", from: ["Requirement"], to: ["Requirement"], undefinedOk: true },
    { field: "derivedFrom", direction: "in", from: ["Requirement"], to: ["Requirement"] },
    { field: "refines", direction: "out", from: ["Requirement"], to: ["Requirement"], undefinedOk: true },
    { field: "refines", direction: "in", from: ["Requirement"], to: ["Requirement"] },
    { field: "references", direction: "out", from: ["Requirement"], to: ["Requirement", "Document"] },
    { field: "satisfies", direction: "in", from: ["Requirement"], to: ["Behavior", "Condition"] },
    { field: "satisfies", direction: "out", from: ["Behavior", "Condition"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
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
    { field: "performs", direction: "in", from: ["Behavior"], to: ["Object"] },
    { field: "hasDesign", direction: "in", from: ["Condition"] },
    { field: "realizedBy", direction: "in", from: ["Behavior", "Condition"], to: ["Use Case"] },
    { field: "participants", direction: "in", from: ["Object", "Actor", "Behavior", "Document"], to: ["Use Case"] },
    { field: "dependsOn", direction: "in" }
  ],
  depth: 3,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true
};
var INTERFACES_PROFILE = {
  name: "Interfaces",
  description: "Local Interface occurrences, their Connections, exposed boundary Interfaces and carried Item Flows.",
  startTypes: ["Object", "Item Flow"],
  steps: [],
  depth: 3,
  nodeCap: 80,
  perParent: 12,
  needsLocalOccurrences: true
};
var VERIFICATION_PROFILE = {
  name: "Verification",
  description: "What verifies a requirement, what else a verification covers, and what satisfies those requirements.",
  startTypes: ["Requirement", "Verification", "Behavior", "Condition"],
  steps: [
    { field: "verifies", direction: "in", from: ["Requirement"], to: ["Verification"] },
    { field: "verifies", direction: "out", from: ["Verification"], to: ["Requirement"], undefinedOk: true },
    { field: "appliesTo", direction: "in", from: ["Condition"], to: ["Requirement"], atStartOnly: true },
    { field: "satisfies", direction: "out", from: ["Behavior", "Condition"], to: ["Requirement"], atStartOnly: true, undefinedOk: true },
    { field: "satisfies", direction: "in", from: ["Requirement"], to: ["Behavior", "Condition"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var DESIGN_PROFILE = {
  name: "Design",
  description: "The designs of an Object or Document, sub-designs, and the requirements each satisfies.",
  startTypes: ["Object", "Document", "Condition"],
  steps: [
    { field: "hasDesign", direction: "out", from: ["Object", "Document"], to: ["Condition"], undefinedOk: true },
    { field: "hasDesign", direction: "in", from: ["Condition"], to: ["Object", "Document"], atStartOnly: true },
    { field: "hasChild", direction: "in", from: ["Condition"], to: ["Condition"], atStartOnly: true },
    { field: "hasChild", direction: "out", from: ["Condition"], to: ["Condition"] },
    { field: "satisfies", direction: "out", from: ["Condition"], to: ["Requirement"], undefinedOk: true }
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
    { field: "participants", direction: "out", from: ["Use Case"], to: ["Object", "Actor", "Behavior", "Document"], undefinedOk: true },
    { field: "realizedBy", direction: "out", from: ["Use Case"], to: ["Behavior", "Condition"], undefinedOk: true },
    { field: "hasChild", direction: "out", from: ["Use Case"], to: ["Use Case"] },
    { field: "hasChild", direction: "in", from: ["Use Case"], to: ["Use Case"], atStartOnly: true },
    { field: "optionOf", direction: "out", from: ["Use Case"], to: ["Use Case"], undefinedOk: true },
    { field: "optionOf", direction: "in", from: ["Use Case"], to: ["Use Case"] },
    { field: "drives", direction: "out", from: ["Use Case"], to: ["Requirement"] },
    { field: "precedes", direction: "in", from: ["Behavior"], to: ["Behavior"] },
    { field: "precedes", direction: "out", from: ["Behavior"], to: ["Behavior"] }
  ],
  depth: 2,
  nodeCap: 80,
  perParent: 12
};
var BEHAVIOR_PROFILE = {
  name: "Behavior",
  description: "State machines and states: who has them, initial and final states, order, nesting, what triggers them.",
  startTypes: ["Condition", "Object"],
  steps: [
    { field: "hasState", direction: "out", from: ["Object", "Condition"], to: ["Condition"], undefinedOk: true },
    { field: "hasState", direction: "in", from: ["Condition"], to: ["Object", "Condition"], atStartOnly: true },
    { field: "initialState", direction: "out", from: ["Condition"], to: ["Condition"], undefinedOk: true },
    { field: "finalState", direction: "out", from: ["Condition"], to: ["Condition"], undefinedOk: true },
    { field: "hasChild", direction: "out", from: ["Condition"], to: ["Condition"] },
    { field: "hasChild", direction: "in", from: ["Condition"], to: ["Condition"], atStartOnly: true },
    { field: "precedes", direction: "in", from: ["Condition"], to: ["Condition"] },
    { field: "precedes", direction: "out", from: ["Condition"], to: ["Condition"], undefinedOk: true },
    { field: "triggeredBy", direction: "out", from: ["Condition"], to: ["Behavior", "Condition", "Item Flow"] },
    { field: "triggeredBy", direction: "in", from: ["Condition"], to: ["Behavior", "Condition"] }
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
    { field: "satisfies", direction: "out", from: ["Behavior", "Condition"], to: ["Requirement"], undefinedOk: true },
    { field: "performs", direction: "in", from: ["Behavior"], to: ["Object"] }
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
function semanticViewType(type) {
  if (type === "Function" || type === "Step" || type === "Action") return "Behavior";
  if (type === "Design" || type === "State" || type === "State Machine" || type === "Mode") return "Condition";
  return type;
}
function stepAllows(step, cur, nbr) {
  cur = semanticViewType(cur);
  nbr = semanticViewType(nbr);
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
  const typeOf = (p) => semanticViewType(index.notes.get(p)?.type);
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
        let list2 = picked.get(s.p);
        if (!list2) picked.set(s.p, list2 = []);
        list2.push(n);
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
        ...r.sourceSchemaVersion === "0.4" ? [] : [["exposes", r.exposes]],
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
      if (r.sourceSchemaVersion === "0.4") {
        for (const link of r.exposes) {
          const t = linkedLocal2(index, local, resolve, ownerPath, link);
          if (!t) continue;
          const alreadyPlaced = m.depthOf.has(t.key);
          addLocalNode(index, local, m, t.path, t.record, ownerDepth + 1, profile);
          if (!m.depthOf.has(t.key)) continue;
          if (alreadyPlaced) m.localEdges.push({ parent: a, child: t.key, field: "exposes", direction: "out", count: 1 });
          else m.tree.push({ parent: a, child: t.key, field: "exposes", direction: "out", count: 1 });
        }
      }
    }
  }
  for (const definitionPath of starts.filter((p) => {
    const note = index.notes.get(p);
    return note?.type === "Item Flow" || note?.type === "Port" || note?.type === "Object" && note.subtype === "interface";
  })) {
    const d = m.depthOf.get(definitionPath) ?? 0;
    const note = index.notes.get(definitionPath);
    const expected = note?.type === "Item Flow" ? "flow" : "endpoint";
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
function resolveAuthoredRelationshipLinks(authored, fromPath, schema4, resolve) {
  const fields = /* @__PURE__ */ new Map();
  let unresolved = 0;
  const broken = [];
  const repeat = /* @__PURE__ */ new Map();
  const localRefs = [];
  for (const item of authored) {
    const field = item.field;
    if (!schema4.byField.has(field) && !schema4.byInverse.has(field)) continue;
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
    let list2 = fields.get(field);
    if (!list2) fields.set(field, list2 = []);
    if (!list2.includes(path)) list2.push(path);
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
  let parse2 = 0;
  let max = rows[0];
  for (const row of rows) {
    total += row.totalMs;
    read += row.readMs;
    parse2 += row.parseMs;
    if (row.totalMs > max.totalMs || row.totalMs === max.totalMs && row.path.localeCompare(max.path) < 0) max = row;
  }
  return {
    owners: rows.length,
    averageMs: total / rows.length,
    maxMs: max.totalMs,
    maxPath: max.path,
    averageReadMs: read / rows.length,
    averageParseMs: parse2 / rows.length
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
  constructor(app, schema4) {
    this.app = app;
    this.schema = schema4;
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
    this.index = new ModelIndex(schema4);
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
  setSchema(schema4) {
    this.schema = schema4;
    this.index = new ModelIndex(schema4);
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
      subtype: str(fm.subtype),
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
  const list2 = nodes instanceof Map ? [...nodes.values()] : [];
  if (!list2.length) return "no cards to inspect";
  const withEl = list2.filter((n) => n?.nodeEl instanceof HTMLElement).length;
  return `${withEl} of ${list2.length} cards have an element`;
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
    for (const [k, v, warn2] of this.rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: k });
      tr.createEl("td", { text: v, cls: warn2 ? "mdse-warn" : void 0 });
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
  constructor(app, ownerName, localId, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.localId = localId;
    this.definitions = definitions;
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
    const definitionRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    definitionRow.createEl("label", { text: "Reusable definition" });
    const definition = definitionRow.createEl("select", { cls: "mdse-detail-input" });
    definition.createEl("option", { text: "Choose a model definition\u2026", value: "" });
    for (const option of this.definitions) {
      definition.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
    }
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
          const selected = this.definitions.find((option) => option.path === definition.value);
          if (!selected) throw new Error("Choose a reusable definition from the model.");
          const definitionLink = `[[${selected.path.replace(/\.md$/i, "")}]]`;
          const fields = {
            definition: definitionLink
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
            definition: definitionLink,
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
  constructor(app, ownerName, partName, partLocalId, localId, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.partName = partName;
    this.partLocalId = partLocalId;
    this.localId = localId;
    this.definitions = definitions;
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
    const definitionRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    definitionRow.createEl("label", { text: "Reusable definition" });
    const definition = definitionRow.createEl("select", { cls: "mdse-detail-input" });
    definition.createEl("option", { text: "Choose a model definition\u2026", value: "" });
    for (const option of this.definitions) {
      definition.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
    }
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
          const selected = this.definitions.find((option) => option.path === definition.value);
          if (!selected) throw new Error("Choose a reusable definition from the model.");
          const definitionLink = `[[${selected.path.replace(/\.md$/i, "")}]]`;
          const fields = {
            definition: definitionLink,
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
            definition: definitionLink,
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
  constructor(app, ownerName, source, options, localId, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.source = source;
    this.options = options;
    this.localId = localId;
    this.definitions = definitions;
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
    const definitionRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    definitionRow.createEl("label", { text: "Reusable definition" });
    const definition = definitionRow.createEl("select", { cls: "mdse-detail-input" });
    definition.createEl("option", { text: "No reusable definition", value: "" });
    for (const option of this.definitions) definition.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
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
        const selected = this.definitions.find((option) => option.path === definition.value);
        const definitionLink = selected ? `[[${selected.path.replace(/\.md$/i, "")}]]` : "";
        if (definitionLink) fields.definition = definitionLink;
        const staged = await this.stage({ kind: "connection", localId: this.localId, heading: heading.value.trim(), fields });
        this.staged = staged;
        this.review(staged, heading.value.trim(), definitionLink, target);
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
  constructor(app, ownerName, connection, localId, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.connection = connection;
    this.localId = localId;
    this.definitions = definitions;
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
    const definitionRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    definitionRow.createEl("label", { text: "Reusable definition" });
    const definition = definitionRow.createEl("select", { cls: "mdse-detail-input" });
    definition.createEl("option", { text: "Choose a model definition\u2026", value: "" });
    for (const option of this.definitions) definition.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
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
        const selected = this.definitions.find((option) => option.path === definition.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const definitionLink = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage({
          kind: "flow",
          localId: this.localId,
          connectionId: this.connection.localId,
          heading: heading.value.trim(),
          fields: {
            definition: definitionLink,
            endpointA: roleA.value.trim(),
            endpointB: roleB.value.trim()
          }
        });
        this.staged = staged;
        this.review(staged, heading.value.trim(), definitionLink, roleA.value.trim(), roleB.value.trim());
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
      ["Current parent", this.endpoint.parent?.text ?? "none"],
      ["Parent after Apply", this.endpoint.parent ? "cleared" : "none"],
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
      this.contentEl.createEl("p", { cls: "mdse-muted", text: this.endpoint.parent ? "Validation passed. Apply will assign the new part and clear the endpoint parent in one structural transaction." : "Validation passed. Apply will change only the endpoint part assignment." });
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
var LocalEndpointEqualsEditModal = class extends import_obsidian3.Modal {
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
    this.titleEl.setText("Edit endpoint equals");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Add or remove one same-note endpoint equals relationship for ${this.endpoint.identifier}. Existing exposes and connection topology are not changed.` });
    const modeRow = this.contentEl.createDiv({ cls: "mdse-create-field" });
    modeRow.createEl("label", { text: "Change" });
    const mode = modeRow.createEl("select", { cls: "mdse-detail-input" });
    if (this.addOptions.length) mode.createEl("option", { text: "Add equals", value: "add" });
    if (this.removeOptions.length) mode.createEl("option", { text: "Remove equals", value: "remove" });
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
        new import_obsidian3.Notice(`Cannot stage equals edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
  }
  renderReview(staged, mode, target) {
    this.titleEl.setText("Review endpoint equals edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["Change", mode === "add" ? "add equals" : "remove equals"],
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
      this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint equals field." });
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
        new import_obsidian3.Notice(`${mode === "add" ? "Added" : "Removed"} equals ${this.endpoint.identifier} \u2194 ${target.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalConnectionEndpointRewireModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, connection, end, options, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.connection = connection;
    this.end = end;
    this.options = options;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText(`Rewire connection ${this.end}`);
    this.contentEl.empty();
    const other = this.end === "endpointA" ? this.connection.endpointB : this.connection.endpointA;
    this.contentEl.createEl("p", { text: `Change only ${this.end} on ${this.connection.identifier}. The opposite endpoint and all child flows remain unchanged.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "New endpoint" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose endpoint...", value: "" });
    for (const option of this.options) pick.createEl("option", { text: `${option.identifier} - ^${option.localId}`, value: option.localId });
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Connection: ${this.connection.identifier} (#^${this.connection.localId})` });
    this.contentEl.createEl("p", { cls: "mdse-muted", text: `Other end: ${other?.text ?? "-"}` });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void this.stageReview(pick.value, review);
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
  async stageReview(localId, review) {
    review.disabled = true;
    try {
      const target = this.options.find((option) => option.localId === localId);
      if (!target) throw new Error("Choose a replacement endpoint.");
      const staged = await this.stage(target);
      this.staged = staged;
      this.renderReview(staged, target);
    } catch (e) {
      new import_obsidian3.Notice(`Cannot stage connection rewire: ${e.message}`, 12e3);
      review.disabled = false;
    }
  }
  renderReview(staged, target) {
    this.titleEl.setText("Review connection endpoint rewire");
    this.contentEl.empty();
    const other = this.end === "endpointA" ? this.connection.endpointB : this.connection.endpointA;
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Connection", this.connection.identifier],
      ["Changed end", this.end],
      ["New endpoint", target.identifier],
      ["Opposite endpoint", other?.text ?? "-"],
      ["Child flows", "preserved"],
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
      this.contentEl.createEl("p", { cls: "mdse-muted", text: `Validation passed. Apply will change only connection ${this.end}.` });
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
        new import_obsidian3.Notice(`Rewired ${this.connection.identifier} ${this.end} to ${target.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalConnectionDefinitionEditModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, connection, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.connection = connection;
    this.definitions = definitions;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Edit connection definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.connection.identifier}. Connection identity, endpoints, and child flows remain unchanged.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "No reusable definition", value: "" });
    const currentTarget = this.connection.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        const value = selected ? `[[${selected.path.replace(/\.md$/i, "")}]]` : "";
        const staged = await this.stage(value || null);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage connection definition edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
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
  renderReview(staged, value) {
    this.titleEl.setText("Review connection definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Connection", this.connection.identifier],
      ["New definition", value || "none"],
      ["Endpoint A", this.connection.endpointA?.text ?? "-"],
      ["Endpoint B", this.connection.endpointB?.text ?? "-"],
      ["Child flows", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: val });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : void 0 });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the connection definition field." });
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
        new import_obsidian3.Notice(`Updated definition for connection ${this.connection.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalPartDefinitionEditModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, part, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.part = part;
    this.definitions = definitions;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Edit part definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.part.identifier}. Part identity, usage, multiplicity, and attached endpoints remain unchanged.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "Choose a model definition\u2026", value: "" });
    const currentTarget = this.part.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const value = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage(value);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage part definition edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
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
  renderReview(staged, value) {
    this.titleEl.setText("Review part definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Part", this.part.identifier],
      ["New definition", value],
      ["Usage", this.part.usage],
      ["Multiplicity", this.part.multiplicity ?? "none"],
      ["Attached endpoints", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: val });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : void 0 });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the part definition field." });
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
        new import_obsidian3.Notice(`Updated definition for part ${this.part.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalEndpointDefinitionEditModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, endpoint2, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.endpoint = endpoint2;
    this.definitions = definitions;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Edit endpoint definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.endpoint.identifier}. Endpoint identity, usage, multiplicity, topology, and connections remain unchanged.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "Choose a model definition\u2026", value: "" });
    const currentTarget = this.endpoint.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const value = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage(value);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage endpoint definition edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
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
  renderReview(staged, value) {
    this.titleEl.setText("Review endpoint definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Endpoint", this.endpoint.identifier],
      ["New definition", value],
      ["Usage", this.endpoint.usage],
      ["Multiplicity", this.endpoint.multiplicity ?? "none"],
      ["Part", this.endpoint.part?.text ?? "none"],
      ["Parent", this.endpoint.parent?.text ?? "none"],
      ["Exposes", this.endpoint.exposes.length ? "preserved" : "none"],
      ["Equals", this.endpoint.equals.length ? "preserved" : "none"],
      ["Connections", "preserved"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: val });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : void 0 });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the endpoint definition field." });
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
        new import_obsidian3.Notice(`Updated definition for endpoint ${this.endpoint.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var LocalFlowDefinitionEditModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, flow, definitions, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.flow = flow;
    this.definitions = definitions;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Edit flow definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: `Change only the reusable definition link for ${this.flow.identifier}. Flow identity, owning connection, and both endpoint roles remain unchanged.` });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Reusable definition" });
    const input = row.createEl("select", { cls: "mdse-detail-input" });
    input.createEl("option", { text: "Choose a model definition\u2026", value: "" });
    const currentTarget = this.flow.definition?.target ?? "";
    for (const option of this.definitions) {
      const item = input.createEl("option", { text: `${option.name} \u2014 ${option.type ?? "model"}`, value: option.path });
      const stem = option.path.replace(/\.md$/i, "");
      if (currentTarget === stem || currentTarget === option.name) item.selected = true;
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const selected = this.definitions.find((option) => option.path === input.value);
        if (!selected) throw new Error("Choose a reusable definition from the model.");
        const value = `[[${selected.path.replace(/\.md$/i, "")}]]`;
        const staged = await this.stage(value);
        this.staged = staged;
        this.renderReview(staged, value);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage flow definition edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
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
  renderReview(staged, value) {
    this.titleEl.setText("Review flow definition edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Flow", this.flow.identifier],
      ["New definition", value],
      ["Connection", this.flow.connectionId ?? "none"],
      ["Endpoint A role", this.flow.roleA ?? "none"],
      ["Endpoint B role", this.flow.roleB ?? "none"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: val });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", { text: `${finding.severity.toUpperCase()}: ${finding.message}`, cls: finding.severity === "error" ? "mdse-warn" : void 0 });
    }
    if (!staged.plan.findings.length) this.contentEl.createEl("p", { cls: "mdse-muted", text: "Validation passed. Apply will change only the flow definition field." });
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
        new import_obsidian3.Notice(`Updated definition for flow ${this.flow.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var _LocalFlowRolesEditModal = class _LocalFlowRolesEditModal extends import_obsidian3.Modal {
  constructor(app, ownerName, flow, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.flow = flow;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Edit flow endpoint roles");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Change the Endpoint A/B roles for ${this.flow.identifier}. Flow identity, reusable definition, and owning connection remain unchanged.`
    });
    const select = (label, current) => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const pick = row.createEl("select", { cls: "mdse-detail-input" });
      for (const role of _LocalFlowRolesEditModal.roles) {
        const option = pick.createEl("option", { text: role, value: role });
        if (role === current) option.selected = true;
      }
      return pick;
    };
    const roleA = select("Endpoint A role", this.flow.roleA);
    const roleB = select("Endpoint B role", this.flow.roleB);
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const staged = await this.stage(roleA.value, roleB.value);
        this.staged = staged;
        this.renderReview(staged, roleA.value, roleB.value);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage flow role edit: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
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
  renderReview(staged, roleA, roleB) {
    this.titleEl.setText("Review flow endpoint-role edit");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Flow", this.flow.identifier],
      ["Reusable definition", this.flow.definition?.text ?? "none"],
      ["Owning connection", this.flow.connectionId ?? "none"],
      ["Endpoint A role", `${this.flow.roleA ?? "none"} \u2192 ${roleA}`],
      ["Endpoint B role", `${this.flow.roleB ?? "none"} \u2192 ${roleB}`],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: val });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : void 0
      });
    }
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Validation passed. Apply will change only the two governed flow endpoint-role fields."
      });
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
        new import_obsidian3.Notice(`Updated endpoint roles for flow ${this.flow.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
_LocalFlowRolesEditModal.roles = ["transmit", "receive", "exchange", "unspecified"];
var LocalFlowRolesEditModal = _LocalFlowRolesEditModal;
var LocalFlowConnectionMoveModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, flow, connections, stage, apply, cancel, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.flow = flow;
    this.connections = connections;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Move flow to connection");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Move ${this.flow.identifier} to another connection in this Local Model. Flow identity, definition, and endpoint roles remain unchanged.`
    });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Owning connection" });
    const select = row.createEl("select", { cls: "mdse-detail-input" });
    select.createEl("option", { text: "Choose a connection\u2026", value: "" });
    for (const connection of this.connections) {
      select.createEl("option", { text: connection.identifier, value: connection.localId });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => void (async () => {
      review.disabled = true;
      try {
        const connection = this.connections.find((candidate) => candidate.localId === select.value);
        if (!connection) throw new Error("Choose a target connection.");
        const staged = await this.stage(connection);
        this.staged = staged;
        this.renderReview(staged, connection);
      } catch (e) {
        new import_obsidian3.Notice(`Cannot stage flow move: ${e.message}`, 12e3);
        review.disabled = false;
      }
    })();
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
  renderReview(staged, connection) {
    this.titleEl.setText("Review flow connection move");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", this.ownerName],
      ["Flow", this.flow.identifier],
      ["Reusable definition", this.flow.definition?.text ?? "none"],
      ["Connection", `${this.flow.connectionId ?? "none"} \u2192 ${connection.localId}`],
      ["Endpoint A role", this.flow.roleA ?? "none"],
      ["Endpoint B role", this.flow.roleB ?? "none"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope]
    ];
    for (const [key2, val] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: val });
    }
    const blocking = staged.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of staged.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : void 0
      });
    }
    if (!staged.plan.findings.length) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Validation passed. Apply will move this flow under the selected connection without changing its identity or flow fields."
      });
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
        new import_obsidian3.Notice(`Moved flow ${this.flow.identifier} to ${connection.identifier}.`, 5e3);
      } catch (e) {
        new import_obsidian3.Notice(`Not applied: ${e.message}`, 12e3);
        apply.disabled = false;
      }
    })();
  }
};
var DefinitionCreateFromOccurrenceModal = class extends import_obsidian3.Modal {
  constructor(app, ownerName, occurrence, stageDefinition, applyDefinition, cancelDefinition, rollbackDefinition, stageBinding, applyBinding, cancelBinding, onApplied) {
    super(app);
    this.ownerName = ownerName;
    this.occurrence = occurrence;
    this.stageDefinition = stageDefinition;
    this.applyDefinition = applyDefinition;
    this.cancelDefinition = cancelDefinition;
    this.rollbackDefinition = rollbackDefinition;
    this.stageBinding = stageBinding;
    this.applyBinding = applyBinding;
    this.cancelBinding = cancelBinding;
    this.onApplied = onApplied;
    this.stagedDefinition = null;
    this.stagedBinding = null;
    this.definitionApplied = false;
    this.bindingApplied = false;
  }
  onOpen() {
    this.renderCompose();
  }
  onClose() {
    const definition = this.stagedDefinition;
    const binding = this.stagedBinding;
    this.stagedDefinition = null;
    this.stagedBinding = null;
    this.contentEl.empty();
    if (binding && !this.bindingApplied) {
      try {
        this.cancelBinding(binding.transaction.id);
      } catch {
      }
    }
    if (definition && !this.definitionApplied) {
      try {
        this.cancelDefinition(definition.transaction.id);
      } catch {
      }
    }
  }
  renderCompose() {
    this.titleEl.setText("Create reusable definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Create a reusable definition for ${this.occurrence.kind} occurrence "${this.occurrence.identifier}" in ${this.ownerName}. Review includes both definition creation and the occurrence binding before anything is written.`
    });
    const field = (label, value = "", placeholder = "") => {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: label });
      const input = row.createEl("input", { type: "text", cls: "mdse-detail-input", value });
      if (placeholder) input.setAttr("placeholder", placeholder);
      input.onkeydown = (e) => e.stopPropagation();
      return input;
    };
    const name = field("Definition name", this.occurrence.identifier, "Reusable definition name");
    const path = field("Vault path", "", "e.g. 40_Objects/Main Contactor.md");
    this.contentEl.createEl("p", {
      cls: "mdse-muted",
      text: "Choose the canonical vault location explicitly. Workbench generates the governed UID from your configured creator identity."
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          const definition = this.stageDefinition(name.value.trim(), path.value.trim());
          this.stagedDefinition = definition;
          try {
            const binding = await this.stageBinding(definition.plan.path);
            this.stagedBinding = binding;
            this.renderReview(definition, binding);
          } catch (error) {
            try {
              this.cancelDefinition(definition.transaction.id);
            } catch {
            }
            this.stagedDefinition = null;
            throw error;
          }
        } catch (e) {
          new import_obsidian3.Notice(`Cannot stage definition workflow: ${e.message}`, 12e3);
          review.disabled = false;
        }
      })();
    };
  }
  renderReview(definition, binding) {
    this.titleEl.setText("Review definition + occurrence binding");
    this.contentEl.empty();
    const rows = [
      ["Owner", this.ownerName],
      ["Occurrence", `${this.occurrence.kind} ${this.occurrence.identifier}`],
      ["Definition transaction", definition.transaction.label],
      ["Definition scope", definition.transaction.scope],
      ["Definition", definition.plan.name],
      ["Type", definition.plan.type],
      ["UID", definition.plan.uid],
      ["Path", definition.plan.path],
      ["Binding transaction", binding.transaction.label],
      ["Binding scope", binding.transaction.scope],
      ["Occurrence field", "definition"],
      ["Binding target", definition.plan.path.replace(/\.md$/i, "")]
    ];
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    const bindingBlocking = binding.plan.findings.filter((finding) => finding.severity === "error");
    for (const finding of binding.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : void 0
      });
    }
    if (!binding.plan.findings.length) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Both structural transactions are staged and reviewed. Apply creates the definition first, then applies the already-reviewed occurrence binding."
      });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Apply definition + bind", cls: "mod-cta" });
    apply.disabled = bindingBlocking.length > 0;
    apply.setAttr("title", bindingBlocking.length ? "Resolve blocking occurrence-binding findings before Apply." : "Apply the reviewed definition creation, then the reviewed occurrence binding.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.applyDefinition(definition.transaction.id);
          this.definitionApplied = true;
          this.stagedDefinition = null;
          await this.applyBinding(binding.transaction.id);
          this.bindingApplied = true;
          this.stagedBinding = null;
          this.close();
          this.onApplied();
          new import_obsidian3.Notice(`Created ${definition.plan.name} and bound ${this.occurrence.identifier} to it.`, 6e3);
        } catch (e) {
          if (this.definitionApplied && !this.bindingApplied) {
            new import_obsidian3.Notice(`Definition was created, but the reviewed occurrence binding was refused: ${e.message}`, 15e3);
            const recovery = this.contentEl.createDiv({ cls: "mdse-detail-state" });
            recovery.createEl("p", {
              cls: "mdse-warn",
              text: "The reusable definition exists, but the occurrence binding was not applied. You can keep the reusable definition, or roll back only that definition creation if no newer semantic edit has occurred."
            });
            const recoveryButtons = recovery.createDiv({ cls: "modal-button-container" });
            const keep = recoveryButtons.createEl("button", { text: "Keep definition" });
            keep.onclick = () => this.close();
            const rollback = recoveryButtons.createEl("button", { text: "Roll back definition", cls: "mod-warning" });
            rollback.onclick = () => {
              void (async () => {
                rollback.disabled = true;
                try {
                  if (this.stagedBinding) {
                    try {
                      this.cancelBinding(this.stagedBinding.transaction.id);
                    } catch {
                    }
                    this.stagedBinding = null;
                  }
                  await this.rollbackDefinition(definition.transaction.id);
                  this.definitionApplied = false;
                  this.close();
                  new import_obsidian3.Notice(`Rolled back reusable definition ${definition.plan.name}.`, 6e3);
                } catch (rollbackError) {
                  new import_obsidian3.Notice(`Definition rollback was refused: ${rollbackError.message}`, 15e3);
                  rollback.disabled = false;
                }
              })();
            };
          } else {
            new import_obsidian3.Notice(`Definition workflow was not applied: ${e.message}`, 15e3);
            apply.disabled = bindingBlocking.length > 0;
          }
        }
      })();
    };
  }
};
var DefinitionDeleteModal = class extends import_obsidian3.Modal {
  constructor(app, definitionName, stage, apply, cancel, onApplied) {
    super(app);
    this.definitionName = definitionName;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Review definition deletion");
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
    this.contentEl.createEl("p", {
      text: `Checking every indexed note relationship and Local Model occurrence that may use ${this.definitionName}\u2026`
    });
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
    const rows = [
      ["Definition", this.definitionName],
      ["Path", staged.path],
      ["UID", staged.uid],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
      ["Note-level uses", String(staged.impact.noteUseCount)],
      ["Local Model occurrences", String(staged.impact.occurrenceUseCount)]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    if (staged.impact.allowed) {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "Impact review passed. No active note-level or Local Model occurrence references use this definition. Apply will delete only this canonical definition note."
      });
    } else {
      const box = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      box.createEl("strong", { text: "Deletion blocked by active references" });
      for (const blocker of staged.impact.blockers) {
        box.createEl("p", { cls: "mdse-warn", text: blocker });
      }
      box.createEl("p", {
        text: "Resolve these references through explicit model edits, retirement, or supersession. Workbench will not silently detach them."
      });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Delete definition", cls: "mod-warning" });
    apply.disabled = !staged.impact.allowed;
    apply.setAttr("title", staged.impact.allowed ? "Delete this definition. Apply will recheck impact and file contents before mutation." : "Deletion is blocked while active references remain.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied();
          new import_obsidian3.Notice(`Deleted reusable definition ${this.definitionName}.`, 6e3);
        } catch (e) {
          new import_obsidian3.Notice(`Definition was not deleted: ${e.message}`, 15e3);
          apply.disabled = !staged.impact.allowed;
        }
      })();
    };
  }
};
var DefinitionRetireModal = class extends import_obsidian3.Modal {
  constructor(app, definitionName, stage, apply, cancel, onApplied) {
    super(app);
    this.definitionName = definitionName;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.onApplied = onApplied;
    this.staged = null;
    this.applied = false;
  }
  onOpen() {
    this.titleEl.setText("Review definition retirement");
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
    this.contentEl.createEl("p", {
      text: `Checking every current use of ${this.definitionName} before retirement\u2026`
    });
    try {
      const staged = await this.stage();
      this.staged = staged;
      this.renderReview(staged);
    } catch (e) {
      this.contentEl.empty();
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `Cannot stage retirement: ${e.message}` });
      const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons.createEl("button", { text: "Close" }).onclick = () => this.close();
    }
  }
  renderReview(staged) {
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Definition", this.definitionName],
      ["Path", staged.path],
      ["UID", staged.uid],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
      ["Current status", staged.plan.fromStatus ?? "unset"],
      ["New status", staged.plan.toStatus],
      ["Note-level uses", String(staged.plan.noteUseCount)],
      ["Local Model occurrences", String(staged.plan.occurrenceUseCount)]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    if (staged.plan.impactRows.length) {
      const impact = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      impact.createEl("strong", { text: "Preserved active uses" });
      for (const row of staged.plan.impactRows) impact.createEl("p", { text: row });
      impact.createEl("p", {
        text: "Retirement preserves these references exactly as authored. Migration is a separate supersession workflow."
      });
    } else {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "No current note-level or Local Model occurrence uses were found. Retirement still changes only canonical lifecycle status."
      });
    }
    if (!staged.plan.changed) {
      this.contentEl.createEl("p", { cls: "mdse-warn", text: "This definition is already retired. No additional retirement change is available." });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Retire definition", cls: "mod-warning" });
    apply.disabled = !staged.plan.changed;
    apply.setAttr("title", staged.plan.changed ? "Set only the canonical definition status to retired. Existing references are preserved." : "This definition is already retired.");
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.close();
          this.onApplied();
          new import_obsidian3.Notice(`Retired reusable definition ${this.definitionName}. Existing references were preserved.`, 6e3);
        } catch (e) {
          new import_obsidian3.Notice(`Definition was not retired: ${e.message}`, 15e3);
          apply.disabled = !staged.plan.changed;
        }
      })();
    };
  }
};
var DefinitionSupersedeModal = class extends import_obsidian3.Modal {
  constructor(app, replacedName, candidates, stage, apply, cancel, stageMigration, applyMigration, cancelMigration, stageNoteMigration, applyNoteMigration, cancelNoteMigration, refreshMigrationCandidates, onRetireReplaced, onApplied) {
    super(app);
    this.replacedName = replacedName;
    this.candidates = candidates;
    this.stage = stage;
    this.apply = apply;
    this.cancel = cancel;
    this.stageMigration = stageMigration;
    this.applyMigration = applyMigration;
    this.cancelMigration = cancelMigration;
    this.stageNoteMigration = stageNoteMigration;
    this.applyNoteMigration = applyNoteMigration;
    this.cancelNoteMigration = cancelNoteMigration;
    this.refreshMigrationCandidates = refreshMigrationCandidates;
    this.onRetireReplaced = onRetireReplaced;
    this.onApplied = onApplied;
    this.staged = null;
    this.stagedMigration = null;
    this.stagedNoteMigration = null;
    this.applied = false;
    this.migrationApplied = false;
    this.noteMigrationApplied = false;
  }
  onOpen() {
    this.renderCompose();
  }
  onClose() {
    const staged = this.staged;
    const migration = this.stagedMigration;
    const noteMigration = this.stagedNoteMigration;
    this.staged = null;
    this.stagedMigration = null;
    this.stagedNoteMigration = null;
    this.contentEl.empty();
    if (migration && !this.migrationApplied) {
      try {
        this.cancelMigration(migration.transaction.id);
      } catch {
      }
    }
    if (noteMigration && !this.noteMigrationApplied) {
      try {
        this.cancelNoteMigration(noteMigration.transaction.id);
      } catch {
      }
    }
    if (staged && !this.applied) {
      try {
        this.cancel(staged.transaction.id);
      } catch {
      }
    }
  }
  renderCompose() {
    this.titleEl.setText("Supersede definition");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `Choose the reusable definition that replaces ${this.replacedName}. Only same-class definitions are offered. Supersession records replacement intent; dependent migration remains separate and reviewed.`
    });
    const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
    row.createEl("label", { text: "Replacement definition" });
    const pick = row.createEl("select", { cls: "mdse-detail-input" });
    pick.createEl("option", { text: "Choose replacement\u2026", value: "" });
    for (const candidate of this.candidates) {
      pick.createEl("option", { text: candidate.name, value: candidate.path });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const review = buttons.createEl("button", { text: "Review", cls: "mod-cta" });
    review.disabled = this.candidates.length === 0;
    review.setAttr("title", this.candidates.length ? "Stage the supersession relationship and complete migration inventory for review." : "No same-class replacement definitions are available.");
    review.onclick = () => {
      void (async () => {
        review.disabled = true;
        try {
          if (!pick.value) throw new Error("Choose a replacement definition.");
          const staged = await this.stage(pick.value);
          this.staged = staged;
          this.renderReview(staged);
        } catch (e) {
          new import_obsidian3.Notice(`Cannot stage supersession: ${e.message}`, 15e3);
          review.disabled = this.candidates.length === 0;
        }
      })();
    };
  }
  renderReview(staged) {
    this.titleEl.setText("Review definition supersession");
    this.contentEl.empty();
    const replacement = this.candidates.find((candidate) => candidate.path === staged.plan.replacementPath);
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Replaced definition", this.replacedName],
      ["Replacement", replacement?.name ?? staged.plan.replacementPath],
      ["Relationship", "replacement supersedes replaced"],
      ["Transaction", staged.transaction.label],
      ["Scope", staged.transaction.scope],
      ["Migration candidates", String(staged.plan.migrationCandidates.length)],
      ["Automatic rewrites", "none"]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    for (const warning of staged.plan.warnings) {
      this.contentEl.createEl("p", { cls: "mdse-warn", text: `WARNING: ${warning}` });
    }
    if (staged.plan.migrationCandidates.length) {
      const inventory = this.contentEl.createDiv({ cls: "mdse-detail-state" });
      inventory.createEl("strong", { text: "Guided migration inventory" });
      for (const candidate of staged.plan.migrationCandidates) {
        inventory.createEl("p", {
          text: candidate.scope === "occurrence" ? `LOCAL: ${candidate.ownerPath} \u2014 ${candidate.kind} ${candidate.identifier} (^${candidate.localId})` : `MODEL: ${candidate.ownerPath} \u2014 ${candidate.field}`
        });
      }
      inventory.createEl("p", {
        text: "Apply does not alter these dependents. Each migration remains a separate governed model edit."
      });
    } else {
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "No current dependents require migration. Apply still records only the paired supersession relationship."
      });
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel" }).onclick = () => this.close();
    const apply = buttons.createEl("button", { text: "Apply supersession", cls: "mod-cta" });
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.apply(staged.transaction.id);
          this.applied = true;
          this.staged = null;
          this.onApplied();
          new import_obsidian3.Notice(`Recorded supersession for ${this.replacedName}. Dependent migration remains explicit.`, 7e3);
          this.renderMigration(staged);
        } catch (e) {
          new import_obsidian3.Notice(`Supersession was not applied: ${e.message}`, 15e3);
          apply.disabled = false;
        }
      })();
    };
  }
  async refreshMigration(staged) {
    const migrationCandidates = await this.refreshMigrationCandidates(staged.plan.replacedPath);
    const refreshed = {
      ...staged,
      plan: { ...staged.plan, migrationCandidates }
    };
    this.renderMigration(refreshed);
  }
  renderMigration(staged) {
    this.titleEl.setText("Migrate one dependent");
    this.contentEl.empty();
    const occurrenceCandidates = staged.plan.migrationCandidates.filter(
      (candidate) => candidate.scope === "occurrence" && !!candidate.localId
    );
    const noteCandidates = staged.plan.migrationCandidates.filter(
      (candidate) => candidate.scope === "note"
    );
    this.contentEl.createEl("p", {
      text: "Supersession is recorded. Migrate one dependent at a time as a separate reviewed transaction. Workbench rechecks fresh source before staging."
    });
    if (!occurrenceCandidates.length && !noteCandidates.length) {
      this.titleEl.setText("Supersession migration complete");
      this.contentEl.createEl("p", {
        text: "Supersession is recorded and there are no remaining dependents using the replaced definition."
      });
      this.contentEl.createEl("p", {
        cls: "mdse-muted",
        text: "The replaced definition is still preserved. Retirement is a separate governed lifecycle change and is never applied automatically."
      });
      const buttons2 = this.contentEl.createDiv({ cls: "modal-button-container" });
      buttons2.createEl("button", { text: "Done" }).onclick = () => this.close();
      buttons2.createEl("button", { text: "Review retirement\u2026", cls: "mod-cta" }).onclick = () => {
        this.close();
        this.onRetireReplaced();
      };
      return;
    }
    if (occurrenceCandidates.length) {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: "Local Model occurrence" });
      const pick = row.createEl("select", { cls: "mdse-detail-input" });
      pick.createEl("option", { text: "Choose occurrence\u2026", value: "" });
      occurrenceCandidates.forEach((candidate, index) => {
        pick.createEl("option", {
          text: `${candidate.ownerPath} \u2014 ${candidate.kind} ${candidate.identifier} (^${candidate.localId})`,
          value: String(index)
        });
      });
      const review = row.createEl("button", { text: "Review occurrence migration", cls: "mod-cta" });
      review.onclick = () => {
        void (async () => {
          review.disabled = true;
          try {
            const candidate = occurrenceCandidates[Number(pick.value)];
            if (!candidate?.localId) throw new Error("Choose an occurrence.");
            this.migrationApplied = false;
            const migration = await this.stageMigration(
              candidate.ownerPath,
              candidate.localId,
              staged.plan.replacedPath,
              staged.plan.replacementPath
            );
            this.stagedMigration = migration;
            this.renderMigrationReview(staged, candidate, migration);
          } catch (e) {
            new import_obsidian3.Notice(`Cannot stage occurrence migration: ${e.message}`, 15e3);
            review.disabled = false;
          }
        })();
      };
    }
    if (noteCandidates.length) {
      const row = this.contentEl.createDiv({ cls: "mdse-create-field" });
      row.createEl("label", { text: "Model relationship" });
      const pick = row.createEl("select", { cls: "mdse-detail-input" });
      pick.createEl("option", { text: "Choose relationship\u2026", value: "" });
      noteCandidates.forEach((candidate, index) => {
        pick.createEl("option", {
          text: `${candidate.ownerPath} \u2014 ${candidate.field}`,
          value: String(index)
        });
      });
      const review = row.createEl("button", { text: "Review relationship migration", cls: "mod-cta" });
      review.onclick = () => {
        void (async () => {
          review.disabled = true;
          try {
            const candidate = noteCandidates[Number(pick.value)];
            if (!candidate) throw new Error("Choose a model relationship.");
            this.noteMigrationApplied = false;
            const migration = await this.stageNoteMigration(
              candidate.ownerPath,
              candidate.field,
              staged.plan.replacedPath,
              staged.plan.replacementPath
            );
            this.stagedNoteMigration = migration;
            this.renderNoteMigrationReview(staged, candidate, migration);
          } catch (e) {
            new import_obsidian3.Notice(`Cannot stage relationship migration: ${e.message}`, 15e3);
            review.disabled = false;
          }
        })();
      };
    }
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Done" }).onclick = () => this.close();
  }
  renderMigrationRefreshFailure(supersession, error) {
    this.titleEl.setText("Migration applied");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: "The migration was applied successfully, but Workbench could not refresh the remaining dependent inventory."
    });
    this.contentEl.createEl("p", {
      cls: "mdse-warn",
      text: `Refresh failed: ${error.message}`
    });
    this.contentEl.createEl("p", {
      text: "Do not re-apply the completed migration. Retry the inventory refresh or close this dialog and reopen supersession later."
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    const retry = buttons.createEl("button", { text: "Retry inventory", cls: "mod-cta" });
    retry.onclick = () => {
      void (async () => {
        retry.disabled = true;
        try {
          await this.refreshMigration(supersession);
        } catch (e) {
          this.renderMigrationRefreshFailure(supersession, e);
        }
      })();
    };
    buttons.createEl("button", { text: "Done" }).onclick = () => this.close();
  }
  renderNoteMigrationReview(supersession, candidate, migration) {
    this.titleEl.setText("Review relationship migration");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", candidate.ownerPath],
      ["Relationship", candidate.field],
      ["From definition", supersession.plan.replacedPath],
      ["To definition", supersession.plan.replacementPath],
      ["Inverse field", migration.plan.inverseField ?? "none"],
      ["Affected notes", String(migration.affectedPaths.length)],
      ["Transaction", migration.transaction.label],
      ["Scope", migration.transaction.scope]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    const affected = this.contentEl.createDiv({ cls: "mdse-detail-state" });
    affected.createEl("strong", { text: "Files changed together" });
    for (const path of migration.affectedPaths) affected.createEl("p", { text: path });
    affected.createEl("p", {
      text: "Apply replaces the authored target and moves any paired or symmetric inverse relationship in the same structural transaction."
    });
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel migration" }).onclick = () => {
      try {
        this.cancelNoteMigration(migration.transaction.id);
      } finally {
        this.stagedNoteMigration = null;
        this.renderMigration(supersession);
      }
    };
    const apply = buttons.createEl("button", { text: "Apply relationship migration", cls: "mod-cta" });
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.applyNoteMigration(migration.transaction.id);
        } catch (e) {
          new import_obsidian3.Notice(`Relationship migration was not applied: ${e.message}`, 15e3);
          apply.disabled = false;
          return;
        }
        this.noteMigrationApplied = true;
        this.stagedNoteMigration = null;
        new import_obsidian3.Notice(`Migrated ${candidate.ownerPath} ${candidate.field} to the replacement definition.`, 6e3);
        try {
          await this.refreshMigration(supersession);
        } catch (e) {
          this.renderMigrationRefreshFailure(supersession, e);
        }
      })();
    };
  }
  renderMigrationReview(supersession, candidate, migration) {
    this.titleEl.setText("Review occurrence migration");
    this.contentEl.empty();
    const table = this.contentEl.createEl("table", { cls: "mdse-diagnostics" });
    const rows = [
      ["Owner", candidate.ownerPath],
      ["Occurrence", `${candidate.kind ?? "occurrence"} ${candidate.identifier ?? candidate.localId ?? ""}`],
      ["From definition", supersession.plan.replacedPath],
      ["To definition", supersession.plan.replacementPath],
      ["Transaction", migration.transaction.label],
      ["Scope", migration.transaction.scope]
    ];
    for (const [key2, value] of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: key2 });
      tr.createEl("td", { text: value });
    }
    for (const finding of migration.plan.findings) {
      this.contentEl.createEl("p", {
        text: `${finding.severity.toUpperCase()}: ${finding.message}`,
        cls: finding.severity === "error" ? "mdse-warn" : void 0
      });
    }
    const blocking = migration.plan.findings.some((finding) => finding.severity === "error");
    const buttons = this.contentEl.createDiv({ cls: "modal-button-container" });
    buttons.createEl("button", { text: "Cancel migration" }).onclick = () => {
      try {
        this.cancelMigration(migration.transaction.id);
      } finally {
        this.stagedMigration = null;
        this.renderMigration(supersession);
      }
    };
    const apply = buttons.createEl("button", { text: "Apply occurrence migration", cls: "mod-cta" });
    apply.disabled = blocking;
    apply.onclick = () => {
      void (async () => {
        apply.disabled = true;
        try {
          await this.applyMigration(migration.transaction.id);
        } catch (e) {
          new import_obsidian3.Notice(`Occurrence migration was not applied: ${e.message}`, 15e3);
          apply.disabled = blocking;
          return;
        }
        this.migrationApplied = true;
        this.stagedMigration = null;
        new import_obsidian3.Notice(`Migrated occurrence ^${candidate.localId} to the replacement definition.`, 6e3);
        try {
          await this.refreshMigration(supersession);
        } catch (e) {
          this.renderMigrationRefreshFailure(supersession, e);
        }
      })();
    };
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
    /** Exact occurrence to return to while definition editing is active. */
    this.definitionReturn = null;
    /** Definition path whose current Where Used/occurrence impact has been explicitly reviewed this session. */
    this.definitionImpactReviewedPath = null;
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
      if (this.definitionReturn && file.path !== this.definitionReturn.definitionPath) {
        this.definitionReturn = null;
        this.definitionImpactReviewedPath = null;
      }
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
    const modelType = typeof fm?.type === "string" && this.host.schema()?.classNames.has(fm.type) ? fm.type : null;
    if (modelType) {
      const impact = head.createEl("button", { text: "Review impact", cls: "mdse-detail-btn" });
      impact.setAttr("title", "Review note-level and occurrence-level uses before changing this canonical model definition.");
      impact.onclick = () => {
        void this.reviewDefinitionImpact(file);
      };
    }
    if (this.definitionReturn?.definitionPath === file.path) {
      const returnToOccurrence = head.createEl("button", { text: "Back to occurrence", cls: "mdse-detail-btn" });
      returnToOccurrence.setAttr("title", "Return to the contextual Local Model occurrence without changing its storage.");
      returnToOccurrence.onclick = () => {
        void this.returnToOccurrence();
      };
    }
    const uid = typeof fm?.uid === "string" ? fm.uid : "";
    if (modelType && uid) {
      const retire = head.createEl("button", { text: "Retire definition\u2026", cls: "mdse-detail-btn" });
      retire.setAttr("title", "Review all current uses, then set only canonical lifecycle status to retired.");
      retire.onclick = () => {
        new DefinitionRetireModal(
          this.app,
          file.basename,
          () => this.host.stageDefinitionRetirement(file.path, uid),
          (transactionId) => this.host.applyDefinitionRetirement(transactionId),
          (transactionId) => this.host.cancelDefinitionRetirement(transactionId),
          () => {
            void this.show(file, false);
          }
        ).open();
      };
      const supersede = head.createEl("button", { text: "Supersede definition\u2026", cls: "mdse-detail-btn" });
      supersede.setAttr("title", "Choose a same-class replacement and review the complete guided migration inventory.");
      supersede.onclick = () => {
        const candidates = this.host.elements(file.path).filter((candidate) => candidate.type === modelType).sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path));
        new DefinitionSupersedeModal(
          this.app,
          file.basename,
          candidates,
          (replacementPath) => this.host.stageDefinitionSupersession(file.path, uid, modelType, replacementPath),
          (transactionId) => this.host.applyDefinitionSupersession(transactionId),
          (transactionId) => this.host.cancelDefinitionSupersession(transactionId),
          (ownerPath, localId, replacedPath, replacementPath) => this.host.stageDefinitionOccurrenceMigration(ownerPath, localId, replacedPath, replacementPath),
          (transactionId) => this.host.applyDefinitionOccurrenceMigration(transactionId),
          (transactionId) => this.host.cancelDefinitionOccurrenceMigration(transactionId),
          (ownerPath, field, replacedPath, replacementPath) => this.host.stageDefinitionNoteMigration(ownerPath, field, replacedPath, replacementPath),
          (transactionId) => this.host.applyDefinitionNoteMigration(transactionId),
          (transactionId) => this.host.cancelDefinitionNoteMigration(transactionId),
          (replacedPath) => this.host.definitionSupersessionMigrationCandidates(replacedPath),
          () => {
            new DefinitionRetireModal(
              this.app,
              file.basename,
              () => this.host.stageDefinitionRetirement(file.path, uid),
              (transactionId) => this.host.applyDefinitionRetirement(transactionId),
              (transactionId) => this.host.cancelDefinitionRetirement(transactionId),
              () => {
                void this.show(file, false);
              }
            ).open();
          },
          () => {
            void this.show(file, false);
          }
        ).open();
      };
      const remove = head.createEl("button", { text: "Delete definition\u2026", cls: "mdse-detail-btn" });
      remove.setAttr("title", "Review all active references before destructive definition deletion.");
      remove.onclick = () => {
        new DefinitionDeleteModal(
          this.app,
          file.basename,
          () => this.host.stageDefinitionDeletion(file.path, uid),
          (transactionId) => this.host.applyDefinitionDeletion(transactionId),
          (transactionId) => this.host.cancelDefinitionDeletion(transactionId),
          () => {
            if (this.definitionReturn?.definitionPath === file.path) void this.returnToOccurrence();
            else this.close();
          }
        ).open();
      };
    }
    const edit = head.createEl("button", { text: this.editing ? "Done" : "Edit definition", cls: this.editing ? "mdse-detail-btn mod-cta" : "mdse-detail-btn" });
    if (!this.definitionReturn || this.definitionReturn.definitionPath !== file.path) {
      edit.setText(this.editing ? "Done" : "Edit");
    }
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
      if (!this.editing && modelType) {
        void this.enterDefinitionEdit(file);
        return;
      }
      this.editing = !this.editing;
      void this.show(file, false);
    };
    if (this.editing) {
      const undo = head.createEl("button", { text: "Undo", cls: "mdse-detail-btn", attr: { title: "Undo the last Workbench edit" } });
      undo.disabled = !this.host.writer()?.canUndo;
      undo.onclick = () => void this.host.undo();
      const local = parseLocalModel(text);
      const canCreateFirstPart = fm?.type === "Object" && (!local || local.structured && local.records.length === 0);
      if (canCreateFirstPart) {
        const addPart = head.createEl("button", { text: "Add first part occurrence\u2026", cls: "mdse-detail-btn" });
        addPart.onclick = () => {
          void this.createPartOccurrence(file);
        };
      }
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
    if (this.editing) {
      chips.createSpan({
        cls: "mdse-detail-chip mdse-detail-chip-edit",
        text: this.definitionReturn?.definitionPath === file.path ? "editing definition" : "editing"
      });
    }
    const schema4 = this.host.schema();
    const fields = new Set(schema4 ? [...schema4.byField.keys(), ...schema4.byInverse.keys()] : []);
    this.propertiesSection(root, file, fm, fields, schema4);
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
      addPart.onclick = () => {
        void this.createPartOccurrence(file);
      };
    }
    if (this.editing && record.kind === "part") {
      const definition = head.createEl("button", { text: "Change definition\u2026", cls: "mdse-detail-btn" });
      definition.onclick = () => this.editPartDefinition(file, record);
      const addEndpoint = head.createEl("button", { text: "Add endpoint\u2026", cls: "mdse-detail-btn" });
      addEndpoint.onclick = () => {
        void this.createEndpointOccurrence(file, record);
      };
    }
    if (this.editing && record.kind === "endpoint") {
      const definition = head.createEl("button", { text: "Change definition\u2026", cls: "mdse-detail-btn" });
      definition.onclick = () => this.editEndpointDefinition(file, record);
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
      const equals = head.createEl("button", { text: "Edit equals\u2026", cls: "mdse-detail-btn" });
      equals.onclick = () => {
        void this.editEndpointEquals(file, record);
      };
      const connect = head.createEl("button", { text: "Connect to endpoint\u2026", cls: "mdse-detail-btn" });
      connect.onclick = () => {
        void this.createConnectionOccurrence(file, record);
      };
    }
    if (this.editing && record.kind === "connection") {
      const definition = head.createEl("button", { text: "Change definition\u2026", cls: "mdse-detail-btn" });
      definition.onclick = () => {
        void this.editConnectionDefinition(file, record);
      };
      const rewireA = head.createEl("button", { text: "Change endpoint A\u2026", cls: "mdse-detail-btn" });
      rewireA.onclick = () => {
        void this.rewireConnectionEndpoint(file, record, "endpointA");
      };
      const rewireB = head.createEl("button", { text: "Change endpoint B\u2026", cls: "mdse-detail-btn" });
      rewireB.onclick = () => {
        void this.rewireConnectionEndpoint(file, record, "endpointB");
      };
      const addFlow = head.createEl("button", { text: "Add flow\u2026", cls: "mdse-detail-btn" });
      addFlow.onclick = () => {
        void this.createFlowOccurrence(file, record);
      };
    }
    if (this.editing && record.kind === "flow") {
      const definition = head.createEl("button", { text: "Change definition\u2026", cls: "mdse-detail-btn" });
      definition.onclick = () => this.editFlowDefinition(file, record);
      const roles = head.createEl("button", { text: "Change endpoint roles\u2026", cls: "mdse-detail-btn" });
      roles.onclick = () => this.editFlowRoles(file, record);
      const move = head.createEl("button", { text: "Move to connection\u2026", cls: "mdse-detail-btn" });
      move.onclick = () => {
        void this.moveFlowConnection(file, record);
      };
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
    if (!record.definition?.target && record.kind !== "connection") {
      const tr = table.createEl("tr");
      tr.createEl("td", { text: "Definition creation" });
      const td = tr.createEl("td");
      const createDefinition = td.createEl("button", { text: "Create reusable definition\u2026", cls: "mdse-detail-btn" });
      createDefinition.setAttr("title", "Create a compatible reusable definition through governed Review/Apply, then bind this occurrence.");
      createDefinition.onclick = () => {
        new DefinitionCreateFromOccurrenceModal(
          this.app,
          file.basename,
          record,
          (name, path) => this.host.stageDefinitionCreation(record.kind, name, path),
          (transactionId) => this.host.applyDefinitionCreation(transactionId),
          (transactionId) => this.host.cancelDefinitionCreation(transactionId),
          (transactionId) => this.host.rollbackDefinitionCreation(transactionId),
          (definitionPath) => this.host.stageOccurrenceDefinitionBinding(file.path, record.localId, definitionPath),
          (transactionId) => this.host.applyOccurrenceDefinitionBinding(transactionId),
          (transactionId) => this.host.cancelOccurrenceDefinitionBinding(transactionId),
          () => {
            void this.refreshLocal(file, record.localId, false);
          }
        ).open();
      };
    }
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
      row("Endpoint A role", record.roleA ?? "");
      row("Endpoint B role", record.roleB ?? "");
    }
    this.localDefinitionSection(root, file, record);
    root.createEl("p", {
      cls: "mdse-muted",
      text: this.editing ? "Editing context only. Definition identity and structural/topology links remain separate and read-only here." : "This is contextual occurrence data stored in the owner note. Open the reusable definition separately to edit definition-level data."
    });
    root.scrollTop = 0;
  }
  /**
   * WB-114 definition/context ownership seam. The reusable definition is visible from an occurrence
   * without copying definition data into the Local Model. The section is lazy and read-only; definition
   * edits continue to use the canonical note surface.
   */
  localDefinitionSection(root, ownerFile, record) {
    const link = record.definition;
    if (!link?.target) return;
    const details = root.createEl("details", { cls: "mdse-local-definition" });
    details.createEl("summary", { text: "Definition" });
    const content = details.createDiv({ cls: "mdse-local-definition-content" });
    content.createEl("p", { cls: "mdse-muted", text: "Expand to load the reusable definition." });
    let loaded = false;
    details.addEventListener("toggle", () => {
      if (!details.open || loaded) return;
      loaded = true;
      void this.renderLocalDefinition(content, ownerFile, link.target);
    });
  }
  async renderLocalDefinition(content, ownerFile, linkpath) {
    content.empty();
    const definitionFile = this.app.metadataCache.getFirstLinkpathDest(linkpath.split("#")[0], ownerFile.path);
    if (!definitionFile) {
      content.createEl("p", { cls: "mdse-warn", text: `Definition could not be resolved: ${linkpath}` });
      return;
    }
    const cache = this.app.metadataCache.getFileCache(definitionFile);
    const fm = cache?.frontmatter ?? null;
    const text = await this.app.vault.cachedRead(definitionFile);
    if (!this.el || this.current !== ownerFile || !this.currentLocal) return;
    const head = content.createDiv({ cls: "mdse-detail-head" });
    head.createDiv({ cls: "mdse-detail-title", text: definitionFile.basename }).setAttr("title", definitionFile.path);
    const editDefinition = head.createEl("button", { text: "Edit definition", cls: "mdse-detail-btn mod-cta" });
    editDefinition.setAttr("title", "Edit the canonical reusable note in a separate definition surface.");
    editDefinition.onclick = () => {
      void this.editDefinitionFromOccurrence(ownerFile, this.currentLocal, definitionFile);
    };
    const open = head.createEl("button", { text: "Open note", cls: "mdse-detail-btn" });
    open.setAttr("title", "Open the canonical reusable definition note in a tab.");
    open.onclick = () => void this.app.workspace.getLeaf(true).openFile(definitionFile);
    const chips = content.createDiv({ cls: "mdse-detail-chips" });
    chips.createSpan({ cls: "mdse-detail-chip", text: "definition" });
    for (const key2 of ["type", "subtype", "id", "status"]) {
      const value = fm?.[key2];
      if (value !== void 0 && value !== null && String(value) !== "") {
        chips.createSpan({ cls: "mdse-detail-chip", text: key2 === "type" || key2 === "subtype" ? String(value) : `${key2} ${String(value)}` });
      }
    }
    const schema4 = this.host.schema();
    const relationshipFields = new Set(schema4 ? [...schema4.byField.keys(), ...schema4.byInverse.keys()] : []);
    const properties = propertyRows(fm, relationshipFields);
    if (properties.length) {
      const table = content.createEl("table", { cls: "mdse-finding" });
      for (const property of properties) this.renderDefinitionRow(table, property, definitionFile);
    }
    const relationships = relationshipRows(fm, relationshipFields);
    const relationshipDetails = content.createEl("details", { cls: "mdse-local-definition-relationships" });
    relationshipDetails.createEl("summary", { text: `Relationships (${relationships.length})` });
    if (relationships.length) {
      const table = relationshipDetails.createEl("table", { cls: "mdse-finding" });
      for (const relationship of relationships) this.renderDefinitionRow(table, relationship, definitionFile);
    } else {
      relationshipDetails.createEl("p", { cls: "mdse-detail-empty", text: "No authored relationships." });
    }
    const md = bodyOf(text, cache?.frontmatterPosition?.end.offset);
    const body = content.createDiv({ cls: "mdse-detail-body markdown-rendered" });
    if (md.trim()) await import_obsidian4.MarkdownRenderer.render(this.app, md, body, definitionFile.path, this);
    else body.createEl("p", { cls: "mdse-detail-empty", text: "This definition has no text." });
  }
  /**
   * Impact review is consumed by one canonical-definition mutation. This makes the gate apply
   * immediately before Apply rather than only when edit mode was entered.
   */
  async ensureDefinitionImpactReviewed(file) {
    const impact = await this.host.definitionImpact(file.path);
    if (impact.notes + impact.occurrences === 0) return true;
    if (this.definitionImpactReviewedPath === file.path) return true;
    new import_obsidian4.Notice(
      `Review impact before applying this definition change: ${impact.notes} note-level use${impact.notes === 1 ? "" : "s"} and ${impact.occurrences} occurrence${impact.occurrences === 1 ? "" : "s"} depend on ${file.basename}.`,
      1e4
    );
    return false;
  }
  consumeDefinitionImpactReview(file) {
    if (this.definitionImpactReviewedPath === file.path) this.definitionImpactReviewedPath = null;
  }
  async reviewDefinitionImpact(file) {
    try {
      const impact = await this.host.definitionImpact(file.path);
      this.definitionImpactReviewedPath = file.path;
      new ReportModal(
        this.app,
        `Definition impact \u2014 ${file.basename}`,
        impact.rows.length ? impact.rows.map((row) => ["Use", row]) : [["Use", "No current note-level or occurrence-level uses were found."]],
        [
          `${impact.notes} note-level use${impact.notes === 1 ? "" : "s"}; ${impact.occurrences} Local Model occurrence${impact.occurrences === 1 ? "" : "s"}.`,
          "This is read-only impact evidence. It does not change the definition or any occurrence."
        ]
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot review definition impact: ${e.message}`, 12e3);
    }
  }
  async editDefinitionFromOccurrence(ownerFile, record, definitionFile) {
    if (!record) return;
    this.definitionReturn = {
      ownerPath: ownerFile.path,
      localId: record.localId,
      definitionPath: definitionFile.path
    };
    this.definitionImpactReviewedPath = null;
    await this.show(definitionFile, false);
    if (this.current?.path === definitionFile.path) {
      new import_obsidian4.Notice("Definition opened. Review impact before editing when this definition is currently used.", 6e3);
    }
  }
  async enterDefinitionEdit(file) {
    try {
      const impact = await this.host.definitionImpact(file.path);
      const hasImpact = impact.notes + impact.occurrences > 0;
      if (hasImpact && this.definitionImpactReviewedPath !== file.path) {
        new import_obsidian4.Notice(
          `Review impact before editing ${file.basename}: ${impact.notes} note-level use${impact.notes === 1 ? "" : "s"} and ${impact.occurrences} occurrence${impact.occurrences === 1 ? "" : "s"} depend on it.`,
          1e4
        );
        return;
      }
      this.editing = true;
      await this.show(file, false);
    } catch (e) {
      new import_obsidian4.Notice(`Cannot enter definition edit mode: ${e.message}`, 12e3);
    }
  }
  async returnToOccurrence() {
    const back = this.definitionReturn;
    if (!back) return;
    if (this.isDirty()) {
      new ConfirmModal(this.app, "Discard the unsaved definition text changes?", "Discard", () => {
        this.bodyArea = null;
        void this.returnToOccurrence();
      }).open();
      return;
    }
    const owner = this.app.vault.getAbstractFileByPath(back.ownerPath);
    if (!(owner instanceof import_obsidian4.TFile)) {
      new import_obsidian4.Notice("The occurrence owner note no longer exists.", 8e3);
      this.definitionReturn = null;
      return;
    }
    const text = await this.app.vault.cachedRead(owner);
    const region = parseLocalModel(text);
    const record = region?.records.find((candidate) => candidate.localId === back.localId);
    if (!record) {
      new import_obsidian4.Notice("The original occurrence no longer exists.", 8e3);
      this.definitionReturn = null;
      return;
    }
    this.definitionReturn = null;
    this.definitionImpactReviewedPath = null;
    this.editing = false;
    this.showLocal(owner, record, false);
  }
  renderDefinitionRow(table, row, sourceFile) {
    const tr = table.createEl("tr");
    tr.createEl("td", { text: row.key });
    const td = tr.createEl("td");
    for (const part of row.parts) {
      if (!part.link) {
        td.appendText(part.text);
        continue;
      }
      const a = td.createEl("a", { text: part.text, href: "#" });
      a.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = this.app.metadataCache.getFirstLinkpathDest(part.link, sourceFile.path);
        if (target) void this.show(target);
      };
    }
  }
  async editEndpointEquals(file, endpoint2) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const endpoints = region.records.filter((record) => record.kind === "endpoint" && record.localId !== endpoint2.localId);
      const equalIds = new Set(endpoint2.equals.filter((link) => !link.target && link.blockId).map((link) => link.blockId));
      const addOptions = endpoints.filter((candidate) => !equalIds.has(candidate.localId));
      const removeOptions = endpoints.filter((candidate) => equalIds.has(candidate.localId));
      if (!addOptions.length && !removeOptions.length) throw new Error("This endpoint has no same-note equals edit available.");
      new LocalEndpointEqualsEditModal(
        this.app,
        file.basename,
        endpoint2,
        addOptions,
        removeOptions,
        (mode, target) => {
          const remaining = endpoint2.equals.filter((link) => !(mode === "remove" && !link.target && link.blockId === target.localId)).map((link) => link.text);
          if (mode === "add") remaining.push(`[[#^${target.localId}|${target.identifier}]]`);
          return editor.stageAndReviewLocalRecordPatch(file.path, endpoint2.localId, {
            fields: { equals: remaining.length ? remaining.join(" ") : null }
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
      new import_obsidian4.Notice(`Cannot edit endpoint equals: ${e.message}`, 12e3);
    }
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
          return editor.stageAndReviewLocalRecordPatch(file.path, endpoint2.localId, {
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
        (parent) => editor.stageAndReviewLocalRecordPatch(file.path, endpoint2.localId, {
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
        (part) => editor.stageAndReviewLocalRecordPatch(file.path, endpoint2.localId, {
          fields: {
            part: `[[#^${part.localId}|${part.identifier}]]`,
            parent: null
          }
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
  async moveFlowConnection(file, flow) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const connections = region.records.filter((record) => record.kind === "connection" && record.localId !== flow.connectionId);
      if (!connections.length) throw new Error("This note has no alternate connection occurrence.");
      new LocalFlowConnectionMoveModal(
        this.app,
        file.basename,
        flow,
        connections,
        (connection) => editor.stageAndReviewLocalFlowMove(file.path, flow.localId, connection.localId),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, flow.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot move flow: ${e.message}`, 12e3);
    }
  }
  editFlowRoles(file, flow) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalFlowRolesEditModal(
        this.app,
        file.basename,
        flow,
        (roleA, roleB) => editor.stageAndReviewLocalRecordPatch(file.path, flow.localId, {
          fields: {
            endpointA: roleA,
            endpointB: roleB
          }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, flow.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot edit flow endpoint roles: ${e.message}`, 12e3);
    }
  }
  editFlowDefinition(file, flow) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalFlowDefinitionEditModal(
        this.app,
        file.basename,
        flow,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, flow.localId, {
          fields: { definition }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, flow.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot edit flow definition: ${e.message}`, 12e3);
    }
  }
  editEndpointDefinition(file, endpoint2) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalEndpointDefinitionEditModal(
        this.app,
        file.basename,
        endpoint2,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, endpoint2.localId, {
          fields: { definition }
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
      new import_obsidian4.Notice(`Cannot edit endpoint definition: ${e.message}`, 12e3);
    }
  }
  editPartDefinition(file, part) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalPartDefinitionEditModal(
        this.app,
        file.basename,
        part,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, part.localId, {
          fields: { definition }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, part.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot edit part definition: ${e.message}`, 12e3);
    }
  }
  editConnectionDefinition(file, connection) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      new LocalConnectionDefinitionEditModal(
        this.app,
        file.basename,
        connection,
        this.host.elements(file.path),
        (definition) => editor.stageAndReviewLocalRecordPatch(file.path, connection.localId, {
          fields: { definition }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, connection.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot edit connection definition: ${e.message}`, 12e3);
    }
  }
  async rewireConnectionEndpoint(file, connection, end) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const current = end === "endpointA" ? connection.endpointA?.blockId : connection.endpointB?.blockId;
      const options = region.records.filter((record) => record.kind === "endpoint" && record.localId !== current);
      if (!options.length) throw new Error("This note has no alternate endpoint occurrence.");
      new LocalConnectionEndpointRewireModal(
        this.app,
        file.basename,
        connection,
        end,
        options,
        (target) => editor.stageAndReviewLocalRecordPatch(file.path, connection.localId, {
          fields: { [end]: `[[#^${target.localId}|${target.identifier}]]` }
        }),
        (transactionId) => editor.applyLocalPatch(transactionId),
        (transactionId) => {
          editor.cancelLocalPatch(transactionId);
        },
        () => {
          void this.refreshLocal(file, connection.localId, true);
        }
      ).open();
    } catch (e) {
      new import_obsidian4.Notice(`Cannot rewire connection endpoint: ${e.message}`, 12e3);
    }
  }
  async createFlowOccurrence(file, connection) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("flow", ownerUid, region.records.map((record) => record.localId));
      const definitions = this.host.elements(file.path);
      if (!definitions.length) throw new Error("No reusable model definitions are available.");
      new LocalFlowCreateModal(
        this.app,
        file.basename,
        connection,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
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
      const localId = nextAvailableLocalId("connection", ownerUid, region.records.map((record) => record.localId));
      const definitions = this.host.elements(file.path);
      new LocalConnectionCreateModal(
        this.app,
        file.basename,
        source,
        options,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
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
  async createEndpointOccurrence(file, part) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (!region?.structured) throw new Error("The owner note has no usable Local Model.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("endpoint", ownerUid, region.records.map((record) => record.localId));
      const definitions = this.host.elements(file.path);
      if (!definitions.length) throw new Error("No reusable model definitions are available.");
      new LocalEndpointCreateModal(
        this.app,
        file.basename,
        part.identifier,
        part.localId,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
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
        () => editor.stageAndReviewLocalRecordDelete(file.path, record.localId),
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
  async createPartOccurrence(file) {
    try {
      const editor = this.host.modelEditor();
      if (!editor) throw new Error("Workbench is still starting.");
      const text = await this.app.vault.read(file);
      const region = parseLocalModel(text);
      if (region && !region.structured) throw new Error("The owner note has no usable Local Model.");
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.type !== "Object") throw new Error("Part occurrences can only be created in an Object owner.");
      const ownerUid = typeof fm?.uid === "string" ? fm.uid : "";
      const localId = nextAvailableLocalId("part", ownerUid, region?.records.map((record) => record.localId) ?? []);
      const definitions = this.host.elements(file.path);
      if (!definitions.length) throw new Error("No reusable model definitions are available.");
      new LocalPartCreateModal(
        this.app,
        file.basename,
        localId,
        definitions,
        (input) => editor.stageAndReviewLocalRecordCreate(file.path, input),
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
    this.definitionReturn = null;
    this.definitionImpactReviewedPath = null;
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
  propertiesSection(root, file, fm, fields, schema4) {
    const rows = propertyRows(fm, fields, this.editing);
    if (!rows.length) return;
    const details = root.createEl("details", { cls: "mdse-detail-props" });
    details.open = this.editing;
    details.createEl("summary", { text: `Properties (${rows.reduce((n, r) => n + r.count, 0)})` });
    const table = details.createEl("table");
    const type = typeof fm?.type === "string" ? fm.type : "";
    const ctx = {
      relationFields: fields,
      translatedOnly: new Set(schema4?.translatedOnlyProperties ?? []),
      subtypes: schema4 ? schema4.classes.find((c) => c.name === type)?.subtypes ?? null : null
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
          if (!await this.ensureDefinitionImpactReviewed(file)) return;
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          await writer.setProperty(file.path, r.key, v);
          this.consumeDefinitionImpactReview(file);
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
      add.onclick = () => {
        void (async () => {
          if (!await this.ensureDefinitionImpactReviewed(file)) return;
          new ElementPicker(this.app, this.host.elements(file.path), `Relate ${file.basename} to\u2026`, (second) => {
            this.consumeDefinitionImpactReview(file);
            this.host.relate(file.path, second.path);
          }).open();
        })();
      };
    }
  }
  confirmRemove(file, field, linkText, shown, times, _fields) {
    const schema4 = this.host.schema();
    const target = this.app.metadataCache.getFirstLinkpathDest(linkText, file.path);
    const forward = schema4?.byField.get(field);
    const inverseOf = schema4?.byInverse.get(field);
    const def = forward ?? inverseOf;
    const back = def ? def.kind === "symmetric" ? def.field : def.inverse : void 0;
    const once = times > 1 ? ` It is listed ${times} times; all are removed.` : "";
    const text = !target ? `Remove ${field} \u2192 ${shown} from ${file.basename}? ${shown} does not exist yet, so there is no inverse.${once}` : `Remove ${field} \u2192 ${shown} from ${file.basename}${back ? `, and its inverse ${forward ? back : def.field} on ${shown}` : ""}?${once}`;
    new ConfirmModal(this.app, text, "Remove", () => {
      void (async () => {
        try {
          if (!await this.ensureDefinitionImpactReviewed(file)) return;
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          if (!target) await writer.removeMissing(file.path, field, linkText);
          else if (forward) await writer.remove(forward, file.path, target.path);
          else if (inverseOf) await writer.remove(inverseOf, target.path, file.path);
          else throw new Error(`${field} is not a relationship in this vault's schema.`);
          this.consumeDefinitionImpactReview(file);
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
          if (!await this.ensureDefinitionImpactReviewed(file)) return;
          const writer = this.host.writer();
          if (!writer) throw new Error("Workbench is still starting.");
          await writer.setBody(file.path, this.bodyLoaded, area.value);
          this.consumeDefinitionImpactReview(file);
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
function countByCategory(list2) {
  const n = { provisional: 0, missingInverse: 0, orphanInverse: 0, offRule: 0, broken: 0, localModel: 0 };
  for (const f of list2) n[f.category]++;
  return n;
}
var base = (path) => path.replace(/^.*\//, "").replace(/\.md$/, "");
function filterFindings(list2, index, f) {
  const q = (f.text ?? "").trim().toLowerCase();
  return list2.filter((x) => {
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
function neighbour(list2, from, direction, skip) {
  for (let i = from + direction; i >= 0 && i < list2.length; i += direction) if (!skip.has(list2[i].key)) return i;
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
    const list2 = filterFindings(this.all, this.host.index(), { category: this.category, text: this.text, type: this.type || void 0, field: this.field || void 0 });
    return list2.filter((f) => !this.resolved.has(f.key));
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
    const pick = (label, values, current, set2) => {
      const s = bar.createEl("select");
      s.createEl("option", { value: "", text: label });
      for (const v of values) s.createEl("option", { value: v, text: v });
      s.value = current;
      s.onchange = () => {
        set2(s.value);
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
    const list2 = this.visible();
    if (!list2.length) {
      listEl.createEl("p", { text: this.all.some((f) => f.category === this.category) ? "Nothing matches these filters." : "No findings in this category.", cls: "mdse-muted" });
      return;
    }
    list2.slice(0, ROW_LIMIT).forEach((f, i) => {
      const row = listEl.createDiv({ cls: "mdse-row" });
      row.createSpan({ text: base2(f.from), cls: "mdse-from" });
      row.createSpan({ text: f.field, cls: "mdse-field" });
      row.createSpan({ text: f.to ? base2(f.to) : f.link ?? "", cls: "mdse-to" });
      row.onclick = () => this.openFinding(list2, i);
    });
    if (list2.length > ROW_LIMIT) listEl.createEl("p", { text: `Showing the first ${ROW_LIMIT} of ${list2.length}. Narrow the filters to see the rest.`, cls: "mdse-muted" });
  }
  openFinding(list2, at) {
    new FindingModal(this.host, list2, at, (key2) => this.markResolved(key2)).open();
  }
  markResolved(key2) {
    this.resolved.add(key2);
    this.render();
    this.later();
  }
};
var FindingModal = class extends import_obsidian5.Modal {
  constructor(host, list2, start, onResolved) {
    super(host.app);
    this.host = host;
    this.list = list2;
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

// src/core/identity.ts
function sourceUidFromMarkdown(source) {
  const frontmatterMatch = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(source);
  if (!frontmatterMatch) return null;
  const raw = /^uid:\s*["']?([^"'\n#]+)["']?\s*(?:#.*)?$/m.exec(frontmatterMatch[1])?.[1]?.trim() ?? "";
  return raw || null;
}
function assertIndexedNoteUidMatchesSource(path, source, indexedUid, operation = "edit") {
  const sourceUid = sourceUidFromMarkdown(source);
  if (!sourceUid || sourceUid !== indexedUid) {
    throw new Error(
      `Cannot ${operation} ${path}: indexed uid ${indexedUid} does not match source uid ${sourceUid ?? "none"}.`
    );
  }
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
    const schema4 = this.getSchema();
    if (editingBlocked(schema4)) return "The vault's schema is older than this Workbench supports, so editing is off.";
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
      this.assertCurrentIdentity(file.path, before, "add relationship to");
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
      this.assertCurrentIdentity(file.path, before, "remove relationship from");
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
    this.assertCurrentIdentity(file.path, before, "remove missing relationship from");
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
    const schema4 = this.getSchema();
    if (editingBlocked(schema4)) throw new Error("The vault's schema is older than this Workbench supports, so editing is off.");
    if (PROTECTED_PROPERTIES.has(key2)) throw new Error(`${key2} is never edited by hand.`);
    if (schema4.byField.has(key2) || schema4.byInverse.has(key2)) throw new Error(`${key2} is a relationship: change it under Relationships.`);
    const file = this.file(path);
    const tx = { label: `set ${key2} on ${file.basename}`, files: [] };
    const before = await this.app.vault.read(file);
    this.assertCurrentIdentity(file.path, before, "set property on");
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
    const schema4 = this.getSchema();
    if (editingBlocked(schema4)) throw new Error("The vault's schema is older than this Workbench supports, so editing is off.");
    const file = this.file(path);
    const tx = { label: `edit text of ${file.basename}`, files: [] };
    const before = await this.app.vault.read(file);
    this.assertCurrentIdentity(file.path, before, "edit body of");
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
  assertCurrentIdentity(path, source, operation) {
    const uid = this.getIndex().notes.get(path)?.uid;
    if (!uid) throw new Error(`Cannot ${operation} ${path}: the note is not indexed with a durable uid.`);
    assertIndexedNoteUidMatchesSource(path, source, uid, operation);
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
  warmCachePreview: false,
  creatorSuffix: ""
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
    /** Context edits apply atomically; structural Local Model edits require service-enforced Review before Apply, new Local Model identities retry collisions at +1 ms, empty Object owners can create their first part occurrence directly, all current Local Model definitions use indexed model-note pickers, endpoint part assignment clears parent atomically, flow endpoint-role edits are staged, a flow can move between existing connections through one reviewed structural transaction without changing its identity, occurrence details expose the canonical reusable definition lazily, definition editing launched from an occurrence uses the canonical note editor with an explicit return to that occurrence, complete note/occurrence impact evidence is available, each used-definition mutation consumes one explicit impact review before Apply regardless of whether the canonical definition was opened from an occurrence or directly, direct canonical model notes expose the same Review impact entry point before edit mode, retirement/supersession/deletion lifecycle actions are available from any canonical reusable-definition view while retaining the same guarded lifecycle services, new reusable definitions have a pure governed creation planner, definition-note creation uses structural Review/Apply/Cancel with guarded history, creator identity is explicit, the definition creation service is bound to real vault storage plus shared semantic history, missing part/endpoint/flow definition workflows stage and visibly review both definition creation and occurrence binding before either Apply begins, a failed second-stage binding exposes a guarded rollback that can only undo the still-latest definition creation, destructive reusable-definition deletion is blocked by active references, deletion uses structural Review/Apply/Cancel with guarded history, the deletion service is bound to real vault storage plus fully hydrated impact evidence, non-destructive retirement is runtime-integrated, reusable-definition supersession is runtime-integrated with complete migration evidence and semantic link resolution prevents duplicate alternate-link relationships, guided Local Model migration verifies the expected old definition from fresh source before staging, the supersession UI supports one reviewed occurrence migration at a time, note-level guided migration has a relationship-safe planner and governed runtime service with forward- and inverse-authored paired relationship support, and paired migration fails closed on missing or duplicate inverse state instead of silently repairing it, and the supersession UI refreshes live dependent inventory after each reviewed occurrence or note migration so multiple migrations can continue in one session without stale candidates, while post-apply refresh failures are reported separately and never misstate a committed migration as unapplied; note migration also removes relationship properties that become empty instead of persisting empty arrays; lifecycle impact queries scan both forward- and inverse-authored governed relationships rather than only forward graph edges; supersession relationship writes also fail closed when any existing relationship target cannot be semantically resolved; shared governed relationship removal keeps frontmatter sparse by deleting a relationship property when its final target is removed; when supersession migration reaches zero remaining engineering dependents, the UI marks migration complete and may hand off to a separate governed retirement review without auto-retiring the replaced definition; lifecycle provenance relationships (supersedes/supersededBy) remain impact evidence but are excluded from migration candidates; retirement Apply revalidates the complete reviewed impact inventory and refuses stale evidence; destructive deletion keeps lifecycle provenance authoritative, so a superseded definition remains blocked from deletion while any supersedes/supersededBy reference still points to it; retirement redo also revalidates the reviewed dependency inventory so semantic history cannot reapply retirement after new dependents appear; supersession redo likewise revalidates the reviewed dependency inventory before restoring the paired lifecycle relationships; deletion redo also treats newly appeared lifecycle provenance as an active reference and refuses destructive replay; supersession undo relies on the unified chronological semantic-history stack, so newer migration edits must be undone before the supersession relationship pair can be removed; note-level paired relationship migration undo is atomic across all affected files and rolls back partial reverts on write failure; redo is likewise atomic and restores earlier files to the pre-redo state if a later paired-file write fails; guided occurrence migration carries a target-validity semantic guard so Apply and Redo refuse a missing replacement definition even when the owner note is otherwise unchanged; note-level migration also verifies replacement existence at Stage, Apply, and Redo, including one-way relationships where the replacement note is not otherwise part of the affected write set; governed definition creation undo revalidates complete lifecycle impact and refuses removal once active note or occurrence references exist; creation redo revalidates both destination-path availability and global UID uniqueness after undo, preventing semantic identity collision before recreating the canonical note; definition deletion undo likewise revalidates global UID uniqueness before restoring a deleted canonical definition, so external post-delete identity reuse cannot create duplicate durable identities; deletion Stage also validates the caller UID against the source note frontmatter before Review, preventing stale UI/index identity from opening a transaction for the wrong canonical definition; retirement Stage applies the same source-UID validation before Review; supersession Stage likewise validates both replaced and replacement UIDs against their canonical source YAML before opening Review, with regressions covering stale identity on either side of the pair; supersession class compatibility and replacement retirement warning are derived from those fresh source notes rather than cached caller type/status; note-level relationship migration Stage validates owner, replaced, and replacement UIDs against fresh canonical source YAML before Review, and pins replacement UID through Apply/Redo even for one-way relationships where the replacement note is not otherwise in the affected write set; staged structural Local Model patches validate indexed owner UID against the freshly read owner note before Review, closing the same stale-identity gap for occurrence migration; structural Local Model create, flow-move, and delete transactions now use the same fresh owner-UID proof before Review, and the immediate atomic Local Model patch path uses that same assertion before writing; the immediate atomic Local Model patch path uses that same source-identity assertion before writing, with explicit regression coverage. the immediate atomic Local Model patch path also validates indexed owner UID against fresh source before writing, so every Local Model edit entry point shares the same owner-identity invariant; occurrence migration also pins the indexed replacement definition UID and revalidates that UID against fresh source YAML at Stage and through the Apply/Redo semantic guard, so in-place path identity swaps fail closed; direct occurrence definition binding now uses the same durable-UID pinning and semantic-guard path, with shared regression coverage proving the guard runs on both Apply and Redo. */
    this.modelEditor = null;
    /** Canonical reusable-definition creation shares the same semantic transaction history. */
    this.definitionCreator = null;
    /** Destructive definition deletion is governed by complete impact evidence and shared history. */
    this.definitionDeleter = null;
    /** Non-destructive retirement shares complete impact evidence and semantic history. */
    this.definitionRetirer = null;
    /** Supersession records replacement intent while leaving dependent migration explicit. */
    this.definitionSuperseder = null;
    /** Guided note-level supersession migration preserves relationship pairing in one transaction. */
    this.definitionNoteMigrator = null;
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
      pickView: (path) => this.pickView(path),
      definitionImpact: (path) => this.definitionImpact(path),
      stageDefinitionCreation: (kind, name, path) => this.stageDefinitionCreation(kind, name, path),
      applyDefinitionCreation: (transactionId) => this.applyDefinitionCreation(transactionId),
      cancelDefinitionCreation: (transactionId) => this.cancelDefinitionCreation(transactionId),
      rollbackDefinitionCreation: (transactionId) => this.rollbackDefinitionCreation(transactionId),
      stageDefinitionDeletion: (path, uid) => this.stageDefinitionDeletion(path, uid),
      applyDefinitionDeletion: (transactionId) => this.applyDefinitionDeletion(transactionId),
      cancelDefinitionDeletion: (transactionId) => this.cancelDefinitionDeletion(transactionId),
      stageDefinitionRetirement: (path, uid) => this.stageDefinitionRetirement(path, uid),
      applyDefinitionRetirement: (transactionId) => this.applyDefinitionRetirement(transactionId),
      cancelDefinitionRetirement: (transactionId) => this.cancelDefinitionRetirement(transactionId),
      stageDefinitionSupersession: (replacedPath, replacedUid, replacedType, replacementPath) => this.stageDefinitionSupersession(replacedPath, replacedUid, replacedType, replacementPath),
      applyDefinitionSupersession: (transactionId) => this.applyDefinitionSupersession(transactionId),
      cancelDefinitionSupersession: (transactionId) => this.cancelDefinitionSupersession(transactionId),
      stageDefinitionOccurrenceMigration: (ownerPath, localId, replacedPath, replacementPath) => this.stageDefinitionOccurrenceMigration(ownerPath, localId, replacedPath, replacementPath),
      applyDefinitionOccurrenceMigration: (transactionId) => this.applyOccurrenceDefinitionBinding(transactionId),
      cancelDefinitionOccurrenceMigration: (transactionId) => this.cancelOccurrenceDefinitionBinding(transactionId),
      stageDefinitionNoteMigration: (ownerPath, field, replacedPath, replacementPath) => this.stageDefinitionNoteMigration(ownerPath, field, replacedPath, replacementPath),
      definitionSupersessionMigrationCandidates: (replacedPath) => this.definitionSupersessionMigrationCandidates(replacedPath),
      applyDefinitionNoteMigration: (transactionId) => this.applyDefinitionNoteMigration(transactionId),
      cancelDefinitionNoteMigration: (transactionId) => this.cancelDefinitionNoteMigration(transactionId),
      stageOccurrenceDefinitionBinding: (ownerPath, localId, definitionPath) => this.stageOccurrenceDefinitionBinding(ownerPath, localId, definitionPath),
      applyOccurrenceDefinitionBinding: (transactionId) => this.applyOccurrenceDefinitionBinding(transactionId),
      cancelOccurrenceDefinitionBinding: (transactionId) => this.cancelOccurrenceDefinitionBinding(transactionId)
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
  definitionUidInUse(uid) {
    const indexer = this.indexer;
    if (indexer) {
      for (const note of indexer.index.notes.values()) if (note.uid === uid) return true;
    }
    for (const file of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
      if (fm?.uid === uid) return true;
    }
    return false;
  }
  stageDefinitionCreation(kind, name, path) {
    const creator = this.definitionCreator;
    if (!creator || !this.isReady()) throw new Error("Workbench is still starting.");
    const suffix = normalizeAuthorSuffix(this.settings.creatorSuffix);
    const uid = nextAvailableDefinitionUid(suffix, (candidate) => this.definitionUidInUse(candidate));
    return creator.stageAndReview({ localKind: kind, name, uid, path });
  }
  async applyDefinitionCreation(transactionId) {
    const creator = this.definitionCreator;
    if (!creator) throw new Error("Definition creation is unavailable.");
    await creator.apply(transactionId);
  }
  cancelDefinitionCreation(transactionId) {
    const creator = this.definitionCreator;
    if (!creator) throw new Error("Definition creation is unavailable.");
    creator.cancel(transactionId);
  }
  async rollbackDefinitionCreation(transactionId) {
    const creator = this.definitionCreator;
    if (!creator) throw new Error("Definition creation is unavailable.");
    await creator.rollbackApplied(transactionId);
  }
  async stageDefinitionDeletion(path, uid) {
    const deleter = this.definitionDeleter;
    if (!deleter || !this.isReady()) throw new Error("Definition deletion is unavailable while Workbench is starting.");
    return deleter.stageAndReview((0, import_obsidian8.normalizePath)(path), uid);
  }
  async applyDefinitionDeletion(transactionId) {
    const deleter = this.definitionDeleter;
    if (!deleter) throw new Error("Definition deletion is unavailable.");
    await deleter.apply(transactionId);
  }
  cancelDefinitionDeletion(transactionId) {
    const deleter = this.definitionDeleter;
    if (!deleter) throw new Error("Definition deletion is unavailable.");
    deleter.cancel(transactionId);
  }
  async stageDefinitionRetirement(path, uid) {
    const retirer = this.definitionRetirer;
    if (!retirer || !this.isReady()) throw new Error("Definition retirement is unavailable while Workbench is starting.");
    return retirer.stageAndReview((0, import_obsidian8.normalizePath)(path), uid);
  }
  async applyDefinitionRetirement(transactionId) {
    const retirer = this.definitionRetirer;
    if (!retirer) throw new Error("Definition retirement is unavailable.");
    await retirer.apply(transactionId);
  }
  cancelDefinitionRetirement(transactionId) {
    const retirer = this.definitionRetirer;
    if (!retirer) throw new Error("Definition retirement is unavailable.");
    retirer.cancel(transactionId);
  }
  async stageDefinitionSupersession(replacedPath, replacedUid, replacedType, replacementPath) {
    const superseder = this.definitionSuperseder;
    const indexer = this.indexer;
    if (!superseder || !indexer || !this.isReady()) throw new Error("Definition supersession is unavailable while Workbench is starting.");
    const replacement = indexer.index.notes.get((0, import_obsidian8.normalizePath)(replacementPath));
    if (!replacement?.uid || !replacement.type) throw new Error("Replacement must be an indexed model definition with type and uid.");
    if (replacement.type !== replacedType) throw new Error(`Replacement must be the same model class (${replacedType}).`);
    const file = this.app.vault.getAbstractFileByPath(replacement.path);
    if (!(file instanceof import_obsidian8.TFile)) throw new Error("Replacement definition no longer exists.");
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
    const replacementStatus = typeof fm?.status === "string" ? fm.status : null;
    return superseder.stageAndReview({
      replacedPath: (0, import_obsidian8.normalizePath)(replacedPath),
      replacedUid,
      replacedType,
      replacementPath: replacement.path,
      replacementUid: replacement.uid,
      replacementType: replacement.type,
      replacementStatus
    });
  }
  async applyDefinitionSupersession(transactionId) {
    const superseder = this.definitionSuperseder;
    if (!superseder) throw new Error("Definition supersession is unavailable.");
    await superseder.apply(transactionId);
  }
  cancelDefinitionSupersession(transactionId) {
    const superseder = this.definitionSuperseder;
    if (!superseder) throw new Error("Definition supersession is unavailable.");
    superseder.cancel(transactionId);
  }
  async stageDefinitionOccurrenceMigration(ownerPath, localId, replacedPath, replacementPath) {
    const editor = this.modelEditor;
    const indexer = this.indexer;
    if (!editor || !indexer) throw new Error("Workbench is still starting.");
    const normalizedOwner = (0, import_obsidian8.normalizePath)(ownerPath);
    const ownerFile = this.app.vault.getAbstractFileByPath(normalizedOwner);
    if (!(ownerFile instanceof import_obsidian8.TFile)) throw new Error(`${normalizedOwner} no longer exists.`);
    const source = await this.app.vault.read(ownerFile);
    const local = parseLocalModel(source);
    const record = local?.records.find((candidate) => candidate.localId === localId);
    if (!record) throw new Error(`Occurrence ^${localId} no longer exists in ${normalizedOwner}.`);
    const currentDefinitionPath = record.definition?.target ? this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(record.definition.target), normalizedOwner)?.path ?? null : null;
    const plan = planDefinitionOccurrenceMigration({
      ownerPath: normalizedOwner,
      localId,
      currentDefinitionPath,
      replacedPath: (0, import_obsidian8.normalizePath)(replacedPath),
      replacementPath: (0, import_obsidian8.normalizePath)(replacementPath)
    });
    const normalizedReplacement = (0, import_obsidian8.normalizePath)(replacementPath);
    const indexedReplacement = indexer.index.notes.get(normalizedReplacement);
    if (!indexedReplacement?.uid) {
      throw new Error(`${normalizedReplacement} is not an indexed model definition with a durable uid.`);
    }
    const replacementUid = indexedReplacement.uid;
    const replacementFile = this.app.vault.getAbstractFileByPath(normalizedReplacement);
    if (!(replacementFile instanceof import_obsidian8.TFile)) throw new Error(`${normalizedReplacement} no longer exists.`);
    const validateReplacementIdentity = async () => {
      const currentReplacement = this.app.vault.getAbstractFileByPath(normalizedReplacement);
      if (!(currentReplacement instanceof import_obsidian8.TFile)) {
        throw new Error(`${normalizedReplacement} no longer exists; reopen supersession migration review.`);
      }
      const text = await this.app.vault.read(currentReplacement);
      assertDefinitionSourceUid(text, normalizedReplacement, replacementUid);
    };
    await validateReplacementIdentity();
    return editor.stageAndReviewLocalRecordPatch(
      normalizedOwner,
      localId,
      { fields: { definition: plan.definitionLink } },
      validateReplacementIdentity
    );
  }
  async definitionSupersessionMigrationCandidates(replacedPath) {
    const impact = await this.definitionDeletionImpact((0, import_obsidian8.normalizePath)(replacedPath));
    return definitionMigrationCandidates(impact);
  }
  async stageDefinitionNoteMigration(ownerPath, field, replacedPath, replacementPath) {
    const migrator = this.definitionNoteMigrator;
    const schema4 = this.schema;
    const indexer = this.indexer;
    if (!migrator || !schema4 || !indexer || !this.isReady()) {
      throw new Error("Definition relationship migration is unavailable while Workbench is starting.");
    }
    const relationship = schema4.byField.get(field) ?? schema4.byInverse.get(field);
    if (!relationship) throw new Error(`${field} is not a governed relationship field.`);
    const normalizedOwner = (0, import_obsidian8.normalizePath)(ownerPath);
    const normalizedReplaced = (0, import_obsidian8.normalizePath)(replacedPath);
    const normalizedReplacement = (0, import_obsidian8.normalizePath)(replacementPath);
    const owner = indexer.index.notes.get(normalizedOwner);
    const replaced = indexer.index.notes.get(normalizedReplaced);
    const replacement = indexer.index.notes.get(normalizedReplacement);
    if (!owner) throw new Error(`${normalizedOwner} is not an indexed model note.`);
    if (!replaced) throw new Error(`${normalizedReplaced} is not an indexed model definition.`);
    if (!replacement) throw new Error(`${normalizedReplacement} is not an indexed model definition.`);
    return migrator.stageAndReview({
      ownerPath: normalizedOwner,
      ownerUid: owner.uid,
      field,
      replacedPath: normalizedReplaced,
      replacedUid: replaced.uid,
      replacementPath: normalizedReplacement,
      replacementUid: replacement.uid,
      relationship
    });
  }
  async applyDefinitionNoteMigration(transactionId) {
    const migrator = this.definitionNoteMigrator;
    if (!migrator) throw new Error("Definition relationship migration is unavailable.");
    await migrator.apply(transactionId);
  }
  cancelDefinitionNoteMigration(transactionId) {
    const migrator = this.definitionNoteMigrator;
    if (!migrator) throw new Error("Definition relationship migration is unavailable.");
    migrator.cancel(transactionId);
  }
  async stageOccurrenceDefinitionBinding(ownerPath, localId, definitionPath) {
    const editor = this.modelEditor;
    const indexer = this.indexer;
    if (!editor || !indexer) throw new Error("Workbench is still starting.");
    const normalized = (0, import_obsidian8.normalizePath)(definitionPath);
    const indexedDefinition = indexer.index.notes.get(normalized);
    if (!indexedDefinition?.uid) {
      throw new Error(`${normalized} is not an indexed model definition with a durable uid.`);
    }
    const definitionUid = indexedDefinition.uid;
    const validateDefinitionIdentity = async () => {
      const file = this.app.vault.getAbstractFileByPath(normalized);
      if (!(file instanceof import_obsidian8.TFile)) {
        throw new Error(`${normalized} no longer exists; reopen occurrence definition review.`);
      }
      const text = await this.app.vault.read(file);
      assertDefinitionSourceUid(text, normalized, definitionUid);
    };
    await validateDefinitionIdentity();
    const definitionLink = `[[${normalized.replace(/\.md$/i, "")}]]`;
    return editor.stageAndReviewLocalRecordPatch(
      ownerPath,
      localId,
      { fields: { definition: definitionLink } },
      validateDefinitionIdentity
    );
  }
  async applyOccurrenceDefinitionBinding(transactionId) {
    const editor = this.modelEditor;
    if (!editor) throw new Error("Workbench is still starting.");
    await editor.applyLocalPatch(transactionId);
  }
  cancelOccurrenceDefinitionBinding(transactionId) {
    const editor = this.modelEditor;
    if (!editor) throw new Error("Workbench is still starting.");
    editor.cancelLocalPatch(transactionId);
  }
  async definitionDeletionImpact(path) {
    const indexer = this.indexer;
    if (!indexer || !this.isReady()) throw new Error("Workbench is still starting.");
    await indexer.whenSourceSettled();
    await indexer.whenLocalSettled(true);
    const normalized = (0, import_obsidian8.normalizePath)(path);
    const noteUses = indexer.index.authoredUsesOf(normalized).map((use) => ({
      fromPath: use.from,
      field: use.field
    }));
    const occurrenceUses = indexer.local.occurrencesOf(
      normalized,
      (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path
    ).map(({ path: ownerPath, record }) => ({
      ownerPath,
      localId: record.localId,
      kind: record.kind,
      identifier: record.identifier
    }));
    return { definitionPath: normalized, noteUses, occurrenceUses };
  }
  async definitionImpact(path) {
    const indexer = this.indexer;
    if (!indexer || !this.isReady()) throw new Error("Workbench is still starting.");
    await indexer.whenSourceSettled();
    await indexer.whenLocalSettled(true);
    const noteUses = indexer.index.authoredUsesOf(path).slice().sort(
      (a, b) => a.from.localeCompare(b.from) || a.field.localeCompare(b.field)
    );
    const occurrences = indexer.local.occurrencesOf(
      path,
      (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest(target, fromPath)?.path
    ).sort(
      (a, b) => a.path.localeCompare(b.path) || a.record.kind.localeCompare(b.record.kind) || a.record.identifier.localeCompare(b.record.identifier)
    );
    const rows = [];
    if (noteUses.length) {
      rows.push("Note-level uses:");
      for (const use of noteUses) {
        const source = indexer.index.notes.get(use.from);
        rows.push(`- ${source?.name ?? use.from} \u2014 ${use.field}`);
      }
    }
    if (occurrences.length) {
      if (rows.length) rows.push("");
      rows.push("Local Model occurrences:");
      for (const occurrence of occurrences) {
        const owner = indexer.index.notes.get(occurrence.path);
        rows.push(`- ${owner?.name ?? occurrence.path} \u2014 ${occurrence.record.kind} ${occurrence.record.identifier} (^${occurrence.record.localId})`);
      }
    }
    return { rows, notes: noteUses.length, occurrences: occurrences.length };
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
    const schema4 = this.schema;
    const indexer = this.indexer;
    if (!schema4 || !indexer || indexer.building || !indexer.stats || indexer.revision === this.lastCachedRevision) return;
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
        schema4,
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
    const schema4 = this.schema;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema4);
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
      this.definitionCreator = new DefinitionCreationService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath((0, import_obsidian8.normalizePath)(path)) !== null,
          read: async (path) => this.app.vault.read(localFile((0, import_obsidian8.normalizePath)(path))),
          create: async (path, text) => {
            const normalized = (0, import_obsidian8.normalizePath)(path);
            if (this.app.vault.getAbstractFileByPath(normalized)) throw new Error(normalized + " already exists.");
            await this.app.vault.create(normalized, text);
          },
          remove: async (path) => {
            const normalized = (0, import_obsidian8.normalizePath)(path);
            const file = this.app.vault.getAbstractFileByPath(normalized);
            if (!(file instanceof import_obsidian8.TFile)) throw new Error(normalized + " no longer exists.");
            await this.app.vault.delete(file);
          }
        },
        (uid) => this.definitionUidInUse(uid),
        this.transactions,
        (path) => this.definitionDeletionImpact(path)
      );
      this.definitionDeleter = new DefinitionDeletionService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath((0, import_obsidian8.normalizePath)(path)) !== null,
          read: async (path) => this.app.vault.read(localFile((0, import_obsidian8.normalizePath)(path))),
          remove: async (path) => {
            const normalized = (0, import_obsidian8.normalizePath)(path);
            const file = this.app.vault.getAbstractFileByPath(normalized);
            if (!(file instanceof import_obsidian8.TFile)) throw new Error(normalized + " no longer exists.");
            await this.app.vault.delete(file);
          },
          create: async (path, text) => {
            const normalized = (0, import_obsidian8.normalizePath)(path);
            if (this.app.vault.getAbstractFileByPath(normalized)) throw new Error(normalized + " already exists.");
            await this.app.vault.create(normalized, text);
          }
        },
        (path) => this.definitionDeletionImpact(path),
        this.transactions,
        (uid) => this.definitionUidInUse(uid)
      );
      this.definitionRetirer = new DefinitionRetirementService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath((0, import_obsidian8.normalizePath)(path)) !== null,
          read: async (path) => this.app.vault.read(localFile((0, import_obsidian8.normalizePath)(path))),
          write: async (path, text) => this.app.vault.modify(localFile((0, import_obsidian8.normalizePath)(path)), text)
        },
        (path) => this.definitionDeletionImpact(path),
        this.transactions
      );
      this.definitionSuperseder = new DefinitionSupersessionService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath((0, import_obsidian8.normalizePath)(path)) !== null,
          read: async (path) => this.app.vault.read(localFile((0, import_obsidian8.normalizePath)(path))),
          write: async (path, text) => this.app.vault.modify(localFile((0, import_obsidian8.normalizePath)(path)), text)
        },
        (path) => this.definitionDeletionImpact(path),
        (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), (0, import_obsidian8.normalizePath)(fromPath))?.path ?? null,
        (targetPath, fromPath) => {
          const file = localFile((0, import_obsidian8.normalizePath)(targetPath));
          return this.app.metadataCache.fileToLinktext(file, (0, import_obsidian8.normalizePath)(fromPath), true);
        },
        this.transactions
      );
      this.definitionNoteMigrator = new DefinitionNoteMigrationService(
        {
          exists: async (path) => this.app.vault.getAbstractFileByPath((0, import_obsidian8.normalizePath)(path)) !== null,
          read: async (path) => this.app.vault.read(localFile((0, import_obsidian8.normalizePath)(path))),
          write: async (path, text) => this.app.vault.modify(localFile((0, import_obsidian8.normalizePath)(path)), text)
        },
        (target, fromPath) => this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian8.getLinkpath)(target), (0, import_obsidian8.normalizePath)(fromPath))?.path ?? null,
        (targetPath, fromPath) => {
          const file = localFile((0, import_obsidian8.normalizePath)(targetPath));
          return this.app.metadataCache.fileToLinktext(file, (0, import_obsidian8.normalizePath)(fromPath), true);
        },
        this.transactions
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
      this.indexer.setSchema(schema4);
    }
    const indexer = this.indexer;
    if (!indexer) return;
    let stats = null;
    if (firstStart && !rebuild && this.settings.warmCachePreview) {
      try {
        this.setRuntimeStatus("restoring");
        const scope = { vaultUid: await this.loadVaultUid() };
        const cache = await readCoreCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
        const restored = restoreCoreSemanticState(cache, schema4, scope);
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
    if (rebuild || schema4.warnings.length) {
      new import_obsidian8.Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1e3).toFixed(1)} s${schema4.warnings.length ? `; ${schema4.warnings.length} schema warning(s), see diagnostics` : ""}.`);
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
    const schema4 = this.schema;
    const indexer = this.indexer;
    if (!schema4 || !indexer) {
      new import_obsidian8.Notice("MDSE Workbench has not loaded the model schemas yet.");
      return;
    }
    try {
      const scope = { vaultUid: await this.loadVaultUid() };
      const cache = await readSemanticCacheGeneration(new ObsidianCacheStorage(this.app), WORKBENCH_CACHE_ROOT);
      const restored = restoreSemanticState(cache, schema4, scope);
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
    const schema4 = this.schema;
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
      ["relationships.yaml", schema4.relationshipsVersion],
      ["element-types.yaml", schema4.elementTypesVersion],
      ["Editing", editingBlocked(schema4) ? "off (schema too old)" : "on", editingBlocked(schema4)],
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
    new ReportModal(this.app, "MDSE Workbench diagnostics", rows, schema4.warnings).open();
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
      const list2 = nodes instanceof Map ? [...nodes.values()] : Array.isArray(nodes) ? nodes : [];
      const node = list2.find((n) => n?.nodeEl === cardEl);
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
    new import_obsidian8.Setting(containerEl).setName("Creator UID suffix").setDesc("13 ASCII letters used for new governed note UIDs, typically normalized last name + first name. Example: skellyspencer. Workbench will not create reusable definitions until this is valid.").addText(
      (t) => t.setValue(this.plugin.settings.creatorSuffix).onChange(async (v) => {
        this.plugin.settings.creatorSuffix = v.replace(/[^A-Za-z]/g, "").toLowerCase();
        await this.plugin.saveAll();
      })
    );
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
