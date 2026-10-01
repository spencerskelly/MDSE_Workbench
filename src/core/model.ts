/**
 * The model index (WB-033): a disposable, rebuildable view of the vault's notes and links.
 * The files are the model; this only makes them fast to query. Pure TypeScript.
 */
import { allows } from "./rules";
import type { RelationshipDef, Schema } from "./schema";

export interface NoteRecord {
  path: string;
  /** File name without extension: the note name engineers see. */
  name: string;
  type?: string;
  id?: string;
  uid?: string;
  /** Relationship field (forward or inverse) → target note paths, resolved by the caller. */
  fields: Map<string, string[]>;
  /** Links in relationship fields whose target note does not exist. */
  unresolved: number;
  /** The same links by field and link text, for Review (optional so older callers keep working). */
  broken?: Array<{ field: string; link: string }>;
}

export interface Edge {
  from: string;
  to: string;
  field: string;
}

export interface Findings {
  /** Forward link whose generated inverse is missing on the target (W-275). */
  missingInverse: Edge[];
  /** Inverse entry with no matching forward link: it would be removed on regeneration. */
  orphanInverse: Edge[];
  /** Link that breaks its endpoint rule (W-277 principle). */
  offRule: Array<Edge & { reason: string }>;
  /** Provisional links to replace (tracesTo, W-288). */
  provisional: Edge[];
  /** Relationship-field links that point at no note. */
  unresolvedLinks: number;
  /** The unresolved links one by one, for Review. */
  broken: Array<{ from: string; field: string; link: string }>;
}

export class ModelIndex {
  readonly notes = new Map<string, NoteRecord>();
  private readonly outEdges = new Map<string, Edge[]>();
  private readonly inEdges = new Map<string, Edge[]>();

  constructor(private readonly schema: Schema) {}

  get size(): number {
    return this.notes.size;
  }

  /** Model notes: notes whose `type` is a class in element-types.yaml. */
  isElement(rec: NoteRecord | undefined): rec is NoteRecord & { type: string } {
    return !!rec && !!rec.type && this.schema.classNames.has(rec.type);
  }

  upsert(rec: NoteRecord): void {
    this.remove(rec.path);
    this.notes.set(rec.path, rec);
    const out: Edge[] = [];
    for (const [field, targets] of rec.fields) {
      if (!this.schema.byField.has(field)) continue; // inverse or unknown field: not an authored link
      for (const to of targets) {
        const e = { from: rec.path, to, field };
        out.push(e);
        let list = this.inEdges.get(to);
        if (!list) this.inEdges.set(to, (list = []));
        list.push(e);
      }
    }
    if (out.length) this.outEdges.set(rec.path, out);
  }

  remove(path: string): void {
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

  out(path: string): readonly Edge[] {
    return this.outEdges.get(path) ?? [];
  }

  in(path: string): readonly Edge[] {
    return this.inEdges.get(path) ?? [];
  }

  edgeCount(): number {
    let n = 0;
    for (const list of this.outEdges.values()) n += list.length;
    return n;
  }

  private hasLink(path: string, field: string, target: string): boolean {
    return this.notes.get(path)?.fields.get(field)?.includes(target) ?? false;
  }

  findings(): Findings {
    const f: Findings = { missingInverse: [], orphanInverse: [], offRule: [], provisional: [], unresolvedLinks: 0, broken: [] };
    for (const rec of this.notes.values()) {
      f.unresolvedLinks += rec.unresolved;
      for (const b of rec.broken ?? []) f.broken.push({ from: rec.path, ...b });
      for (const e of this.out(rec.path)) {
        const def = this.schema.byField.get(e.field) as RelationshipDef;
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
      // Inverse entries on this note that no forward link backs up.
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
}
