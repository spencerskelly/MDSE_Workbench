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

/** Adds `[[target]]` to a list field. Returns false when it was already there. */
export function addLink(fm: Frontmatter, field: string, target: string): boolean {
  const list = asList(fm[field]);
  if (list.some((v) => linkTarget(v)?.toLowerCase() === target.toLowerCase())) return false;
  list.push(`[[${target}]]`);
  fm[field] = sortLinks(list);
  return true;
}

/** Removes `target` from a list field. Returns false when it was not there. */
export function removeLink(fm: Frontmatter, field: string, target: string): boolean {
  const list = asList(fm[field]);
  const kept = list.filter((v) => linkTarget(v)?.toLowerCase() !== target.toLowerCase());
  if (kept.length === list.length) return false;
  fm[field] = kept;
  return true;
}

/**
 * Property order (W-97, W-126): common properties with the translated-only ones before
 * `tags`, then relationship fields in the order of relationships.yaml, then anything else
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
  return [...common, ...rel];
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
