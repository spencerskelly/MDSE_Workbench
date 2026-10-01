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
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
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
var import_obsidian5 = require("obsidian");

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

// src/core/views.ts
var STRUCTURE_PROFILE = {
  name: "Structure",
  steps: [
    { field: "hasPart", direction: "out" },
    { field: "hasChild", direction: "out" },
    { field: "includes", direction: "out" },
    { field: "hasPort", direction: "out" },
    { field: "exposes", direction: "out" },
    { field: "hasFlow", direction: "out" }
  ],
  depth: 2,
  nodeCap: 150
};
function traverse(index, starts, profile) {
  const nameOf = (p) => index.notes.get(p)?.name ?? p;
  const depthOf = /* @__PURE__ */ new Map();
  const omitted = /* @__PURE__ */ new Map();
  let capReached = false;
  let frontier = [...new Set(starts)].filter((s) => index.notes.has(s));
  for (const s of frontier) depthOf.set(s, 0);
  const neighbours = (p) => {
    const seen = /* @__PURE__ */ new Set();
    const out = [];
    for (const step of profile.steps) {
      const edges2 = step.direction === "out" ? index.out(p) : index.in(p);
      const next = edges2.filter((e) => e.field === step.field).map((e) => step.direction === "out" ? e.to : e.from).filter((n) => index.notes.has(n) && !seen.has(n)).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
      for (const n of next) {
        seen.add(n);
        out.push(n);
      }
    }
    return out;
  };
  for (let d = 0; d < profile.depth && frontier.length; d++) {
    const next = [];
    for (const p of frontier) {
      for (const n of neighbours(p)) {
        if (depthOf.has(n)) continue;
        if (depthOf.size >= profile.nodeCap) {
          capReached = true;
          omitted.set(p, (omitted.get(p) ?? 0) + 1);
          continue;
        }
        depthOf.set(n, d + 1);
        next.push(n);
      }
    }
    frontier = next;
  }
  for (const p of frontier) {
    const beyond = neighbours(p).filter((n) => !depthOf.has(n)).length;
    if (beyond) omitted.set(p, (omitted.get(p) ?? 0) + beyond);
  }
  const fields = new Set(profile.steps.map((s) => s.field));
  const edges = [];
  for (const p of depthOf.keys()) {
    for (const e of index.out(p)) {
      if (fields.has(e.field) && depthOf.has(e.to)) edges.push(e);
    }
  }
  return { profile: profile.name, starts: [...depthOf.keys()].filter((p) => depthOf.get(p) === 0), depthOf, edges, omitted, capReached };
}
function signature(view) {
  const nodes = [...view.depthOf.keys()].sort().join("\n");
  const edges = view.edges.map((e) => `${e.from}|${e.field}|${e.to}`).sort().join("\n");
  let h = 2166136261;
  for (const ch of `${view.profile}
${nodes}
${edges}`) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}
var NODE_W = 360;
var NODE_H = 90;
var COL_GAP = 140;
var ROW_GAP = 30;
var MAX_ROWS = 20;
function toCanvas(index, view) {
  const nameOf = (p) => index.notes.get(p)?.name ?? p;
  const layers = /* @__PURE__ */ new Map();
  for (const [p, d] of view.depthOf) {
    let l = layers.get(d);
    if (!l) layers.set(d, l = []);
    l.push(p);
  }
  const nodes = [];
  const idOf = /* @__PURE__ */ new Map();
  let x = 0;
  for (const d of [...layers.keys()].sort((a, b) => a - b)) {
    const members = (layers.get(d) ?? []).sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
    const cols = Math.max(1, Math.ceil(members.length / MAX_ROWS));
    members.forEach((p, i) => {
      const id = `n${nodes.length}`;
      idOf.set(p, id);
      nodes.push({
        id,
        type: "file",
        file: p,
        x: x + Math.floor(i / MAX_ROWS) * (NODE_W + COL_GAP / 2),
        y: i % MAX_ROWS * (NODE_H + ROW_GAP),
        width: NODE_W,
        height: NODE_H,
        color: d === 0 ? "4" : void 0
      });
    });
    x += cols * (NODE_W + COL_GAP / 2) + COL_GAP;
  }
  const edges = view.edges.map((e, i) => ({
    id: `e${i}`,
    fromNode: idOf.get(e.from),
    toNode: idOf.get(e.to),
    fromSide: "right",
    toSide: "left",
    label: e.field
  }));
  for (const [p, n] of [...view.omitted].sort((a, b) => nameOf(a[0]).localeCompare(nameOf(b[0])))) {
    const owner = nodes.find((nd) => nd.id === idOf.get(p));
    if (!owner) continue;
    const id = `o${nodes.length}`;
    nodes.push({
      id,
      type: "text",
      text: `${n} more not shown`,
      x: owner.x + NODE_W + 40,
      y: owner.y + NODE_H + 10,
      width: 200,
      height: 50,
      color: "3"
    });
    edges.push({ id: `e${edges.length}`, fromNode: owner.id, toNode: id, fromSide: "bottom", toSide: "left" });
  }
  return { nodes, edges };
}

