import type { VariantOfFinding } from "./variantof";
/**
 * Review (WB-063, Part C): turns the index's model-health findings into one list that can be
 * counted, filtered and walked with Previous / Next. Pure TypeScript, no Obsidian imports.
 */
import type { Findings, ModelIndex } from "./model";
import type { LocalFinding } from "./localmodel";

export type Category = "provisional" | "missingInverse" | "orphanInverse" | "offRule" | "broken" | "localModel" | "variantOf";

/** Display order and names. Categories with no findings are still listed, with a zero. */
export const CATEGORIES: ReadonlyArray<{ id: Category; label: string; help: string }> = [
  { id: "provisional", label: "Provisional Relationships", help: "Links written with the provisional relationship. Replace each with an approved relationship when the real one is known." },
  { id: "missingInverse", label: "Missing Inverses", help: "A link exists on one note but the generated inverse is missing on the other." },
  { id: "orphanInverse", label: "Inverses With No Forward Link", help: "An inverse entry that no forward link backs up. Regenerating inverses would remove it." },
  { id: "offRule", label: "Off-Rule Links", help: "A link whose two note types the endpoint rules do not allow. Imported links stay as findings, not errors." },
  { id: "broken", label: "Broken References", help: "A relationship field points at a note that does not exist." },
  { id: "variantOf", label: "Variant Family Findings", help: "Invalid Object variantOf links, multiple targets, missing targets, or cycles." },
  { id: "localModel", label: "Local Model Findings", help: "Problems in contextual part, endpoint, connection and flow records. These are read-only findings in WB-106." },
];

export interface Finding {
  /** Stable across rebuilds, so a finding can be recognised after the list refreshes. */
  key: string;
  category: Category;
  /** The note the link is written on. */
  from: string;
  /** The note it points at; absent for a broken reference. */
  to?: string;
  field: string;
  /** Off-rule reason. */
  reason?: string;
  /** Broken reference: the link text as written. */
  link?: string;
}

const key = (c: Category, from: string, field: string, target: string) => `${c}|${from}|${field}|${target}`;

export function toFindings(f: Findings, local: readonly LocalFinding[] = [], variants: readonly VariantOfFinding[] = []): Finding[] {
  const out: Finding[] = [];
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
  for (const v of variants) out.push({ key: key("variantOf", v.path, v.code, v.target ?? ""), category: "variantOf", from: v.path, to: v.target, field: "variantOf", reason: v.code });
  const order = new Map(CATEGORIES.map((c, i) => [c.id, i]));
  return out.sort((a, b) => (order.get(a.category) as number) - (order.get(b.category) as number) || a.from.localeCompare(b.from) || a.field.localeCompare(b.field) || (a.to ?? a.link ?? "").localeCompare(b.to ?? b.link ?? ""));
}

export function countByCategory(list: readonly Finding[]): Record<Category, number> {
  const n: Record<Category, number> = { provisional: 0, missingInverse: 0, orphanInverse: 0, offRule: 0, broken: 0, localModel: 0, variantOf: 0 };
  for (const f of list) n[f.category]++;
  return n;
}

export interface Filter {
  category?: Category;
  /** Matches note names, the relationship field and the link text, case-insensitive. */
  text?: string;
  /** Class of the note the link is written on. */
  type?: string;
  field?: string;
}

const base = (path: string) => path.replace(/^.*\//, "").replace(/\.md$/, "");

export function filterFindings(list: readonly Finding[], index: ModelIndex, f: Filter): Finding[] {
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

/** Position of the nearest finding in `direction` that is not in `skip`, or -1. */
export function neighbour(list: readonly Finding[], from: number, direction: 1 | -1, skip: ReadonlySet<string>): number {
  for (let i = from + direction; i >= 0 && i < list.length; i += direction) if (!skip.has(list[i].key)) return i;
  return -1;
}
