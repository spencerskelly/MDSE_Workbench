/**
 * Feeds the pure ModelIndex from Obsidian's own metadata cache (works on desktop and mobile,
 * WB-087). Builds in chunks so Obsidian stays responsive (WB-081).
 */
import { App, getLinkpath, TFile } from "obsidian";
import { ModelIndex, type NoteRecord } from "../core/model";
import type { Schema } from "../core/schema";

const CHUNK = 500;
/** After this many outside changes, rebuild instead of patching (WB-086). */
const REBUILD_AFTER = 300;

export interface BuildStats {
  files: number;
  notes: number;
  elements: number;
  links: number;
  ms: number;
  builtAt: number;
}

export class Indexer {
  index: ModelIndex;
  stats: BuildStats | null = null;
  building = false;
  private pendingChanges = 0;

  constructor(private readonly app: App, private schema: Schema) {
    this.index = new ModelIndex(schema);
  }

  setSchema(schema: Schema): void {
    this.schema = schema;
  }

  record(file: TFile): NoteRecord | null {
    const cache = this.app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (!fm) return null;
    const fields = new Map<string, string[]>();
    let unresolved = 0;
    for (const fl of cache.frontmatterLinks ?? []) {
      const field = fl.key.split(".")[0];
      if (!this.schema.byField.has(field) && !this.schema.byInverse.has(field)) continue;
      const dest = this.app.metadataCache.getFirstLinkpathDest(getLinkpath(fl.link), file.path);
      if (!dest) {
        unresolved++;
        continue;
      }
      let list = fields.get(field);
      if (!list) fields.set(field, (list = []));
      if (!list.includes(dest.path)) list.push(dest.path);
    }
    const str = (v: unknown) => (v === undefined || v === null || v === "" ? undefined : String(v));
    return { path: file.path, name: file.basename, type: str(fm.type), id: str(fm.id), uid: str(fm.uid), fields, unresolved };
  }

  async build(): Promise<BuildStats> {
    this.building = true;
    const t0 = performance.now();
    const index = new ModelIndex(this.schema);
    const files = this.app.vault.getMarkdownFiles();
    for (let i = 0; i < files.length; i++) {
      const rec = this.record(files[i]);
      if (rec) index.upsert(rec);
      if (i % CHUNK === CHUNK - 1) await new Promise((r) => window.setTimeout(r, 0));
    }
    this.index = index;
    this.pendingChanges = 0;
    this.building = false;
    let elements = 0;
    for (const r of index.notes.values()) if (index.isElement(r)) elements++;
    this.stats = {
      files: files.length,
      notes: index.size,
      elements,
      links: index.edgeCount(),
      ms: Math.round(performance.now() - t0),
      builtAt: Date.now(),
    };
    return this.stats;
  }

  /** Incremental update after one file changed. Returns true if a full rebuild is due. */
  changed(file: TFile): boolean {
    if (this.building) return false;
    const rec = this.record(file);
    if (rec) this.index.upsert(rec);
    else this.index.remove(file.path);
    return ++this.pendingChanges >= REBUILD_AFTER;
  }

  removed(path: string): void {
    if (!this.building) this.index.remove(path);
  }
}