// src/obsidian/indexer.ts
var import_obsidian = require("obsidian");

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
    const f = { missingInverse: [], orphanInverse: [], offRule: [], provisional: [], unresolvedLinks: 0 };
    for (const rec of this.notes.values()) {
      f.unresolvedLinks += rec.unresolved;
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

// src/obsidian/indexer.ts
var CHUNK = 500;
var BURST_REBUILD = 300;
var QUIET_MS = 3e3;
var Indexer = class {
  constructor(app, schema) {
    this.app = app;
    this.schema = schema;
    this.stats = null;
    this.running = null;
    this.dirty = /* @__PURE__ */ new Set();
    this.burst = 0;
    this.burstStarted = 0;
    this.timer = null;
    this.index = new ModelIndex(schema);
  }
  get building() {
    return this.running !== null;
  }
  setSchema(schema) {
    this.schema = schema;
  }
  record(file) {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return null;
    const fields = /* @__PURE__ */ new Map();
    let unresolved = 0;
    for (const fl of cache.frontmatterLinks ?? []) {
      const field = fl.key.split(".")[0];
      if (!this.schema.byField.has(field) && !this.schema.byInverse.has(field)) continue;
      const dest = this.app.metadataCache.getFirstLinkpathDest((0, import_obsidian.getLinkpath)(fl.link), file.path);
      if (!dest) {
        unresolved++;
        continue;
      }
      let list = fields.get(field);
      if (!list) fields.set(field, list = []);
      if (!list.includes(dest.path)) list.push(dest.path);
    }
    const str = (v) => v === void 0 || v === null || v === "" ? void 0 : String(v);
    return { path: file.path, name: file.basename, type: str(fm.type), id: str(fm.id), uid: str(fm.uid), fields, unresolved };
  }
  /** Builds the index; a second call while building returns the same promise. */
  build() {
    if (!this.running) this.running = this.doBuild().finally(() => this.running = null);
    return this.running;
  }
  async doBuild() {
    const t0 = performance.now();
    const index = new ModelIndex(this.schema);
    const files = this.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
      const rec = this.record(files[i]);
      if (rec) index.upsert(rec);
      if (i % CHUNK === CHUNK - 1) await new Promise((r) => window.setTimeout(r, 0));
    }
    this.index = index;
    const backlog = this.dirty.size;
    if (backlog <= CHUNK) for (const path of this.dirty) this.apply(path);
    this.dirty.clear();
    if (backlog > CHUNK) this.scheduleRebuild();
    this.burst = 0;
    let elements = 0;
    for (const r of index.notes.values()) if (index.isElement(r)) elements++;
    this.stats = {
      files: files.length,
      notes: index.size,
      elements,
      links: index.edgeCount(),
      ms: Math.round(performance.now() - t0),
      builtAt: Date.now()
    };
    return this.stats;
  }
  apply(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    const rec = f instanceof import_obsidian.TFile ? this.record(f) : null;
    if (rec) this.index.upsert(rec);
    else this.index.remove(path);
  }
  /** One file changed or was created. Cheap; never starts a build directly. */
  changed(path) {
    if (!this.stats || this.running) {
      this.dirty.add(path);
      return;
    }
    this.apply(path);
    const now = Date.now();
    if (now - this.burstStarted > 1e4) {
      this.burstStarted = now;
      this.burst = 0;
    }
    if (++this.burst >= BURST_REBUILD) this.scheduleRebuild();
  }
  removed(path) {
    this.changed(path);
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
  }
};

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
    ["Selected notes now", String(selectedFiles(c).length)]
  ];
  return rows;
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

