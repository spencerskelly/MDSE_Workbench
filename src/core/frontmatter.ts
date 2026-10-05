/**
 * Editing relationship values in a note's properties. Pure TypeScript: the Obsidian layer
 * passes the frontmatter object from `processFrontMatter`, which keeps the note body intact.
 */
import type { Schema } from "./schema";

export type Frontmatter = Record<string, unknown>;

/** `[[Name]]`, `[[Name|alias]]` or `Name` → `Name`. */
export function linkTarget(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const m = /^\s*\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]\s*$/.exec(value);
  return (m ? m[1] : value).trim() || undefined;
}

function asList(v: unknown): unknown[] {
  if (v === undefined || v === null || v === "") return [];
  return Array.isArray(v) ? [...v] : [v];
}

/**
 * Stable order for relationship lists (WB-086): sorted by target name, case-insensitive,
 * so two people adding links to the same note produce mergeable changes.
 */
function sortLinks(list: unknown[]): unknown[] {
  return list.sort((a, b) =>
    (linkTarget(a) ?? String(a)).localeCompare(linkTarget(b) ?? String(b), undefined, { sensitivity: "base" }),
  );
}

/**
 * Decides whether an existing list entry points at the same note as the link being added or removed.
 * The Obsidian layer passes a resolver-based check (W-324: a link is a file name or, where the name is
 * not unique, the shortest unique path, so two different texts can mean one note and one text can mean
 * two). Without it the comparison falls back to the link text.
 */
export type SameNote = (value: unknown) => boolean;

/** Adds `[[linkText]]` to a list field. Returns false when the note was already linked. */
export function addLink(fm: Frontmatter, field: string, linkText: string, same?: SameNote): boolean {
  const list = asList(fm[field]);
  const already = same ?? ((v: unknown) => linkTarget(v)?.toLowerCase() === linkText.toLowerCase());
  if (list.some(already)) return false;
  list.push(`[[${linkText}]]`);
  fm[field] = sortLinks(list);
  return true;
}

/**
 * Removes the entries that point at the note. Relationship frontmatter is sparse: when the final
 * target is removed, drop the property instead of persisting an empty relationship array.
 * Returns false when it was not linked.
 */
export function removeLink(fm: Frontmatter, field: string, linkText: string, same?: SameNote): boolean {
  const list = asList(fm[field]);
  const match = same ?? ((v: unknown) => linkTarget(v)?.toLowerCase() === linkText.toLowerCase());
  const kept = list.filter((v) => !match(v));
  if (kept.length === list.length) return false;
  if (kept.length) fm[field] = kept;
  else delete fm[field];
  return true;
}

/**
 * Property order (W-97, W-126): common properties with the translated-only ones before
 * `tags`, then governed sparse optional properties, then relationship fields in the order of relationships.yaml, then anything else
 * in its existing order. Where an inverse sits relative to its forward field is still an
 * open workspace decision; this keeps each inverse right after its forward field.
 */
export function canonicalOrder(schema: Schema): string[] {
  const common = [...schema.commonProperties];
  const tagsAt = common.indexOf("tags");
  common.splice(tagsAt < 0 ? common.length : tagsAt, 0, ...schema.translatedOnlyProperties);
  const rel: string[] = [];
  for (const r of schema.relationships) {
    rel.push(r.field);
    if (r.inverse) rel.push(r.inverse);
  }
  return [...common, ...schema.optionalProperties, ...rel];
}

/** Reorders `fm` in place (JavaScript keeps string-key insertion order). */
export function orderProperties(fm: Frontmatter, order: string[]): void {
  const rank = new Map(order.map((k, i) => [k, i]));
  const keys = Object.keys(fm);
  const known = keys.filter((k) => rank.has(k)).sort((a, b) => (rank.get(a) as number) - (rank.get(b) as number));
  const rest = keys.filter((k) => !rank.has(k));
  const copy: Frontmatter = { ...fm };
  for (const k of keys) delete fm[k];
  for (const k of [...known, ...rest]) fm[k] = copy[k];
}
