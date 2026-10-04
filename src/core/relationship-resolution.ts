/**
 * Pure relationship-link resolution from cached authored evidence (W-344 follow-on).
 *
 * This allows Workbench to re-resolve unchanged notes after file add/delete/rename events
 * without rereading their Markdown bodies. Obsidian supplies the resolver function.
 */
import type { AuthoredRelationshipLink } from "./model";
import type { Schema } from "./schema";

export interface ResolvedRelationshipEvidence {
  fields: Map<string, string[]>;
  unresolved: number;
  broken: Array<{ field: string; link: string }>;
  repeat?: Map<string, number>;
  localRefs?: Array<{ field: string; path: string; localId: string }>;
}

export type ResolveAuthoredTarget = (linkpath: string, fromPath: string) => string | undefined;

export function resolveAuthoredRelationshipLinks(
  authored: readonly AuthoredRelationshipLink[],
  fromPath: string,
  schema: Schema,
  resolve: ResolveAuthoredTarget,
): ResolvedRelationshipEvidence {
  const fields = new Map<string, string[]>();
  let unresolved = 0;
  const broken: Array<{ field: string; link: string }> = [];
  const repeat = new Map<string, number>();
  const localRefs: Array<{ field: string; path: string; localId: string }> = [];

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
    if (!list) fields.set(field, (list = []));
    if (!list.includes(path)) list.push(path);
    else repeat.set(`${field}|${path}`, (repeat.get(`${field}|${path}`) ?? 1) + 1);
  }

  return {
    fields,
    unresolved,
    broken,
    ...(repeat.size ? { repeat } : {}),
    ...(localRefs.length ? { localRefs } : {}),
  };
}

function blockId(link: string): string | null {
  const hash = link.indexOf("#^");
  if (hash < 0) return null;
  const tail = link.slice(hash + 2);
  const id = tail.split("|")[0].split("]]")[0].trim();
  return id || null;
}