// src/obsidian/writer.ts
var import_obsidian4 = require("obsidian");

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
function addLink(fm, field, target) {
  const list = asList(fm[field]);
  if (list.some((v) => linkTarget(v)?.toLowerCase() === target.toLowerCase())) return false;
  list.push(`[[${target}]]`);
  fm[field] = sortLinks(list);
  return true;
}
function removeLink(fm, field, target) {
  const list = asList(fm[field]);
  const kept = list.filter((v) => linkTarget(v)?.toLowerCase() !== target.toLowerCase());
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
  return [...common, ...rel];
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
var RelationshipWriter = class {
  constructor(app, getSchema, getIndex) {
    this.app = app;
    this.getSchema = getSchema;
    this.getIndex = getIndex;
    this.undoStack = [];
  }
  file(path) {
    const f = this.app.vault.getAbstractFileByPath(path);
    if (!(f instanceof import_obsidian4.TFile)) throw new Error(`${path} no longer exists.`);
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
        changed = addLink(fm, field, linkTo.basename);
        if (changed) orderProperties(fm, order);
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };
    await edit(owner, def.field, target);
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);
    if (tx.files.length) this.undoStack.push(tx);
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
        changed = removeLink(fm, field, linkTo.basename);
      });
      if (changed) tx.files.push({ path: file.path, before, after: await this.app.vault.read(file) });
    };
    await edit(owner, def.field, target);
    const back = def.kind === "symmetric" ? def.field : def.inverse;
    if (back) await edit(target, back, owner);
    if (tx.files.length) this.undoStack.push(tx);
    return tx;
  }
  get canUndo() {
    return this.undoStack.length > 0;
  }
  /**
   * Undo the last transaction, but only if no note in it changed since (WB-086).
   * Nothing is written unless every file still matches.
   */
  async undo() {
    const tx = this.undoStack[this.undoStack.length - 1];
    if (!tx) return "Nothing to undo.";
    for (const s of tx.files) {
      const current = await this.app.vault.read(this.file(s.path));
      if (current !== s.after) {
        this.undoStack.pop();
        return `Not undone: ${s.path} changed after "${tx.label}". Fix it by hand or from Git history.`;
      }
    }
    for (const s of tx.files) await this.app.vault.modify(this.file(s.path), s.before);
    this.undoStack.pop();
    return `Undone: ${tx.label}.`;
  }
};

