import { parseDocument } from "yaml";
export interface DefinitionOccurrenceMigrationRequest {
  ownerPath: string;
  localId: string;
  currentDefinitionPath: string | null;
  replacedPath: string;
  replacementPath: string;
}

export interface DefinitionOccurrenceMigrationPlan {
  ownerPath: string;
  localId: string;
  replacedPath: string;
  replacementPath: string;
  definitionLink: string;
}

/**
 * Pure planner for migrating one Local Model occurrence after definition supersession.
 *
 * The caller resolves the occurrence definition from fresh source. Migration is permitted only
 * while it still resolves to the reviewed superseded definition; this prevents a guided migration
 * from overwriting an independent reassignment made by another edit.
 */
export function planDefinitionOccurrenceMigration(
  request: DefinitionOccurrenceMigrationRequest,
): DefinitionOccurrenceMigrationPlan {
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
    definitionLink: `[[${replacementPath.replace(/\.md$/i, "")}]]`,
  };
}


export function assertDefinitionSourceUid(text: string, path: string, expectedUid: string): void {
  const match = /^---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!match) throw new Error(`${path} must begin with YAML frontmatter.`);
  const doc = parseDocument(match[1]);
  if (doc.errors.length) throw new Error(`${path} frontmatter is invalid YAML.`);
  const sourceUid = String(doc.get("uid") ?? "").trim();
  if (!sourceUid || sourceUid !== expectedUid) {
    throw new Error(
      `${path} identity changed; expected uid ${expectedUid}, found ${sourceUid || "none"}. Reopen supersession migration review.`,
    );
  }
}