// src/main.ts
var DEFAULTS = {
  relationshipsPath: "99_System/03_Schemas/relationships.yaml",
  elementTypesPath: "99_System/03_Schemas/element-types.yaml",
  viewsFolder: "Workbench Views",
  canvasProbe: true
};
var MdseWorkbench = class extends import_obsidian5.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULTS };
    this.views = {};
    this.schema = null;
    this.indexer = null;
    this.writer = null;
    this.lastFindingsMs = 0;
  }
  async onload() {
    const stored = await this.loadData() ?? {};
    this.settings = { ...DEFAULTS, ...stored.settings ?? {} };
    this.views = stored.views ?? {};
    this.addSettingTab(new WorkbenchSettings(this.app, this));
    this.addCommand({ id: "diagnostics", name: "Show diagnostics", callback: () => this.diagnostics() });
    this.addCommand({ id: "rebuild-index", name: "Rebuild index", callback: () => this.start(true) });
    this.addCommand({
      id: "explore-structure",
      name: "Explore structure of current note",
      checkCallback: (checking) => this.withActive(checking, (f) => this.explore([f.path]))
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
    this.addCommand({ id: "undo", name: "Undo last relationship change", callback: () => this.undo() });
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
    this.app.workspace.onLayoutReady(() => void this.start(false));
  }
  async saveAll() {
    await this.saveData({ settings: this.settings, views: this.views });
  }
  withActive(checking, run) {
    const f = this.app.workspace.getActiveFile();
    if (!f || f.extension !== "md") return false;
    if (!checking) run(f);
    return true;
  }
  async loadSchema() {
    const read = async (p) => (0, import_obsidian5.parseYaml)(await this.app.vault.adapter.read((0, import_obsidian5.normalizePath)(p)));
    return parseSchema(await read(this.settings.relationshipsPath), await read(this.settings.elementTypesPath));
  }
  /** Load schema, build the index, then follow vault changes (WB-033, WB-086). */
  async start(rebuild) {
    try {
      this.schema = await this.loadSchema();
    } catch (e) {
      new import_obsidian5.Notice(`MDSE Workbench: could not read the schema files. ${e.message} Check the paths in settings.`);
      return;
    }
    const schema = this.schema;
    if (!this.indexer) {
      this.indexer = new Indexer(this.app, schema);
      this.writer = new RelationshipWriter(this.app, () => this.schema, () => this.indexer.index);
      const schemaPaths = () => [(0, import_obsidian5.normalizePath)(this.settings.relationshipsPath), (0, import_obsidian5.normalizePath)(this.settings.elementTypesPath)];
      this.registerEvent(
        this.app.metadataCache.on("changed", (file) => {
          if (!schemaPaths().includes(file.path)) this.indexer?.changed(file.path);
        })
      );
      this.registerEvent(this.app.vault.on("delete", (f) => this.indexer?.removed(f.path)));
      this.registerEvent(
        this.app.vault.on("rename", (f, old) => {
          this.indexer?.removed(old);
          this.indexer?.changed(f.path);
        })
      );
      this.registerEvent(
        this.app.vault.on("modify", (f) => {
          if (schemaPaths().includes(f.path)) void this.start(true);
        })
      );
      this.register(() => this.indexer?.dispose());
      await new Promise((res) => {
        const ref = this.app.metadataCache.on("resolved", () => {
          this.app.metadataCache.offref(ref);
          res();
        });
        window.setTimeout(() => {
          this.app.metadataCache.offref(ref);
          res();
        }, 5e3);
      });
      new import_obsidian5.Notice("MDSE Workbench: indexing the vault. Diagnostics are available when it finishes.");
    } else {
      this.indexer.setSchema(schema);
    }
    const stats = await this.indexer.build();
    if (rebuild || schema.warnings.length) {
      new import_obsidian5.Notice(`MDSE Workbench: indexed ${stats.elements} model notes in ${(stats.ms / 1e3).toFixed(1)} s${schema.warnings.length ? `; ${schema.warnings.length} schema warning(s), see diagnostics` : ""}.`);
    }
  }
  ready() {
    if (!this.schema || !this.indexer || this.indexer.building || !this.indexer.stats) {
      new import_obsidian5.Notice("MDSE Workbench is still indexing. Try again in a moment.");
      return false;
    }
    return true;
  }
  diagnostics() {
    if (!this.ready()) return;
    const s = this.indexer.stats;
    const schema = this.schema;
    const t0 = performance.now();
    const f = this.indexer.index.findings();
    this.lastFindingsMs = Math.round(performance.now() - t0);
    const mem = performance.memory;
    const rows = [
      ["Markdown files", String(s.files)],
      ["Notes with properties", String(s.notes)],
      ["Model notes", String(s.elements)],
      ["Authored links", String(s.links)],
      ["Index build", `${(s.ms / 1e3).toFixed(2)} s (target under 60 s)`, s.ms > 6e4],
      ["Findings scan", `${this.lastFindingsMs} ms`],
      ["Missing inverses", String(f.missingInverse.length), f.missingInverse.length > 0],
      ["Inverses with no forward link", String(f.orphanInverse.length), f.orphanInverse.length > 0],
      ["Links that break endpoint rules", String(f.offRule.length)],
      ["Provisional links (tracesTo)", String(f.provisional.length)],
      ["Unresolved relationship links", String(f.unresolvedLinks), f.unresolvedLinks > 0],
      ["relationships.yaml", schema.relationshipsVersion],
      ["element-types.yaml", schema.elementTypesVersion],
      ["Editing", editingBlocked(schema) ? "off (schema too old)" : "on", editingBlocked(schema)]
    ];
    if (mem) rows.push(["JavaScript heap in use", `${Math.round(mem.usedJSHeapSize / 1048576)} MB (whole Obsidian window)`]);
    new ReportModal(this.app, "MDSE Workbench diagnostics", rows, schema.warnings).open();
  }
  async explore(starts) {
    if (!this.ready()) return;
    const index = this.indexer.index;
    const t0 = performance.now();
    const view = traverse(index, starts, STRUCTURE_PROFILE);
    if (view.depthOf.size <= 1 && view.omitted.size === 0) {
      new import_obsidian5.Notice("Nothing to show: this note has no structure links (hasPart, hasChild, includes, hasPort, exposes, hasFlow).");
      return;
    }
    const canvas = toCanvas(index, view);
    const name = (index.notes.get(starts[0])?.name ?? "view").replace(/[\\/:*?"<>|#^[\]]/g, "_");
    const folder = (0, import_obsidian5.normalizePath)(this.settings.viewsFolder);
    if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
    const path = (0, import_obsidian5.normalizePath)(`${folder}/${name} - ${view.profile}.canvas`);
    const json = JSON.stringify(canvas, null, "	");
    const existing = this.app.vault.getAbstractFileByPath(path);
    const file = existing instanceof import_obsidian5.TFile ? (await this.app.vault.modify(existing, json), existing) : await this.app.vault.create(path, json);
    this.views[path] = { starts: view.starts, profile: view.profile, signature: signature(view), at: Date.now() };
    await this.saveAll();
    const ms = Math.round(performance.now() - t0);
    await this.app.workspace.getLeaf(true).openFile(file);
    new import_obsidian5.Notice(`${view.profile}: ${view.depthOf.size} notes in ${ms} ms${view.capReached ? `, stopped at the ${STRUCTURE_PROFILE.nodeCap}-note limit` : ""}.`);
  }
  async checkView() {
    if (!this.ready()) return;
    const f = this.app.workspace.getActiveFile();
    const meta = f ? this.views[f.path] : void 0;
    if (!f || !meta) {
      new import_obsidian5.Notice("Open a view generated by Workbench first.");
      return;
    }
    const now = signature(traverse(this.indexer.index, meta.starts, STRUCTURE_PROFILE));
    if (now === meta.signature) new import_obsidian5.Notice("This view is current.");
    else
      new ConfirmModal(this.app, "The model changed since this view was generated.", "Refresh view", () => void this.explore(meta.starts)).open();
  }
  elements() {
    const index = this.indexer.index;
    return [...index.notes.values()].filter((r) => index.isElement(r)).sort((a, b) => a.name.localeCompare(b.name));
  }
  pickTargetThenRelate(firstPath) {
    if (!this.ready()) return;
    const first = this.indexer.index.notes.get(firstPath);
    if (!this.indexer.index.isElement(first)) {
      new import_obsidian5.Notice("This note has no known type, so Workbench cannot relate it.");
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
    if (!this.ready()) return;
    const index = this.indexer.index;
    const a = index.notes.get(firstPath);
    const b = index.notes.get(secondPath);
    if (!index.isElement(a) || !index.isElement(b)) {
      new import_obsidian5.Notice("Both notes need a known type to be related.");
      return;
    }
    const options = optionsBetween(this.schema, a.type, b.type);
    new RelationshipPicker(this.app, options, a, b, async (o) => {
      const [owner, target] = o.ownerIsFirst ? [a, b] : [b, a];
      try {
        const tx = await this.writer.add(o.def, owner.path, target.path);
        new import_obsidian5.Notice(tx.files.length ? `Added: ${owner.name} ${o.def.field} ${target.name}.` : "That link already exists.");
      } catch (e) {
        new import_obsidian5.Notice(`Not added: ${e.message}`);
      }
    }).open();
  }
  async undo() {
    if (!this.writer) return;
    new import_obsidian5.Notice(await this.writer.undo());
  }
};
var WorkbenchSettings = class extends import_obsidian5.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    const text = (name, desc, key) => new import_obsidian5.Setting(containerEl).setName(name).setDesc(desc).addText(
      (t) => t.setValue(this.plugin.settings[key]).onChange(async (v) => {
        this.plugin.settings[key] = v.trim();
        await this.plugin.saveAll();
      })
    );
    text("Relationship schema", "Path to relationships.yaml in this vault.", "relationshipsPath");
    text("Element types", "Path to element-types.yaml in this vault.", "elementTypesPath");
    text("Generated views folder", "Generated canvases are written here. Add this folder to .gitignore.", "viewsFolder");
    new import_obsidian5.Setting(containerEl).setName("Canvas probe").setDesc("Adds 'Relate selected notes' to the canvas right-click menu, to test whether Canvas editing is possible (Phase 0). Reload Obsidian after changing.").addToggle(
      (t) => t.setValue(this.plugin.settings.canvasProbe).onChange(async (v) => {
        this.plugin.settings.canvasProbe = v;
        await this.plugin.saveAll();
      })
    );
  }
};
